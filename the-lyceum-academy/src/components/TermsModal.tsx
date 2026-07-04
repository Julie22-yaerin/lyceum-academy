/**
 * TermsModal — shown once per account, the very first time a user enters the
 * workspace. Blocks until "Đồng ý" is clicked. Never shown again afterwards
 * (localStorage 'lyceum_terms_accepted').
 */
export default function TermsModal({ onAgree }: { onAgree: () => void }) {
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        className="glass-strong rounded-2xl p-8 max-w-lg w-full flex flex-col gap-5"
        style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
      >
        <div>
          <h2 className="font-serif text-white text-xl font-semibold mb-1">Điều khoản sử dụng</h2>
          <p className="text-white/40 text-xs font-sans uppercase tracking-[2px]">Vui lòng đọc trước khi bắt đầu</p>
        </div>

        <div className="max-h-64 overflow-y-auto pr-2 flex flex-col gap-3 font-sans text-sm text-white/70 leading-relaxed">
          <p>
            Lyceum sử dụng các mô hình AI (Gemini, Groq, NVIDIA, OpenRouter, Ollama...) để hỗ trợ học tập:
            trò chuyện Socratic, chấm điểm bài làm, tạo sơ đồ kiến thức, và trợ lý giọng nói ARI.
          </p>
          <p>
            Nội dung bạn tải lên (ghi chú, đề bài, hình ảnh, bản ghi giọng nói) có thể được gửi tới các
            nhà cung cấp AI nói trên để xử lý. Không tải lên thông tin cá nhân nhạy cảm hoặc tài liệu bạn
            không có quyền chia sẻ.
          </p>
          <p>
            ARI (trợ lý giọng nói) có thể lắng nghe nền khi bạn bật mic để hỗ trợ tức thời — bạn có thể tắt
            mic hoặc tạm dừng bất cứ lúc nào bằng các nút cạnh biểu tượng ARI.
          </p>
          <p>
            Dữ liệu học tập (ghi chú, lỗi sai, tiến độ) được lưu trên trình duyệt của bạn để cá nhân hoá trải
            nghiệm. Lyceum không đảm bảo tính chính xác tuyệt đối của nội dung do AI tạo ra — hãy luôn kiểm
            chứng lại kiến thức quan trọng.
          </p>
        </div>

        <button
          onClick={onAgree}
          className="glass-btn rounded-xl py-3 font-sans text-xs uppercase tracking-[2px] font-semibold"
        >
          Tôi đồng ý, tiếp tục
        </button>
      </div>
    </div>
  );
}
