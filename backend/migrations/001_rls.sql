-- =============================================================================
-- Row Level Security — Lyceum Academy / Pclick
-- Apply against Railway PostgreSQL (or Supabase Postgres).
--
-- Strategy: each request sets a session variable `app.current_user_uuid` (UUID
-- string) via SQLAlchemy before any query.  Policies check this variable so the
-- DB enforces isolation even if application code has a bug.
--
-- Run once:
--   psql "$DATABASE_URL" -f migrations/001_rls.sql
-- =============================================================================

-- ── Helper function ───────────────────────────────────────────────────────────
-- Returns the current request's user UUID, or NULL if not set (admin / migration).
CREATE OR REPLACE FUNCTION current_user_uuid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
        SELECT NULLIF(current_setting('app.current_user_uuid', true), '')::uuid
    $$;


-- ── users ─────────────────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Each user can only see and modify their own row.
CREATE POLICY users_self_select ON users FOR SELECT
    USING (id = current_user_uuid());

CREATE POLICY users_self_update ON users FOR UPDATE
    USING (id = current_user_uuid())
    WITH CHECK (id = current_user_uuid());

-- INSERT is done by the application with a service-role connection (no RLS check).
-- DELETE is prohibited for end-users.


-- ── stored_assets ─────────────────────────────────────────────────────────────
ALTER TABLE stored_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY assets_owner_select ON stored_assets FOR SELECT
    USING (owner_id = current_user_uuid());

CREATE POLICY assets_owner_insert ON stored_assets FOR INSERT
    WITH CHECK (owner_id = current_user_uuid());

CREATE POLICY assets_owner_update ON stored_assets FOR UPDATE
    USING (owner_id = current_user_uuid())
    WITH CHECK (owner_id = current_user_uuid());

CREATE POLICY assets_owner_delete ON stored_assets FOR DELETE
    USING (owner_id = current_user_uuid());


-- ── psets ─────────────────────────────────────────────────────────────────────
ALTER TABLE psets ENABLE ROW LEVEL SECURITY;

-- Owner can do anything with their psets.
CREATE POLICY psets_owner_all ON psets FOR ALL
    USING (owner_id = current_user_uuid())
    WITH CHECK (owner_id = current_user_uuid());

-- Any authenticated user can SELECT psets that have a public share.
-- (sharable psets are read via pset_shares; problem content access is app-controlled)
CREATE POLICY psets_shared_select ON psets FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM pset_shares ps
            WHERE ps.pset_id = psets.id
              AND ps.visibility = 'public'
        )
    );


-- ── problems ─────────────────────────────────────────────────────────────────
-- Problems are read by the pset owner or anyone with a public pset share.
ALTER TABLE problems ENABLE ROW LEVEL SECURITY;

CREATE POLICY problems_via_pset ON problems FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM psets p
            WHERE p.id = problems.pset_id
              AND (
                p.owner_id = current_user_uuid()
                OR EXISTS (
                    SELECT 1 FROM pset_shares ps
                    WHERE ps.pset_id = p.id AND ps.visibility = 'public'
                )
              )
        )
    );

CREATE POLICY problems_owner_write ON problems FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM psets p
            WHERE p.id = problems.pset_id
              AND p.owner_id = current_user_uuid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM psets p
            WHERE p.id = problems.pset_id
              AND p.owner_id = current_user_uuid()
        )
    );


-- ── attempts ─────────────────────────────────────────────────────────────────
ALTER TABLE attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY attempts_owner_all ON attempts FOR ALL
    USING (user_id = current_user_uuid())
    WITH CHECK (user_id = current_user_uuid());


-- ── attempt_hints ─────────────────────────────────────────────────────────────
ALTER TABLE attempt_hints ENABLE ROW LEVEL SECURITY;

CREATE POLICY attempt_hints_via_attempt ON attempt_hints FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM attempts a
            WHERE a.id = attempt_hints.attempt_id
              AND a.user_id = current_user_uuid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM attempts a
            WHERE a.id = attempt_hints.attempt_id
              AND a.user_id = current_user_uuid()
        )
    );


-- ── progress ──────────────────────────────────────────────────────────────────
ALTER TABLE progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY progress_owner_all ON progress FOR ALL
    USING (user_id = current_user_uuid())
    WITH CHECK (user_id = current_user_uuid());


-- ── knowledge_mastery ─────────────────────────────────────────────────────────
ALTER TABLE knowledge_mastery ENABLE ROW LEVEL SECURITY;

CREATE POLICY mastery_owner_all ON knowledge_mastery FOR ALL
    USING (user_id = current_user_uuid())
    WITH CHECK (user_id = current_user_uuid());


-- ── pdf_reports ───────────────────────────────────────────────────────────────
ALTER TABLE pdf_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY reports_owner_all ON pdf_reports FOR ALL
    USING (generated_by = current_user_uuid())
    WITH CHECK (generated_by = current_user_uuid());


-- ── leaderboard_entries ────────────────────────────────────────────────────────
-- Public reads; writes are service-only (application bypasses RLS for writes).
ALTER TABLE leaderboard_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY leaderboard_entries_public_select ON leaderboard_entries FOR SELECT
    USING (true);

-- Only service connections can INSERT/UPDATE/DELETE leaderboard data.


-- ── Public / shared tables (no per-user RLS needed) ──────────────────────────
-- concepts        — global reference data, public read
-- leaderboards    — public read
-- pset_shares     — public read (content access controlled at psets level)
-- reasoning_trees — accessible via problems policy (read-through)
-- reasoning_nodes — accessible via reasoning_trees (read-through)
-- community_profiles — public profiles, controlled at app layer


-- ── community_profiles ────────────────────────────────────────────────────────
-- Anyone can read public profiles; only owner can update.
ALTER TABLE community_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY community_profiles_public_select ON community_profiles FOR SELECT
    USING (true);

CREATE POLICY community_profiles_owner_write ON community_profiles FOR ALL
    USING (user_id = current_user_uuid())
    WITH CHECK (user_id = current_user_uuid());
