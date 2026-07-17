"""
Base class for all background AI agents.

Provides:
  - Async task queue with asyncio.Queue
  - Background worker loop (started on app startup)
  - Result push via WebSocket to connected frontend clients
  - Health/status reporting
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Coroutine, Optional

import logging

logger = logging.getLogger(__name__)


class AgentStatus(str, Enum):
    IDLE = "idle"
    PROCESSING = "processing"
    STOPPED = "stopped"


class TaskStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


@dataclass
class AgentTask:
    task_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    payload: dict[str, Any] = field(default_factory=dict)
    status: TaskStatus = TaskStatus.QUEUED
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    result: dict[str, Any] | None = None
    error: str | None = None


@dataclass
class AgentResult:
    task_id: str
    agent_id: str
    data: dict[str, Any]
    elapsed_ms: int


# Type alias for the actual work function each agent implements
WorkFn = Callable[[AgentTask], Coroutine[Any, Any, dict[str, Any]]]


class BaseAgent:
    """Abstract base for a background AI agent with async task queue."""

    AGENT_ID: str = "base"
    AGENT_NAME: str = "Base Agent"
    API_PREFIX: str = "/ai/agents/base"

    # Anti-loop guard: an agent instance may execute at most one task
    # (i.e. make one round of external API calls) per this interval,
    # no matter how many tasks are sitting in its queue.
    _MIN_API_INTERVAL_SEC: float = 300.0
    # Hard ceiling on a single task's execution so a hung external call
    # can never wedge a worker (and its queue) forever.
    _TASK_TIMEOUT_SEC: float = 90.0

    def __init__(self, max_concurrent: int = 2):
        self.status: AgentStatus = AgentStatus.IDLE
        self._queue: asyncio.Queue[AgentTask] = asyncio.Queue(maxsize=100)
        self._workers: list[asyncio.Task[None]] = []
        self._max_concurrent = max_concurrent
        self._task_history: list[AgentTask] = []
        self._ws_subscribers: list[asyncio.Queue[dict[str, Any]]] = []
        self._last_run_at: float = 0.0

    # ── Lifecycle ──────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Start background worker(s). Called from app lifespan."""
        if self._workers:
            return
        self.status = AgentStatus.IDLE
        for i in range(self._max_concurrent):
            task = asyncio.create_task(self._worker_loop(i), name=f"{self.AGENT_ID}-worker-{i}")
            self._workers.append(task)
        logger.info(f"[{self.AGENT_ID}] started {self._max_concurrent} worker(s)")

    async def stop(self) -> None:
        """Gracefully shut down workers. Called from app lifespan."""
        self.status = AgentStatus.STOPPED
        for w in self._workers:
            w.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()
        logger.info(f"[{self.AGENT_ID}] stopped")

    # ── Submit ─────────────────────────────────────────────────────────────

    async def submit(self, payload: dict[str, Any]) -> AgentTask:
        """Enqueue a new task and return the task handle."""
        task = AgentTask(payload=payload)
        await self._queue.put(task)
        self._task_history.append(task)
        logger.info(f"[{self.AGENT_ID}] task {task.task_id} queued")
        return task

    # ── WebSocket subscription ─────────────────────────────────────────────

    def subscribe_ws(self) -> asyncio.Queue[dict[str, Any]]:
        """Return a queue that receives pushed results for WebSocket relay."""
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._ws_subscribers.push(q) if hasattr(self._ws_subscribers, 'push') else self._ws_subscribers.append(q)
        return q

    def unsubscribe_ws(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        if q in self._ws_subscribers:
            self._ws_subscribers.remove(q)

    async def _push_result(self, result: AgentResult) -> None:
        """Broadcast result to all WebSocket subscribers."""
        msg = {
            "type": "agent_result",
            "agent_id": result.agent_id,
            "task_id": result.task_id,
            "data": result.data,
            "elapsed_ms": result.elapsed_ms,
        }
        for q in self._ws_subscribers:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                logger.warning(f"[{self.AGENT_ID}] WS subscriber queue full, dropping")

    # ── Worker loop ────────────────────────────────────────────────────────

    async def _worker_loop(self, worker_id: int) -> None:
        """Continuously pull tasks from the queue and execute them."""
        while self.status != AgentStatus.STOPPED:
            try:
                task = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            # Anti-loop rate limit: at most one task execution (i.e. one round
            # of external API calls) per _MIN_API_INTERVAL_SEC, regardless of
            # how many tasks are queued up.
            elapsed = time.time() - self._last_run_at
            if elapsed < self._MIN_API_INTERVAL_SEC:
                try:
                    await asyncio.sleep(self._MIN_API_INTERVAL_SEC - elapsed)
                except asyncio.CancelledError:
                    break

            task.status = TaskStatus.RUNNING
            task.started_at = time.time()
            self.status = AgentStatus.PROCESSING

            try:
                result_data = await asyncio.wait_for(
                    self.process(task), timeout=self._TASK_TIMEOUT_SEC
                )
                task.status = TaskStatus.DONE
                task.result = result_data
            except asyncio.TimeoutError:
                task.status = TaskStatus.FAILED
                task.error = f"timed out after {self._TASK_TIMEOUT_SEC}s"
                result_data = {"error": task.error}
                logger.warning(f"[{self.AGENT_ID}] task {task.task_id} timed out")
            except Exception as exc:
                task.status = TaskStatus.FAILED
                task.error = str(exc)
                result_data = {"error": str(exc)}
                logger.exception(f"[{self.AGENT_ID}] task {task.task_id} failed")

            self._last_run_at = time.time()
            task.finished_at = time.time()
            elapsed_ms = int((task.finished_at - task.started_at) * 1000)

            agent_result = AgentResult(
                task_id=task.task_id,
                agent_id=self.AGENT_ID,
                data=result_data,
                elapsed_ms=elapsed_ms,
            )
            await self._push_result(agent_result)

            if self._queue.empty():
                self.status = AgentStatus.IDLE

    # ── Subclass must implement ────────────────────────────────────────────

    async def process(self, task: AgentTask) -> dict[str, Any]:
        """Override in subclass. Do the actual AI work here and return result dict."""
        raise NotImplementedError

    # ── Status / health ────────────────────────────────────────────────────

    def get_status(self) -> dict[str, Any]:
        recent = self._task_history[-20:]
        return {
            "agent_id": self.AGENT_ID,
            "agent_name": self.AGENT_NAME,
            "api_prefix": self.API_PREFIX,
            "status": self.status.value,
            "queue_size": self._queue.qsize(),
            "workers": len(self._workers),
            "total_tasks": len(self._task_history),
            "recent_tasks": [
                {
                    "task_id": t.task_id,
                    "status": t.status.value,
                    "created_at": t.created_at,
                    "elapsed_ms": int((t.finished_at - t.started_at) * 1000) if t.finished_at and t.started_at else None,
                }
                for t in recent
            ],
        }
