---
type: concept
topic: ux-ai-products
roles: [CPO, CTO]
stages: [2-mvp]
tags: [concept, ux, design, ai-product]
status: filled
---

# UX cho sản phẩm AI

**Vai trò:** [[CPO - Product]], [[CTO - Technical Cofounder]] · **Giai đoạn:** [[MVP]]

## Vì sao cần

Sản phẩm AI dễ hỏng UX theo kiểu riêng: output không chắc chắn, đôi khi sai (hallucination), user không biết tin bao nhiêu. UX chính là nơi biến workflow integration thành moat ([[AI Moat Checklist]]).

## Concept lõi cần học

- **Thiết kế cho tính bất định:** AI không luôn đúng — thiết kế để user dễ sửa, dễ hoàn tác, thấy được độ tin cậy.
- **Human-in-the-loop:** cho user review/duyệt trước khi hành động quan trọng; tạo niềm tin.
- **Progressive disclosure:** đừng dội hết sức mạnh AI cùng lúc; dẫn user đến giá trị từng bước (time-to-value ngắn).
- **Workflow integration > chatbox:** cắm AI vào đúng chỗ trong quy trình thật của user thay vì thêm 1 ô chat rời — tạo switching cost.
- **Feedback loop:** thu phản hồi user (thumbs up/down) vừa cải thiện model vừa nuôi [[Growth Loops va Retention]] (data flywheel).
- **Xử lý lỗi & hallucination trên UI:** minh bạch khi AI không chắc, tránh mất niềm tin.

## Áp dụng theo giai đoạn

- MVP: thiết kế luồng cốt lõi + human-in-the-loop cho tác vụ rủi ro.

## Nguồn

Nguyên tắc UX cho generative AI 2025-2026; [Hatchworks — AI Wrapper Product Strategy](https://hatchworks.com/blog/gen-ai/ai-wrapper-product-strategy/)
