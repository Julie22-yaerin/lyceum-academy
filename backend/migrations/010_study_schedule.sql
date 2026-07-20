-- Migration 010: Weekly study schedule + exercise pre-generation batch jobs
--
-- Backs the onboarding drag-and-drop weekly scheduler and the session-end
-- (sendBeacon) → APScheduler pre-generation pipeline.
--
-- Run: psql -f migrations/010_study_schedule.sql

CREATE TABLE IF NOT EXISTS schedule_blocks (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           VARCHAR(128) NOT NULL,
    day_of_week       INTEGER NOT NULL,
    start_minute      INTEGER NOT NULL,
    duration_minutes  INTEGER NOT NULL,
    subject_key       VARCHAR(64) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_blocks_user_id ON schedule_blocks(user_id);

CREATE TABLE IF NOT EXISTS exercise_batch_jobs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           VARCHAR(128) NOT NULL,
    subject_key       VARCHAR(64) NOT NULL,
    status            VARCHAR(16) NOT NULL DEFAULT 'queued',
    source            VARCHAR(16) NOT NULL DEFAULT 'session_end',
    result_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
    completed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exercise_batch_jobs_user_id ON exercise_batch_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_exercise_batch_jobs_status ON exercise_batch_jobs(status);
