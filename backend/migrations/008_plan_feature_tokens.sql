-- Migration: Replace the single credits_monthly number (migration 007) with
-- a per-feature token allotment per plan (e.g. note=500, chat=2000/month).
-- Created: 2026-07-18
--
-- credits_monthly was never set/used in production — safe to drop. Same
-- caveat as 007: this is data-model + admin UI only, not wired to a real
-- Stripe payment (user_subscriptions/users still don't exist in production;
-- see migrations/002_billing_subscriptions.sql).

ALTER TABLE subscription_plans DROP COLUMN IF EXISTS credits_monthly;

CREATE TABLE IF NOT EXISTS plan_feature_tokens (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id        UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
    feature_name   VARCHAR(64) NOT NULL,
    tokens_monthly INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (plan_id, feature_name)
);

CREATE INDEX IF NOT EXISTS idx_plan_feature_tokens_plan ON plan_feature_tokens(plan_id);
