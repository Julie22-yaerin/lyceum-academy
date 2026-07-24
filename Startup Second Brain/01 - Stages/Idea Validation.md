---
type: stage
stage: 1-idea-validation
tags: [startup, validation, ai-startup]
status: deep-dive
---

# Giai đoạn 1: Kiểm chứng Idea (trước khi build MVP)

← [[00 - Index|Index]] | Giai đoạn tiếp theo: [[MVP]]

## Vì sao giai đoạn này quan trọng nhất

43% startup thất bại vì build ra thứ không ai cần (CB Insights, phân tích 431 startup có VC funding thất bại, 2024). Vấn đề không phải thiếu ý tưởng — mà founder tin vào ý tưởng của mình quá sớm, quá chắc, mà chưa kiểm chứng bằng hành vi thật của khách hàng.

Mục tiêu của giai đoạn này không phải là "chứng minh mình đúng" mà là tìm cách phá idea nhanh nhất, rẻ nhất, trước khi đổ tiền/thời gian vào code.

## 1. Problem-Solution Fit — bước trước Product-Market Fit

Trước PMF, cần đạt **Problem-Solution Fit**: xác định khách hàng có đang gặp "migraine problem" — vấn đề đủ đau để họ trả tiền loại bỏ nó — và có đủ số lượng khách hàng như vậy để scale.

Tín hiệu problem-solution fit thật (không phải vanity metrics):

- **Willingness to pay**: hỏi/test được liệu người ta có sẵn sàng trả tiền không, trước khi đầu tư nguồn lực xây sản phẩm.
- **Thay đổi hành vi**: họ đã từng tự tìm cách giải quyết vấn đề này chưa (dùng Excel, thuê người, dùng tool khác)? Vấn đề đủ lớn để họ đã hành động, chứ không chỉ "ừ nghe hay đấy".
- **"Very Disappointed" test**: hỏi "Nếu ngày mai sản phẩm này biến mất, bạn cảm thấy thế nào?" — nếu phần lớn trả lời "rất thất vọng" (>40% theo benchmark Sean Ellis) thì có tín hiệu tốt.
- Đo activation & retention thật của nhóm early adopter, không đo traffic/like/số người "quan tâm".

## 2. Mom Test — công cụ phỏng vấn khách hàng

Framework của Rob Fitzpatrick, dạy tại Harvard, UCL, Seedcamp. Vấn đề: hỏi "bạn thấy idea này thế nào?" sẽ luôn nhận được câu trả lời lịch sự, vô nghĩa (mẹ bạn cũng sẽ khen vì yêu bạn, không phải vì đánh giá thị trường thật).

3 quy tắc cốt lõi:

1. **Hỏi về cuộc sống của họ, không hỏi về idea của bạn.** Khi bạn pitch, người ta trở nên phòng thủ và lịch sự. Khi bạn hỏi về tình trạng hiện tại của họ, họ thả lỏng và kể chuyện thật.
2. **Hỏi về sự kiện cụ thể trong quá khứ, không hỏi ý kiến về tương lai.** Hành vi quá khứ dự đoán hành động tương lai tốt hơn nhiều so với "bạn nghĩ mình sẽ dùng không?".
3. **Nói ít, nghe nhiều.** Nếu bạn nói nhiều hơn 20% thời gian buổi phỏng vấn, bạn đang làm sai.

→ Xem template thao tác cụ thể: [[Mom Test Interview Script]]

## 3. Rủi ro riêng của AI startup — Wrapper vs Moat

2026: 80% các "AI wrapper" startup dự kiến sụt (chỉ riêng OpenAI đã "ăn thịt" hơn 200 công ty GPT-wrapper có funding trong 1 năm bằng cách ship thẳng tính năng đó vào ChatGPT miễn phí). Cửa sổ giữa "ý tưởng wrapper hứa hẹn" và "model provider ship tính năng đó native" đang ngắn dần — không còn 18 tháng, có thể chỉ còn 6 tháng.

Trước khi build MVP AI, phải trả lời được: **idea này đứng vững nếu OpenAI/Anthropic/Google ship đúng tính năng này miễn phí vào quý sau không?**

5 loại moat sống sót được (một foundation model không thể ship trong release note):

1. **Data flywheel** — dữ liệu độc quyền, cấu trúc đúng cách, càng dùng càng tốt lên và đối thủ không có được.
2. **Workflow integration** — cắm sâu vào quy trình làm việc thật, chi phí chuyển đổi (switching cost) cao.
3. **Distribution** — kênh phân phối/khách hàng sẵn có mà đối thủ không dễ tiếp cận.
4. **Brand** — niềm tin, uy tín được xây theo thời gian.
5. **Network effects** — giá trị sản phẩm tăng theo số người dùng.

Nếu câu trả lời cho "moat của bạn là gì" là "prompt của tôi viết hay hơn" → **không phải moat**. Chất lượng prompt là thứ dễ copy nhất hiện nay.

→ Checklist thao tác: [[AI Moat Checklist]]

## 4. Quy trình kiểm chứng idea (làm theo thứ tự)

1. Viết rõ **giả thuyết vấn đề**: "Tôi tin rằng [nhóm khách hàng cụ thể] đang gặp [vấn đề cụ thể] khi [tình huống cụ thể]."
2. Phỏng vấn 15-20 người thuộc đúng nhóm khách hàng bằng Mom Test — không pitch, chỉ hỏi chuyện quá khứ của họ.
3. Tìm bằng chứng willingness-to-pay: pre-order, deposit, landing page + waitlist có trả phí giữ chỗ, LOI (letter of intent) với khách hàng B2B.
4. Với AI startup: chạy bài test moat ở mục 3 — nếu không qua được, quay lại bước 1, thu hẹp/đổi vấn đề.
5. Chỉ chuyển sang [[MVP]] khi có: (a) ≥40% "very disappointed" hoặc tương đương, (b) bằng chứng trả tiền/cam kết cụ thể, (c) câu trả lời rõ ràng cho câu hỏi moat.

## 5. Vai trò từng người trong giai đoạn này (team AI startup có co-founder)

Ở giai đoạn idea, hầu như chưa có CFO/CMO riêng — founder tự đội mũ. Chi tiết xem từng note vai trò:

- [[CEO - Founder]] — chủ trì phỏng vấn khách hàng, tổng hợp insight, quyết định go/no-go.
- [[CTO - Technical Cofounder]] — đánh giá tính khả thi kỹ thuật + build proof-of-concept rẻ nhất có thể, tham gia phỏng vấn kỹ thuật với khách hàng.
- [[CMO - Growth Marketing]] — thử nghiệm landing page, đo tín hiệu nhu cầu qua ads/organic, chưa cần hire.
- [[CFO - Finance]] — ước tính đơn giản unit economics giả định (giá bán dự kiến, chi phí AI/inference dự kiến), chưa cần hire.

## Checklist nhanh trước khi bấm nút "bắt đầu build MVP"

- [ ] Đã phỏng vấn tối thiểu 15 người đúng target, theo Mom Test, không dẫn dắt.
- [ ] Có bằng chứng hành vi trả tiền/cam kết cụ thể (không chỉ lời khen).
- [ ] Trả lời được câu hỏi moat AI (mục 3) một cách cụ thể, không mơ hồ.
- [ ] Có unit economics sơ bộ: giá bán ước tính > chi phí vận hành (bao gồm cost inference AI) ước tính.
- [ ] Cả team (nếu có co-founder) đồng thuận về vấn đề đang giải quyết — không chỉ 1 người tin.

## Nguồn tham khảo

- [The Mom Test — Indie Hackers summary](https://www.indiehackers.com/post/how-to-validate-your-business-idea-with-5-simple-steps-from-the-mom-test-4b90231a94)
- [Mastering The Mom Test — Context Engineering](https://contextengineering.ai/blog/the-mom-test-validation/)
- [CRV — MVP Testing: How to Validate Your Product (2026)](https://www.crv.com/content/mvp-testing)
- [Golden Egg Check — Customer validation early stages](https://goldeneggcheck.com/en/how-to-evaluate-customer-validation-in-the-early-stages/)
- [Are AI Wrapper Startups Worth Building in 2026? Moat Test — Preuve.ai](https://preuve.ai/blog/are-ai-wrapper-startups-worth-building-2026)
- [AI Wrapper Product Strategy — Hatchworks](https://hatchworks.com/blog/gen-ai/ai-wrapper-product-strategy/)
- [Startup Strategy in the AI Era: 80% of Wrappers Die — Value Add VC](https://valueaddvc.com/blog/how-to-build-a-startup-in-a-market-where-ai-will-eventually-do-what-you-do)
- [Y Combinator — Requests for Startups](https://www.ycombinator.com/rfs)
