import { useState, useEffect, useRef } from 'react';
import { saveNote, attachToNote, attachToGraphNode, saveReference } from '../lib/persist';
import SmartImage from './SmartImage';
import { saveMistake, attachToMistake } from '../lib/mistakes';
import { getNodeSummary, voiceFallbackChat, computeMath } from '../lib/api';
import { startVoiceSession, endVoiceSession, logFeatureUsage } from '../lib/subscriptionApi';
import { getSpeechLocale, type AppLocale } from '../lib/locale';
import { useWorkspace } from '../context/WorkspaceContext';
import { getApiBaseUrl } from '../lib/apiBase';
import { useTranslation } from '../i18n/I18nContext';

// Gemini 2.0 Flash + v1alpha BidiGenerateContent were shut down 2026-06-01.
// Live voice now runs on the native-audio Live model over v1beta (see backend/app/main.py).
const LIVE_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

// After this long with no new user speech and no AI audio, hand the turn to
// ARI — same signal a manual mute sends. The session itself stays open and
// keeps listening; this no longer disconnects anything (see sendAudioStreamEnd).
const SILENCE_AUTO_CLOSE_MS = 20000;

interface S2SVoiceOverlayProps {
  onNewMessage: (role: 'user' | 'assistant', content: string, model?: string) => void;
  systemInstruction: string;
  enableAutoSave?: boolean;
  voiceName?: 'Puck' | 'Aoede' | 'Charon' | 'Kore' | 'Fenrir';
  locale?: AppLocale;
  /** If true, mic starts muted (push-to-talk mode). Default: false (always-listen). */
  startMuted?: boolean;
}

/**
 * ARI's always-on background voice session. Renders as a small persistent
 * HUD (colorful orb + mic/pause buttons) fixed bottom-right — never a
 * fullscreen takeover, so the rest of the workspace stays fully usable while
 * ARI is connected and listening. Mounted once by VoiceOrb and stays alive
 * for as long as the user is in the workspace.
 */
export default function S2SVoiceOverlay({
  onNewMessage,
  systemInstruction,
  enableAutoSave = false,
  voiceName = 'Puck',
  locale = 'en',
  startMuted = false,
}: S2SVoiceOverlayProps) {
  const { t } = useTranslation();
  const { activeTab } = useWorkspace();
  const [status, setStatus] = useState<'connecting' | 'idle' | 'listening' | 'speaking' | 'paused' | 'error' | 'fallback'>('connecting');
  const [isMuted, setIsMuted] = useState(startMuted);
  const [liveUserTranscription, setLiveUserTranscription] = useState('');
  const [liveAiTranscription, setLiveAiTranscription] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'note' | 'mistake' | 'research'; images?: string[] } | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null);
  // Typed mode — ARI is the default help/Q&A surface now that Dialogue is
  // gone, and not everyone wants to talk out loud. Defaults from Settings'
  // "Trợ lý mặc định" toggle; switchable live from the HUD regardless.
  const [textMode, setTextMode] = useState(() => {
    try { return localStorage.getItem('ari-default-mode') === 'text'; } catch { return false; }
  });
  const [typedInput, setTypedInput] = useState('');
  const [typedBusy, setTypedBusy] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const recognitionRef = useRef<any>(null);

  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const aiAnalyserRef = useRef<AnalyserNode | null>(null);
  const activeAnalyserRef = useRef<AnalyserNode | null>(null);

  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const nextPlayTimeRef = useRef(0);

  const currentTurnUserTextRef = useRef('');
  const currentTurnAiTextRef = useRef('');

  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackHistoryRef = useRef<{ role: string; content: string }[]>([]);
  // Last thing Gemma researched — what an [ATTACH: ...] tag attaches.
  const lastResearchRef = useRef<{ topic: string; imageUrl?: string; imageUrls?: string[]; sourceUrl?: string } | null>(null);

  // Mirrors `status` for the async callbacks inside the setup effect below.
  // The effect itself must NOT depend on `status` (it calls setStatus internally —
  // that turned every connecting→idle→listening→speaking transition into a full
  // WebSocket/mic teardown+rebuild, i.e. the connecting/listening reconnect loop).
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  // Same story for `isMuted`: keeping it out of the setup effect's dependency
  // array means clicking mute doesn't tear down and reconnect the whole
  // mic/WS/audio pipeline — it just flips a ref the processor/recognition
  // callbacks already read live.
  const isMutedRef = useRef(isMuted);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  // Explicit "my turn is over" signal to Gemini — documented for exactly this
  // case (mic turned off) when automatic activity detection is enabled. Safe
  // to call repeatedly; sending new audio afterwards implicitly resumes the
  // stream, so this never has to mean "disconnect."
  function sendAudioStreamEnd() {
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      }
    } catch { /* ignore */ }
  }

  function armSilenceTimer() {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      sendAudioStreamEnd();
    }, SILENCE_AUTO_CLOSE_MS);
  }

  // Manual mute click = the same "it's ARI's turn" handoff, sent immediately
  // instead of waiting out the 20s timer.
  useEffect(() => {
    if (isMuted) {
      clearSilenceTimer();
      sendAudioStreamEnd();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMuted]);

  function showToastMsg(message: string, type: 'note' | 'mistake' | 'research' | 'attach', images?: string[]) {
    setToast({ message, type, images });
    setTimeout(() => setToast(null), type === 'research' ? 8000 : 5000);
  }

  // Ari's "researcher" — calls the Gemma-backed /ai/node-summary endpoint for
  // out-of-band reference material (a mistake that needs more explanation, a
  // concept a note/graph didn't cover, etc.), shows it as a toast, and feeds
  // the result back into the live session as a text turn so Ari can actually
  // talk about it on its next reply instead of just silently fetching it.
  // Also remembers {topic, imageUrls, sourceUrl} so a follow-up [ATTACH: ...]
  // tag knows what to attach and where the source link points.
  // Core lookup: runs the Gemma-backed search, toasts + saves it to the
  // Reference Bank, and returns a plain-text result summary. Callers decide
  // how to feed that back to whichever model is currently active.
  async function runResearch(topic: string): Promise<{ text: string; imageUrls: string[]; sourceUrl?: string }> {
    const result = await getNodeSummary(topic);
    const text = result.definition || result.summary || '';
    const imageUrls = result.image_urls?.length ? result.image_urls : (result.image_url ? [result.image_url] : []);
    // Prefer the backend's real citation (Wikipedia article / Knowledge Graph
    // entity page) — only fall back to a generic search link if it truly
    // couldn't find one, so the source is an actual reference, not a query.
    const sourceUrl = result.source_url || `https://www.google.com/search?q=${encodeURIComponent(topic)}`;
    if (text) {
      lastResearchRef.current = { topic, imageUrl: imageUrls[0], imageUrls, sourceUrl };
      showToastMsg(text, 'research', imageUrls);
      saveReference({ topic, summary: text, imageUrl: imageUrls[0], imageUrls, sourceUrl, category: activeTab || undefined });

      // Log reference library usage
      try {
        await logFeatureUsage('reference_library_item', { topic });
      } catch (err) {
        console.error('Failed to log reference library usage:', err);
      }
    }
    return { text, imageUrls, sourceUrl };
  }

  // Text-tag path (used by the GPT fallback, and as a legacy path for Live —
  // superseded there by the toolCall handler in ws.onmessage, which is the
  // reliable mechanism since it doesn't depend on the model speaking a
  // bracket tag out loud).
  async function handleResearch(topic: string) {
    try {
      const { text, imageUrls } = await runResearch(topic);
      if (!text) return;
      const relayText = `[Gemma researched "${topic}": ${text}${imageUrls.length ? ' (with an illustrative image)' : ''}. Summarize this briefly for the student out loud.]`;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text: relayText }] }],
            turnComplete: true,
          },
        }));
      } else if (statusRef.current === 'fallback') {
        // Same relay, just routed through the GPT fallback loop instead.
        runFallbackTurn(relayText, true);
      }
    } catch (e) {
      console.error('ARI research lookup failed:', e);
    }
  }

  // "Attach that image/source to note X" — attaches whatever Gemma last researched
  // to a Note, Mistake Bank entry, or Knowledge Tree node (fuzzy-matched by
  // title). Deliberately excludes PDF problem sets — those are fixed
  // documents, not editable app records.
  function handleAttach(targetType: string, targetText: string): boolean {
    const research = lastResearchRef.current;
    if (!research) {
      showToastMsg(t('voice.noRef'), 'attach');
      return false;
    }
    const patch = { imageUrl: research.imageUrl, sourceUrl: research.sourceUrl, sourceLabel: research.topic };
    const type = targetType.trim().toLowerCase();
    let ok = false;
    if (type.startsWith('note')) ok = attachToNote(targetText, patch);
    else if (type.startsWith('mistake')) ok = attachToMistake(targetText, patch);
    else if (type.startsWith('node') || type.startsWith('graph')) ok = attachToGraphNode(targetText, patch);

    showToastMsg(
      ok ? t('voice.attached', { target: targetText }) : t('voice.attachFailed', { target: targetText }),
      'attach',
    );
    return ok;
  }

  // ── GPT (NVIDIA gpt-oss-20b) fallback — kicks in only when Gemini Live's
  // WebSocket is unreachable. The mic + SpeechRecognition never stop; this
  // just routes finished utterances to a text model instead, and speaks the
  // reply back via the browser's own speechSynthesis.
  function speakText(text: string) {
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = getSpeechLocale(locale);
      utter.onstart = () => setStatus('speaking');
      utter.onend = () => setStatus('fallback');
      utter.onerror = () => setStatus('fallback');
      window.speechSynthesis.speak(utter);
    } catch { /* speechSynthesis unsupported — reply stays text-only */ }
  }

  async function runFallbackTurn(overrideText?: string, silent = false) {
    const userText = (overrideText ?? currentTurnUserTextRef.current).trim();
    if (!userText) return;
    currentTurnUserTextRef.current = '';
    setLiveUserTranscription('');
    if (!silent) {
      fallbackHistoryRef.current.push({ role: 'user', content: userText });
      onNewMessage('user', userText);
    }
    try {
      const reply = await voiceFallbackChat(fallbackHistoryRef.current.slice(-12), systemInstruction);
      if (!reply) return;
      const researchMatch = reply.match(/\[RESEARCH:\s*([^\]]+)\]/i);
      const attachMatch = reply.match(/\[ATTACH:\s*(note|mistake|node|graph)\s*\|\s*([^\]]+)\]/i);
      let spoken = reply.replace(/\[RESEARCH:[^\]]+\]/i, '').replace(/\[ATTACH:[^\]]+\]/i, '').trim();
      fallbackHistoryRef.current.push({ role: 'assistant', content: reply });
      onNewMessage('assistant', reply, 'gpt-oss-20b (fallback)');
      setLiveAiTranscription(spoken);
      if (spoken) speakText(spoken);
      if (researchMatch) handleResearch(researchMatch[1].trim());
      if (attachMatch) handleAttach(attachMatch[1], attachMatch[2].trim());
    } catch (e) {
      console.error('GPT fallback chat failed:', e);
    }
  }

  async function submitTyped() {
    const text = typedInput.trim();
    if (!text || typedBusy) return;
    setTypedInput('');
    setTypedBusy(true);
    try {
      await runFallbackTurn(text, false);
    } finally {
      setTypedBusy(false);
    }
  }

  function armFallbackDebounce() {
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = setTimeout(() => { runFallbackTurn(); }, 1300);
  }

  function enterFallbackMode(reason: string) {
    setErrorMessage(reason);
    fallbackHistoryRef.current = [];
    setStatus('fallback');
  }

  useEffect(() => {
    let active = true;

    function resampleTo16k(float32Array: Float32Array, sampleRate: number) {
      const targetRate = 16000;
      if (sampleRate === targetRate) return float32Array;
      const ratio = sampleRate / targetRate;
      const newLength = Math.round(float32Array.length / ratio);
      const result = new Float32Array(newLength);
      let offsetResult = 0;
      let offsetInput = 0;
      while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
        let accum = 0, count = 0;
        for (let i = offsetInput; i < nextOffsetBuffer && i < float32Array.length; i++) {
          accum += float32Array[i];
          count++;
        }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetInput = nextOffsetBuffer;
      }
      return result;
    }

    function float32ToInt16(float32Array: Float32Array) {
      const l = float32Array.length;
      const buf = new Int16Array(l);
      for (let i = 0; i < l; i++) {
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        buf[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      return buf;
    }

    function arrayBufferToBase64(buffer: ArrayBuffer) {
      let binary = '';
      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return window.btoa(binary);
    }

    function base64ToArrayBuffer(base64: string) {
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    }

    // Connect happens silently in the background (no "Connecting..." banner) —
    // this chime is the only signal the user gets that ARI is now live.
    // AudioContext may be suspended without a direct user gesture (ARI now
    // connects automatically on mount) — resume() first so the chime plays.
    function playConnectedChime(audioCtx: AudioContext) {
      audioCtx.resume().then(() => {
        try {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(760, audioCtx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(1180, audioCtx.currentTime + 0.14);
          gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.22, audioCtx.currentTime + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.32);
          osc.connect(gain).connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.35);
        } catch { /* ignore */ }
      }).catch(() => { /* ignore — chime is a nicety, not critical */ });
    }

    const handleTurnComplete = () => {
      const userText = currentTurnUserTextRef.current.trim();
      let aiText = currentTurnAiTextRef.current.trim();
      if (!userText && !aiText) return;

      const researchMatch = aiText.match(/\[RESEARCH:\s*([^\]]+)\]/i);
      if (researchMatch) {
        aiText = aiText.replace(researchMatch[0], '').trim();
        handleResearch(researchMatch[1].trim());
      }

      const attachMatch = aiText.match(/\[ATTACH:\s*(note|mistake|node|graph)\s*\|\s*([^\]]+)\]/i);
      if (attachMatch) {
        aiText = aiText.replace(attachMatch[0], '').trim();
        handleAttach(attachMatch[1], attachMatch[2].trim());
      }

      if (enableAutoSave) {
        const noteRegex = /\[NOTE:\s*([^|]+)\s*\|\s*([^\]]+)\]/i;
        const mistakeRegex = /\[MISTAKE:\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^\]]+)\]/i;

        const noteMatch = aiText.match(noteRegex);
        const mistakeMatch = aiText.match(mistakeRegex);

        if (noteMatch) {
          const title = noteMatch[1].trim();
          const content = noteMatch[2].trim();
          try {
            saveNote({
              id: crypto.randomUUID(),
              title: title,
              savedAt: Date.now(),
              sourceType: 'text',
              subject: activeTab || undefined,
              note: {
                title: title,
                tldr: content,
                concepts: [],
                takeaways: [content]
              }
            });
            showToastMsg(t('voice.savedNote', { title }), 'note');
          } catch (err) {
            console.error('Failed to save note from S2S:', err);
          }
          aiText = aiText.replace(noteRegex, '').trim();
        }

        if (mistakeMatch) {
          const mistakeText = mistakeMatch[1].trim();
          const locationText = mistakeMatch[2].trim();
          const explanationText = mistakeMatch[3].trim();
          try {
            saveMistake({
              mistake: mistakeText,
              location: locationText,
              explanation: explanationText,
              subject: activeTab || undefined,
            });
            showToastMsg(t('voice.loggedMistake', { text: mistakeText }), 'mistake');
          } catch (err) {
            console.error('Failed to save mistake from S2S:', err);
          }
          aiText = aiText.replace(mistakeRegex, '').trim();
        }
      }

      if (userText) {
        onNewMessage('user', userText);
      }
      if (aiText) {
        onNewMessage('assistant', aiText, LIVE_MODEL);
      }

      currentTurnUserTextRef.current = '';
      currentTurnAiTextRef.current = '';
      if (active) {
        setLiveUserTranscription('');
        setLiveAiTranscription('');
      }
    };

    async function initS2S() {
      try {
        if (!active) return;
        setStatus('connecting');

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContextClass();
        audioCtxRef.current = audioCtx;

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // StrictMode double-invokes this effect in dev: the throwaway first run's
        // cleanup can fire (active=false) while this getUserMedia() is still
        // pending. Without this guard the stale run would keep going — starting
        // a second SpeechRecognition + WebSocket and clobbering the refs the real
        // run is using, which is what produced the connecting/listening flapping.
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        micStreamRef.current = stream;

        const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognitionClass) {
          const rec = new SpeechRecognitionClass();
          rec.continuous = true;
          rec.interimResults = true;
          // Match speech recognition to the selected UI/assistant locale.
          rec.lang = getSpeechLocale(locale);

          rec.onresult = (e: any) => {
            // Muted: don't transcribe, don't touch status.
            if (!active || isMutedRef.current) return;
            let interim = '';
            let final = '';
            for (let i = e.resultIndex; i < e.results.length; ++i) {
              if (e.results[i].isFinal) {
                final += e.results[i][0].transcript;
              } else {
                interim += e.results[i][0].transcript;
              }
            }
            if (final) {
              currentTurnUserTextRef.current += (currentTurnUserTextRef.current ? ' ' : '') + final.trim();
              if (statusRef.current === 'fallback') {
                armFallbackDebounce();
              } else {
                armSilenceTimer();
              }
            }
            const currentShowText = currentTurnUserTextRef.current + (interim ? ' ' + interim.trim() : '');
            setLiveUserTranscription(currentShowText);

            if (statusRef.current !== 'speaking' && statusRef.current !== 'paused' && statusRef.current !== 'fallback') {
              setStatus('listening');
            }
          };

          rec.onerror = (err: any) => {
            console.warn('SpeechRecognition error:', err);
          };

          rec.onend = () => {
            if (active && statusRef.current !== 'paused' && statusRef.current !== 'connecting') {
              try { rec.start(); } catch { /* ignore */ }
            }
          };

          recognitionRef.current = rec;
          try { rec.start(); } catch (err) { console.warn('SpeechRecognition start failed:', err); }
        }

        const API_BASE = getApiBaseUrl();
        const wsUrl = API_BASE.replace(/^http/, 'ws') + '/ws/s2s';
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = async () => {
          if (!active) return;
          setStatus('idle');
          armSilenceTimer();
          playConnectedChime(audioCtx);

          // Start voice session tracking
          try {
            const session = await startVoiceSession();
            setVoiceSessionId(session.session_id);
          } catch (err) {
            console.error('Failed to start voice session tracking:', err);
          }

          const setupMsg = {
            setup: {
              model: LIVE_MODEL,
                generationConfig: {
                  responseModalities: ["AUDIO"],
                  speechConfig: {
                    languageCode: getSpeechLocale(locale),
                    voiceConfig: {
                      prebuiltVoiceConfig: {
                        voiceName: voiceName
                    }
                  }
                }
              },
              systemInstruction: {
                parts: [
                  {
                    text: systemInstruction
                  }
                ]
              },
              // Real function calling for research/attach — reliable because it's a
              // structured tool call, not text the model has to speak out loud and
              // then have us regex out of the audio transcript.
              tools: [
                {
                  functionDeclarations: [
                    {
                      name: 'research_topic',
                      description: 'Look up reference material (definition + an illustrative image if one is available) on a topic the student needs more context on — a Mistake Bank entry, a note, a graph node, or anything else that needs outside material.',
                      parameters: {
                        type: 'OBJECT',
                        properties: { topic: { type: 'STRING', description: 'Brief topic to look up' } },
                        required: ['topic'],
                      },
                    },
                    {
                      name: 'attach_reference',
                      description: 'Attach the most recently researched image/source to a Note, Mistake Bank entry, or Knowledge Tree node (never a PDF Problem Set — those cannot be attached to). Only call this after research_topic has already returned a result.',
                      parameters: {
                        type: 'OBJECT',
                        properties: {
                          target_type: { type: 'STRING', description: "'note', 'mistake', or 'node'" },
                          target_text: { type: 'STRING', description: 'Title/keyword identifying which one, e.g. the note title or a description of the mistake' },
                        },
                        required: ['target_type', 'target_text'],
                      },
                    },
                    {
                      name: 'compute_math',
                      description: 'Get an exact WolframAlpha answer for arithmetic, algebra, calculus, or unit conversion — call this to check your own arithmetic before speaking a number out loud. This is for YOUR accuracy only: still ask the student for their guess first and keep the discussion Socratic, never just read the result out as the answer.',
                      parameters: {
                        type: 'OBJECT',
                        properties: { query: { type: 'STRING', description: 'The computation to evaluate, e.g. "integral of x^2" or "15% of 340"' } },
                        required: ['query'],
                      },
                    },
                  ],
                },
              ],
              realtimeInputConfig: {
                automaticActivityDetection: {
                  disabled: false,
                  startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
                  endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
                  prefixPaddingMs: 20,
                  silenceDurationMs: 400,
                },
                activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {}
            }
          };
          ws.send(JSON.stringify(setupMsg));

          setupMicrophoneCapture(audioCtx, stream, ws);
        };

        ws.onmessage = async (event) => {
          if (!active) return;
          try {
            const data = JSON.parse(event.data);

            if (data.serverContent) {
              const modelTurn = data.serverContent.modelTurn;
              if (modelTurn && modelTurn.parts) {
                for (const part of modelTurn.parts) {
                  if (part.inlineData && part.inlineData.data) {
                    armSilenceTimer();
                    playAudioChunk(part.inlineData.data, audioCtx);
                  }
                  if (part.text) {
                    currentTurnAiTextRef.current += part.text;
                    setLiveAiTranscription(currentTurnAiTextRef.current);
                  }
                }
              }

              if (data.serverContent.inputTranscription?.text) {
                currentTurnUserTextRef.current += data.serverContent.inputTranscription.text;
                setLiveUserTranscription(currentTurnUserTextRef.current);
                armSilenceTimer();
              }

              if (data.serverContent.outputTranscription?.text) {
                currentTurnAiTextRef.current += data.serverContent.outputTranscription.text;
                setLiveAiTranscription(currentTurnAiTextRef.current);
                armSilenceTimer();
              }

              if (data.serverContent.turnComplete) {
                handleTurnComplete();
              }
            }

            if (data.toolCall?.functionCalls) {
              armSilenceTimer();
              const functionResponses = await Promise.all(
                data.toolCall.functionCalls.map(async (call: { id: string; name: string; args: any }) => {
                  let response: Record<string, unknown> = {};
                  try {
                    if (call.name === 'research_topic') {
                      const { text, imageUrls } = await runResearch(String(call.args?.topic || ''));
                      response = text
                        ? { result: text, has_image: imageUrls.length > 0 }
                        : { result: t('voice.noRefFound') };
                    } else if (call.name === 'attach_reference') {
                      const ok = handleAttach(String(call.args?.target_type || ''), String(call.args?.target_text || ''));
                      response = { attached: ok };
                    } else if (call.name === 'compute_math') {
                      const { result, configured } = await computeMath(String(call.args?.query || ''));
                      response = configured
                        ? { result: result ?? t('voice.noWolfram') }
                        : { result: t('voice.noPlugin') };
                    }
                  } catch (e) {
                    console.error(`Tool call ${call.name} failed:`, e);
                    response = { error: t('voice.lookupFailed') };
                  }
                  return { id: call.id, name: call.name, response };
                })
              );
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ toolResponse: { functionResponses } }));
              }
            }
          } catch (e) {
            console.error('Error parsing WS message:', e);
          }
        };

        ws.onerror = (err) => {
          console.error('WebSocket Error:', err);
          clearSilenceTimer();
          if (active) {
            enterFallbackMode(t('voice.gemmaFallback'));
          }
        };

        ws.onclose = (evt) => {
          clearSilenceTimer();
          if (active && statusRef.current !== 'fallback') {
            let reason = evt.reason || t('voice.connectionClosed');
            try {
              const parsed = JSON.parse(evt.reason);
              reason = parsed.error || parsed.message || reason;
            } catch { /* reason stays as-is */ }
            enterFallbackMode(`${reason} — switched ARI to the GPT fallback.`);
          }
        };

      } catch (e: any) {
        console.error('S2S Init failed:', e);
        if (active) {
          setStatus('error');
          setErrorMessage(e.message || t('voice.micError'));
        }
      }
    }

    function setupMicrophoneCapture(audioCtx: AudioContext, stream: MediaStream, ws: WebSocket) {
      const micSource = audioCtx.createMediaStreamSource(stream);
      micSourceRef.current = micSource;

      const micAnalyser = audioCtx.createAnalyser();
      micAnalyser.fftSize = 256;
      micSource.connect(micAnalyser);
      micAnalyserRef.current = micAnalyser;
      activeAnalyserRef.current = micAnalyser;

      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        if (!active || ws.readyState !== WebSocket.OPEN || isMutedRef.current || statusRef.current === 'paused' || statusRef.current === 'connecting') return;

        const inputData = e.inputBuffer.getChannelData(0);
        const resampled = resampleTo16k(inputData, audioCtx.sampleRate);
        const pcm16 = float32ToInt16(resampled);

        const base64 = arrayBufferToBase64(pcm16.buffer);
        ws.send(JSON.stringify({
          realtimeInput: {
            audio: {
              mimeType: "audio/pcm;rate=16000",
              data: base64
            }
          }
        }));
      };

      processor.connect(audioCtx.destination);
      micSource.connect(processor);
      processorNodeRef.current = processor;
    }

    function playAudioChunk(base64Data: string, audioCtx: AudioContext) {
      const arrayBuffer = base64ToArrayBuffer(base64Data);
      const int16Array = new Int16Array(arrayBuffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7FFF);
      }

      const buffer = audioCtx.createBuffer(1, float32Array.length, 24000);
      buffer.getChannelData(0).set(float32Array);

      audioQueueRef.current.push(buffer);
      processPlaybackQueue(audioCtx);
    }

    function processPlaybackQueue(audioCtx: AudioContext) {
      if (isPlayingRef.current && nextPlayTimeRef.current > audioCtx.currentTime + 0.05) {
        return;
      }
      if (audioQueueRef.current.length === 0) {
        if (isPlayingRef.current && audioCtx.currentTime >= nextPlayTimeRef.current) {
          isPlayingRef.current = false;
          setStatus('idle');
          activeAnalyserRef.current = micAnalyserRef.current;
          armSilenceTimer();
        }
        return;
      }

      setStatus('speaking');
      isPlayingRef.current = true;
      const buffer = audioQueueRef.current.shift()!;
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;

      if (!aiAnalyserRef.current) {
        const aiAnalyser = audioCtx.createAnalyser();
        aiAnalyser.fftSize = 256;
        aiAnalyserRef.current = aiAnalyser;
      }

      source.connect(aiAnalyserRef.current!);
      aiAnalyserRef.current!.connect(audioCtx.destination);
      activeAnalyserRef.current = aiAnalyserRef.current;

      const startTime = Math.max(audioCtx.currentTime, nextPlayTimeRef.current);
      source.start(startTime);
      nextPlayTimeRef.current = startTime + buffer.duration;

      source.onended = () => {
        processPlaybackQueue(audioCtx);
      };
    }

    // Runs once, at mount — ARI connects the moment it's in the workspace.
    initS2S();

    return () => {
      active = false;
      clearSilenceTimer();

      // End voice session tracking
      if (voiceSessionId) {
        endVoiceSession(voiceSessionId).catch(err =>
          console.error('Failed to end voice session:', err)
        );
      }

      try { recognitionRef.current?.stop(); } catch {}
      try { micStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
      try { processorNodeRef.current?.disconnect(); } catch {}
      try { micSourceRef.current?.disconnect(); } catch {}
      try { micAnalyserRef.current?.disconnect(); } catch {}
      try { aiAnalyserRef.current?.disconnect(); } catch {}
      try { audioCtxRef.current?.close(); } catch {}
      try { wsRef.current?.close(); } catch {}
    };
  // Mount-once. Mute and pause/resume are read live via isMutedRef / statusRef
  // inside the callbacks above — neither needs to rebuild the WebSocket/mic/
  // AudioContext pipeline.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ringColor =
    status === 'speaking' ? 'rgba(52,211,153,0.7)' :
    status === 'listening' ? 'rgba(96,165,250,0.7)' :
    status === 'error' ? 'rgba(248,113,113,0.7)' :
    status === 'fallback' ? 'rgba(251,191,36,0.6)' :
    status === 'paused' ? 'rgba(255,255,255,0.15)' :
    'rgba(139,92,246,0.35)';

  return (
    <>
      {toast && (
        <div className="fixed bottom-40 right-6 z-40 max-w-xs glass-strong rounded-2xl p-3 shadow-2xl animate-scale-in">
          <div className="flex gap-3 items-start">
            {toast.images && toast.images.length > 0 && (
              <SmartImage src={toast.images[0]} alt="" onClick={() => setLightboxImage(toast.images![0])}
                className="w-12 h-12 rounded-xl object-cover flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity" />
            )}
            <div className="min-w-0">
              <span className="font-sans text-[9px] uppercase tracking-[2px] text-white/40 block mb-1">
                {toast.type === 'research' ? t('voice.toastResearch') :
                 toast.type === 'attach' ? t('voice.toastAttached') :
                 toast.type === 'mistake' ? t('voice.toastMistake') : t('voice.toastNote')}
              </span>
              <p className="font-sans text-xs text-white/85 leading-relaxed line-clamp-4">{toast.message}</p>
            </div>
          </div>
          {/* Extra reference images (2nd/3rd) — small strip, click to view full-size on a blurred backdrop */}
          {toast.images && toast.images.length > 1 && (
            <div className="flex gap-2 mt-2 pl-[60px]">
              {toast.images.slice(1, 3).map((img, i) => (
                <SmartImage key={i} src={img} alt="" onClick={() => setLightboxImage(img)}
                  className="w-9 h-9 rounded-lg object-cover cursor-pointer opacity-80 hover:opacity-100 transition-opacity" />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lightbox: full-size reference image on a blurred backdrop */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[250] flex items-center justify-center p-8 bg-black/60 backdrop-blur-xl animate-scale-in"
          onClick={() => setLightboxImage(null)}
        >
          <SmartImage src={lightboxImage} alt="" className="max-w-full max-h-full rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightboxImage(null)}
            className="absolute top-6 right-6 w-10 h-10 rounded-full glass-strong flex items-center justify-center text-white/80 hover:text-white transition-colors">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
      )}

      {/* Live captions — small, non-blocking, only while there's something to show */}
      {(liveUserTranscription || liveAiTranscription) && status !== 'paused' && (
        <div className="fixed bottom-40 left-6 z-30 max-w-xs glass-strong rounded-2xl px-4 py-3 pointer-events-none">
          {liveUserTranscription && (
            <p className="font-sans text-xs text-white/60 leading-relaxed mb-1">{liveUserTranscription}</p>
          )}
          {liveAiTranscription && (
            <p className="font-sans text-xs text-emerald-300/90 font-medium leading-relaxed">{liveAiTranscription}</p>
          )}
        </div>
      )}

      {(status === 'error' || status === 'fallback') && errorMessage && (
        <div className={`fixed bottom-40 right-24 z-30 max-w-[220px] glass-strong rounded-2xl px-4 py-3 text-[11px] leading-relaxed ${status === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
          {errorMessage}
        </div>
      )}

      {/* Persistent HUD — mic + pause sit right next to the colorful orb,
          fixed on top of the workspace, never blocking it. Part of the
          bottom-right stack shared with FloatingPodcast (bottom-6),
          StudyCycleTimer (bottom-[12rem]) and Support (bottom-[17rem]) —
          fixed at bottom-24 on every breakpoint so it never collapses back
          onto Podcast's slot the way the old md:bottom-8 override did. */}
      {textMode && (
        <div className="fixed bottom-[9.5rem] right-6 z-40 w-72 glass-strong rounded-2xl p-2.5 flex items-center gap-2">
          <input
            value={typedInput} onChange={e => setTypedInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitTyped(); }}
            placeholder="Hỏi ARI…"
            autoFocus
            className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-xs text-white/85 outline-none border border-white/10 focus:border-white/25"
          />
          <button onClick={submitTyped} disabled={!typedInput.trim() || typedBusy}
            className="text-white/70 hover:text-white disabled:opacity-30 flex-shrink-0">
            <span className="material-symbols-outlined text-[18px]">send</span>
          </button>
        </div>
      )}

      <div className="fixed bottom-24 right-6 z-40 flex items-center gap-3">
        <button
          onClick={() => setTextMode(m => !m)}
          className={`w-10 h-10 rounded-full border transition-all flex items-center justify-center flex-shrink-0 ${
            textMode
              ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
              : 'glass hover:bg-white/10 border-white/10 text-white/80'
          }`}
          title={textMode ? 'Chuyển sang giọng nói' : 'Gõ thay vì nói'}
        >
          <span className="material-symbols-outlined text-[16px]">{textMode ? 'keyboard_voice' : 'keyboard'}</span>
        </button>

        <button
          onClick={() => setIsMuted(m => !m)}
          className={`w-10 h-10 rounded-full border transition-all flex items-center justify-center flex-shrink-0 ${
            isMuted
              ? 'bg-red-500/20 border-red-500/40 text-red-400'
              : 'glass hover:bg-white/10 border-white/10 text-white/80'
          }`}
          title={isMuted ? t('voice.micOn') : t('voice.micOff')}
        >
          <span className="material-symbols-outlined text-[16px]">{isMuted ? 'mic_off' : 'mic'}</span>
        </button>

        <button
          onClick={() => setStatus(s => s === 'paused' ? 'idle' : 'paused')}
          className={`w-10 h-10 rounded-full border transition-all flex items-center justify-center flex-shrink-0 ${
            status === 'paused'
              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
              : 'glass hover:bg-white/10 border-white/10 text-white/80'
          }`}
          title={status === 'paused' ? t('voice.resume') : t('voice.pause')}
        >
          <span className="material-symbols-outlined text-[18px]">{status === 'paused' ? 'play_arrow' : 'pause'}</span>
        </button>

        {/* The orb itself — color ring reflects live status */}
        <div
          className="w-16 h-16 rounded-full glass-strong flex items-center justify-center flex-shrink-0 transition-shadow duration-500"
          style={{ boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 24px ${ringColor}` }}
          title={
            status === 'speaking' ? t('voice.speaking') :
            status === 'listening' ? t('voice.listening') :
            status === 'paused' ? t('voice.paused') :
            status === 'error' ? t('voice.connError') :
            status === 'fallback' ? t('voice.gptFallback') :
            t('voice.bgListening')
          }
        >
          <span className="voice-orb-ring absolute inset-0 rounded-full pointer-events-none" style={{ borderColor: ringColor, animationDelay: '0s' }} />
          <span className="voice-orb-ring absolute inset-0 rounded-full pointer-events-none" style={{ borderColor: ringColor, animationDelay: '0.9s' }} />

          <span className="relative w-11 h-11 rounded-full glass flex items-center justify-center overflow-hidden">
            <span
              className="voice-orb-mesh absolute inset-[-4px] rounded-full transition-opacity"
              style={{
                opacity: status === 'paused' ? 0.35 : status === 'speaking' ? 1 : 0.8,
                animation: `orb-pulse ${status === 'speaking' ? 1.4 : 3.2}s ease-in-out infinite, orb-mesh-spin ${status === 'listening' ? 3 : 6}s linear infinite`,
              }}
            />
            <span className="relative z-10 w-4 h-4 rounded-full bg-white/90" />
          </span>
        </div>
      </div>
    </>
  );
}
