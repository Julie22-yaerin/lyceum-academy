import { useState, useEffect, useRef } from 'react';
import { saveNote, attachToNote, attachToGraphNode } from '../lib/persist';
import { saveMistake, attachToMistake } from '../lib/mistakes';
import { getNodeSummary, voiceFallbackChat } from '../lib/api';

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
  startMuted = false,
}: S2SVoiceOverlayProps) {
  const [status, setStatus] = useState<'connecting' | 'idle' | 'listening' | 'speaking' | 'paused' | 'error' | 'fallback'>('connecting');
  const [isMuted, setIsMuted] = useState(startMuted);
  const [liveUserTranscription, setLiveUserTranscription] = useState('');
  const [liveAiTranscription, setLiveAiTranscription] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'note' | 'mistake' | 'research'; image?: string } | null>(null);

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
  const lastResearchRef = useRef<{ topic: string; imageUrl?: string; sourceUrl?: string } | null>(null);

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

  function showToastMsg(message: string, type: 'note' | 'mistake' | 'research' | 'attach', image?: string) {
    setToast({ message, type, image });
    setTimeout(() => setToast(null), type === 'research' ? 8000 : 5000);
  }

  // Ari's "researcher" — calls the Gemma-backed /ai/node-summary endpoint for
  // out-of-band reference material (a mistake that needs more explanation, a
  // concept a note/graph didn't cover, etc.), shows it as a toast, and feeds
  // the result back into the live session as a text turn so Ari can actually
  // talk about it on its next reply instead of just silently fetching it.
  // Also remembers {topic, imageUrl, sourceUrl} so a follow-up [ATTACH: ...]
  // tag knows what to attach and where the source link points.
  async function handleResearch(topic: string) {
    try {
      const result = await getNodeSummary(topic);
      const text = result.definition || result.summary || '';
      if (!text) return;
      const sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(topic)}`;
      lastResearchRef.current = { topic, imageUrl: result.image_url, sourceUrl };
      showToastMsg(text, 'research', result.image_url);
      const relayText = `[Gemma đã tra cứu giúp về "${topic}": ${text}${result.image_url ? ' (kèm hình minh hoạ)' : ''}. Hãy tóm tắt ngắn gọn lại cho học sinh bằng giọng nói.]`;
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

  // "Gắn hình/nguồn đó vào note X" — attaches whatever Gemma last researched
  // to a Note, Mistake Bank entry, or Knowledge Tree node (fuzzy-matched by
  // title). Deliberately excludes PDF problem sets — those are fixed
  // documents, not editable app records.
  function handleAttach(targetType: string, targetText: string) {
    const research = lastResearchRef.current;
    if (!research) {
      showToastMsg('Chưa có kết quả tra cứu nào để gắn — hãy nhờ ARI tra cứu trước.', 'attach');
      return;
    }
    const patch = { imageUrl: research.imageUrl, sourceUrl: research.sourceUrl, sourceLabel: research.topic };
    const type = targetType.trim().toLowerCase();
    let ok = false;
    if (type.startsWith('note')) ok = attachToNote(targetText, patch);
    else if (type.startsWith('mistake')) ok = attachToMistake(targetText, patch);
    else if (type.startsWith('node') || type.startsWith('graph')) ok = attachToGraphNode(targetText, patch);

    showToastMsg(
      ok ? `Đã gắn vào "${targetText}".` : `Không tìm thấy "${targetText}" để gắn — thử nói rõ tên hơn.`,
      'attach',
    );
  }

  // ── GPT (NVIDIA gpt-oss-20b) fallback — kicks in only when Gemini Live's
  // WebSocket is unreachable. The mic + SpeechRecognition never stop; this
  // just routes finished utterances to a text model instead, and speaks the
  // reply back via the browser's own speechSynthesis.
  function speakText(text: string) {
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'vi-VN';
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
              note: {
                title: title,
                tldr: content,
                concepts: [],
                takeaways: [content]
              },
              subject: 'General Study Notes'
            });
            showToastMsg(`Đã lưu ghi chú: "${title}"`, 'note');
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
              explanation: explanationText
            });
            showToastMsg(`Đã thêm lỗi sai: "${mistakeText}"`, 'mistake');
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
          rec.lang = 'vi-VN';

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

        const API_BASE = (import.meta.env.VITE_API_BASE as string) || 'http://localhost:8000';
        const wsUrl = API_BASE.replace(/^http/, 'ws') + '/ws/s2s';
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!active) return;
          setStatus('idle');
          armSilenceTimer();
          playConnectedChime(audioCtx);

          const setupMsg = {
            setup: {
              model: LIVE_MODEL,
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
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
              realtimeInputConfig: {
                automaticActivityDetection: {
                  disabled: false,
                  startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
                  endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
                  prefixPaddingMs: 20,
                  silenceDurationMs: 650,
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
          } catch (e) {
            console.error('Error parsing WS message:', e);
          }
        };

        ws.onerror = (err) => {
          console.error('WebSocket Error:', err);
          clearSilenceTimer();
          if (active) {
            enterFallbackMode('Gemini Live không kết nối được — đã chuyển ARI sang GPT dự phòng (chỉ văn bản + giọng đọc trình duyệt).');
          }
        };

        ws.onclose = (evt) => {
          clearSilenceTimer();
          if (active && statusRef.current !== 'fallback') {
            let reason = evt.reason || 'Kết nối Gemini Live bị đóng.';
            try {
              const parsed = JSON.parse(evt.reason);
              reason = parsed.error || parsed.message || reason;
            } catch { /* reason stays as-is */ }
            enterFallbackMode(`${reason} — đã chuyển ARI sang GPT dự phòng.`);
          }
        };

      } catch (e: any) {
        console.error('S2S Init failed:', e);
        if (active) {
          setStatus('error');
          setErrorMessage(e.message || 'Không khởi tạo được Micro hoặc Audio.');
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
        <div className="fixed bottom-24 md:bottom-28 right-6 z-40 max-w-xs glass-strong rounded-2xl p-3 shadow-2xl flex gap-3 items-start animate-scale-in">
          {toast.image && (
            <img src={toast.image} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
          )}
          <div className="min-w-0">
            <span className="font-sans text-[9px] uppercase tracking-[2px] text-white/40 block mb-1">
              {toast.type === 'research' ? '🔎 Gemma researched' :
               toast.type === 'attach' ? '📎 Attached' :
               toast.type === 'mistake' ? '⚠️ Mistake Bank' : '📝 Notes'}
            </span>
            <p className="font-sans text-xs text-white/85 leading-relaxed line-clamp-4">{toast.message}</p>
          </div>
        </div>
      )}

      {/* Live captions — small, non-blocking, only while there's something to show */}
      {(liveUserTranscription || liveAiTranscription) && status !== 'paused' && (
        <div className="fixed bottom-24 md:bottom-28 left-6 z-30 max-w-xs glass-strong rounded-2xl px-4 py-3 pointer-events-none">
          {liveUserTranscription && (
            <p className="font-sans text-xs text-white/60 leading-relaxed mb-1">{liveUserTranscription}</p>
          )}
          {liveAiTranscription && (
            <p className="font-sans text-xs text-emerald-300/90 font-medium leading-relaxed">{liveAiTranscription}</p>
          )}
        </div>
      )}

      {(status === 'error' || status === 'fallback') && errorMessage && (
        <div className={`fixed bottom-24 md:bottom-28 right-24 z-30 max-w-[220px] glass-strong rounded-2xl px-4 py-3 text-[11px] leading-relaxed ${status === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
          {errorMessage}
        </div>
      )}

      {/* Persistent HUD — mic + pause sit right next to the colorful orb,
          fixed on top of the workspace, never blocking it */}
      <div className="fixed bottom-24 md:bottom-8 right-6 z-40 flex items-center gap-3">
        <button
          onClick={() => setIsMuted(m => !m)}
          className={`w-10 h-10 rounded-full border transition-all flex items-center justify-center flex-shrink-0 ${
            isMuted
              ? 'bg-red-500/20 border-red-500/40 text-red-400'
              : 'glass hover:bg-white/10 border-white/10 text-white/80'
          }`}
          title={isMuted ? 'Bật Mic' : 'Tắt Mic'}
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
          title={status === 'paused' ? 'Tiếp tục' : 'Tạm dừng'}
        >
          <span className="material-symbols-outlined text-[18px]">{status === 'paused' ? 'play_arrow' : 'pause'}</span>
        </button>

        {/* The orb itself — color ring reflects live status */}
        <div
          className="w-16 h-16 rounded-full glass-strong flex items-center justify-center flex-shrink-0 transition-shadow duration-500"
          style={{ boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 24px ${ringColor}` }}
          title={
            status === 'speaking' ? 'ARI đang nói...' :
            status === 'listening' ? 'ARI đang nghe...' :
            status === 'paused' ? 'ARI tạm dừng' :
            status === 'error' ? 'Lỗi kết nối' :
            status === 'fallback' ? 'ARI (chế độ GPT dự phòng)' :
            'ARI đang lắng nghe nền'
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
