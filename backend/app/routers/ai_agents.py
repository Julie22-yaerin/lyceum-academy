"""
AI Agents API Router
════════════════════

Exposes 3 background AI agents via REST endpoints.
Each endpoint submits a task to the agent's queue and returns immediately.
Results are pushed to the frontend via WebSocket.

Agent Addresses:
  POST /ai/agents/content-analyzer/analyze  — ContentAnalyzerAgent
  POST /ai/agents/path-generator/generate   — PathGeneratorAgent
  POST /ai/agents/progress-tracker/analyze   — ProgressTrackerAgent
  GET  /ai/agents/status                     — All agents status
  GET  /ai/agents/{agent_id}/status          — Single agent status
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from app.services.ai_agents import AGENTS

router = APIRouter(prefix="/ai/agents", tags=["ai-agents"])


# ── Status endpoints ───────────────────────────────────────────────────────

@router.get("/status")
async def all_agents_status() -> dict[str, Any]:
    """Return health/status for every registered agent."""
    return {
        agent_id: agent.get_status()
        for agent_id, agent in AGENTS.items()
    }


@router.get("/{agent_id}/status")
async def agent_status(agent_id: str) -> dict[str, Any]:
    agent = AGENTS.get(agent_id)
    if not agent:
        raise HTTPException(404, f"Agent '{agent_id}' not found")
    return agent.get_status()


# ── Agent 1: Content Analyzer ──────────────────────────────────────────────

@router.post("/content-analyzer/analyze")
async def analyze_content(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Submit content for analysis. Returns task_id immediately.
    Results arrive via WebSocket channel /ws/ai-agents.
    """
    from app.services.ai_agents import content_analyzer
    task = await content_analyzer.submit(payload)
    return {
        "task_id": task.task_id,
        "agent_id": content_analyzer.AGENT_ID,
        "status": task.status.value,
        "message": "Task queued. Listen on /ws/ai-agents for result.",
    }


# ── Agent 2: Path Generator ───────────────────────────────────────────────

@router.post("/path-generator/generate")
async def generate_path(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Submit a learning path generation request. Returns task_id immediately.
    Results arrive via WebSocket channel /ws/ai-agents.
    """
    from app.services.ai_agents import path_generator
    task = await path_generator.submit(payload)
    return {
        "task_id": task.task_id,
        "agent_id": path_generator.AGENT_ID,
        "status": task.status.value,
        "message": "Task queued. Listen on /ws/ai-agents for result.",
    }


# ── Agent 3: Progress Tracker ─────────────────────────────────────────────

@router.post("/progress-tracker/analyze")
async def analyze_progress(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Submit progress data for analysis. Returns task_id immediately.
    Results arrive via WebSocket channel /ws/ai-agents.
    """
    from app.services.ai_agents import progress_tracker
    task = await progress_tracker.submit(payload)
    return {
        "task_id": task.task_id,
        "agent_id": progress_tracker.AGENT_ID,
        "status": task.status.value,
        "message": "Task queued. Listen on /ws/ai-agents for result.",
    }


# ── WebSocket push channel ────────────────────────────────────────────────

@router.websocket("/ws")
async def agents_ws(websocket: WebSocket) -> None:
    """
    WebSocket endpoint for receiving real-time agent results.
    Frontend connects to: ws://backend:8000/ai/agents/ws

    On connect: subscribes to all 3 agents' result streams.
    On message: can send {"subscribe":"<agent_id>"} or {"unsubscribe":"<agent_id>"}.
    On disconnect: automatically unsubscribes.
    """
    await websocket.accept()

    # Subscribe to all agents
    queues = {}
    for agent_id, agent in AGENTS.items():
        q = agent.subscribe_ws()
        queues[agent_id] = q

    try:
        while True:
            # Listen for client messages AND agent results simultaneously
            import asyncio

            ws_recv = asyncio.create_task(websocket.receive_text())
            done, pending = await asyncio.wait(
                [ws_recv] + [asyncio.create_task(q.get()) for q in queues.values()],
                return_when=asyncio.FIRST_COMPLETED,
            )

            for task_obj in done:
                result = task_obj.result()
                if isinstance(result, str):
                    # Client sent a message (could be ping/control)
                    continue
                elif isinstance(result, dict):
                    # Agent result — push to client
                    await websocket.send_json(result)

            ws_recv.cancel() if not ws_recv.done() else None
            for p in pending:
                p.cancel()

    except WebSocketDisconnect:
        pass
    finally:
        for agent_id, q in queues.items():
            agent = AGENTS.get(agent_id)
            if agent:
                agent.unsubscribe_ws(q)
