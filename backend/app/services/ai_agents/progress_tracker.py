"""
Agent 3: Progress Tracker — analyzes student performance and predicts mastery.

API Address: POST /ai/agents/progress-tracker/analyze
WebSocket:   receives {"type":"agent_result","agent_id":"progress-tracker",...}

Takes: exercise history, quiz scores, time spent → returns mastery predictions,
weak areas, and recommended focus topics.
"""

from __future__ import annotations

from typing import Any

from app.services.ai_agents.base import BaseAgent, AgentTask


class ProgressTrackerAgent(BaseAgent):
    AGENT_ID = "progress-tracker"
    AGENT_NAME = "Progress Tracker"
    API_PREFIX = "/ai/agents/progress-tracker"

    async def process(self, task: AgentTask) -> dict[str, Any]:
        import json
        from app.services.ai import chat_completion

        exercises = task.payload.get("exercises", [])
        quiz_scores = task.payload.get("quiz_scores", [])
        time_spent = task.payload.get("time_spent_minutes", 0)
        user_id = task.payload.get("user_id", "anonymous")

        system_prompt = """You are an educational analytics AI that tracks student progress.
Given the student's exercise history, quiz scores, and time spent, analyze their progress.

Return a JSON object with exactly these keys (no markdown, just raw JSON):
{
  "overall_mastery": 0.0 to 1.0,
  "subject_breakdown": {
    "subject_name": {
      "mastery": 0.0 to 1.0,
      "trend": "improving|stable|declining",
      "hours_practiced": 5
    }
  },
  "strengths": ["strength1", "strength2"],
  "weak_areas": ["weak1", "weak2"],
  "recommended_focus": ["topic1", "topic2"],
  "predicted_ready_for_advanced": true,
  "encouragement_message": "a brief encouraging message",
  "next_actions": ["action1", "action2"]
}
"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": (
                f"Exercises completed: {json.dumps(exercises[:50])}\n"
                f"Quiz scores: {json.dumps(quiz_scores[:20])}\n"
                f"Total time spent: {time_spent} minutes"
            )},
        ]

        raw = await chat_completion(
            messages=messages,
            temperature=0.3,
            max_tokens=1000,
            task_name="progress-tracker",
        )

        try:
            result = json.loads(raw)
        except json.JSONDecodeError:
            result = {
                "overall_mastery": 0.5,
                "subject_breakdown": {},
                "strengths": [],
                "weak_areas": [],
                "recommended_focus": [],
                "predicted_ready_for_advanced": False,
                "encouragement_message": raw[:300],
                "next_actions": [],
            }

        result["analyzed_by"] = self.AGENT_ID
        result["user_id"] = user_id
        return result
