import { useCallback, useState } from 'react';
import S2SVoiceOverlay from './S2SVoiceOverlay';
import { buildAssistantContext } from '../lib/assistantContext';
import type { View } from '../types';

const BASE_INSTRUCTION =
  "Tên của bạn là Ari — trợ lý học tập 24/7 của Lyceum, luôn sẵn sàng ở mọi màn hình và có thể thấy nội dung học sinh đang xem cũng như dữ liệu đã lưu của họ (ghi chú, lỗi sai, tiến độ) — hãy dùng thông tin đó để tư vấn tức thời, cụ thể, đúng ngữ cảnh, thay vì hỏi lại những gì đã biết. Nếu được hỏi tên, hãy trả lời bạn là Ari. Hãy lắng nghe, giải thích ngắn gọn, khích lệ và giúp học sinh ghi chú hoặc ghi nhận lỗi sai. Trả lời cực kỳ ngắn gọn (1-3 câu), tự nhiên và thân thiện. Nếu học sinh muốn lưu lỗi sai, kết thúc câu trả lời bằng tag: [MISTAKE: <tên lỗi sai> | <môn học/vị trí> | <giải thích ngắn gọn>]. Nếu muốn ghi chú, kết thúc bằng tag: [NOTE: <tiêu đề ghi chú> | <nội dung ghi chú>]. Không chèn thêm ký tự thừa quanh tag.";

const LISTEN_MODE_KEY = 'ari-listen-mode';
type ListenMode = 'always' | 'push';

function getSavedMode(): ListenMode | null {
  try { return (localStorage.getItem(LISTEN_MODE_KEY) as ListenMode) || null; } catch { return null; }
}
function saveMode(mode: ListenMode) {
  try { localStorage.setItem(LISTEN_MODE_KEY, mode); } catch { /* ignore */ }
}

interface VoiceOrbProps {
  currentView: View;
}

/**
 * Persistent voice assistant orb, fixed bottom-right.
 * First-time users see a preference dialog: always-listen vs push-to-talk.
 * Preference is saved to localStorage and respected on subsequent opens.
 */
export default function VoiceOrb({ currentView }: VoiceOrbProps) {
  const [expanded, setExpanded] = useState(false);
  const [showPrefDialog, setShowPrefDialog] = useState(false);
  const [listenMode, setListenMode] = useState<ListenMode>(() => getSavedMode() ?? 'always');
  const [systemInstruction, setSystemInstruction] = useState(BASE_INSTRUCTION);

  const openSession = useCallback((mode: ListenMode) => {
    const context = buildAssistantContext(currentView);
    setSystemInstruction(`${BASE_INSTRUCTION}\n\n=== NGỮ CẢNH HIỆN TẠI ===\n${context}`);
    setListenMode(mode);
    setShowPrefDialog(false);
    setExpanded(true);
  }, [currentView]);

  const handleOrbClick = useCallback(() => {
    if (getSavedMode() === null) {
      // First time — ask for preference
      setShowPrefDialog(true);
    } else {
      openSession(getSavedMode()!);
    }
  }, [openSession]);

  const handleChoose = (mode: ListenMode) => {
    saveMode(mode);
    openSession(mode);
  };

  if (expanded) {
    return (
      <S2SVoiceOverlay
        onClose={() => setExpanded(false)}
        onNewMessage={() => {}}
        systemInstruction={systemInstruction}
        enableAutoSave
        startMuted={listenMode === 'push'}
      />
    );
  }

  return (
    <>
      {/* First-time preference dialog */}
      {showPrefDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div
            className="glass-strong rounded-2xl p-8 max-w-sm w-full mx-4 flex flex-col gap-6"
            style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
          >
            <div className="text-center">
              <div className="text-2xl mb-2">🎙</div>
              <h2 className="font-serif text-white text-lg font-semibold mb-1">Cài đặt ARI</h2>
              <p className="text-white/50 text-sm font-sans">Bạn muốn ARI nghe như thế nào?</p>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleChoose('always')}
                className="glass rounded-xl p-4 text-left hover:bg-white/10 transition-colors border border-white/10 group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">🔊</span>
                  <div>
                    <div className="text-white font-sans font-medium text-sm">Luôn lắng nghe</div>
                    <div className="text-white/40 text-xs mt-0.5">Mic luôn mở, nói bất cứ lúc nào</div>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleChoose('push')}
                className="glass rounded-xl p-4 text-left hover:bg-white/10 transition-colors border border-white/10 group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">👆</span>
                  <div>
                    <div className="text-white font-sans font-medium text-sm">Chỉ khi bấm vào</div>
                    <div className="text-white/40 text-xs mt-0.5">Bấm nút mic để bắt đầu nói</div>
                  </div>
                </div>
              </button>
            </div>

            <button
              onClick={() => setShowPrefDialog(false)}
              className="text-white/30 text-xs font-sans hover:text-white/60 transition-colors text-center"
            >
              Huỷ
            </button>
          </div>
        </div>
      )}

      {/* The orb button */}
      <button
        onClick={handleOrbClick}
        className="fixed bottom-24 md:bottom-8 right-6 z-40 w-16 h-16 rounded-full glass-strong flex items-center justify-center group"
        style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 24px rgba(139,92,246,0.15)' }}
        title="Ask Ari"
      >
        {/* Expanding idle-breathing rings */}
        <span className="voice-orb-ring absolute inset-0 rounded-full pointer-events-none" style={{ animationDelay: '0s' }} />
        <span className="voice-orb-ring absolute inset-0 rounded-full pointer-events-none" style={{ animationDelay: '0.9s' }} />

        {/* Double-glass bubble */}
        <span className="relative w-11 h-11 rounded-full glass flex items-center justify-center overflow-hidden">
          <span
            className="voice-orb-mesh absolute inset-[-4px] rounded-full opacity-80 group-hover:opacity-100 transition-opacity"
            style={{ animation: 'orb-pulse 3.2s ease-in-out infinite, orb-mesh-spin 6s linear infinite' }}
          />
          <span className="relative z-10 w-4 h-4 rounded-full bg-white/90" />
        </span>
      </button>
    </>
  );
}
