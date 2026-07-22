-- Migration 011: Admin-curated content catalog + Coach AI daily selection
--
-- Backs the global WorkspaceCatalog students browse/join at onboarding (in
-- place of free-text subject entry), the admin-authored CatalogItems within
-- each workspace, and the ServedMaterial log the Coach writes to so a
-- student's "Today" vs "Already Studied" materials are stable across visits.
--
-- Run: psql -f migrations/011_content_catalog.sql

CREATE TABLE IF NOT EXISTS workspace_catalog (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title         VARCHAR(255) NOT NULL,
    subject_key   VARCHAR(64) NOT NULL,
    field         VARCHAR(32) NOT NULL,
    description   TEXT,
    is_published  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalog_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   UUID NOT NULL REFERENCES workspace_catalog(id) ON DELETE CASCADE,
    concept_name   VARCHAR(255) NOT NULL,
    item_type      VARCHAR(32) NOT NULL,
    title          VARCHAR(255) NOT NULL,
    content        JSONB NOT NULL DEFAULT '{}'::jsonb,
    ordinal        INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_items_workspace_id ON catalog_items(workspace_id);
CREATE INDEX IF NOT EXISTS idx_catalog_items_ordinal ON catalog_items(workspace_id, ordinal);

CREATE TABLE IF NOT EXISTS served_materials (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           VARCHAR(128) NOT NULL,
    workspace_id      UUID NOT NULL REFERENCES workspace_catalog(id) ON DELETE CASCADE,
    catalog_item_id   UUID NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
    served_date       DATE NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_served_materials_user_workspace ON served_materials(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_served_materials_served_date ON served_materials(served_date);
