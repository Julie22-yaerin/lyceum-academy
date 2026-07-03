import { useState, useEffect, useRef } from 'react';
import { saveNote } from '../lib/persist';
import { saveMistake } from '../lib/mistakes';

// Gemini 2.0 Flash + v1alpha BidiGenerateContent were shut down 2026-06-01.
// Live voice now runs on the native-audio Live model over v1beta (see backend/app/main.py).
const LIVE_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

// After this long with no new user speech and no AI audio, hand the turn to
// ARI — same signal a manual mute sends. Voice mode itself stays open and
// keeps listening; this no longer closes the session (see sendAudioStreamEnd).
const SILENCE_AUTO_CLOSE_MS = 20000;

const FAREWELL_KEYWORDS = [
  'cam on', 'tam biet', 'chao nhe', 'hen gap lai', 'thoi nhe', 'vay thoi', 'toi xong roi', 'xong roi nhe',
  'thanks', 'thank you', 'bye', 'goodbye', 'see you', "that's all", 'that is all', "that'll be all",
];

function stripDiacritics(input: string) {
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function isFarewell(text: string) {
  if (!text.trim()) return false;
  const norm = stripDiacritics(text);
  return FAREWELL_KEYWORDS.some(k => norm.includes(k));
}

interface S2SVoiceOverlayProps {
  onClose: () => void;
  onNewMessage: (role: 'user' | 'assistant', content: string, model?: string) => void;
  systemInstruction: string;
  enableAutoSave?: boolean;
  voiceName?: 'Puck' | 'Aoede' | 'Charon' | 'Kore' | 'Fenrir';
  /** If true, mic starts muted (push-to-talk mode). Default: false (always-listen). */
  startMuted?: boolean;
}

export default function S2SVoiceOverlay({
  onClose,
  onNewMessage,
  systemInstruction,
  enableAutoSave = false,
  voiceName = 'Puck',
  startMuted = false,
}: S2SVoiceOverlayProps) {
  const [status, setStatus] = useState<'connecting' | 'idle' | 'listening' | 'speaking' | 'paused' | 'error'>('connecting');
  const [isMuted, setIsMuted] = useState(startMuted);
  const [liveUserTranscription, setLiveUserTranscription] = useState('');
  const [liveAiTranscription, setLiveAiTranscription] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'note' | 'mistake' } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const recognitionRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const aiAnalyserRef = useRef<AnalyserNode | null>(null);
  const activeAnalyserRef = useRef<AnalyserNode | null>(null);
  
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const nextPlayTimeRef = useRef(0);
  
  const currentTurnUserTextRef = useRef('');
  const currentTurnAiTextRef = useRef('');
  const finalTurnCompleteRef = useRef(false);

  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCloseRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Mirrors `status` for the async callbacks inside the setup effect below.
  // The effect itself must NOT depend on `status` (it calls setStatus internally —
  // that turned every connecting→idle→listening→speaking transition into a full
  // WebSocket/mic teardown+rebuild, i.e. the connecting/listening reconnect loop).
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  // Same story for `isMuted`: it used to sit in the setup effect's dependency
  // array, so clicking mute tore down and reconnected the entire mic/WS/audio
  // pipeline (mic light flickers off-then-on again) — and worse, the fresh
  // SpeechRecognition instance that reconnect spun up never checked `isMuted`
  // at all, so it kept transcribing and flipping status to "listening" right
  // through the mute. `isMutedRef` lets the processor + recognition callbacks
  // read the live value without the setup effect ever needing to rerun.
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
  // stream, so this never has to mean "close the connection."
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

  const showToastMsg = (message: string, type: 'note' | 'mistake') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast(null);
    }, 5000);
  };

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

    // clearSilenceTimer / armSilenceTimer / sendAudioStreamEnd are defined at
    // component scope now (above) so the mute-effect can reach them without
    // this whole setup effect needing to depend on `isMuted`.

    // Connect happens silently in the background (no "Connecting..." banner) —
    // this chime is the only signal the user gets that ARI is now live.
    // AudioContext may be suspended when triggered by wake word (no direct user
    // gesture) — resume() first so the chime actually plays.
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

      if (isFarewell(userText)) {
        pendingCloseRef.current = true;
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
            // Muted: don't transcribe, don't touch status. This was the actual
            // "still hears me after muting" bug — the mic-off toggle used to
            // rebuild this whole recognizer, but the fresh instance never
            // checked isMuted at all.
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
              armSilenceTimer();
            }
            const currentShowText = currentTurnUserTextRef.current + (interim ? ' ' + interim.trim() : '');
            setLiveUserTranscription(currentShowText);

            if (statusRef.current !== 'speaking' && statusRef.current !== 'paused') {
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
          // Guard against InvalidStateError if a recognition session (e.g. the
          // orb's background wake-word listener) hasn't fully released the mic
          // yet — don't let it take down the whole S2S init (would surface as
          // a spurious "Connection Error" / connecting↔listening flicker).
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
              // This was the missing trigger: without it, the server falls back to
              // undocumented default VAD behavior, so there's no reliable signal for
              // "user stopped talking, generate a reply now." Configuring it explicitly
              // makes Gemini itself detect end-of-speech (~650ms of silence) and commit
              // the turn — separate from SILENCE_AUTO_CLOSE_MS below, which is a much
              // longer "nobody said anything at all" timeout that ends the whole session.
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
              // Native-audio Live models only emit AUDIO in modelTurn.parts — these
              // give us the actual text transcripts for the chat log / auto-save.
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
                finalTurnCompleteRef.current = true;
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
            setStatus('error');
            setErrorMessage('Không kết nối được với AI Voice service. Kiểm tra backend đang chạy.');
          }
        };

        ws.onclose = (evt) => {
          clearSilenceTimer();
          if (active && statusRef.current !== 'error') {
            setStatus('error');
            // Backend forwards Gemini errors as JSON before close — parse if present.
            let reason = evt.reason || 'Kết nối Voice AI bị đóng.';
            try {
              const parsed = JSON.parse(evt.reason);
              reason = parsed.error || parsed.message || reason;
            } catch { /* reason stays as-is */ }
            setErrorMessage(reason);
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
          // AI just finished speaking. If the user said goodbye/thanks this turn,
          // end the session now instead of waiting for the silence timeout.
          if (pendingCloseRef.current && active) {
            pendingCloseRef.current = false;
            clearSilenceTimer();
            onCloseRef.current();
          } else {
            armSilenceTimer();
          }
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

    // Runs once, at mount — connecting really is a background task now.
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
  // Mount-once. Mute and pause/resume are now read live via isMutedRef /
  // statusRef inside the callbacks above — neither needs to rebuild the
  // WebSocket/mic/AudioContext pipeline anymore. That rebuild-on-toggle was
  // both the connecting/listening reconnect loop AND the reason mute didn't
  // actually mute (the rebuilt SpeechRecognition never checked isMuted).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Visualizer Loop
  useEffect(() => {
    let animFrameId: number;
    
    const draw = () => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const analyser = activeAnalyserRef.current;
      let bufferLength = 0;
      let dataArray = new Uint8Array(0);
      
      if (analyser) {
        bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);
      }
      
      ctx.fillStyle = '#050816';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const baseRadius = 65;
      
      let sum = 0;
      if (bufferLength > 0) {
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
      }
      const average = bufferLength > 0 ? sum / bufferLength : 0;
      
      const idleFluctuation = Math.sin(Date.now() * 0.003) * 4;
      const pulseRadius = baseRadius + (status === 'paused' ? 0 : (average * 0.45 + idleFluctuation));
      
      const glow = ctx.createRadialGradient(centerX, centerY, baseRadius - 15, centerX, centerY, pulseRadius + 35);
      if (status === 'speaking') {
        glow.addColorStop(0, 'rgba(52, 211, 153, 0.2)');
        glow.addColorStop(1, 'rgba(5, 8, 22, 0)');
        ctx.strokeStyle = '#34d399';
        ctx.shadowColor = '#34d399';
      } else if (status === 'listening') {
        glow.addColorStop(0, 'rgba(96, 165, 250, 0.2)');
        glow.addColorStop(1, 'rgba(5, 8, 22, 0)');
        ctx.strokeStyle = '#60a5fa';
        ctx.shadowColor = '#60a5fa';
      } else {
        glow.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
        glow.addColorStop(1, 'rgba(5, 8, 22, 0)');
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.shadowColor = 'rgba(255, 255, 255, 0.25)';
      }
      
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(centerX, centerY, pulseRadius + 35, 0, 2 * Math.PI);
      ctx.fill();

      ctx.beginPath();
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 10;
      
      const numPoints = 120;
      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;
        let value = 0;
        
        if (bufferLength > 0 && status !== 'paused') {
          const dataIndex = Math.floor((i / numPoints) * bufferLength * 0.65);
          value = dataArray[dataIndex] || 0;
        }
        
        const ripple = status === 'connecting' ? Math.sin(angle * 8 + Date.now() * 0.012) * 2 : 0;
        const r = pulseRadius + (value * 0.28) + ripple;
        
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.stroke();
      
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius - 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      
      // Connecting renders identically to idle (owl, no ripple/hourglass) — it's
      // a background step now, not something the UI announces.
      let emoji = '🦉';
      if (status === 'speaking') emoji = '🦉';
      else if (status === 'listening') emoji = '👂';
      else if (status === 'paused') emoji = '⏸';
      else if (status === 'error') emoji = '⚠';
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '26px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, centerX, centerY);
      
      animFrameId = requestAnimationFrame(draw);
    };
    
    animFrameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameId);
  }, [status]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between p-8 bg-[#050816]/96 backdrop-blur-lg animate-fadeIn text-white">
      {toast && (
        <div className="absolute top-6 left-1/2 transform -translate-x-1/2 glass border border-emerald-500/20 px-6 py-3 rounded-full flex items-center gap-3 shadow-2xl z-50 animate-bounce">
          <span className="text-emerald-400">✨</span>
          <span className="font-sans text-xs text-white/90 tracking-wide">{toast.message}</span>
        </div>
      )}

      <div className="w-full max-w-4xl flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="text-emerald-400 font-serif text-lg tracking-wider font-semibold">ARI</div>
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping"></div>
        </div>
        <button 
          onClick={onClose}
          className="glass-btn px-4 py-1.5 text-xs font-sans font-medium uppercase tracking-[2px] hover:bg-white/10 transition-colors rounded-xl"
        >
          Exit Voice Mode
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center relative w-full">
        <canvas 
          ref={canvasRef} 
          width={300} 
          height={300} 
          className="rounded-full overflow-hidden max-w-full max-h-full"
        />
        
        <div className="mt-6 text-center">
          <div className="font-sans text-[10px] uppercase tracking-[3px] text-white/40">
            {/* Connecting is a silent background step now — a chime plays once it's
                ready instead of a "Connecting..." banner. Nothing renders here for it. */}
            {status === 'idle' && 'Listening for your voice...'}
            {status === 'listening' && 'Recording...'}
            {status === 'speaking' && 'ARI is responding...'}
            {status === 'paused' && 'Voice mode paused'}
            {status === 'error' && 'Connection Error'}
          </div>
          {status === 'error' && (
            <div className="mt-2 text-red-400 font-sans text-xs max-w-md mx-auto">
              {errorMessage}
            </div>
          )}
        </div>
      </div>

      <div className="w-full max-w-2xl bg-white/[0.02] border border-white/5 rounded-2xl p-6 min-h-[140px] flex flex-col gap-4 mb-8 flex-shrink-0">
        <div className="flex flex-col gap-1.5">
          <span className="font-sans text-[9px] font-semibold text-white/30 uppercase tracking-[2px]">You (Chép lời)</span>
          <p className="font-sans text-sm text-white/80 leading-relaxed min-h-[20px]">
            {liveUserTranscription || <em className="text-white/20">Hãy nói gì đó...</em>}
          </p>
        </div>
        <div className="h-px bg-white/5" />
        <div className="flex flex-col gap-1.5">
          <span className="font-sans text-[9px] font-semibold text-emerald-400/40 uppercase tracking-[2px]">Ari</span>
          <p className="font-sans text-sm text-emerald-300/90 font-medium leading-relaxed min-h-[20px]">
            {liveAiTranscription || <em className="text-white/10">Đang lắng nghe...</em>}
          </p>
        </div>
      </div>

      <div className="w-full max-w-md flex items-center justify-center gap-6 flex-shrink-0">
        <button
          onClick={() => setIsMuted(m => !m)}
          className={`w-12 h-12 rounded-full border transition-all flex items-center justify-center ${
            isMuted 
              ? 'bg-red-500/20 border-red-500/40 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.2)]' 
              : 'glass hover:bg-white/10 border-white/10 text-white/80'
          }`}
          title={isMuted ? "Bật Mic" : "Tắt Mic"}
        >
          <span className="material-symbols-outlined text-[20px]">
            {isMuted ? 'mic_off' : 'mic'}
          </span>
        </button>

        <button
          onClick={() => setStatus(s => s === 'paused' ? 'idle' : 'paused')}
          className={`w-14 h-14 rounded-full border transition-all flex items-center justify-center ${
            status === 'paused'
              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.2)]'
              : 'glass hover:bg-white/10 border-white/10 text-white/85'
          }`}
          title={status === 'paused' ? "Tiếp tục" : "Tạm dừng"}
        >
          <span className="material-symbols-outlined text-[22px]">
            {status === 'paused' ? 'play_arrow' : 'pause'}
          </span>
        </button>
      </div>
    </div>
  );
}
