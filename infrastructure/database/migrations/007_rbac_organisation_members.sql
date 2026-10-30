-- ============================================================
-- Migration 007: RBAC hardening, agents/browser-jobs columns
-- ============================================================
-- Additive migration. organisation_members is created in 002 and
-- audit_logs in 003; this migration extends them and adds the
-- columns the agents / browser-jobs API routes rely on.
-- Safe to re-run.
-- ============================================================

-- ---------------------------------------------------------------
-- organisation_members: enforce valid roles, track invites
-- ---------------------------------------------------------------
ALTER TABLE organisation_members
    ADD COLUMN IF NOT EXISTS invited_by UUID,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Normalise any legacy values before adding the constraint
UPDATE organisation_members
   SET role = 'member'
 WHERE role NOT IN ('owner', 'admin', 'member', 'guest');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'organisation_members_role_check'
    ) THEN
        ALTER TABLE organisation_members
            ADD CONSTRAINT organisation_members_role_check
            CHECK (role IN ('owner', 'admin', 'member', 'guest'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_org_members_org_id
    ON organisation_members (organisation_id) WHERE left_at IS NULL;

-- Backfill: anyone with an employee profile in an org becomes a member.
INSERT INTO organisation_members (organisation_id, user_id, role)
SELECT DISTINCT ON (organisation_id, user_id) organisation_id, user_id, 'member'
  FROM employee_profiles
 WHERE deleted_at IS NULL
ON CONFLICT (organisation_id, user_id) DO NOTHING;

-- Every org must have an owner: promote the earliest member of any org without one.
UPDATE organisation_members m
   SET role = 'owner'
  FROM (
        SELECT DISTINCT ON (organisation_id) id, organisation_id
          FROM organisation_members
         WHERE left_at IS NULL
         ORDER BY organisation_id, joined_at ASC
       ) first_member
 WHERE m.id = first_member.id
   AND NOT EXISTS (
        SELECT 1 FROM organisation_members o
         WHERE o.organisation_id = m.organisation_id
           AND o.role = 'owner' AND o.left_at IS NULL
       );

-- ---------------------------------------------------------------
-- audit_logs: allow agent/system actors and non-resource events
-- ---------------------------------------------------------------
ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS actor_type VARCHAR(20) DEFAULT 'user';

ALTER TABLE audit_logs ALTER COLUMN resource_type DROP NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN resource_id   DROP NOT NULL;

-- ---------------------------------------------------------------
-- agents: columns used by /api/v1/agents
-- ---------------------------------------------------------------
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS role             VARCHAR(100),
    ADD COLUMN IF NOT EXISTS allowed_domains  TEXT[]  DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS created_by       UUID,
    ADD COLUMN IF NOT EXISTS total_executions INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS success_rate     NUMERIC(5,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_agents_org ON agents (organisation_id);

-- ---------------------------------------------------------------
-- browser_jobs: columns used by /api/v1/browser-jobs
-- ---------------------------------------------------------------
ALTER TABLE browser_jobs
    ADD COLUMN IF NOT EXISTS steps            JSONB  DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS evidence_urls    TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS output_summary   TEXT,
    ADD COLUMN IF NOT EXISTS approval_request JSONB;

-- Jobs dispatched by the AI engine may not reference a registered agent.
ALTER TABLE browser_jobs ALTER COLUMN agent_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_browser_jobs_org_status
    ON browser_jobs (organisation_id, status);

-- ---------------------------------------------------------------
-- Helper view: active member roles per org
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW active_org_members AS
    SELECT m.id, m.organisation_id, m.user_id, m.role, m.joined_at,
           o.name AS organisation_name
      FROM organisation_members m
      JOIN organisations o ON o.id = m.organisation_id
     WHERE m.left_at IS NULL;
