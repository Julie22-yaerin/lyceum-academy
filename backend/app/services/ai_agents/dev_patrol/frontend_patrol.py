"""
Role: Frontend Dev — stays silent until given a task.

Model: minimaxai/minimax-m3 (NVIDIA NIM Key #2)
Scope: the-lyceum-academy/src/**, components, views, hooks, lib

Handles: React bugs, TypeScript errors, hook issues, state problems,
         render bugs, CSS/layout, accessibility, dead code.
"""

from __future__ import annotations

import json
from typing import Any

from app.services.ai_agents.base import BaseAgent, AgentTask
from app.services.ai_agents.dev_patrol.nvidia_client import nvidia_completion_json
from app.services.ai_agents.dev_patrol.scanner import (
    scan_frontend_files,
    scan_single_file,
    format_files_for_prompt,
)
from app.core.config import settings


class FrontendPatrolAgent(BaseAgent):
    AGENT_ID = "frontend-dev"
    AGENT_NAME = "Frontend Dev (TypeScript/React)"
    API_PREFIX = "/ai/agents/dev-patrol/frontend"

    def __init__(self):
        super().__init__(max_concurrent=1)

    async def process(self, task: AgentTask) -> dict[str, Any]:
        """
        Task payload:
          - mode: "full_scan" | "single_file" | "report" (default: full_scan)
          - file_path: str (for single_file mode)
          - bug_report: str (user-reported bug description)
          - file_content: str (for report mode)
        """
        mode = task.payload.get("mode", "full_scan")
        bug_report = task.payload.get("bug_report", "")

        api_key = settings.dev_patrol_frontend_key or settings.nvidia_api_key
        model = settings.dev_patrol_frontend_model

        if mode == "single_file":
            return await self._scan_single(task, api_key, model)
        elif mode == "report":
            return await self._analyze_report(task, api_key, model)
        else:
            return await self._full_scan(task, api_key, model, bug_report)

    async def _full_scan(
        self, task: AgentTask, api_key: str, model: str, bug_report: str = ""
    ) -> dict[str, Any]:
        """Scan all frontend files for bugs."""
        files = scan_frontend_files()
        if not files:
            return {"findings": [], "message": "No frontend files found to scan"}

        file_dump = format_files_for_prompt(files, max_chars=50000)

        system = """You are a senior TypeScript/React code auditor.
Analyze the provided source code files and find ALL bugs, errors, and issues.

Return a JSON object with exactly these keys:
{
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "file": "relative/path/to/file.tsx",
      "line_hint": "function name or line number",
      "issue": "short title",
      "description": "detailed explanation",
      "fix": "exact code fix or suggestion",
      "category": "bug|type-error|hook-issue|render-bug|state|promise|a11y|dead-code|css"
    }
  ],
  "summary": "one-paragraph overall assessment",
  "files_scanned": 0,
  "critical_count": 0,
  "high_count": 0
}

Focus on REAL bugs: type mismatches, broken hooks, unhandled promises,
missing error boundaries, state that never updates, memory leaks,
incorrect useEffect dependencies, dead code paths."""

        user_msg = f"Scan these frontend files for bugs:\n\n{file_dump}"
        if bug_report:
            user_msg += f"\n\nAlso investigate this reported bug: {bug_report}"

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ]

        result = await nvidia_completion_json(
            api_key=api_key,
            model=model,
            messages=messages,
            temperature=0.2,
            max_tokens=4096,
        )

        result["scanned_by"] = self.AGENT_ID
        result["model"] = model
        result["files_count"] = len(files)
        return result

    async def _scan_single(
        self, task: AgentTask, api_key: str, model: str
    ) -> dict[str, Any]:
        """Scan a single frontend file for bugs."""
        file_path = task.payload.get("file_path", "")
        if not file_path:
            return {"error": "file_path is required for single_file mode"}

        file_data = scan_single_file(file_path)
        if not file_data:
            return {"error": f"File not found: {file_path}"}

        system = """You are a senior TypeScript/React code auditor.
Analyze the provided file and find ALL bugs, errors, and issues.

Return JSON:
{
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "line_hint": "function name or line number",
      "issue": "short title",
      "description": "detailed explanation",
      "fix": "exact code fix",
      "category": "bug|type-error|hook-issue|render-bug|state|promise|a11y|dead-code|css"
    }
  ],
  "summary": "assessment",
  "health_score": 0-100
}"""

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"File: {file_data['relative_path']}\n\n{file_data['content']}"},
        ]

        result = await nvidia_completion_json(
            api_key=api_key,
            model=model,
            messages=messages,
            temperature=0.2,
            max_tokens=2048,
        )

        result["scanned_by"] = self.AGENT_ID
        result["file"] = file_data["relative_path"]
        return result

    async def _analyze_report(
        self, task: AgentTask, api_key: str, model: str
    ) -> dict[str, Any]:
        """Analyze a user-reported frontend bug."""
        bug_report = task.payload.get("bug_report", "")
        file_content = task.payload.get("file_content", "")
        component = task.payload.get("component", "")

        system = """You are a senior React/TypeScript debugger.
Given a bug report and optional code context, diagnose the root cause
and provide a fix.

Return JSON:
{
  "root_cause": "detailed explanation",
  "affected_files": ["file.tsx"],
  "fix": {
    "description": "what to change",
    "code_diff": "the exact fix as code snippet"
  },
  "prevention": "how to prevent this class of bug",
  "severity": "critical|high|medium|low"
}"""

        context_parts = [f"Bug report: {bug_report}"]
        if component:
            context_parts.append(f"Affected component: {component}")
        if file_content:
            context_parts.append(f"Related code:\n{file_content[:8000]}")

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": "\n\n".join(context_parts)},
        ]

        result = await nvidia_completion_json(
            api_key=api_key,
            model=model,
            messages=messages,
            temperature=0.2,
            max_tokens=2048,
        )

        result["scanned_by"] = self.AGENT_ID
        result["mode"] = "report_analysis"
        return result
