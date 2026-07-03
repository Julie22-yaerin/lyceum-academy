from __future__ import annotations

from urllib.parse import urlparse

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("X-XSS-Protection", "1; mode=block")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
        )
        return response


class ProductionSecurityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, allowed_hosts: list[str] | None = None, enforce_https: bool = True):
        super().__init__(app)
        self.allowed_hosts = {host.lower().strip() for host in (allowed_hosts or []) if host and host.strip()}
        self.enforce_https = enforce_https

    async def dispatch(self, request: Request, call_next):
        forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
        request_scheme = request.url.scheme.lower()
        host = request.headers.get("host", "").split(":")[0].lower()

        if self.allowed_hosts and host not in self.allowed_hosts:
            return Response(status_code=400, content="Invalid Host")

        is_http_request = self.enforce_https and (request_scheme == "http" or forwarded_proto == "http")
        if is_http_request:
            return RedirectResponse(url=request.url.replace(scheme="https"), status_code=307)

        if request.method == "OPTIONS":
            return await call_next(request)

        return await call_next(request)
