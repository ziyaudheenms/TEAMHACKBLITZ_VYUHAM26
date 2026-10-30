-- ============================================================
-- Migration 009: Employee invitations (single-use, per-person links)
-- ============================================================
-- An org admin invites ONE specific person. The API creates an inactive account
-- (banned until accepted) with a password chosen by the organisation, and returns a
-- link containing a random token. Only the SHA-256 hash of the token is stored, so a
-- database leak does not leak usable links. The org-chosen password is never stored.
-- Opening the link activates the account, joins the organisation and creates the
-- people-directory profile.
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_invitations (
    id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id           UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,

    -- Who is being invited
    email                     VARCHAR(254) NOT NULL,
    first_name                VARCHAR(100) NOT NULL,
    last_name                 VARCHAR(100) NOT NULL DEFAULT '',
    role                      VARCHAR(20)  NOT NULL DEFAULT 'member'
                                  CHECK (role IN ('owner', 'admin', 'member', 'guest')),
    designation               VARCHAR(150),
    department_id             UUID REFERENCES departments(id) ON DELETE SET NULL,

    -- Link security
    token_hash                CHAR(64) NOT NULL UNIQUE,           -- sha256 hex of the link token
    expires_at                TIMESTAMPTZ NOT NULL,

    -- The Supabase auth user this invitation activates / attaches
    user_id                   UUID NOT NULL,
    account_created_by_invite BOOLEAN NOT NULL DEFAULT FALSE,     -- true: inactive account made for this invite

    status                    VARCHAR(20) NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
    invited_by                UUID NOT NULL,
    accepted_at               TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One live invitation per person per organisation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_pending_email
    ON employee_invitations (organisation_id, lower(email))
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_invitations_org_status
    ON employee_invitations (organisation_id, status, created_at DESC);

-- Reachable only through the API (service-role key bypasses RLS).
ALTER TABLE employee_invitations ENABLE ROW LEVEL SECURITY;
