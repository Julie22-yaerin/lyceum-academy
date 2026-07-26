"""
thelyceum.site/{math,chemistry,biology,physics} — TRIP, the public no-login
demo. See app.services.trip for the preset content and design notes.

  GET  /trip/{subject}            — preset bundle (note, lotus seed, reel path)
  GET  /trip/{subject}/podcast    — narrated audio (generated once, cached)
  POST /trip/teach-back           — explain the concept to Leo, get Socratic
                                     questions back (rate-limited: real model call)
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.core.limiter import limiter

router = APIRouter(prefix="/trip", tags=["trip"])


class TeachBackRequest(BaseModel):
    subject: str
    explanation: str


@router.get("/{subject}")
@limiter.limit("30/minute")
async def trip_preset(request: Request, subject: str):
    from app.services import trip as trip_svc

    try:
        return trip_svc.get_preset(subject)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{subject}/podcast")
@limiter.limit("20/minute")
async def trip_podcast(request: Request, subject: str):
    from app.services import trip as trip_svc

    try:
        audio = await trip_svc.get_podcast_audio(subject)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"podcast_unavailable: {e}")
    return Response(content=audio, media_type="audio/mpeg")


@router.post("/teach-back")
@limiter.limit("6/minute")
async def trip_teach_back(request: Request, req: TeachBackRequest):
    from app.services import trip as trip_svc

    try:
        return await trip_svc.teach_back(req.subject, req.explanation)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"teach_back_failed: {e}")
