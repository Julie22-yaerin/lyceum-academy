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

    # ── Persona Mind (GPT-4.1) — multi-agent persona brain ───────
    # The single "brain" that reads the user's question + Firebase persona
    # library and spawns 3 independent character responses in parallel.
    # Falls back to openai_api_key if persona_mind_key is not set.
    persona_mind_key: str = ""          # PERSONA_MIND_KEY in .env
    persona_mind_model: str = "gpt-4.1" # PERSONA_MIND_MODEL in .env

    # ── Team Phản Biện (Debate Team) ─────────────────────────────
    # Pos 1 (OpenAI GPT-4o)  — phân tích 100% nội dung gốc
    critique_openai_key: str = ""
    critique_openai_model: str = "gpt-4o"
    # Pos 2 (Groq)           — tập trung 50% cốt lõi nhất
    critique_groq_key: str = ""
    critique_groq_model: str = "qwen/qwen3-32b"
    # Pos 3 (Ollama Cloud)   — 20% cốt, chắt lọc + điều phối tranh luận
    critique_ollama_key: str = ""
    critique_ollama_model: str = "qwen3.5:9b"

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

    # ── Google AI Studio (optional — needs AIza... key) ──────────
    google_api_key:       str = ""
    google_primary_model: str = "gemini-2.5-flash"
    google_fast_model:    str = "gemma-3-27b-it"
    # Same GOOGLE_API_KEY as above — one Google AI Studio key covers every
    # Gemini model tier (Flash, Flash-Lite, Pro), no separate key needed.
    # Used for the grading role: grade_all / grade_dual / check_mastery.
    google_pro_model:     str = "gemini-2.5-pro"

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

    # ── NVIDIA NIM Safety Guard (security police, SOC-16+) ─────────
    # Nemotron Safety Guard 8B — scans every AI response for security policy
    # violations, prompt injection, and unsafe content BEFORE delivery to user.
    # Falls back to nvidia_api_key if no dedicated key is set.
    nvidia_safety_key: str = ""
    nvidia_safety_model: str = "nvidia/llama-3.1-nemotron-safety-guard-8b-v3"

    # ── NVIDIA NIM DeepSeek (learning roadmap generator) ───────────
    # Falls back to nvidia_api_key if no dedicated key is set.
    nvidia_deepseek_key: str = ""
    nvidia_deepseek_model: str = "deepseek-ai/deepseek-v4-flash"

    # ── NVIDIA NIM DiffusionGemma (dual-role reviewer) ──────────────
    # google/diffusiongemma-26b-a4b-it acts as the "reviewer" model:
    # the primary model reasons/drafts, then this model refines before
    # the answer is delivered to the student.
    # Uses the same nvidia_api_key unless a dedicated key is provided.
    nvidia_gemma_reviewer_key: str = ""    # set in .env to override; falls back to nvidia_api_key
    nvidia_gemma_reviewer_model: str = "google/diffusiongemma-26b-a4b-it"
    nvidia_gemma_reviewer_max_retries: int = 2  # retries before WolframAlpha fallback

    # ── OpenRouter (fallback, :free models need no credits) ──────
    openrouter_api_key: str = ""
    openrouter_primary_model: str = "nvidia/nemotron-3-super-120b-a12b:free"
    openrouter_fallback_model: str = "qwen/qwen3-coder:free"

    # ── WolframAlpha (computation plugin, SOC-17) ─────────────────
    # Free AppID at https://developer.wolframalpha.com/access — used for exact
    # arithmetic/equation-solving instead of burning an LLM call, and as a
    # last-resort answer when every chat provider above is down or errors out.
    wolfram_app_id: str = ""

    # ── API ──────────────────────────────────────────────────
    api_cors_origins: str = "http://localhost:3000"
    api_allow_dev_auth: bool = False

    # ── Firebase ─────────────────────────────────────────────
    firebase_project_id: str = ""
    # Path to a Firebase service account JSON key file (downloaded from
    # Firebase Console → Project Settings → Service Accounts → Generate new key).
    # Required for Firestore write access (admin SDK).
    # Leave empty when running in a GCP environment — ADC is used instead.
    firebase_service_account_path: str = ""

    @property
    def has_firestore(self) -> bool:
        """True when the Firebase project ID is set (enough for Firestore)."""
        return bool(self.firebase_project_id)

    # ── Admin ────────────────────────────────────────────────
    # Comma-separated list of Firebase emails allowed to call /admin/* endpoints.
    # If empty, any verified Firebase user can call admin (not recommended for prod).
    admin_emails: str = ""

    @property
    def admin_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.admin_emails.split(",") if e.strip()}

    # ── Encryption (SOC-16) ──────────────────────────────────
    # Primary encryption key (current) — used for new encryptions
    # Generate with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
    encryption_key_primary: str = ""
    # Secondary keys (for rotation) — comma-separated, used only for decryption
    encryption_keys_secondary: str = ""

    @property
    def encryption_keys(self) -> list[str]:
        """All encryption keys (primary + secondary) for key rotation support."""
        keys = [self.encryption_key_primary] if self.encryption_key_primary else []
        if self.encryption_keys_secondary:
            keys.extend([k.strip() for k in self.encryption_keys_secondary.split(",") if k.strip()])
        return keys

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
