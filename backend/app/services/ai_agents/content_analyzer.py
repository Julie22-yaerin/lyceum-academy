"""
Agent 1: Content Analyzer — silently analyzes uploaded learning material.

API Address: POST /ai/agents/content-analyzer/analyze
WebSocket:   receives {"type":"agent_result","agent_id":"content-analyzer",...}

Extracts: key concepts, difficulty level, estimated duration, prerequisites,
          suggested tags, and a brief summary.
"""

from __future__ import annotations

from typing import Any

from app.services.ai_agents.base import BaseAgent, AgentTask


class ContentAnalyzerAgent(BaseAgent):
    AGENT_ID = "content-analyzer"
    AGENT_NAME = "Content Analyzer"
    API_PREFIX = "/ai/agents/content-analyzer"

    async def process(self, task: AgentTask) -> dict[str, Any]:
        """Analyze content and return structured metadata."""
        import json
        from app.services.ai import chat_completion

        content = task.payload.get("content", "")
        content_type = task.payload.get("content_type", "text")
        user_id = task.payload.get("user_id", "anonymous")

        system_prompt = """You are an educational content analyzer.
Return a JSON object with exactly these keys (no markdown, just raw JSON):
{
  "title": "suggested title for this content",
  "summary": "2-3 sentence summary",
  "key_concepts": ["concept1", "concept2", ...],
  "difficulty": "beginner|intermediate|advanced",
  "estimated_minutes": 25,
  "prerequisites": ["prereq1", "prereq2"],
  "tags": ["tag1", "tag2"],
  "suggested_subjects": ["subject1", "subject2"]
}
"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Content type: {content_type}\n\nContent:\n{content[:4000]}"},
        ]

        raw = await chat_completion(
            messages=messages,
            temperature=0.3,
            max_tokens=800,
            task_name="content-analyzer",
        )

        try:
            result = json.loads(raw)
        except json.JSONDecodeError:
            result = {
                "summary": raw[:500],
                "key_concepts": [],
                "difficulty": "intermediate",
                "estimated_minutes": 30,
                "prerequisites": [],
                "tags": [],
                "suggested_subjects": [],
            }

        result["analyzed_by"] = self.AGENT_ID
        result["user_id"] = user_id
        return result
