# Lyceum Academy — Phân tích giá gói & phân quyền tính năng

> Bối cảnh: founder đưa giá nháp Compass $9.99 / Scholar $19.99 / STEM $34.5 / Researcher $38.99, có thể tuỳ chỉnh. Yêu cầu: phân tích lại giá + chia quyền/tính năng theo gói sao cho **phù hợp** (đúng giá trị), **đầy đủ** (không thiếu tính năng cốt lõi ở gói thấp) và **không quá hẹp hòi** (không giam tính năng free/basic tới mức người dùng bỏ đi trước khi thấy giá trị).
>
> Số liệu chi phí dùng lại từ [api_cost_growth_model.md](./api_cost_growth_model.md) — tại đây tôi chỉ mở rộng sang pricing/entitlements, không tính lại chi phí hạ tầng.

## 1. Vấn đề với bậc giá nháp hiện tại

| Gói | Giá | Khoảng cách với gói dưới |
|---|---|---|
| Compass | $9.99 | — |
| Scholar | $19.99 | +$10.00 (+100%) |
| STEM | $34.5 | +$14.51 (+73%) |
| Researcher | $38.99 | **+$4.49 (+13%)** |

**Vấn đề chính: khoảng cách STEM → Researcher chỉ 13%.** So với 73–100% ở các bậc dưới, đây là bậc thang gãy — người dùng gần như luôn thấy Researcher "rẻ hơn tương đối" so với STEM và mua thẳng lên trên nếu có bất kỳ tính năng nào researcher hấp dẫn hơn, khiến STEM trở thành một "decoy" chứ không phải một gói có lý do tồn tại độc lập. Ngược lại nếu Researcher không đủ khác biệt, người dùng sẽ thấy bị "ép" mua thêm $4.49 mà không rõ đổi lấy gì.

**Vấn đề thứ hai: tên gói "STEM" xung đột với sản phẩm.** Code hiện tại (`SUBJECT_META` trong `src/lib/persist.ts`) hỗ trợ 10 môn: Toán, Lý, Hoá, Sinh, Lập trình, Sử, Văn, Kinh tế, Triết, Tiếng Anh — tức sản phẩm là gia sư **đa môn**, không phải riêng STEM. Đặt tên gói "STEM" ngụ ý giới hạn theo môn học, nhưng không có cơ chế nào trong code hiện khoá theo môn (không có `subject` field trên user/subscription). Nếu giữ tên "STEM", cần hoặc (a) thực sự giới hạn STEM-only ở gói đó (thu hẹp phạm vi, cần thêm logic chưa tồn tại), hoặc (b) đổi tên để tránh hứa hẹn sai — tôi khuyến nghị (b), xem mục 3.

**Vấn đề thứ ba: chi phí API không phải cơ sở để định giá.** Theo model chi phí, 1 trial user tốn ~$0.014–$0.022, và ngay ở kịch bản 10,000 user mới/tháng bill vẫn chỉ ~$140–215. Nghĩa là **không có gói nào trong 4 gói này bị áp lực margin từ text-chat/exercises** — chi phí biến đổi thực sự nằm ở **voice ARI (S2S)**, chiếm ~75% chi phí/user trong model. Đây phải là trục phân biệt chính giữa các gói, không phải số lượng câu hỏi hay môn học.

## 2. Trục phân biệt nên dùng: phút thoại ARI (voice), không phải số lượng chat

Vì text (chat/exercise/mistake bank/notes) gần như miễn phí ở quy mô hiện tại, giới hạn cứng số tin nhắn/exercise ở gói thấp sẽ **quá hẹp hòi** so với chi phí thật — đúng như founder lo ngại. Thay vào đó:

- **Text-based (chat, exercise, mistake bank, notes, reference bank, progress): mở toàn bộ ở MỌI gói trả phí**, không giới hạn số lượng. Đây là "đầy đủ" — chi phí không đáng kể nên không có lý do khoá.
- **Voice ARI (S2S): giới hạn theo phút/tháng**, tăng dần theo gói — đây là chỗ margin thật sự bị ảnh hưởng (theo model, 1 phiên 5 phút ≈ $0.021).
- **AI Roadmap (Nexus, DeepSeek-powered)**: đây là tính năng tính toán nặng hơn (gọi LLM riêng để phân tích learning style), hợp lý để giới hạn tần suất tạo lại ở gói thấp (vd. 1 lần/tuần) và mở tự do ở gói cao.

## 3. Đề xuất bậc giá đã sửa (giữ tinh thần 4 gói, sửa khoảng cách + tên)

| Gói (đề xuất) | Giá gốc | Giá đề xuất | Lý do đổi |
|---|---|---|---|
| **Compass** (Khởi đầu) | $9.99 | **$9.99** (giữ nguyên) | Anchor tốt, giữ nguyên |
| **Scholar** (Học viên) | $19.99 | **$19.99** (giữ nguyên) | Khoảng cách x2 với Compass hợp lý |
| **Mentor** *(đổi tên từ "STEM")* | $34.5 | **$29.99** | Bỏ tên "STEM" (sai vì đa môn); hạ nhẹ để nới khoảng cách xuống Researcher |
| **Researcher** (Chuyên sâu) | $38.99 | **$49.99** | Nâng để tạo khoảng cách +67% so với Mentor — xứng đáng là gói cao nhất |

→ Bậc thang mới: $9.99 → $19.99 (+100%) → $29.99 (+50%) → $49.99 (+67%). Đều >45%, không còn bậc gãy.

**Đây vẫn là số tuỳ chỉnh được** — founder có thể giữ tên/số gốc nếu ưu tiên thẩm mỹ giá (.5, .99 cho đẹp) hơn là khoảng cách đều; nhưng nếu giữ nguyên 4 số gốc, tôi khuyến nghị **gộp STEM+Researcher thành 1 gói** thay vì tách 2 gói cách nhau 13%, vì 2 gói quá gần sẽ chỉ gây rối hành vi mua chứ không tăng doanh thu (người mua sẽ luôn chọn gói mắc hơn nếu chênh lệch quá nhỏ, làm STEM trở thành gói chết).

## 4. Ma trận phân quyền / tính năng theo gói

Cơ sở: liệt kê tính năng thật đang có trong code (`src/views/*`, `src/components/*`), không phải tính năng giả định.

| Tính năng (nguồn code) | Compass $9.99 | Scholar $19.99 | Mentor $29.99 | Researcher $49.99 |
|---|:---:|:---:|:---:|:---:|
| Chat gia sư văn bản (`DialogueView`) — đa môn, không giới hạn | ✅ không giới hạn | ✅ không giới hạn | ✅ không giới hạn | ✅ không giới hạn |
| Bộ đề luyện tập (`ExerciseView`, `ProblemSetsView`) | ✅ không giới hạn | ✅ không giới hạn | ✅ không giới hạn | ✅ không giới hạn |
| Sổ tay lỗi sai (`MistakeBankView`) | ✅ | ✅ | ✅ | ✅ |
| Ghi chú + note editor (`NoteView`, `NotepadWindow`, `RichNoteEditor`) | ✅ | ✅ | ✅ | ✅ |
| Theo dõi tiến độ / streak (`ProgressView`) | ✅ | ✅ | ✅ | ✅ |
| Kho tài liệu tham khảo (`ReferenceBankView`) | Giới hạn 20 mục đã lưu | 100 mục | Không giới hạn | Không giới hạn |
| Sơ đồ tư duy (`KnowledgeMapView`, `MindMapTool`) | ❌ | ✅ | ✅ | ✅ |
| **Gia sư giọng nói ARI (S2S)** (`VoiceOrb`, `S2SVoiceOverlay`) | **15 phút/tháng** | **60 phút/tháng** | **180 phút/tháng** | **Không giới hạn*** |
| Lộ trình học AI cá nhân hoá (`NexusView`, DeepSeek roadmap) | Tạo 1 lần khi onboarding, không tạo lại | Tạo lại 1 lần/tháng | Tạo lại 1 lần/tuần | Tạo lại không giới hạn |
| Ưu tiên hàng đợi model (fallback cascade ít hơn khi traffic cao) | Chuẩn | Chuẩn | Ưu tiên | Ưu tiên cao nhất |
| Hỗ trợ | Email, phản hồi 48h | Email, 24h | Email, 12h | Email + ưu tiên phản hồi trong ngày |

*\*Researcher "không giới hạn" voice nên có fair-use cap ẩn (vd. 600 phút/tháng, ~soft-cap) để tránh rủi ro rate-limit/chi phí đột biến — không cần công bố con số này cho khách, chỉ cảnh báo nội bộ khi vượt.*

**Vì sao không khoá chat/exercise/notes ở gói thấp nhất:** đây chính là phần "không quá hẹp hòi" — chi phí text gần như $0, khoá nó chỉ làm giảm giá trị cảm nhận của Compass mà không tiết kiệm được gì đáng kể. Trục thu phí thật nằm ở phút thoại ARI, vì đó là dòng chi phí biến đổi thật duy nhất đáng kể trong model.

## 5. Kiểm tra margin nhanh với số đã có

- Compass 15 phút voice/tháng ≈ 3 phiên 5 phút ≈ $0.021 × 3 = **$0.063 chi phí voice/tháng**. Cộng chi phí text (~$0.003/tháng ở mức dùng bình thường) → tổng chi phí biến đổi/user ≈ **$0.07/tháng**, trên giá $9.99 → margin biến đổi ~99.3%. Rất an toàn.
- Researcher không giới hạn (giả sử fair-use 600 phút/tháng = 120 phiên): chi phí voice tối đa ≈ $0.021 × 120 = **$2.52/tháng**, trên giá $49.99 → margin vẫn ~95%. Vẫn an toàn ngay cả ở trần fair-use.
- Phí thanh toán (PayPal/MoR, ~5-10% theo mục 10 của cost model) là chi phí lớn hơn nhiều so với API — **đây là lý do nên có chiết khấu trả theo năm** (giảm số lần bị phí cố định $0.49/giao dịch ăn vào, đúng như model gốc đã nêu ở mục 10).

## 6. Việc cần làm tiếp — vì hệ thống chưa có cơ chế phân quyền

Đã kiểm tra code: hiện **chưa tồn tại** khái niệm plan/tier/entitlement nào trong `src/` — không có bảng subscription, không có feature flag theo gói, không có giới hạn phút voice. Sản phẩm đang chạy 100% free trial. Nghĩa là bảng phân quyền ở mục 4 là **thiết kế**, chưa phải **thực thi**. Việc dựng cơ chế này (billing integration, đếm phút voice, gate tính năng theo plan trong Supabase/Firebase) là một hạng mục kỹ thuật riêng, cần chủ dự án xác nhận giá/tên gói trước khi triển khai để tránh phải sửa lại schema.

## 7. Câu hỏi cần founder chốt trước khi build

1. Giữ nguyên 4 số giá gốc ($9.99/$19.99/$34.5/$38.99) hay áp dụng bậc thang đề xuất ($9.99/$19.99/$29.99/$49.99)?
2. Đổi tên "STEM" → "Mentor" (hoặc tên khác) để khớp với sản phẩm đa môn, hay giữ tên STEM và thực sự giới hạn nội dung theo môn ở gói đó?
3. Số phút voice ARI/tháng ở mục 4 là đề xuất dựa trên tỷ lệ giá — founder có số liệu thật về nhu cầu voice/user chưa (model gốc ghi rõ đây là "giả định yếu nhất, chưa đo")? Nên đo trước khi khoá cứng con số này vào billing.
4. Billing theo tháng hay có gói năm (giảm phí giao dịch cố định)?

## 8. QUYẾT ĐỊNH CUỐI CÙNG CỦA FOUNDER (2026-07-08)

Founder đã trả lời qua interaction `ask_user_questions` (ID `311942c2-6488-4c49-be94-75a2293f5404`):

| Câu hỏi | Quyết định |
|---|---|
| Bậc giá | **Dùng bậc thang đề xuất: $9.99 / $19.99 / $29.99 / $49.99** |
| Tên gói "STEM" | **Đổi tên thành "Mentor"** (không giới hạn theo môn) |
| Số phút voice ARI | **Dùng số đề xuất để launch** (15/60/180/fair-use 600 phút), đo lại nhu cầu thật sau khi có dữ liệu người dùng |
| Chu kỳ billing | **Theo tháng + có gói năm (chiết khấu)** |

### Bảng giá & tên gói CHỐT (final)

| Gói | Giá/tháng | Giá/năm (đề xuất, ~2 tháng miễn phí = -17%) | Voice ARI/tháng |
|---|---|---|---|
| **Compass** | $9.99 | $99.99 | 15 phút |
| **Scholar** | $19.99 | $199.99 | 60 phút |
| **Mentor** | $29.99 | $299.99 | 180 phút |
| **Researcher** | $49.99 | $499.99 | Không giới hạn (fair-use 600 phút, ẩn) |

Chiết khấu năm ~17% (2 tháng miễn phí trên 12) là mức phổ biến trong SaaS và giúp giảm số lần thu phí giao dịch cố định ($0.49/lần theo cost model mục 10) — ví dụ Compass: 12 lần thu $0.49 = $5.88 phí cố định/năm nếu billing tháng, so với 1 lần $0.49 nếu billing năm, tiết kiệm ~$5.39/user/năm ngay cả trước khi tính chiết khấu.

**Ma trận phân quyền ở mục 4 giữ nguyên là bản chốt cuối** (tên cột đã dùng Mentor/Researcher với giá mới).

### Việc cần làm tiếp (kỹ thuật)

Giá và phân quyền đã chốt nhưng **hệ thống chưa có cơ chế thực thi** (xem mục 6) — cần task kỹ thuật riêng để dựng: bảng subscription/plan trong DB, đếm phút voice ARI theo user/tháng, feature gate theo gói, tích hợp billing (Stripe hoặc tương đương) hỗ trợ chu kỳ tháng + năm. Task này đã được tạo và giao cho đội kỹ thuật (xem liên kết trong comment).
