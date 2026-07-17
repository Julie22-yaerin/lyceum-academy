"""
Dev Patrol — 3 silent dev roles that stay quiet until someone sends them a task.

Roles:
  1. Frontend Dev  (minimaxai/minimax-m3)   — React, TypeScript, CSS, hooks
  2. Backend Dev   (poolside/laguna-xs-2.1)  — Python, FastAPI, SQL, async
  3. Security Dev  (z-ai/glm-5.2)           — auth, injection, CORS, SOC

They don't do anything proactively — they wait for task submissions.
"""

from app.services.ai_agents.dev_patrol.backend_patrol import BackendPatrolAgent
from app.services.ai_agents.dev_patrol.frontend_patrol import FrontendPatrolAgent
from app.services.ai_agents.dev_patrol.integration_patrol import SecurityDevAgent

backend_dev = BackendPatrolAgent()
frontend_dev = FrontendPatrolAgent()
security_dev = SecurityDevAgent()

DEV_AGENTS = {
    "backend-dev": backend_dev,
    "frontend-dev": frontend_dev,
    "security-dev": security_dev,
}

__all__ = [
    "BackendPatrolAgent",
    "FrontendPatrolAgent",
    "SecurityDevAgent",
    "backend_dev",
    "frontend_dev",
    "security_dev",
    "DEV_AGENTS",
]
