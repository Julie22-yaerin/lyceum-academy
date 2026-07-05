from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── App ──────────────────────────────────────────────────
    app_env: str = "development"
    app_name: str = "Pclick"

    # ── Database ─────────────────────────────────────────────
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/pclick"

    # ── Supabase ─────────────────────────────────────────────
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    supabase_jwt_audience: str = "authenticated"

    # ── OpenAI (fine-tuning) ─────────────────────────────────
    openai_api_key: str = ""
    openai_model_analysis: str = "gpt-4o"
    openai_model_hints: str = "gpt-4o-mini"

    # ── Ollama Cloud (multi-key rotation) ────────────────────
    ollama_api_key:   str = ""   # key 1 (primary)
    ollama_api_key_2: str = ""   # key 2
    ollama_api_key_3: str = ""   # key 3
    ollama_cloud_url: str = "https://ollama.com"      # /api/chat appended in ai.py
    ollama_primary_model: str = "deepseek-v4-flash"   # thinking, 1M ctx, free on Ollama Cloud
    ollama_fast_model:    str = "qwen3.5:9b"          # fast hints / mastery checks
    ollama_vision_model:  str = ""   # set in .env to enable vision (e.g. qwen3.5)

    @property
    def ollama_keys(self) -> list[str]:
        """All non-empty Ollama keys — used for round-robin rotation."""
        return [k for k in [
            self.ollama_api_key,
            self.ollama_api_key_2,
            self.ollama_api_key_3,
        ] if k]

    # ── Groq (primary — free, 14k req/day, OpenAI-compatible) ───────
    groq_api_key:       str = ""
    groq_primary_model: str = "qwen/qwen3-32b"
    groq_fast_model:    str = "llama-3.1-8b-instant"

    # ── yt-dlp cookies (optional) ────────────────────────────────
    # YouTube rate-limits/blocks requests from datacenter IPs (Railway etc.)
    # regardless of the video's own privacy settings. Exporting cookies.txt
    # from a real, logged-in browser session (e.g. via the "Get cookies.txt"
    # extension) and pointing this at that file lets yt-dlp authenticate as
    # a real session, which YouTube treats far less suspiciously.
    ytdlp_cookies_file: str = ""
    # Route yt-dlp through a proxy (http://user:pass@host:port or socks5://...)
    # when the server's own IP gets rate-limited/blocked by YouTube.
    ytdlp_proxy: str = ""

    # ── Google AI Studio (optional — needs AIza... key) ──────────
    google_api_key:       str = ""
    google_primary_model: str = "gemini-2.5-flash"
    google_fast_model:    str = "gemma-3-27b-it"

    # ── NVIDIA NIM (fallback) ─────────────────────────────────────
    nvidia_api_key: str = ""
    nvidia_primary_model: str = "google/gemma-2-2b-it"
    nvidia_node_model: str = "google/gemma-2-2b-it"   # model for knowledge graph node summaries
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    # Text fallback for ARI's voice session when the Gemini Live WebSocket is
    # down — no native audio here, the frontend speaks the reply via the
    # browser's own speechSynthesis instead.
    nvidia_voice_fallback_model: str = "openai/gpt-oss-20b"

    # ── NVIDIA NIM Vision (image analysis) ────────────────────────
    nvidia_vision_key: str = ""
    nvidia_vision_model: str = "meta/llama-3.2-11b-vision-instruct"

    # ── NVIDIA NIM Orchestrator (onboarding → pricing plan) ────────
    nvidia_orchestrator_key: str = ""
    nvidia_orchestrator_model: str = "meta/llama-3.1-70b-instruct"

    # ── OpenRouter (fallback, :free models need no credits) ──────
    openrouter_api_key: str = ""
    openrouter_primary_model: str = "nvidia/nemotron-3-super-120b-a12b:free"
    openrouter_fallback_model: str = "qwen/qwen3-coder:free"

    # ── API ──────────────────────────────────────────────────
    api_cors_origins: str = "http://localhost:3000"
    api_allow_dev_auth: bool = False

    # ── Firebase ─────────────────────────────────────────────
    firebase_project_id: str = ""

    # ── Admin ────────────────────────────────────────────────
    # Comma-separated list of Firebase emails allowed to call /admin/* endpoints.
    # If empty, any verified Firebase user can call admin (not recommended for prod).
    admin_emails: str = ""

    @property
    def admin_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.admin_emails.split(",") if e.strip()}

    # ── Derived ──────────────────────────────────────────────
    @property
    def has_supabase(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]

    @property
    def firebase_jwks_url(self) -> str:
        return (
            "https://www.googleapis.com/service_accounts/v1/jwk/"
            "securetoken@system.gserviceaccount.com"
        )

    @property
    def firebase_issuer(self) -> str:
        return f"https://securetoken.google.com/{self.firebase_project_id}"

    @property
    def supabase_jwks_url(self) -> str:
        return f"{self.supabase_url}/auth/v1/keys"


settings = Settings()
