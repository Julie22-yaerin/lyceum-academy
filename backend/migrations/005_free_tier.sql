-- Migration: Add a "free" tier — what a user is left with after the 3-day
-- trial ends if they don't subscribe. Deliberately more restricted than the
-- trial itself (which has full access to everything for 3 days).
-- Created: 2026-07-15

ALTER TYPE subscription_tier_enum ADD VALUE IF NOT EXISTS 'free';
