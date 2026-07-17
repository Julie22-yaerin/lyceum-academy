"""
Role: Security Dev — stays silent until given a task.

Model: z-ai/glm-5.2 (NVIDIA NIM Key #3)
Scope: auth, injection, CORS, API contracts, data exposure,
       encryption, JWT, rate limiting, SOC compliance.

Handles: security vulnerabilities, auth bypass, injection attacks,
         CORS misconfig, data leaks, missing auth, insecure defaults.
"""

from __future__ import annotations

import json
from typing import Any

from app.services.ai_agents.base import BaseAgent, AgentTask
from app.services.ai_agents.dev_patrol.nvidia_client import nvidia_completion_json
from app.services.ai_agents.dev_patrol.scanner import (
    scan_backend_files,
    scan_frontend_files,
    scan_config_files,
    format_files_for_prompt,
)
from app.core.config import settings


class SecurityDevAgent(BaseAgent):
    AGENT_ID = "security-dev"
    AGENT_NAME = "Security Dev (Auth/CORS/SOC)"
    API_PREFIX = "/ai/agents/dev-patrol/security"

    def __init__(self):
        super().__init__(max_concurrent=1)

    async def process(self, task: AgentTask) -> dict[str, Any]:
        """
        Task payload:
          - mode: "full_scan" | "endpoint_check" | "report" (default: full_scan)
          - endpoint: str (for endpoint_check mode, e.g. "/ai/chat")
          - bug_report: str (user-reported bug description)
          - file_content: str (for report mode)
        """
        mode = task.payload.get("mode", "full_scan")
        bug_report = task.payload.get("bug_report", "")

        api_key = settings.dev_patrol_integration_key or settings.nvidia_api_key
        model = settings.dev_patrol_integration_model

        if mode == "endpoint_check":
            return await self._check_endpoint(task, api_key, model)
        elif mode == "report":
            return await self._analyze_report(task, api_key, model)
        else:
            return await self._full_scan(task, api_key, model, bug_report)

    async def _full_scan(
        self, task: AgentTask, api_key: str, model: str, bug_report: str = ""
    ) -> dict[str, Any]:
        """
        Scan both backend routes and frontend API calls to find security issues.
        """
        backend_files = scan_backend_files(["*.py"])
        frontend_files = scan_frontend_files(["*.ts", "*.tsx"])
        config_files = scan_config_files()

        all_files = backend_files + frontend_files + config_files
        if not all_files:
            return {"findings": [], "message": "No files found to scan"}

        file_dump = format_files_for_prompt(all_files, max_chars=55000)

        system = """You are a senior security engineer specializing in web application security.
Analyze the provided backend (Python/FastAPI) and frontend (TypeScript/React)
source code to find ALL security vulnerabilities.

Check for:
1. Authentication/authorization bypass
2. SQL injection, XSS, CSRF, prompt injection
3. Hardcoded secrets, API keys, credentials in code
4. CORS misconfigurations (overly permissive origins)
5. Missing rate limiting on sensitive endpoints
6. Insecure data exposure in API responses
7. Missing input validation/sanitization
8. Insecure JWT handling, token leaks
9. PII data leaking to logs or third parties
10. Missing security headers

Return JSON:
{
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "issue": "short title",
      "description": "detailed explanation",
      "file": "relative/path.py",
      "line_hint": "function or line",
      "fix": "exact fix",
      "category": "auth|injection|xss|csrf|secret|cors|rate-limit|data-exposure|header|compliance",
      "owasp_category": "A01:2021 etc"
    }
  ],
  "summary": "one-paragraph security assessment",
  "critical_count": 0,
  "high_count": 0,
  "compliance_score": 0-100
}"""

        user_msg = f"Scan this codebase for security vulnerabilities:\n\n{file_dump}"
        if bug_report:
            user_msg += f"\n\nAlso investigate this reported security concern: {bug_report}"

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
        result["backend_files"] = len(backend_files)
        result["frontend_files"] = len(frontend_files)
        return result

    async def _check_endpoint(
        self, task: AgentTask, api_key: str, model: str
    ) -> dict[str, Any]:
        """Security-check a specific endpoint."""
        endpoint = task.payload.get("endpoint", "")
        if not endpoint:
            return {"error": "endpoint is required for endpoint_check mode"}

        backend_files = scan_backend_files(["*.py"])
        frontend_files = scan_frontend_files(["*.ts", "*.tsx"])

        relevant_backend = [
            f for f in backend_files
            if endpoint in f["content"]
        ]
        relevant_frontend = [
            f for f in frontend_files
            if endpoint in f["content"]
        ]

        all_relevant = relevant_backend + relevant_frontend
        if not all_relevant:
            return {
                "endpoint": endpoint,
                "findings": [],
                "message": f"No files reference endpoint {endpoint}",
            }

        file_dump = format_files_for_prompt(all_relevant, max_chars=30000)

        system = f"""You are a senior security engineer.
Security-audit all code referencing the endpoint: {endpoint}

Check: auth, input validation, rate limiting, error info leaks, CORS,
data exposure in response, injection vectors.

Return JSON:
{{
  "endpoint": "{endpoint}",
  "findings": [
    {{
      "severity": "critical|high|medium|low",
      "issue": "title",
      "description": "explanation",
      "fix": "exact fix",
      "category": "auth|injection|rate-limit|data-exposure|validation"
    }}
  ],
  "secure": true/false
}}"""

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Files referencing {endpoint}:\n\n{file_dump}"},
        ]

        result = await nvidia_completion_json(
            api_key=api_key,
            model=model,
            messages=messages,
            temperature=0.2,
            max_tokens=2048,
        )

        result["scanned_by"] = self.AGENT_ID
        result["mode"] = "endpoint_check"
        return result

    async def _analyze_report(
        self, task: AgentTask, api_key: str, model: str
    ) -> dict[str, Any]:
        """Analyze a user-reported security concern."""
        bug_report = task.payload.get("bug_report", "")
        endpoint = task.payload.get("endpoint", "")
        file_content = task.payload.get("file_content", "")

        system = """You are a senior security engineer.
Given a security concern report, diagnose the risk and provide a fix.

Return JSON:
{
  "risk_level": "critical|high|medium|low",
  "root_cause": "detailed explanation",
  "affected_area": "description",
  "fix": {
    "description": "what to change",
    "code_diff": "exact fix"
  },
  "prevention": "how to prevent",
  "compliance_impact": "SOC/GDPR/etc impact if any"
}"""

        context_parts = [f"Security concern: {bug_report}"]
        if endpoint:
            context_parts.append(f"Affected endpoint: {endpoint}")
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
