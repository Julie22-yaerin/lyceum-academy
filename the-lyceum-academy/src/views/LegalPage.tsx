/**
 * LegalPage — standalone Privacy Policy and Terms of Service documents,
 * served at /privacy and /terms. Linked from the waitlist form's required
 * consent checkbox and from the cookie banner. Plain, honest, understated.
 */

import type { ReactNode } from 'react';

type Doc = 'privacy' | 'terms';

const UPDATED = 'Cập nhật: 07/2026';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="font-serif text-lg text-white mb-2">{title}</h2>
      <div className="text-sm text-slate-400 leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

function Privacy() {
  return (
    <>
      <Section title="1. Chúng tôi thu thập gì">
        <p>Khi bạn nộp đơn vào danh sách chờ: email, tên gọi, cấp lớp, môn học, mục tiêu học tập và những gì bạn tự điền vào biểu mẫu. Khi bạn dùng nền tảng: nội dung học tập bạn tạo (ghi chú, bài tập, lỗi sai) và dữ liệu sử dụng cơ bản.</p>
      </Section>
      <Section title="2. Chúng tôi dùng nó để làm gì">
        <p>Để xét duyệt hồ sơ, tạo và cá nhân hoá lộ trình học của bạn, vận hành các trợ lý AI, và cải thiện dịch vụ. Chúng tôi không bán dữ liệu của bạn.</p>
      </Section>
      <Section title="3. Trí tuệ nhân tạo">
        <p>Nội dung bạn nhập có thể được gửi tới các nhà cung cấp mô hình AI để tạo phản hồi. Bạn có thể tắt việc dùng dữ liệu của mình để huấn luyện mô hình trong phần Cài đặt.</p>
      </Section>
      <Section title="4. Cookie">
        <p>Chúng tôi dùng cookie bắt buộc để giữ bạn đăng nhập, và cookie tuỳ chọn cho tính năng và cải thiện trải nghiệm. Bạn chọn đồng ý hay từ chối cookie tuỳ chọn khi vào trang. Bạn có thể đổi lựa chọn bằng cách xoá cookie của trình duyệt.</p>
      </Section>
      <Section title="5. Lưu trữ & xoá">
        <p>Hồ sơ bị từ chối được giữ tối đa 7 ngày rồi xoá. Bạn có thể yêu cầu xem, sửa hoặc xoá dữ liệu cá nhân của mình bất cứ lúc nào.</p>
      </Section>
      <Section title="6. Đối tượng">
        <p>Nền tảng dành cho người học từ lớp 10 đến năm nhất đại học. Nếu bạn dưới 16 tuổi, cần có sự đồng ý của cha mẹ hoặc người giám hộ.</p>
      </Section>
      <Section title="7. Liên hệ">
        <p>Mọi thắc mắc về quyền riêng tư: gửi email tới đội ngũ Lyceum qua kênh hỗ trợ trong ứng dụng.</p>
      </Section>
    </>
  );
}

function Terms() {
  return (
    <>
      <Section title="1. Ai được dùng">
        <p>The Lyceum nhận người học từ lớp 10 đến năm nhất đại học. Nội dung học tập giới hạn ở Toán và Khoa học. Việc gia nhập theo xét duyệt — nộp đơn không đảm bảo được nhận.</p>
      </Section>
      <Section title="2. Tài khoản">
        <p>Bạn chịu trách nhiệm giữ an toàn tài khoản của mình và những gì diễn ra dưới tài khoản đó. Thông tin bạn cung cấp phải trung thực.</p>
      </Section>
      <Section title="3. Sử dụng đúng mực">
        <p>Không lạm dụng nền tảng, không cố phá hoại hệ thống, không dùng để gian lận thi cử hay vi phạm pháp luật. Chúng tôi có thể ngừng quyền truy cập nếu bạn vi phạm.</p>
      </Section>
      <Section title="4. Quanta & thanh toán">
        <p>Một số tính năng AI tiêu tốn Quanta theo gói của bạn. Các khoản đã thanh toán cho dịch vụ số không hoàn lại trừ khi luật yêu cầu.</p>
      </Section>
      <Section title="5. Nội dung của bạn">
        <p>Bạn giữ quyền với nội dung mình tạo. Bạn cho phép chúng tôi lưu trữ và xử lý nội dung đó để cung cấp dịch vụ cho bạn.</p>
      </Section>
      <Section title="6. Không bảo đảm">
        <p>Nền tảng là công cụ hỗ trợ học tập, cung cấp "nguyên trạng". Chúng tôi cố gắng chính xác nhưng không bảo đảm mọi phản hồi của AI đều đúng — hãy kiểm chứng những gì quan trọng.</p>
      </Section>
      <Section title="7. Thay đổi">
        <p>Chúng tôi có thể cập nhật các điều khoản này. Nếu có thay đổi lớn, chúng tôi sẽ thông báo trong ứng dụng.</p>
      </Section>
    </>
  );
}

export default function LegalPage({ doc }: { doc: Doc }) {
  const title = doc === 'privacy' ? 'Chính sách quyền riêng tư' : 'Điều khoản dịch vụ';
  return (
    <div className="relative bg-[#050508] text-slate-200 font-sans antialiased min-h-screen px-4 py-14">
      <div className="w-full max-w-2xl mx-auto">
        <a href="/" className="font-serif text-xl tracking-[4px] uppercase text-slate-300 block text-center mb-3">
          The Lyceum
        </a>
        <h1 className="font-serif text-3xl text-white text-center mb-1">{title}</h1>
        <p className="text-[11px] uppercase tracking-[2px] text-slate-500 text-center mb-10">{UPDATED}</p>

        <div className="glass-card rounded-3xl p-8">
          {doc === 'privacy' ? <Privacy /> : <Terms />}
        </div>

        <div className="flex items-center justify-center gap-6 mt-8 text-xs text-slate-500">
          <a href="/privacy" className="hover:text-slate-300 transition-colors">Quyền riêng tư</a>
          <a href="/terms" className="hover:text-slate-300 transition-colors">Điều khoản</a>
          <a href="/" className="hover:text-slate-300 transition-colors">Về trang chủ</a>
        </div>
      </div>
    </div>
  );
}
