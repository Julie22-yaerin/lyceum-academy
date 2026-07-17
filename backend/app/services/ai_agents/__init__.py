"""
Background AI Agents — 6 silent workers that process tasks asynchronously.

Learning Agents (3):
  1. ContentAnalyzer   — extracts concepts, difficulty from content
  2. PathGenerator     — builds personalized learning paths
  3. ProgressTracker   — analyzes mastery and predicts readiness

Dev Patrol Agents (3):
  4. BackendPatrol     — scans Python/FastAPI for bugs (poolside/laguna-xs-2.1)
  5. FrontendPatrol    — scans TypeScript/React for bugs (minimaxai/minimax-m3)
  6. IntegrationPatrol — scans cross-layer API contracts (z-ai/glm-5.2)
"""

from app.services.ai_agents.base import BaseAgent, AgentTask, AgentResult
from app.services.ai_agents.content_analyzer import ContentAnalyzerAgent
from app.services.ai_agents.path_generator import PathGeneratorAgent
from app.services.ai_agents.progress_tracker import ProgressTrackerAgent
from app.services.ai_agents.dev_patrol.backend_patrol import BackendPatrolAgent
from app.services.ai_agents.dev_patrol.frontend_patrol import FrontendPatrolAgent
from app.services.ai_agents.dev_patrol.integration_patrol import SecurityDevAgent

# Singleton instances — one per agent, shared across the app lifespan
content_analyzer = ContentAnalyzerAgent()
path_generator = PathGeneratorAgent()
progress_tracker = ProgressTrackerAgent()
backend_patrol = BackendPatrolAgent()
frontend_patrol = FrontendPatrolAgent()
integration_patrol = SecurityDevAgent()

AGENTS = {
    "content-analyzer": content_analyzer,
    "path-generator": path_generator,
    "progress-tracker": progress_tracker,
    "backend-dev": backend_patrol,
    "frontend-dev": frontend_patrol,
    "security-dev": integration_patrol,
}

__all__ = [
    "BaseAgent",
    "AgentTask",
    "AgentResult",
    "ContentAnalyzerAgent",
    "PathGeneratorAgent",
    "ProgressTrackerAgent",
    "BackendPatrolAgent",
    "FrontendPatrolAgent",
    "SecurityDevAgent",
    "content_analyzer",
    "path_generator",
    "progress_tracker",
    "backend_patrol",
    "frontend_patrol",
    "integration_patrol",
    "AGENTS",
]
