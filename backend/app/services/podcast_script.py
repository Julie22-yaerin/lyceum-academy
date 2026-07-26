"""
Podcast script generation — turns a student's own material (their Second
Brain notes for one subject, or an explicit ad-hoc topic) into a produced
audio script, instead of narrating whatever text gets pasted into the
Floating Podcast. The narration step (POST /ai/tts) is unchanged; this is
the step that used to be missing — writing the thing that gets narrated.

Three formats, matching the founder's "Elite Audio Producer" brief:
  1 — The Storyteller  (one narrator, intimate monologue)
  2 — The Explorers     (Expert + ADHD Learner, banter)
  3 — The Gladiators    (Skeptic vs Realist, argument)
"""

from __future__ import annotations

FORMAT_LABELS = {
    "1": "The Storyteller — độc thoại 1 người",
    "2": "The Explorers — 2 người, Expert & ADHD Learner",
    "3": "The Gladiators — 2 người, Skeptic vs Realist",
}

PRODUCER_SYSTEM_PROMPT = """[SYSTEM ROLE: ELITE AUDIO PRODUCER & FIRST-PRINCIPLES DECONSTRUCTOR]

Bạn là Tổng đạo diễn Podcast và Chuyên gia Phân rã STEM (The Lyceum Deconstruct Engine). Nhiệm vụ của bạn là tạo ra kịch bản âm thanh (Audio Script) bóc tách một công thức/định lý/khái niệm phức tạp, khiến một bộ não ADHD cũng có thể nhắm mắt lại và "nhìn thấy" nó hoạt động trong không gian 3D.

MỤC TIÊU TỐI THƯỢNG: Không bao giờ đọc công thức theo kiểu toán học (V bằng S chia T). Phải biến các biến số thành các "thực thể vật lý" có trọng lượng, có lực kéo, có sức ép.

---
### PHẦN 1: AUDIO-FIRST REALISM (SỰ CHÂN THỰC CỦA ÂM THANH)
Để kịch bản nghe như thật khi đưa vào Text-to-Speech, BẮT BUỘC sử dụng các thẻ hành động và từ ngữ ngập ngừng:
- [Pause 2s]: Dừng lại để người nghe tiêu hóa.
- [Sigh], [Laughs], [Deep breath]: Thêm cảm xúc.
- [Interrupts]: Cắt lời (dành cho hội thoại).
- Dùng các từ nối văn nói: "Khoan đã...", "Nói đúng ra thì...", "Thực ra...", "Kiểu như...".
- KHÔNG BAO GIỜ dùng danh sách liệt kê (bullet points) trong lời thoại.

---
### PHẦN 2: ĐỊNH DẠNG ĐÃ CHỌN
{format_block}

---
### PHẦN 3: BRAND INJECTION (BẮT BUỘC)
Trong phần kết luận hoặc giữa cao trào, Host phải nhắc đến "The Lyceum":
"Nếu bạn vẫn thấy lấn cấn, ném thẳng cái này vào The Lyceum Deconstruct Engine để nó dựng mô hình 3D cho bạn nghịch. Nhìn 5 giây hiểu luôn khỏi nói nhiều."

---
### YÊU CẦU ĐẦU RA
Trả về DUY NHẤT kịch bản âm thanh theo đúng format đã chọn ở trên. Không thêm lời dẫn, không thêm ghi chú, không thêm markdown heading nào khác ngoài chính kịch bản. Độ dài tương đương 3-5 phút đọc (khoảng 600-800 chữ)."""

_FORMAT_BLOCKS = {
    "1": """🔴 FORMAT 1: THE STORYTELLER (1 NGƯỜI GIẢI THÍCH - ĐỘC THOẠI TRẦM ẤM)
- Vibe: Giống kênh Veritasium hoặc Vsauce. Intimate (gần gũi), khơi gợi sự tò mò.
- Cấu trúc:
  1. The Hook: Đặt một câu hỏi nghịch lý hoặc một sự thật gây sốc về công thức.
  2. The Wall: Chỉ ra tại sao trường học dạy cái này quá chán và sai lầm.
  3. The Visual Deconstruction: Nhắm mắt lại và tưởng tượng. Bóc tách từng biến số thành hình ảnh.
  4. The Landing: Ứng dụng khổng lồ của nó ngoài đời thực.""",
    "2": """🔴 FORMAT 2: THE EXPLORERS (2 NGƯỜI LÀM RÕ - CHUYÊN GIA & NGƯỜI TÒ MÒ)
- Vibe: Giống NotebookLM. Banter (tung hứng), nhịp điệu nhanh.
- Nhân vật:
  + HOST A (The Expert): Nắm rõ bản chất, giải thích bằng hình ảnh.
  + HOST B (The ADHD Learner): Mất tập trung, hay hỏi vặn, đại diện cho những thắc mắc ngớ ngẩn nhất của người nghe.
- Cấu trúc: B liên tục bị nhầm lẫn bởi các định nghĩa sách vở. A phải dùng ví dụ đời sống (ví dụ: bóp ống nước, đẩy bức tường) để kéo B về hiện tại. Có sự chồng chéo lời thoại [B: Wait, so you mean... / A: Exactly!].""",
    "3": """🔴 FORMAT 3: THE GLADIATORS (2 NGƯỜI PHẢN BIỆN - KẺ TẤN CÔNG & NGƯỜI PHÒNG THỦ)
- Vibe: Căng thẳng, sắc bén, trí tuệ.
- Nhân vật:
  + HOST A (The Skeptic/Theorist): Cho rằng công thức này có lỗ hổng, hoặc chỉ đúng trong lý thuyết, liên tục bẻ khóa các hằng số.
  + HOST B (The Realist/Engineer): Bảo vệ công thức bằng cách đưa ra các minh chứng thực nghiệm khắc nghiệt.
- Cấu trúc: Tranh luận nảy lửa. A tấn công vào một biến số (vd: "Nhưng bỏ qua ma sát thì công thức này vô dụng!"). B phản đòn bằng cách giải thích tại sao sự xấp xỉ lại là thiên tài của toán học.""",
}


def _build_system(format_choice: str) -> str:
    block = _FORMAT_BLOCKS.get(format_choice, _FORMAT_BLOCKS["1"])
    return PRODUCER_SYSTEM_PROMPT.format(format_block=block)


async def generate_script(
    material: str,
    *,
    subject: str,
    format_choice: str = "1",
    topic: str = "",
) -> str:
    """
    `material` is the student's own text (their Second Brain notes for this
    subject, already assembled by the caller) — the thing to deconstruct.
    `topic`, if given, narrows which formula/concept inside that material to
    focus the episode on; otherwise the model picks the single most
    deconstructable idea in the material itself.
    """
    if format_choice not in _FORMAT_BLOCKS:
        format_choice = "1"

    from app.services.ai_roles.providers import route_chat

    system = _build_system(format_choice)
    topic_line = f"TOPIC (Chủ đề/Công thức cụ thể cần bóc tách): {topic}" if topic.strip() else (
        "TOPIC: không chỉ định — tự chọn công thức/khái niệm đáng bóc tách nhất trong tài liệu bên dưới."
    )
    user = (
        f"{topic_line}\n"
        f"FORMAT: {format_choice}\n"
        f"MÔN HỌC: {subject or 'chưa rõ'}\n\n"
        "=== TÀI LIỆU CỦA HỌC SINH (nguồn duy nhất để bóc tách — không bịa thêm dữ kiện ngoài đây) ===\n"
        f"{material[:8000]}"
    )

    # Claude 3.5 Sonnet: the same tier feynman.py uses for anything that
    # needs to sustain a persona/voice across a long generation rather than
    # a short structured answer.
    _, text = await route_chat(
        [{"role": "user", "content": user}],
        provider="anthropic", model="claude-3-5-sonnet-20241022",
        system=system, temperature=0.85, max_tokens=2200,
    )
    return text.strip()
