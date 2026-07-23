---
type: concept
topic: ai-foundations
roles: [CTO]
stages: [1-idea-validation, 2-mvp]
tags: [concept, ai, llm]
status: filled
---

# Nền tảng AI & LLM (AI Foundations)

**Vai trò:** [[CTO - Technical Cofounder]] · **Giai đoạn:** [[Idea Validation]], [[MVP]]

## Vì sao cần

Với AI startup, CTO phải hiểu đủ sâu để trả lời: bài toán này AI có giải được thật không, cost bao nhiêu, và moat nằm ở đâu (không phải ở model).

## Concept lõi cần học

- **Foundation models & API:** hiểu khác biệt giữa các provider (Claude, GPT, Gemini, open-source như Llama), context window, latency, cost/token.
- **Prompt engineering vs fine-tuning vs RAG:** RAG (retrieval-augmented generation) để cắm dữ liệu độc quyền — đây thường là nơi tạo moat data. Fine-tuning tốn kém, cân nhắc kỹ.
- **Agents & tool use:** LLM gọi tool/hàm để hành động, không chỉ trả text. Nền tảng của workflow automation → liên quan [[AI Coding Agents va Skills]].
- **Cost of inference:** chi phí thật trên mỗi tác vụ — ảnh hưởng trực tiếp margin và [[Chien luoc Pricing AI]].
- **Eval & hallucination:** cách đo chất lượng output, kiểm soát bịa đặt — quan trọng khi sản phẩm phục vụ khách hàng thật.
- **Vendor lock-in / single point of failure:** phụ thuộc 1 API provider là rủi ro; kiến trúc nên cho phép đổi model.

## Áp dụng theo giai đoạn

- Idea: đánh giá tính khả thi kỹ thuật + ước tính cost trong [[AI Moat Checklist]].
- MVP: chọn stack, dựng RAG/agent, đo eval.

## Nguồn

Kiến thức nền LLM/AI engineering 2025-2026.
