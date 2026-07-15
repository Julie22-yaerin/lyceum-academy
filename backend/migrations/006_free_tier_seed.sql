-- Migration: Seed the free-tier plan row. Split from 005 because Postgres
-- won't let a transaction both add an enum value and use it.
-- Created: 2026-07-15

INSERT INTO subscription_plans (
    tier, billing_cycle, price_usd_cents, voice_minutes_monthly, mind_map_enabled,
    reference_library_limit, roadmap_regen_daily_limit,
    daily_tool_call_limit, reverse_build_hint_limit_per_file, daily_upload_limit,
    ai_queue_priority, ari_voice_daily_call_limit
) VALUES
    ('free', 'monthly', 0, 0, FALSE, 5, 0, 2, 1, 2, -1, 0)
ON CONFLICT ON CONSTRAINT uq_plan_tier_cycle DO NOTHING;
