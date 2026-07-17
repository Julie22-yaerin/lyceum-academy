-- Migration: Add an admin-editable credit allotment per subscription plan.
-- Created: 2026-07-18
--
-- Data model only. This does NOT wire up auto-granting credits when a
-- Stripe payment succeeds — that requires user_subscriptions/users to
-- actually exist first (migration 002_billing_subscriptions.sql was never
-- applied to production; get_current_user currently 500s against a
-- nonexistent `users` table). Fixing that pipeline is a separate follow-up.
--
-- Purely additive on subscription_plans, the one table from that lineage
-- that IS real and seeded in production — safe to run standalone.

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS credits_monthly INTEGER;
