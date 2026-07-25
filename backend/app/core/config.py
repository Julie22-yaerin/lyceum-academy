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

    # ── OpenAI (fine-tuning + free tier) ─────────────────────────
    openai_api_key: str = ""          # FREE tier uses this key
    openai_model_analysis: str = "gpt-4o"
    openai_model_hints: str = "gpt-4o-mini"

    # ── OpenAI (paid tiers) ──────────────────────────────────────
    # Separate key for paid subscribers (compass, scholar, mentor, researcher).
    # Falls back to openai_api_key if not set.
    openai_paid_key: str = ""         # OPENAI_PAID_KEY in .env

    # ── Persona Mind (GPT-4.1) — multi-agent persona brain ───────
    # The single "brain" that reads the user's question + Firebase persona
    # library and spawns 3 independent character responses in parallel.
    # Falls back to openai_api_key if persona_mind_key is not set.
    persona_mind_key: str = ""          # PERSONA_MIND_KEY in .env
    persona_mind_model: str = "gpt-4.1" # PERSONA_MIND_MODEL in .env

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

    # ── NVIDIA NIM Feedback Insights (admin Feedback dashboard) ────
    # Clusters free-text student feedback into themes for the admin
    # dashboard's AI-insights chart. Uses the same nvidia_api_key.
    # NOTE: "google/gemma-4-31b-it" (originally requested) times out on
    # NVIDIA's catalog — not a deployed model as of this writing. Verified
    # google/gemma-2-2b-it responds correctly instead (same as
    # nvidia_primary_model); override via NVIDIA_FEEDBACK_MODEL if needed.
    nvidia_feedback_model: str = "google/gemma-2-2b-it"

    # ── Dev Patrol — background bug-finding & fixing team ──────────
    # Key 1: poolside/laguna-xs-2.1 — backend Python dev
    dev_patrol_backend_key: str = ""
    dev_patrol_backend_model: str = "poolside/laguna-xs-2.1"
    # Key 2: minimaxai/minimax-m3 — frontend TypeScript/React dev
    dev_patrol_frontend_key: str = ""
    dev_patrol_frontend_model: str = "minimaxai/minimax-m3"
    # Key 3: z-ai/glm-5.2 — security dev
    dev_patrol_integration_key: str = ""
    dev_patrol_integration_model: str = "z-ai/glm-5.2"

    # ── Customer Support Chat (always-on,热情 tư vấn viên) ──────────
    support_chat_key: str = ""
    support_chat_model: str = "nvidia/nemotron-mini-4b-instruct"

    # ── Commander — chỉ huy đội dev ──────────────────────────────
    # Classifies bugs (critical → fix now, minor → batch every 4 days),
    # dispatches to the right dev, and takes direct admin commands
    # (function-calling — see app/services/commander.py).
    commander_key: str = ""
    commander_model: str = "nvidia/llama-3.3-nemotron-super-49b-v1.5"

    # ── Safety Guard (content intake) — blocks profanity, virus uploads,
    # unauthorized extensions in user-submitted text/files. Not to be
    # confused with app/services/safety_guard.py (scans outgoing AI
    # responses) or app/services/content_safety.py (prompt/upload size
    # + type validation) — this is a third, distinct gate.
    content_guard_key: str = ""
    content_guard_model: str = "nvidia/nemotron-3.5-content-safety"

    # ── Anthropic (Claude — premium real-time roles) ────────────────────────
    anthropic_api_key: str = ""
    anthropic_base_url: str = "https://api.anthropic.com/v1"
    anthropic_claude_sonnet_model: str = "claude-3-5-sonnet-20241022"  # Feynman Listener
    anthropic_claude_opus_model: str = "claude-3-opus-20240229"       # Lead Concierge

    # ── Second Brain synthesizer — dedicated key, Opus 3 only ───────────────
    # A separate Anthropic key reserved for turning raw material a student
    # adds (Settings → Customize Second Brain, /secondbrain page) into a
    # clean structured note. Falls back to anthropic_api_key if unset.
    second_brain_anthropic_key: str = ""       # SECOND_BRAIN_ANTHROPIC_KEY in .env

    # ── OpenAI o1 (Coach — deep Chain-of-Thought, batch API) ───────────────
    openai_o1_model: str = "o1"  # Batch/off-peak execution for Coach role

    # ── Google AI Studio — Gemini 1.5 Pro (Debate Partner, multimodal) ─────
    google_gemini_pro_model: str = "gemini-1.5-pro"  # Scientific Debate Partner

    # ── Premium Role Configs ───────────────────────────────────────────────
    # Performance threshold: below this score → Concierge provides foundational
    # blocks; at or above → initiates theoretical debates.
    concierge_performance_threshold: float = 0.6
    # Max Socratic questions per Feynman Listener turn (spec: 3)
    feynman_max_questions: int = 3
    # Coach runs at off-peak hours (UTC) — default 03:00
    coach_batch_hour: int = 3
    coach_batch_minute: int = 0

    # ── OpenRouter (fallback, :free models need no credits) ──────
    openrouter_api_key: str = ""
    openrouter_primary_model: str = "nvidia/nemotron-3-super-120b-a12b:free"
    openrouter_fallback_model: str = "qwen/qwen3-coder:free"

    # ── Cloudflare Workers AI (image generation + text-to-speech) ────
    # REST shape: POST https://api.cloudflare.com/client/v4/accounts/
    #   {account_id}/ai/run/{model}   with  Authorization: Bearer <token>
    # The account id is part of the URL, so BOTH the id and a token are
    # required — a token alone cannot address the endpoint. All three live in
    # .env (gitignored); nothing here is ever committed with a real value.
    # Leave any of them empty and the callers fall back to their local paths
    # (tiny-sd for images, browser speechSynthesis for audio).
    cloudflare_account_id: str = ""     # CLOUDFLARE_ACCOUNT_ID
    cloudflare_image_token: str = ""    # CLOUDFLARE_IMAGE_TOKEN — image generation
    cloudflare_tts_token: str = ""      # CLOUDFLARE_TTS_TOKEN   — podcast narration
    cloudflare_image_model: str = "@cf/bytedance/stable-diffusion-xl-lightning"
    cloudflare_tts_model: str = "@cf/myshell-ai/melotts"
    # Break-time short "reels". NOTE: Workers AI has no text-to-video model —
    # its catalogue is text / image / TTS / ASR / embeddings. So a reel here is
    # assembled from generated stills + narration rather than being an encoded
    # video file. This token is used for that generation.
    cloudflare_reels_token: str = ""    # CLOUDFLARE_REELS_TOKEN

    # ── Retention offers (shown when a subscriber tries to cancel) ────
    # Stripe coupon applying the 65% save-offer. Created once in the Stripe
    # dashboard (Products -> Coupons); leave empty and the offer is recorded
    # for manual follow-up instead of applied automatically.
    stripe_retention_coupon_id: str = ""   # STRIPE_RETENTION_COUPON_ID
    # Quanta granted for booking an onboarding call during the cancel flow.
    retention_call_bonus_quanta: int = 200
    # Free trial length, in days, attached to the Stripe checkout session.
    trial_period_days: int = 4

    # ── WolframAlpha (computation plugin, SOC-17) ─────────────────
    # Free AppID at https://developer.wolframalpha.com/access — used for exact
    # arithmetic/equation-solving instead of burning an LLM call, and as a
    # last-resort answer when every chat provider above is down or errors out.
    wolfram_app_id: str = ""

    # ── Google reCAPTCHA v3 (bot protection on login/signup) ──────
    # Secret key from https://www.google.com/recaptcha/admin — pairs with the
    # frontend's VITE_RECAPTCHA_SITE_KEY. Leave empty to disable verification
    # (the login-attempt rate limit still applies on its own).
    recaptcha_secret_key: str = ""

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

    # ── Unlimited test access ─────────────────────────────────
    # There is no free-trial program anymore (registration is vetted). This
    # is the one bypass: a one-time redeemable code (see
    # POST /account/redeem-unlimited) that pins an account to the top plan
    # with effectively uncapped Quanta, permanently — for the admin's own
    # unlimited testing, not distributed to regular applicants.
    admin_unlimited_test_code: str = ""   # ADMIN_UNLIMITED_TEST_CODE in .env

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
