-- Migration: Create subscription_plans (standalone) with per-tier entitlement
-- limits, seeded with corrected pricing.
-- Created: 2026-07-15
--
-- Note: migration 002_billing_subscriptions.sql was written but never applied
-- to production — none of its tables exist yet (verified: `public` schema
-- only has pclick_documents/pclick_messages). This migration creates ONLY
-- subscription_plans, since it's the one table with no FK dependency on the
-- rest of that never-applied schema (users, user_subscriptions, etc. — a
-- separate, larger pre-existing gap, not created here). This is enough to
-- serve real, DB-driven pricing/entitlement data to the paywall UI.

CREATE TYPE subscription_tier_enum AS ENUM ('compass', 'scholar', 'mentor', 'researcher');
CREATE TYPE billing_cycle_enum AS ENUM ('monthly', 'annual');

CREATE TABLE subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tier subscription_tier_enum NOT NULL,
    billing_cycle billing_cycle_enum NOT NULL,
    price_usd_cents INTEGER NOT NULL,
    voice_minutes_monthly INTEGER,  -- NULL = unlimited
    mind_map_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    reference_library_limit INTEGER,  -- NULL = unlimited
    roadmap_regen_daily_limit INTEGER,  -- NULL = unlimited
    -- Entitlements added in this migration:
    daily_tool_call_limit INTEGER,             -- NULL = unlimited
    reverse_build_hint_limit_per_file INTEGER, -- NULL = unlimited
    daily_upload_limit INTEGER,                -- NULL = unlimited
    ai_queue_priority INTEGER NOT NULL DEFAULT 0,  -- higher = served first
    ari_voice_daily_call_limit INTEGER,        -- NULL = unlimited, 0 = locked out
    stripe_price_id VARCHAR(128) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_plan_tier_cycle UNIQUE (tier, billing_cycle)
);

CREATE INDEX idx_subscription_plans_tier ON subscription_plans(tier);

INSERT INTO subscription_plans (
    tier, billing_cycle, price_usd_cents, voice_minutes_monthly, mind_map_enabled,
    reference_library_limit, roadmap_regen_daily_limit,
    daily_tool_call_limit, reverse_build_hint_limit_per_file, daily_upload_limit,
    ai_queue_priority, ari_voice_daily_call_limit
) VALUES
    -- Compass — $9.99/mo
    ('compass', 'monthly', 999,   15,  FALSE, 20,   1, 10, 3, 3, 0, 0),
    ('compass', 'annual',  9999,  15,  FALSE, 20,   1, 10, 3, 3, 0, 0),

    -- Scholar — $19.99/mo (2x Compass's tool-call limit, priority over Compass)
    ('scholar', 'monthly', 1999,  60,  TRUE,  100,  3, 20, 6, 5, 1, 0),
    ('scholar', 'annual',  19999, 60,  TRUE,  100,  3, 20, 6, 5, 1, 0),

    -- STEM Focus (enum value stays 'mentor' — display name is frontend-only)
    -- — $34/mo, priority over Scholar, unlocks Ari voice (5 calls/day)
    ('mentor',  'monthly', 3400,  180, TRUE,  NULL, NULL, 30, NULL, 10, 2, 5),
    ('mentor',  'annual',  33999, 180, TRUE,  NULL, NULL, 30, NULL, 10, 2, 5),

    -- Researcher — kept for schema completeness, hidden from pricing UI
    ('researcher', 'monthly', 4999,  NULL, TRUE, NULL, NULL, NULL, NULL, NULL, 3, NULL),
    ('researcher', 'annual',  49999, NULL, TRUE, NULL, NULL, NULL, NULL, NULL, 3, NULL);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_subscription_plans_updated_at
    BEFORE UPDATE ON subscription_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
