"""
Agent 2: Path Generator — builds personalized learning paths in the background.

API Address: POST /ai/agents/path-generator/generate
WebSocket:   receives {"type":"agent_result","agent_id":"path-generator",...}

Takes: goal, current knowledge, preferred pace → returns ordered step list
with resources, milestones, and estimated timeline.
"""

from __future__ import annotations

from typing import Any

from app.services.ai_agents.base import BaseAgent, AgentTask


class PathGeneratorAgent(BaseAgent):
    AGENT_ID = "path-generator"
    AGENT_NAME = "Learning Path Generator"
    API_PREFIX = "/ai/agents/path-generator"

    async def process(self, task: AgentTask) -> dict[str, Any]:
        import json
        from app.services.ai import chat_completion

        goal = task.payload.get("goal", "")
        current_knowledge = task.payload.get("current_knowledge", "")
        pace = task.payload.get("pace", "moderate")
        user_id = task.payload.get("user_id", "anonymous")

        system_prompt = """You are an expert learning path designer.
Given a student's goal, current knowledge, and preferred pace, generate a structured learning path.

Return a JSON object with exactly these keys (no markdown, just raw JSON):
{
  "path_title": "string",
  "overview": "2-3 sentence overview",
  "total_estimated_hours": 40,
  "steps": [
    {
      "step_number": 1,
      "title": "string",
      "description": "what this step covers",
      "estimated_hours": 5,
      "resources": ["resource_url_or_title"],
      "milestone": "how to know this step is mastered",
      "difficulty": "beginner|intermediate|advanced"
    }
  ],
  "tips": ["tip1", "tip2"],
  "success_metrics": ["metric1", "metric2"]
}
Generate 4-8 steps. Be specific and actionable.
"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": (
                f"Goal: {goal}\n"
                f"Current knowledge: {current_knowledge}\n"
                f"Preferred pace: {pace}"
            )},
        ]

        raw = await chat_completion(
            messages=messages,
            temperature=0.4,
            max_tokens=2000,
            task_name="path-generator",
        )

        try:
            result = json.loads(raw)
        except json.JSONDecodeError:
            result = {
                "path_title": f"Learning path: {goal}",
                "overview": raw[:500],
                "total_estimated_hours": 30,
                "steps": [],
                "tips": [],
                "success_metrics": [],
            }

        result["generated_by"] = self.AGENT_ID
        result["user_id"] = user_id
        return result
