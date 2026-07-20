"""
AI Registry API Router
══════════════════════

Admin-only: identity, status, editable hierarchy, and direct chat for
every AI agent in the system.

Endpoints:
  GET    /ai-registry/agents            — list all agents + live status
  POST   /ai-registry/agents            — create an agent
  PUT    /ai-registry/agents/{id}       — edit name/description/category/parent_id/notes
  DELETE /ai-registry/agents/{id}       — remove an agent
  POST   /ai-registry/chat/{agent_id}   — chat with a head AI (commander)
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.routers.admin import _auth as _admin_auth
from app.services import ai_registry as registry_svc
from app.services import chat_history as history_svc
from app.services import commander as commander_svc

router = APIRouter(prefix="/ai-registry", tags=["ai-registry"])


@router.get("/agents")
async def list_agents(_: None = Depends(_admin_auth)) -> dict[str, Any]:
    return {"agents": registry_svc.list_agents_with_status()}


class AgentIn(BaseModel):
    id: str
    name: str = ""
    description: str = ""
    category: str = ""
    parent_id: str | None = None
    notes: str = ""
    custom_instructions: str = ""


@router.post("/agents", status_code=201)
async def create_agent(body: AgentIn, _: None = Depends(_admin_auth)) -> dict[str, Any]:
    if registry_svc.get_agent(body.id):
        raise HTTPException(409, "Agent id already exists")
    return registry_svc.create_agent(**body.model_dump())


class AgentUpdateIn(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    parent_id: str | None = None
    notes: str | None = None
    custom_instructions: str | None = None


@router.put("/agents/{agent_id}")
async def update_agent(agent_id: str, body: AgentUpdateIn, _: None = Depends(_admin_auth)) -> dict[str, Any]:
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    result = registry_svc.update_agent(agent_id, **fields)
    if result is None:
        raise HTTPException(404, "Agent not found")
    return result


@router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str, _: None = Depends(_admin_auth)) -> dict[str, Any]:
    if not registry_svc.delete_agent(agent_id):
        raise HTTPException(404, "Agent not found")
    return {"ok": True}


# ── Chat with a head AI ──────────────────────────────────────────────────────

class ChatIn(BaseModel):
    session_id: str
    message: str


@router.post("/chat/{agent_id}")
async def chat(agent_id: str, body: ChatIn, _: None = Depends(_admin_auth)) -> dict[str, Any]:
    """
    Chat with a head AI. agent_id: commander.
    (support-chat has its own always-on endpoint, /support/chat.)
    """
    if agent_id == "commander":
        result = await commander_svc.admin_chat(body.session_id, body.message)
    else:
        raise HTTPException(404, f"Unknown or non-chattable agent '{agent_id}'")
    # Both admin_chat implementations can execute real tool calls (dispatch/
    # scan/resolve/run-batch, update_instructions) — surface which ones ran.
    return {"reply": result["reply"], "tool_calls": result.get("tool_calls", [])}


@router.get("/chat/{agent_id}/history")
async def chat_history(agent_id: str, limit: int = 200, _: None = Depends(_admin_auth)) -> dict[str, Any]:
    """Auto-saved transcript for this agent — used to restore the admin's
    conversation across page reloads/devices."""
    return {"messages": history_svc.list_messages(agent_id, limit)}
