"""
Gallery — save/list/view/delete generated artifacts. See
app.services.gallery for storage design notes.

  GET    /gallery              — list the caller's saved items (metadata only)
  POST   /gallery/save         — save one (image or video, base64 in the body)
  GET    /gallery/{id}/file    — raw bytes, correct media_type
  DELETE /gallery/{id}
"""

from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from app.api.deps import require_auth
from app.core.limiter import limiter

router = APIRouter(prefix="/gallery", tags=["gallery"])


def _uid(auth: dict) -> str:
    return auth.get("user_id") or auth.get("sub") or ""


@router.get("")
async def gallery_list(auth: dict = Depends(require_auth)):
    from app.services import gallery as gallery_svc

    return {"items": gallery_svc.list_artifacts(_uid(auth))}


class SaveArtifactRequest(BaseModel):
    kind: str          # "image" | "video"
    mime: str
    data_base64: str
    title: str = ""
    subject: str = ""
    source: str = ""


@router.post("/save")
@limiter.limit("20/minute")
async def gallery_save(request: Request, req: SaveArtifactRequest, auth: dict = Depends(require_auth)):
    from app.services import gallery as gallery_svc

    try:
        data = base64.b64decode(req.data_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid_base64")
    if not data:
        raise HTTPException(status_code=400, detail="empty_data")

    try:
        result = gallery_svc.save_artifact(
            _uid(auth), req.kind, req.mime, data, title=req.title, subject=req.subject, source=req.source,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


@router.get("/{item_id}/file")
async def gallery_file(item_id: str, auth: dict = Depends(require_auth)):
    from app.services import gallery as gallery_svc

    found = gallery_svc.get_artifact(item_id, _uid(auth))
    if not found:
        raise HTTPException(status_code=404, detail="not_found")
    data, mime = found
    return Response(content=data, media_type=mime)


@router.delete("/{item_id}")
async def gallery_delete(item_id: str, auth: dict = Depends(require_auth)):
    from app.services import gallery as gallery_svc

    ok = gallery_svc.delete_artifact(item_id, _uid(auth))
    if not ok:
        raise HTTPException(status_code=404, detail="not_found")
    return {"ok": True}
