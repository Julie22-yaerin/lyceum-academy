---
type: concept
topic: ai-coding-agents
roles: [CTO]
stages: [2-mvp]
tags: [concept, ai, coding-agent, skills, productivity]
status: filled
---

# AI Coding Agents & Skills

**Vai trò:** [[CTO - Technical Cofounder]] · **Giai đoạn:** [[MVP]] (một phần ở PoC giai đoạn [[Idea Validation]])

## Vì sao cần

2026: team AI startup nhỏ (2-3 người) có thể build nhanh gấp nhiều lần nhờ agentic coding. Đội báo cáo giao feature nhanh hơn 30-50%, phần lớn nhờ tự động debug & viết test. Đây là đòn bẩy lớn nhất của technical co-founder ở giai đoạn build MVP.

## Concept lõi cần học

- **Agentic coding là gì:** agent đọc cả codebase, lập kế hoạch, sửa nhiều file, chạy lệnh/test, chuẩn bị PR để người review — không chỉ autocomplete 1 dòng.
- **Công cụ chính 2026:** Claude Code (mạnh nhất cho task phức tạp đa file, chạy trong terminal, hỗ trợ hooks & skills), Cursor (IDE fork của VS Code, chế độ agent Composer chạy song song), OpenAI Codex. Chọn theo workflow team.
- **Skills / hooks:** đóng gói quy trình lặp (deploy, review checklist, workflow riêng của repo) thành "skill" để agent tự dùng lại — nhân năng suất, giảm lỗi lặp.
- **Subagent & tool scoping:** giao task con cho agent riêng, giới hạn tool để an toàn.
- **Review kỷ luật:** agent tăng tốc nhưng CTO vẫn phải review — tránh tech debt vô hình và lỗ hổng bảo mật.

## Áp dụng theo giai đoạn

- Idea: dựng proof-of-concept siêu nhanh để test giả thuyết kỹ thuật (xem [[CTO - Technical Cofounder]]).
- MVP: build sản phẩm thật; đóng gói skill cho các quy trình lặp lại.

## Nguồn

[Levelop — Best AI Coding Agents 2026](https://levelop.dev/blog/the-best-ai-coding-agents-in-2026-a-practical-ranking-for-working-developers), [Cosmic — Claude Code vs Codex vs Cursor](https://www.cosmicjs.com/blog/claude-code-vs-codex-vs-cursor)
