"""
thelyceum.site/game — public, no-login marketing quiz. See
app.services.game for the full design notes (scoring, tiers, taunts).

  POST /game/start           — {subject, curriculum, player_name} -> session + 20 items
  POST /game/answer           — grade a spot_mistake / image_multiselect item
  POST /game/concept-answer   — grade a concept_explain item (text/audio/skip)
  GET  /game/image/{sid}/{iid} — lazily-generated illustration for an image_multiselect item
  POST /game/finish           — write leaderboard entry, return tier + rank + top 10
  GET  /game/leaderboard      — top N entries (public)
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.core.limiter import limiter

router = APIRouter(prefix="/game", tags=["game"])


class StartRequest(BaseModel):
    subject: str
    curriculum: str = ""
    player_name: str = "Anonymous"


class AnswerRequest(BaseModel):
    session_id: str
    item_id: str
    selected: list[int] = []
    skipped: bool = False


class ConceptAnswerRequest(BaseModel):
    session_id: str
    item_id: str
    mode: str  # 'text' | 'audio' | 'skip'
    text: str = ""
    duration_seconds: float = 0


class FinishRequest(BaseModel):
    session_id: str


@router.post("/start")
@limiter.limit("5/minute")
async def game_start(request: Request, req: StartRequest):
    from app.services import game as game_svc

    try:
        return await game_svc.start_game(req.subject, req.curriculum, req.player_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"game_generation_failed: {e}")


@router.post("/answer")
@limiter.limit("60/minute")
async def game_answer(request: Request, req: AnswerRequest):
    from app.services import game as game_svc

    try:
        return game_svc.answer_item(req.session_id, req.item_id, req.selected, req.skipped)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/concept-answer")
@limiter.limit("30/minute")
async def game_concept_answer(request: Request, req: ConceptAnswerRequest):
    from app.services import game as game_svc

    try:
        return game_svc.concept_answer(req.session_id, req.item_id, req.mode, req.text, req.duration_seconds)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/image/{session_id}/{item_id}")
@limiter.limit("20/minute")
async def game_image(request: Request, session_id: str, item_id: str):
    from app.services import game as game_svc

    try:
        png = await game_svc.get_image(session_id, item_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"image_generation_failed: {e}")
    return Response(content=png, media_type="image/png")


@router.post("/finish")
@limiter.limit("10/minute")
async def game_finish(request: Request, req: FinishRequest):
    from app.services import game as game_svc

    try:
        return game_svc.finish_game(req.session_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/leaderboard")
async def game_leaderboard(limit: int = 20):
    from app.services import game as game_svc

    return {"entries": game_svc.leaderboard(min(max(limit, 1), 50))}
