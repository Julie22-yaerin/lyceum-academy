import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.core.security import ProductionSecurityMiddleware, SecurityHeadersMiddleware


def test_production_settings_require_security_config():
    with pytest.raises(ValidationError):
        Settings(
            app_env="production",
            api_cors_origins="https://app.example.com",
            api_allow_dev_auth=True,
            firebase_project_id="",
        )


def test_security_headers_are_added():
    app = FastAPI()
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/test")
    def test_route():
        return {"ok": True}

    client = TestClient(app)
    response = client.get("/test")

    assert response.headers["strict-transport-security"] == "max-age=31536000; includeSubDomains"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"


def test_production_middleware_redirects_http_requests():
    app = FastAPI()
    app.add_middleware(ProductionSecurityMiddleware, allowed_hosts=["example.com"])

    @app.get("/test")
    def test_route():
        return {"ok": True}

    client = TestClient(app, base_url="https://example.com")
    response = client.get("/test", headers={"x-forwarded-proto": "http"}, follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"].startswith("https://example.com")
