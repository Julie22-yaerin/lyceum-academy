import { useCallback, useEffect, useRef, useState } from 'react';
import S2SVoiceOverlay from './S2SVoiceOverlay';
import { buildAssistantContext } from '../lib/assistantContext';
import type { View } from '../types';

const BASE_INSTRUCTION =
  "Tên của bạn là Ari — trợ lý học tập 24/7 của Lyceum, luôn sẵn sàng ở mọi màn hình và có thể thấy nội dung học sinh đang xem cũng như dữ liệu đã lưu của họ (ghi chú, lỗi sai, tiến độ) — hãy dùng thông tin đó để tư vấn tức thời, cụ thể, đúng ngữ cảnh, thay vì hỏi lại những gì đã biết. Nếu được hỏi tên, hãy trả lời bạn là Ari. Hãy lắng nghe, giải thích ngắn gọn, khích lệ và giúp học sinh ghi chú hoặc ghi nhận lỗi sai. Trả lời cực kỳ ngắn gọn (1-3 câu), tự nhiên và thân thiện. Nếu học sinh muốn lưu lỗi sai, kết thúc câu trả lời bằng tag: [MISTAKE: <tên lỗi sai> | <môn học/vị trí> | <giải thích ngắn gọn>]. Nếu muốn ghi chú, kết thúc bằng tag: [NOTE: <tiêu đề ghi chú> | <nội dung ghi chú>]. Không chèn thêm ký tự thừa quanh tag.";

// Matches "hey ari" / "hê ari" / "ây ari" etc. — cheap client-side wake-word check
// run over the free browser SpeechRecognition stream (no Gemini connection yet).
const WAKE_WORD_REGEX = /\b(hey|h[eê]y?|[eâ]y)[,]?\s*ari\b/i;

interface VoiceOrbProps {
  currentView: View;
}

/**
 * Persistent double-glass voice assistant orb, fixed bottom-right across the workspace.
 * Runs a lightweight background mic listener at all times (Web Speech API — free,
 * local) waiting for the wake word "Hey Ari". Saying it — or clicking the orb —
 * opens the full S2S overlay, which snapshots on-screen content + saved app data
 * into the system prompt and connects to the live Gemini voice session. The full
 * session auto-ends itself on silence or a farewell (see S2SVoiceOverlay), which
 * re-arms this background listener.
 */
// If the recognizer dies faster than this after starting, it's a real failure
// (permission/device/service issue) rather than a normal session boundary —
// count it toward the give-up threshold below.
const UNHEALTHY_RUN_MS = 1500;
const MAX_CONSECUTIVE_FAILURES = 4;
const RESTART_BACKOFF_MS = [300, 800, 1800, 3500];
// After MAX_CONSECUTIVE_FAILURES, don't give up forever — retry after this
// delay. Covers transient issues (OS STT service blip, tab backgrounded, etc.)
const WAKE_RECOVERY_MS = 30_000;

export default function VoiceOrb({ currentView }: VoiceOrbProps) {
  const [expanded, setExpanded] = useState(false);
  const [wakeListening, setWakeListening] = useState(false);
  const [wakeUnavailable, setWakeUnavailable] = useState(false);
  const [systemInstruction, setSystemInstruction] = useState(BASE_INSTRUCTION);
  const wakeRecRef = useRef<any>(null);
  const expandedRef = useRef(false);

  const handleOpen = useCallback(() => {
    // Stop the background wake-word recognizer synchronously, before
    // S2SVoiceOverlay mounts and starts its own SpeechRecognition. Relying on
    // the useEffect below (keyed on `expanded`) to do this was a race: React
    // runs the newly-mounted child's effects before the parent's, so the
    // overlay's rec.start() could fire while this wake listener was still
    // live — two SpeechRecognition sessions contending for the same mic
    // right at the orb→overlay handoff.
    expandedRef.current = true;
    try { wakeRecRef.current?.stop(); } catch { /* ignore */ }
    wakeRecRef.current = null;
    setWakeListening(false);

    const context = buildAssistantContext(currentView);
    setSystemInstruction(`${BASE_INSTRUCTION}\n\n=== NGỮ CẢNH HIỆN TẠI ===\n${context}`);
    setExpanded(true);
  }, [currentView]);

  useEffect(() => {
    expandedRef.current = expanded;

    if (expanded) {
      // Full S2S session owns the mic now — stop the lightweight wake listener.
      try { wakeRecRef.current?.stop(); } catch { /* ignore */ }
      wakeRecRef.current = null;
      setWakeListening(false);
      return;
    }

    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) return; // browser has no free STT — orb falls back to click-to-talk

    let stopped = false;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;
    let lastStartedAt = 0;

    // The previous version called rec.start() synchronously from onend with no
    // limit — if the mic was blocked or the recognition service was
    // unreachable, start→(near-instant)error→end→start looped as fast as the
    // JS engine could go, pegging the CPU. That's what caused the site-wide
    // lag and the flickering mic icon (setWakeListening toggling every cycle).
    // Now every restart is delayed (growing backoff) and capped — after
    // MAX_CONSECUTIVE_FAILURES quick deaths in a row, give up for this mount
    // instead of retrying forever; the orb still works via click-to-talk.
    function scheduleRestart() {
      if (stopped || expandedRef.current) return;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        // Don't give up forever — show unavailable UI, but retry after 30s.
        // Covers transient STT service blips, tab-backgrounded throttling, etc.
        setWakeUnavailable(true);
        restartTimer = setTimeout(() => {
          restartTimer = null;
          if (!stopped && !expandedRef.current) {
            consecutiveFailures = 0;
            setWakeUnavailable(false);
            startRecognition();
          }
        }, WAKE_RECOVERY_MS);
        return;
      }
      const delay = RESTART_BACKOFF_MS[Math.min(consecutiveFailures, RESTART_BACKOFF_MS.length - 1)];
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (!stopped && !expandedRef.current) startRecognition();
      }, delay);
    }

    function startRecognition() {
      const rec = new SpeechRecognitionClass();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'vi-VN';

      rec.onstart = () => {
        lastStartedAt = Date.now();
        setWakeListening(true);
      };

      rec.onresult = (e: any) => {
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          const transcript: string = e.results[i][0]?.transcript || '';
          if (WAKE_WORD_REGEX.test(transcript)) {
            try { rec.stop(); } catch { /* ignore */ }
            handleOpen();
            return;
          }
        }
      };

      rec.onerror = (err: any) => {
        // 'no-speech' / 'aborted' fire constantly in continuous mode — not real errors.
        if (err?.error === 'not-allowed' || err?.error === 'service-not-allowed' || err?.error === 'audio-capture') {
          // Permission/device problem — retrying won't help, stop for good.
          consecutiveFailures = MAX_CONSECUTIVE_FAILURES;
          setWakeListening(false);
        }
      };

      rec.onend = () => {
        setWakeListening(false);
        const ranFor = Date.now() - lastStartedAt;
        consecutiveFailures = ranFor < UNHEALTHY_RUN_MS ? consecutiveFailures + 1 : 0;
        scheduleRestart();
      };

      wakeRecRef.current = rec;
      try { rec.start(); } catch { consecutiveFailures += 1; scheduleRestart(); }
    }

    setWakeUnavailable(false);
    startRecognition();

    return () => {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      try { wakeRecRef.current?.stop(); } catch { /* ignore */ }
    };
  }, [expanded, handleOpen]);

  if (expanded) {
    return (
      <S2SVoiceOverlay
        onClose={() => setExpanded(false)}
        onNewMessage={() => {}}
        systemInstruction={systemInstruction}
        enableAutoSave
      />
    );
  }

  return (
    <button
      onClick={handleOpen}
      className="fixed bottom-24 md:bottom-8 right-6 z-40 w-16 h-16 rounded-full glass-strong flex items-center justify-center group"
      style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 24px rgba(139,92,246,0.15)' }}
      title={
        wakeUnavailable
          ? 'Không nghe được nền (mic/quyền truy cập) — bấm để nói chuyện'
          : wakeListening
          ? 'Đang nghe nền — nói "Hey Ari" để bắt đầu'
          : 'Ask Ari'
      }
    >
      {/* Expanding listening rings (subtle, always-on idle breathing) */}
      <span className="voice-orb-ring absolute inset-0 rounded-full pointer-events-none" style={{ animationDelay: '0s' }} />
      <span className="voice-orb-ring absolute inset-0 rounded-full pointer-events-none" style={{ animationDelay: '0.9s' }} />

      {/* Double-glass bubble wrapper */}
      <span className="relative w-11 h-11 rounded-full glass flex items-center justify-center overflow-hidden">
        <span
          className="voice-orb-mesh absolute inset-[-4px] rounded-full opacity-80 group-hover:opacity-100 transition-opacity"
          style={{ animation: 'orb-pulse 3.2s ease-in-out infinite, orb-mesh-spin 6s linear infinite' }}
        />
        <span className={`relative z-10 w-4 h-4 rounded-full ${wakeListening ? 'bg-emerald-400' : 'bg-white/90'}`} />
      </span>
    </button>
  );
}
