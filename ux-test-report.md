# UX Test Report — lyceum-academy.vercel.app
Phương pháp: mô phỏng hành trình theo 10 Nielsen Heuristics, dựa trên khảo sát thực tế site (desktop, Chrome) ngày 2026-07-13.

## Lỗi/heuristic nền tảng phát hiện được trên site (dùng chung cho mọi tester)
- **H8 – Aesthetic & minimalist / H1 – Visibility of system status**: Toàn bộ nội dung dùng animation fade-in theo scroll. Nếu scroll nhanh (hành vi tự nhiên của phần lớn user), chữ hiện ra ở trạng thái xám nhạt gần như vô hình trong 0.5-1s, trông như trang bị lỗi/load thiếu.
- **H3 – User control and freedom**: Bấm "Launch Workspace" / "Enter the Agora" / "Join the Cohort" đều dẫn thẳng vào màn hình đăng nhập/đăng ký toàn màn hình (nền đen). Màn hình này **không có nút back/close, không có logo để về home, phím Escape không có tác dụng, và nút back của trình duyệt cũng không hoạt động** (SPA không push history) → user bị "nhốt" trong màn hình auth.
- **H6 – Recognition rather than recall**: Không có bản demo/dùng thử nào — mọi CTA đều ép đăng nhập ngay, không cho xem trước sản phẩm thực (đoạn hội thoại Socratic ở hero chỉ là ảnh minh hoạ tĩnh, không tương tác được).
- **H2 – Match between system & real world**: Copy chơi chữ quá đà ("Enrollment — begin your journey into the realm of forms", "New Seeker?", "Already a Scholar?") khiến chức năng thực (đăng ký / đăng nhập) bị mơ hồ, đặc biệt với người ít quen thuật ngữ.
- **H10 – Help and documentation**: Footer chỉ có dòng bản quyền, không có link Hỗ trợ/FAQ/Liên hệ/Chính sách bảo mật.
- **H4 – Consistency and standards**: Theme chuyển đột ngột từ nền sáng (landing) sang nền đen tuyền (auth) không có transition hay giải thích, gây mất phương hướng thị giác.
- Ghi chú kỹ thuật: form đăng nhập/đăng ký bị trình duyệt autofill sẵn email + password thật của người dùng máy — bản thân site không kiểm soát việc này nhưng cũng không có `autocomplete="off"`/cảnh báo, rủi ro trên máy dùng chung.

---

## Nhật ký 10 tester đầu tiên

**T1 — 17 tuổi, Mobile, Tech: Cao, Mục tiêu: Mạng xã hội**
Vào thử vì thấy link chia sẻ trên nhóm bạn, lướt nhanh để xem "có gì hot". Việc chữ mờ dần khi cuộn khiến em tưởng mạng lag, cuộn qua cuộn lại 2 lần để "load" chữ. Bấm thẳng "Launch Workspace" vì tò mò sản phẩm thật trông thế nào — bị đẩy vào màn hình đăng nhập đen ngòm, không có nút thoát, phải đóng tab luôn vì bực. **CSAT: 2/5.**

**T2 — 16 tuổi, Mobile, Tech: Trung bình, Mục tiêu: Giải trí (video/tin tức)**
Định xem thử "AI dạy học" có vui như TikTok không. Đọc câu quote to đẹp ở đầu trang thấy hay, nhưng cuộn xuống thấy chữ cứ nhạt dần nhạt dần, em nghĩ máy mình bị đơ nên tắt mở lại web 2 lần. Không hiểu "Agora" là gì, không dám bấm vì sợ phải trả tiền mà không thấy giá ở đâu cả. **CSAT: 2/5.**

**T3 — 19 tuổi, Mobile, Tech: Cao, Mục tiêu: Chơi game**
Vào xem có phải web kiểu "học mà chơi" như app game giáo dục không. Thích cái khung chat demo Socratic ở đầu trang, tưởng bấm vào chơi thử được — hoá ra chỉ là ảnh tĩnh, không click được (không có affordance rõ ràng nó chỉ minh hoạ). Bấm "Enter the Agora" mong vào "level" đầu tiên thì bị quăng ra màn hình login, không có nút back, phải kill app/tab. Trải nghiệm giống bị "softlock" trong game dở. **CSAT: 2/5.**

**T4 — 18 tuổi, Mobile, Tech: Trung bình, Mục tiêu: Học tập/Nghiên cứu**
Đang cần tìm công cụ hỗ trợ ôn thi, nghĩ đây đúng nhu cầu. Đọc phần "The Method" thấy ý tưởng hay (hỏi ngược thay vì trả lời) nhưng phải chờ từng đoạn hiện rõ mới đọc được, mất thời gian. Cuối cùng bấm "Join the Cohort" mong đăng ký học thử miễn phí, không có thông tin học phí/gói dùng thử trước khi bắt buộc tạo tài khoản — thấy thiếu minh bạch nên bỏ ngang. **CSAT: 3/5.**

**T5 — 17 tuổi, Desktop, Tech: Cao, Mục tiêu: Chơi game**
Rảnh lướt web trong lúc chờ tải game, click vào vì tiêu đề lạ. Trên desktop hiệu ứng fade còn rõ và khó chịu hơn vì màn hình lớn, nhiều mảng chữ xám cùng lúc trông như trang bị vỡ layout. Thử phím tắt Escape để thoát form đăng ký (thói quen từ game) — không ăn thua, nút Back trình duyệt cũng vô dụng. Đánh giá đây là "web đẹp mã nhưng dởm về UX". **CSAT: 1/5.**

**T6 — 19 tuổi, Mobile, Tech: Thấp, Mục tiêu: Mạng xã hội**
Bạn bè gửi link bảo "web học hay lắm", vào xem thử. Không hiểu chữ "Socratic", "Agora", "Enrollment" nghĩa là gì, không có tiếng Việt hay giải thích đơn giản. Thấy chữ mờ ảo cứ nghĩ máy yếu nên chờ khá lâu mỗi lần cuộn. Bấm nhầm nút tối/sáng (nút mặt trời) không hiểu để làm gì vì không có chữ ghi chú. Cuối cùng không tìm được cách "dùng thử" mà không phải đăng ký, thấy nản và thoát. **CSAT: 1/5.**

**T7 — 22 tuổi, Mobile, Tech: Cao, Mục tiêu: Mạng xã hội**
Thấy web được share trên Threads, vào xem để đánh giá có đáng giới thiệu lại không. Về mặt thẩm mỹ thấy ổn (font serif sang), nhưng animation scroll-fade là "red flag" UX kinh điển — che nội dung đúng lúc cần đọc nhanh. Thử cả 3 nút CTA (Launch Workspace, Enter the Agora, Join the Cohort) đều ra cùng 1 màn login, không có cách nào xem trước tính năng thật. Sẽ không giới thiệu lại. **CSAT: 2/5.**

**T8 — 24 tuổi, Mobile, Tech: Trung bình, Mục tiêu: Mua sắm online**
Quen thói quen shopping app (xem sản phẩm/giá trước khi tạo tài khoản), áp dụng tương tự ở đây: kéo xuống tìm mục "giá/gói học" nhưng không có, chỉ có nút CTA mơ hồ. Không có preview/trial như các app học online khác (Duolingo, v.v.) từng dùng. Cảm giác bị ép "mua hàng không thấy giá" — rất khó chịu, tắt trang giữa chừng. **CSAT: 2/5.**

**T9 — 21 tuổi, Desktop, Tech: Cao, Mục tiêu: Học tập/Nghiên cứu**
Đúng đối tượng mục tiêu của sản phẩm (sinh viên cần công cụ ôn tập), chủ động đọc kỹ cả 3 mục The Method/Features/Wisdom. Đánh giá ý tưởng sản phẩm (Feynman Technique Simulator, Knowledge Map, Mistake Vault) rất tốt và đúng insight giáo dục. Nhưng khi bấm vào dùng thử thật thì bị chặn ngay ở màn hình đăng nhập đen, không preview được bất kỳ tính năng nào đã đọc — cảm giác "bị lừa" vì marketing hứa hẹn nhiều hơn những gì cho trải nghiệm trước khi trả giá (tạo tài khoản). Đây là user có thiện chí cao nhất trong nhóm mà vẫn tụt hứng. **CSAT: 3/5.**

**T10 — 27 tuổi, Mobile, Tech: Trung bình, Mục tiêu: Công việc/Năng suất**
Tranh thủ giờ nghỉ trưa xem công cụ có ích cho việc học thêm kỹ năng công việc không, cần quyết định nhanh trong 2-3 phút. Vì animation làm chậm việc đọc lướt, không kịp nắm được thông tin trong thời gian ít ỏi. Bấm thử nút đăng nhập để xem "dashboard" trông thế nào trước khi cân nhắc dùng cho công việc — bị chặn hoàn toàn, không có cách nào xem giao diện sản phẩm thật nếu chưa có tài khoản. Không có thời gian quay lại tìm hiểu thêm. **CSAT: 2/5.**

---

## Bảng thống kê kết quả (T1–T10)

| ID | Tuổi | Thiết bị | Tech | Mục tiêu | CSAT (/5) | Heuristic vi phạm chính |
|---|---|---|---|---|---|---|
| T1 | 17 | Mobile | Cao | Mạng xã hội | 2 | H3 – User control (bẫy auth) |
| T2 | 16 | Mobile | Trung bình | Giải trí | 2 | H1 – Visibility (fade mập mờ) |
| T3 | 19 | Mobile | Cao | Chơi game | 2 | H3 – User control (bẫy auth) |
| T4 | 18 | Mobile | Trung bình | Học tập | 3 | H10 – Help/documentation (thiếu giá) |
| T5 | 17 | Desktop | Cao | Chơi game | 1 | H1 + H3 kết hợp |
| T6 | 19 | Mobile | Thấp | Mạng xã hội | 1 | H2 – Match real world (thuật ngữ khó hiểu) |
| T7 | 22 | Mobile | Cao | Mạng xã hội | 2 | H6 – Recognition (không có demo) |
| T8 | 24 | Mobile | Trung bình | Mua sắm | 2 | H10 – Thiếu thông tin giá/gói |
| T9 | 21 | Desktop | Cao | Học tập | 3 | H6 – Recognition (không preview tính năng) |
| T10 | 27 | Mobile | Trung bình | Công việc | 2 | H1 – Visibility (chậm nắm bắt thông tin) |

**CSAT trung bình (T1–T10): 2.0/5**

**Phân tích nhanh:**
- Tech "Thấp" (T6) chấm điểm thấp nhất tuyệt đối (1/5) — thuật ngữ ẩn dụ (Agora, Socratic, Enrollment) là rào cản lớn nhất với nhóm này.
- Lỗi lặp lại ở **9/10 tester**: bị chặn bởi màn hình đăng nhập toàn màn hình không lối thoát — đây là lỗi nghiêm trọng nhất, nên fix trước tiên.
- Không tester nào tìm thấy thông tin giá/gói dùng thử — rào cản chuyển đổi (conversion) rất lớn, kể cả với user tech cao và đúng target (T9).
- Hiệu ứng fade-in theo scroll bị chê ở cả mobile lẫn desktop, cả tech cao lẫn thấp — nên cân nhắc bỏ hoặc giảm mạnh cường độ.
