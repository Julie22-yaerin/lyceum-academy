-- Migration 009: Rename Pset/Problem → Playground/Exercise
-- Renames all tables, columns, constraints, and enum types from the old
-- pset/problem naming to the new playground/exercise naming.
--
-- Run: psql -f migrations/009_rename_pset_to_playground.sql

-- ── 1. Rename tables ────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS psets RENAME TO playgrounds;
ALTER TABLE IF EXISTS problems RENAME TO exercises;
ALTER TABLE IF EXISTS problem_concepts RENAME TO exercise_concepts;
ALTER TABLE IF EXISTS pset_shares RENAME TO playground_shares;

-- ── 2. Rename columns in playgrounds (was psets) ─────────────────────────────
-- No column renames needed (id, owner_id, asset_id, title, etc. stay the same)

-- ── 3. Rename columns in exercises (was problems) ────────────────────────────
ALTER TABLE IF EXISTS exercises RENAME COLUMN pset_id TO playground_id;

-- ── 4. Rename columns in exercise_concepts (was problem_concepts) ─────────────
ALTER TABLE IF EXISTS exercise_concepts RENAME COLUMN problem_id TO exercise_id;

-- ── 5. Rename columns in playground_shares (was pset_shares) ─────────────────
ALTER TABLE IF EXISTS playground_shares RENAME COLUMN pset_id TO playground_id;

-- ── 6. Rename columns in reasoning_trees ─────────────────────────────────────
ALTER TABLE IF EXISTS reasoning_trees RENAME COLUMN pset_id TO playground_id;
ALTER TABLE IF EXISTS reasoning_trees RENAME COLUMN problem_id TO exercise_id;

-- ── 7. Rename columns in attempts ────────────────────────────────────────────
ALTER TABLE IF EXISTS attempts RENAME COLUMN problem_id TO exercise_id;

-- ── 8. Rename columns in pdf_reports ─────────────────────────────────────────
ALTER TABLE IF EXISTS pdf_reports RENAME COLUMN pset_id TO playground_id;

-- ── 9. Rename columns in ai_analysis_jobs ────────────────────────────────────
ALTER TABLE IF EXISTS ai_analysis_jobs RENAME COLUMN pset_id TO playground_id;

-- ── 10. Rename columns in leaderboard_entries ────────────────────────────────
ALTER TABLE IF EXISTS leaderboard_entries RENAME COLUMN problems_completed TO exercises_completed;

-- ── 11. Rename columns in ux_metrics_snapshots ──────────────────────────────
ALTER TABLE IF EXISTS ux_metrics_snapshots RENAME COLUMN completed_psets TO completed_playgrounds;

-- ── 12. Rename constraints ──────────────────────────────────────────────────
-- Unique constraints (name-based, need explicit rename)
ALTER TABLE IF EXISTS exercises DROP CONSTRAINT IF EXISTS uq_problem_pset_ordinal;
ALTER TABLE IF EXISTS exercises ADD CONSTRAINT uq_exercise_playground_ordinal UNIQUE (playground_id, ordinal);

ALTER TABLE IF EXISTS exercise_concepts DROP CONSTRAINT IF EXISTS uq_problem_concept;
ALTER TABLE IF EXISTS exercise_concepts ADD CONSTRAINT uq_exercise_concept UNIQUE (exercise_id, concept_id);

-- ── 13. Rename indexes that reference old column names ──────────────────────
-- Drop and recreate indexes that referenced renamed columns
DROP INDEX IF EXISTS idx_reasoning_trees_pset_id;
CREATE INDEX IF NOT EXISTS idx_reasoning_trees_playground_id ON reasoning_trees(playground_id);

DROP INDEX IF EXISTS idx_reasoning_trees_problem_id;
CREATE INDEX IF NOT EXISTS idx_reasoning_trees_exercise_id ON reasoning_trees(exercise_id);

DROP INDEX IF EXISTS idx_attempts_problem_id;
CREATE INDEX IF NOT EXISTS idx_attempts_exercise_id ON attempts(exercise_id);

-- ── 14. Rename enum types ──────────────────────────────────────────────────
-- PostgreSQL enum types can't be renamed directly; we need to:
--   a. Create new enum type
--   b. Alter column to use new type
--   c. Drop old enum type
-- Note: This only works if no other objects depend on the old type.
-- If the enum type rename fails (e.g. due to dependencies), the column
-- still stores the correct string values — SQLAlchemy handles the mapping.

DO $$
BEGIN
    -- Rename PsetStatusEnum → PlaygroundStatusEnum
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'psetstatusenum') THEN
        ALTER TYPE psetstatusenum RENAME TO playgroundstatusenum;
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- If rename fails (e.g. type doesn't exist or has dependencies), continue
    RAISE NOTICE 'Could not rename psetstatusenum: %', SQLERRM;
END $$;
