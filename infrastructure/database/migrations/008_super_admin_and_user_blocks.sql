-- ============================================================
-- Migration 008: Platform super admin support + user blocking
-- ============================================================
-- * user_blocks: one row per blocked auth user. The API checks this table on
--   every authenticated request, so a block takes effect immediately instead of
--   waiting for the user's access token to expire.
-- * audit_logs.organisation_id becomes nullable so platform-level actions
--   (blocking a user, creating an organisation) can be recorded.
--
-- The super admin flag itself lives in Supabase Auth `app_metadata.is_super_admin`
-- (writable only with the service-role key), set by `bun run seed:admin`.
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_blocks (
    user_id     UUID PRIMARY KEY,                 -- Supabase auth.users.id
    reason      TEXT,
    blocked_by  UUID NOT NULL,
    blocked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deny all access through the public (anon / authenticated) PostgREST roles.
-- The API uses the service-role key, which bypasses RLS.
ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;

ALTER TABLE audit_logs ALTER COLUMN organisation_id DROP NOT NULL;
