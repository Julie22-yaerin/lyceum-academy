"""
Dev Patrol API Router
═════════════════════

3 silent dev roles — stay quiet until someone sends them a task.

Agent Addresses:
  POST /ai/agents/dev-patrol/backend/scan      — Backend Dev (Python)
  POST /ai/agents/dev-patrol/frontend/scan      — Frontend Dev (React/TS)
  POST /ai/agents/dev-patrol/security/scan      — Security Dev (Auth/CORS)
  POST /ai/agents/dev-patrol/report             — Report a bug (auto-routes)
  POST /ai/agents/dev-patrol/scan-all           — Trigger all 3 at once
  GET  /ai/agents/dev-patrol/status             — All devs status
  WS   /ai/agents/dev-patrol/ws                 — Real-time findings push
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.core.limiter import limiter
from app.services.ai_agents.dev_patrol import DEV_AGENTS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai/agents/dev-patrol", tags=["dev-patrol"])


# ── Status ─────────────────────────────────────────────────────────────────

@router.get("/status")
async def patrol_status() -> dict[str, Any]:
    """Return health/status for all 3 dev roles."""
    return {
        agent_id: agent.get_status()
        for agent_id, agent in DEV_AGENTS.items()
    }


# ── Backend Dev ────────────────────────────────────────────────────────────

@router.post("/backend/scan")
async def backend_scan(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Send a task to the Backend Dev.

    Body (all optional):
      - mode: "full_scan" | "single_file" | "report"
      - file_path: str (for single_file)
      - bug_report: str (optional context)
    """
    from app.services.ai_agents.dev_patrol import backend_dev
    task = await backend_dev.submit(payload or {})
    return {
        "task_id": task.task_id,
        "agent_id": backend_dev.AGENT_ID,
        "status": task.status.value,
        "message": "Task queued. Listen on /ai/agents/dev-patrol/ws for results.",
    }


# ── Frontend Dev ───────────────────────────────────────────────────────────

@router.post("/frontend/scan")
async def frontend_scan(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Send a task to the Frontend Dev.

    Body (all optional):
      - mode: "full_scan" | "single_file" | "report"
      - file_path: str (for single_file)
      - bug_report: str (optional context)
    """
    from app.services.ai_agents.dev_patrol import frontend_dev
    task = await frontend_dev.submit(payload or {})
    return {
        "task_id": task.task_id,
        "agent_id": frontend_dev.AGENT_ID,
        "status": task.status.value,
        "message": "Task queued. Listen on /ai/agents/dev-patrol/ws for results.",
    }


# ── Security Dev ───────────────────────────────────────────────────────────

@router.post("/security/scan")
async def security_scan(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Send a task to the Security Dev.

    Body (all optional):
      - mode: "full_scan" | "endpoint_check" | "report"
      - endpoint: str (for endpoint_check, e.g. "/ai/chat")
      - bug_report: str (optional context)
    """
    from app.services.ai_agents.dev_patrol import security_dev
    task = await security_dev.submit(payload or {})
    return {
        "task_id": task.task_id,
        "agent_id": security_dev.AGENT_ID,
        "status": task.status.value,
        "message": "Task queued. Listen on /ai/agents/dev-patrol/ws for results.",
    }


# ── User-facing "Report a bug" button ──────────────────────────────────────

class ReportBugRequest(BaseModel):
    description: str
    page: str = ""


@router.post("/report-bug")
@limiter.limit("5/minute")
async def report_bug_button(request: Request, req: ReportBugRequest) -> dict[str, Any]:
    """
    Report a bug from the frontend "Báo lỗi" button.

    Routes through Commander triage (critical → dispatched immediately,
    minor → batched every 4 days) exactly like the support consultant's
    auto-detected complaints. No auth required — same anonymous-friendly,
    rate-limited pattern as /feedback.

    Always returns {"ok": True}: failures are logged server-side only, so
    the UI can unconditionally show a success message and return to the
    workspace, per product decision.
    """
    if req.description and req.description.strip():
        try:
            from app.services import commander as cmd_svc
            await cmd_svc.triage_bug(
                bug_report=req.description.strip()[:4000],
                endpoint=req.page,
                reported_by="anonymous",
            )
        except Exception as exc:
            logger.warning("report-bug triage failed: %s", exc)
    return {"ok": True}


# ── Unified bug report ─────────────────────────────────────────────────────

@router.post("/report")
async def report_bug(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Report a bug — automatically routes to the best dev.

    Body:
      - bug_report: str (required)
      - endpoint: str (optional)
      - file_path: str (optional)
      - file_content: str (optional)
      - target: "backend"|"frontend"|"security"|"auto" (default: auto)
    """
    bug_report = payload.get("bug_report", "")
    if not bug_report:
        raise HTTPException(400, "bug_report is required")

    target = payload.get("target", "auto")

    if target == "auto":
        lower = bug_report.lower()
        if any(kw in lower for kw in ["auth", "token", "cors", "injection", "xss", "secret", "security"]):
            target = "security"
        elif any(kw in lower for kw in [".tsx", ".ts", "react", "component", "hook", "state", "render", "css"]):
            target = "frontend"
        else:
            target = "backend"

    agent_map = {
        "backend": "backend-dev",
        "frontend": "frontend-dev",
        "security": "security-dev",
    }

    agent_id = agent_map.get(target, "backend-dev")
    agent = DEV_AGENTS[agent_id]

    report_payload = {
        "mode": "report",
        **{k: v for k, v in payload.items() if k != "target"},
    }

    task = await agent.submit(report_payload)
    return {
        "task_id": task.task_id,
        "agent_id": agent_id,
        "routed_to": target,
        "status": task.status.value,
        "message": f"Bug report routed to {agent_id}. Listen on /ai/agents/dev-patrol/ws for results.",
    }


# ── Scan all at once ───────────────────────────────────────────────────────

@router.post("/scan-all")
async def scan_all(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """Send a task to all 3 dev roles simultaneously."""
    payload = payload or {}
    tasks = {}
    for agent_id, agent in DEV_AGENTS.items():
        task = await agent.submit(payload)
        tasks[agent_id] = task.task_id

    return {
        "tasks": tasks,
        "message": "All 3 devs received the task. Listen on /ai/agents/dev-patrol/ws for results.",
    }


# ── WebSocket for real-time findings ───────────────────────────────────────

@router.websocket("/ws")
async def patrol_ws(websocket: WebSocket) -> None:
    """
    WebSocket endpoint for receiving real-time Dev Patrol findings.
    Frontend connects to: ws://backend:8000/ai/agents/dev-patrol/ws
    """
    await websocket.accept()

    queues = {}
    for agent_id, agent in DEV_AGENTS.items():
        q = agent.subscribe_ws()
        queues[agent_id] = q

    try:
        while True:
            import asyncio

            ws_recv = asyncio.create_task(websocket.receive_text())
            agent_tasks = [asyncio.create_task(q.get()) for q in queues.values()]
            done, pending = await asyncio.wait(
                [ws_recv] + agent_tasks,
                return_when=asyncio.FIRST_COMPLETED,
            )

            for t in done:
                result = t.result()
                if isinstance(result, dict):
                    await websocket.send_json(result)

            ws_recv.cancel() if not ws_recv.done() else None
            for p in pending:
                p.cancel()

    except WebSocketDisconnect:
        pass
    finally:
        for agent_id, q in queues.items():
            agent = DEV_AGENTS.get(agent_id)
            if agent:
                agent.unsubscribe_ws(q)
