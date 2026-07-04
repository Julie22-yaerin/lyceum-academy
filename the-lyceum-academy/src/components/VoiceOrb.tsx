import { useCallback, useEffect, useState } from 'react';
import S2SVoiceOverlay from './S2SVoiceOverlay';
import { buildAssistantContext } from '../lib/assistantContext';
import type { View } from '../types';

const BASE_INSTRUCTION =
  "Tên của bạn là Ari — trợ lý nghiên cứu nền (background) 24/7 của Lyceum. Bạn LUÔN đang kết nối và lắng nghe song song trong khi học sinh dùng các công cụ khác trên web (Nexus, Problem Sets, Notes, Mistake Bank, Knowledge Tree) — không cần học sinh bấm nút hay gọi tên bạn trước, chỉ cần họ nói là bạn nghe và phản hồi được ngay. Bạn có thể thấy nội dung học sinh đang xem cũng như dữ liệu đã lưu của họ (ghi chú, lỗi sai, tiến độ) — hãy dùng thông tin đó để tư vấn tức thời, cụ thể, đúng ngữ cảnh, thay vì hỏi lại những gì đã biết. Nếu được hỏi tên, hãy trả lời bạn là Ari. Hãy lắng nghe, giải thích ngắn gọn, khích lệ. Trả lời cực kỳ ngắn gọn (1-3 câu), tự nhiên và thân thiện.\n\nBạn có một trợ lý nghiên cứu tên Gemma (mô hình chuyên tra cứu/tổng hợp tài liệu) mà bạn có thể nhờ tra cứu tài liệu tham khảo ngoài luồng — ví dụ: học sinh hỏi về một lỗi sai trong Mistake Bank cần thêm giải thích/hình minh hoạ, hoặc cần bổ sung tư liệu cho một note/graph đang xem. Khi cần, kết thúc câu trả lời bằng tag: [RESEARCH: <chủ đề cần tra cứu ngắn gọn>]. Gemma sẽ trả kết quả về và bạn sẽ được đưa nội dung đó để tiếp tục giải thích cho học sinh ở lượt sau.\n\nHãy chủ động gợi ý tài liệu liên quan đúng lúc theo ngữ cảnh hiện tại: nếu học sinh đang làm Problem Sets, gợi ý xem lại Notes hoặc Mistake Bank liên quan; nếu đang xem Knowledge Tree, gợi ý các note đã lưu về chủ đề đó. Không lạm dụng — chỉ gợi ý khi thực sự hữu ích.\n\nNếu học sinh muốn lưu lỗi sai, kết thúc câu trả lời bằng tag: [MISTAKE: <tên lỗi sai> | <môn học/vị trí> | <giải thích ngắn gọn>]. Nếu muốn ghi chú, kết thúc bằng tag: [NOTE: <tiêu đề ghi chú> | <nội dung ghi chú>]. Không chèn thêm ký tự thừa quanh tag, và không nói to nội dung tag ra.";

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
 * ARI runs as an always-on background voice session the moment you're in the
 * workspace — no click, no wake word. First visit asks once whether the mic
 * should stay open (always-listen) or wait for a manual mic tap (push-to-talk);
 * after that it just connects. The actual orb + mic/pause controls live in
 * S2SVoiceOverlay now (rendered as a small persistent HUD, not a takeover).
 */
export default function VoiceOrb({ currentView }: VoiceOrbProps) {
  const [showPrefDialog, setShowPrefDialog] = useState(false);
  const [ready, setReady] = useState(false);
  const [listenMode, setListenMode] = useState<ListenMode>(() => getSavedMode() ?? 'always');
  const [systemInstruction, setSystemInstruction] = useState(BASE_INSTRUCTION);

  // Decide immediately on mount — this is the only gate, and only ever once.
  useEffect(() => {
    const context = buildAssistantContext(currentView);
    setSystemInstruction(`${BASE_INSTRUCTION}\n\n=== NGỮ CẢNH HIỆN TẠI ===\n${context}`);
    if (getSavedMode() === null) {
      setShowPrefDialog(true);
    } else {
      setReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChoose = useCallback((mode: ListenMode) => {
    saveMode(mode);
    setListenMode(mode);
    setShowPrefDialog(false);
    setReady(true);
  }, []);

  return (
    <>
      {/* First-time preference dialog — only decision ARI ever asks for */}
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
                    <div className="text-white/40 text-xs mt-0.5">ARI chạy nền, nói bất cứ lúc nào không cần bấm gì</div>
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
                    <div className="text-white font-sans font-medium text-sm">Chỉ khi bấm mic</div>
                    <div className="text-white/40 text-xs mt-0.5">ARI vẫn kết nối nền nhưng mic tắt sẵn, bấm để nói</div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {ready && (
        <S2SVoiceOverlay
          onNewMessage={() => {}}
          systemInstruction={systemInstruction}
          enableAutoSave
          startMuted={listenMode === 'push'}
        />
      )}
    </>
  );
}
