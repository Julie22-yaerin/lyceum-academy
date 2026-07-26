"""
TRIP — thelyceum.site/{subject}, the public no-login taste of the workspace.

One preset A-Level-ish concept per subject (Math/Chemistry/Biology/Physics),
fully worked ahead of time, so a visitor gets the whole loop the product
actually runs on without an account:

  1. ready-made material     — a short first-principles note
  2. podcast, listen + write — the note narrated, generated once and cached
  3. brainrot short video    — reuses the same reel from tools/reels/
  4. teach it back to Leo    — the real Feynman-listener role, rate-limited
  5. Lotus Map               — the symmetric mind map, pre-seeded

Nothing here touches a user account, Second Brain, or Quanta — it is a
sealed demo surface. The only real cost is the Feynman call (a live model
call) and the one-time podcast narration per subject (cached after the
first visitor generates it, so cost does not scale with traffic).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

log = logging.getLogger("pclick.trip")

PRESETS: dict[str, dict[str, Any]] = {
    "math": {
        "subject_label": "Toán",
        "concept": "Hàm hợp (Chain Rule)",
        "note_title": "Hàm hợp: bóc từng lớp",
        "note_body": (
            "Một hàm hợp là một hàm nằm bên trong một hàm khác — ví dụ "
            "y = sin(x²). Đừng nhìn cả biểu thức cùng lúc.\n\n"
            "Gọi lớp trong là u = x². Khi đó y = sin(u) — lớp ngoài.\n\n"
            "Đạo hàm của hàm hợp là tích hai đạo hàm riêng:\n"
            "dy/dx = dy/du · du/dx = cos(u) · 2x = cos(x²) · 2x.\n\n"
            "Quy tắc: đạo hàm lớp ngoài (giữ nguyên lớp trong), nhân với "
            "đạo hàm lớp trong. Luôn đúng thứ tự đó."
        ),
        "podcast_script": (
            "Hàm hợp không khó, nó chỉ trông rối vì bạn đang nhìn cả biểu "
            "thức cùng một lúc. Hãy bóc nó ra làm hai lớp. "
            "Ví dụ y bằng sin của x bình phương. "
            "Gọi u là lớp trong: u bằng x bình phương. "
            "Khi đó y bằng sin của u — đó là lớp ngoài. "
            "Đạo hàm của hàm hợp bằng đạo hàm lớp ngoài, giữ nguyên lớp "
            "trong, nhân với đạo hàm của lớp trong. "
            "Viết ra: d y trên d x bằng cos của u, nhân hai x. "
            "Thay u lại, ta được cos của x bình phương, nhân hai x. "
            "Đó là toàn bộ quy tắc: bóc lớp, đạo hàm từng lớp, nhân lại "
            "với nhau, đúng thứ tự ngoài rồi mới vào trong."
        ),
        "lotus_seed": "Hàm hợp: y = sin(x²)",
    },
    "chemistry": {
        "subject_label": "Hoá",
        "concept": "Orbital nguyên tử (9701)",
        "note_title": "Orbital là xác suất, không phải quỹ đạo",
        "note_body": (
            "Electron không bay theo một đường tròn quanh hạt nhân như hành "
            "tinh. Cơ học lượng tử chỉ cho biết xác suất tìm thấy electron "
            "ở một vùng không gian — gọi là orbital.\n\n"
            "Hàm sóng ψ mô tả electron. |ψ|² tại một điểm là mật độ xác "
            "suất tìm thấy electron ở đó.\n\n"
            "Orbital s: |ψ|² đối xứng cầu — xác suất giảm dần đều theo mọi "
            "hướng ra xa hạt nhân.\n"
            "Orbital p: có hai thuỳ đối xứng qua hạt nhân, và một mặt nút "
            "ở giữa nơi |ψ|² = 0 — electron không bao giờ ở đó."
        ),
        "podcast_script": (
            "Quên hình ảnh electron bay vòng quanh hạt nhân như một hành "
            "tinh đi — đó không phải cách nó hoạt động. "
            "Cơ học lượng tử không cho bạn biết electron đang ở đâu, nó "
            "chỉ cho biết xác suất electron xuất hiện ở một vùng không "
            "gian. Vùng xác suất đó gọi là orbital. "
            "Orbital ét hình cầu: xác suất cao nhất gần hạt nhân, giảm "
            "dần khi ra xa, đều theo mọi hướng. "
            "Orbital pờ có hai thuỳ, nằm hai bên hạt nhân, và ở chính "
            "giữa có một mặt phẳng nút, nơi xác suất bằng không tuyệt "
            "đối — electron không bao giờ xuất hiện ở đó. "
            "Bạn không vẽ đường đi của electron. Bạn vẽ xác suất."
        ),
        "lotus_seed": "Orbital nguyên tử: |ψ|²",
    },
    "biology": {
        "subject_label": "Sinh",
        "concept": "Điện thế hoạt động (Action Potential)",
        "note_title": "Tín hiệu thần kinh: tất cả hoặc không",
        "note_body": (
            "Một nơron ở trạng thái nghỉ có điện thế màng khoảng −70 mV — "
            "âm hơn bên ngoài.\n\n"
            "Khi kích thích đủ mạnh đẩy điện thế lên tới ngưỡng −55 mV, "
            "cổng Na⁺ mở ra. Na⁺ tràn vào trong, màng khử cực nhanh, điện "
            "thế vọt lên khoảng +40 mV.\n\n"
            "Ngay sau đó cổng K⁺ mở, K⁺ đi ra, màng tái cực trở lại âm. "
            "Bơm Na⁺/K⁺ nạp lại chênh lệch ion để sẵn sàng cho xung tiếp "
            "theo.\n\n"
            "Điểm mấu chốt: dưới ngưỡng thì không có gì xảy ra. Đạt "
            "ngưỡng thì luôn bùng nổ y hệt nhau, không có mức lưng chừng."
        ),
        "podcast_script": (
            "Một nơron lúc nghỉ mang điện thế âm bảy mươi mi-li-vôn ở bên "
            "trong màng. "
            "Khi có kích thích đủ mạnh đẩy điện thế lên tới ngưỡng âm năm "
            "mươi lăm mi-li-vôn, một cánh cổng bật mở: cổng na-tri. "
            "Ion na-tri tràn ồ ạt vào bên trong, điện thế đảo chiều rất "
            "nhanh, vọt lên khoảng cộng bốn mươi mi-li-vôn. "
            "Ngay sau đó, cổng ka-li mở ra, ka-li đi ra ngoài, điện thế "
            "quay trở lại âm như cũ. "
            "Một cái bơm âm thầm bơm ngược hai loại ion về đúng chỗ, để "
            "sẵn sàng cho xung tiếp theo. "
            "Điều quan trọng nhất cần nhớ: dưới ngưỡng thì không có "
            "chuyện gì xảy ra cả. Đủ ngưỡng thì luôn luôn bùng nổ y hệt "
            "nhau. Không có nửa chừng."
        ),
        "lotus_seed": "Điện thế hoạt động: −70 → −55 → +40 mV",
    },
    "physics": {
        "subject_label": "Lý",
        "concept": "Dao động điều hoà (SHM)",
        "note_title": "Dao động là vòng tròn nhìn từ cạnh",
        "note_body": (
            "Một vật gắn vào lò xo, kéo ra rồi thả, sẽ dao động qua lại. "
            "Lực kéo về luôn tỉ lệ thuận với độ lệch khỏi vị trí cân bằng "
            "và ngược chiều với nó: F = −kx.\n\n"
            "Từ đó gia tốc a = −ω²x — gia tốc luôn hướng về vị trí cân "
            "bằng, lớn nhất ở biên, bằng 0 ở giữa.\n\n"
            "Vị trí theo thời gian: x = A cos(ωt). Chu kỳ: T = 2π√(m/k).\n\n"
            "Một cách hình dung: nếu chiếu một điểm đang chuyển động tròn "
            "đều lên một trục, hình chiếu đó chuyển động y hệt dao động "
            "điều hoà. Dao động là chuyển động tròn nhìn nghiêng."
        ),
        "podcast_script": (
            "Gắn một vật vào lò xo, kéo ra rồi buông tay, nó sẽ dao động "
            "qua lại quanh vị trí cân bằng. "
            "Lực kéo nó về luôn tỉ lệ thuận với khoảng cách lệch khỏi vị "
            "trí cân bằng, và luôn ngược hướng với độ lệch đó. "
            "Từ đó suy ra gia tốc cũng tỉ lệ thuận và ngược hướng với độ "
            "lệch: gia tốc lớn nhất ở hai biên, bằng không ở chính giữa. "
            "Vị trí theo thời gian đi theo hàm cô-sin, và chu kỳ dao động "
            "phụ thuộc vào khối lượng và độ cứng lò xo. "
            "Có một cách hình dung rất trực quan: nếu bạn nhìn một điểm "
            "đang chuyển động tròn đều từ đúng cạnh của vòng tròn đó, cái "
            "bạn thấy chính là một dao động điều hoà. "
            "Dao động điều hoà chỉ là chuyển động tròn, nhìn nghiêng từ "
            "cạnh."
        ),
        "lotus_seed": "Dao động điều hoà: F = −kx",
    },
}


def get_preset(subject: str) -> dict[str, Any]:
    preset = PRESETS.get(subject)
    if not preset:
        raise ValueError(f"unknown TRIP subject: {subject}")
    return {
        "subject": subject,
        "subject_label": preset["subject_label"],
        "concept": preset["concept"],
        "note_title": preset["note_title"],
        "note_body": preset["note_body"],
        "lotus_seed": preset["lotus_seed"],
        "reel_src": f"/reels/{subject}.mp4",
        "reel_poster": f"/reels/{subject}-poster.jpg",
    }


# ── podcast: generated once per subject, reused for every visitor ─────────
_PODCAST_CACHE: dict[str, bytes] = {}
_PODCAST_LOCKS: dict[str, asyncio.Lock] = {s: asyncio.Lock() for s in PRESETS}


async def get_podcast_audio(subject: str) -> bytes:
    if subject not in PRESETS:
        raise ValueError(f"unknown TRIP subject: {subject}")

    cached = _PODCAST_CACHE.get(subject)
    if cached:
        return cached

    async with _PODCAST_LOCKS[subject]:
        cached = _PODCAST_CACHE.get(subject)
        if cached:  # another request won the race while we waited
            return cached

        from app.services import cloudflare_ai

        audio = await cloudflare_ai.text_to_speech(PRESETS[subject]["podcast_script"], lang="vi")
        _PODCAST_CACHE[subject] = audio
        log.info("TRIP podcast generated and cached for subject=%s (%d bytes)", subject, len(audio))
        return audio


# ── teach-back: the real Feynman-listener role, scoped to the preset concept
async def teach_back(subject: str, explanation: str) -> dict[str, Any]:
    if subject not in PRESETS:
        raise ValueError(f"unknown TRIP subject: {subject}")
    explanation = (explanation or "").strip()
    if not explanation:
        raise ValueError("explanation is empty")

    from app.services.ai_roles.feynman import feynman_respond
    from app.services.ai_roles.tier_router import TIER_COMPASS

    concept = PRESETS[subject]["concept"]
    # Leo has no memory of a TRIP visitor between turns (no account, no
    # session store) — the concept is folded into this single turn's
    # explanation instead of a multi-turn history.
    framed = f"[Chủ đề đang học: {concept}]\n\n{explanation[:2000]}"
    return await feynman_respond(conversation_history=[], current_explanation=framed, tier=TIER_COMPASS)
