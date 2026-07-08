-- Migration: Add billing and subscription tables (SOC-6)
-- Created: 2026-07-08
-- Description: Implements subscription tiers, user subscriptions, voice usage tracking, and feature usage logging

-- Create subscription tier enum
CREATE TYPE subscription_tier_enum AS ENUM ('compass', 'scholar', 'mentor', 'researcher');

-- Create billing cycle enum
CREATE TYPE billing_cycle_enum AS ENUM ('monthly', 'annual');

-- Create subscription status enum
CREATE TYPE subscription_status_enum AS ENUM ('active', 'past_due', 'canceled', 'trialing');

-- Subscription plans table (seeded data)
CREATE TABLE subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tier subscription_tier_enum NOT NULL,
    billing_cycle billing_cycle_enum NOT NULL,
    price_usd_cents INTEGER NOT NULL,
    voice_minutes_monthly INTEGER,  -- NULL = unlimited
    mind_map_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    reference_library_limit INTEGER,  -- NULL = unlimited
    roadmap_regen_daily_limit INTEGER,  -- NULL = unlimited
    stripe_price_id VARCHAR(128) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_plan_tier_cycle UNIQUE (tier, billing_cycle)
);

-- User subscriptions table
CREATE TABLE user_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES subscription_plans(id),
    status subscription_status_enum NOT NULL DEFAULT 'trialing',
    stripe_customer_id VARCHAR(128) UNIQUE,
    stripe_subscription_id VARCHAR(128) UNIQUE,
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Voice usage records (S2S tracking)
CREATE TABLE voice_usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    duration_seconds DOUBLE PRECISION,
    billing_period_start TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feature usage logs (mind maps, roadmap regen)
CREATE TABLE feature_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature_name VARCHAR(64) NOT NULL,
    feature_metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX idx_user_subscriptions_stripe_customer ON user_subscriptions(stripe_customer_id);
CREATE INDEX idx_user_subscriptions_stripe_subscription ON user_subscriptions(stripe_subscription_id);

CREATE INDEX idx_voice_usage_user_period ON voice_usage_records(user_id, billing_period_start);

CREATE INDEX idx_feature_usage_user_feature ON feature_usage_logs(user_id, feature_name);
CREATE INDEX idx_feature_usage_created_at ON feature_usage_logs(created_at);

-- Seed subscription plans (prices from SOC-5 § 8)
INSERT INTO subscription_plans (tier, billing_cycle, price_usd_cents, voice_minutes_monthly, mind_map_enabled, reference_library_limit, roadmap_regen_daily_limit) VALUES
    -- Compass tier
    ('compass', 'monthly', 999, 15, FALSE, 20, 1),
    ('compass', 'annual', 9999, 15, FALSE, 20, 1),

    -- Scholar tier
    ('scholar', 'monthly', 1999, 60, TRUE, 100, 3),
    ('scholar', 'annual', 19999, 60, TRUE, 100, 3),

    -- Mentor tier (renamed from STEM)
    ('mentor', 'monthly', 2999, 180, TRUE, NULL, NULL),
    ('mentor', 'annual', 29999, 180, TRUE, NULL, NULL),

    -- Researcher tier
    ('researcher', 'monthly', 4999, NULL, TRUE, NULL, NULL),  -- unlimited voice (soft-cap 600 min)
    ('researcher', 'annual', 49999, NULL, TRUE, NULL, NULL);

-- Updated_at trigger for subscription_plans
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

CREATE TRIGGER update_user_subscriptions_updated_at
    BEFORE UPDATE ON user_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_voice_usage_records_updated_at
    BEFORE UPDATE ON voice_usage_records
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_feature_usage_logs_updated_at
    BEFORE UPDATE ON feature_usage_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
