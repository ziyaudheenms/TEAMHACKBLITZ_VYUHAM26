-- =============================================================================
-- Migration 006: Extended Meetings, Minutes & AI Action Items
-- =============================================================================
-- Extends:
--   • meetings             — adds duration, participants array, AI summary, deletion
-- Creates:
--   • meeting_action_items — individual actionable tasks extracted from minutes
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Alter meetings table
-- ---------------------------------------------------------------------------
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS duration_minutes   INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS participant_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS participant_names  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_summary         TEXT,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at         TIMESTAMPTZ;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_meetings_organisation_id
  ON meetings (organisation_id);

CREATE INDEX IF NOT EXISTS idx_meetings_project_id
  ON meetings (project_id);

CREATE INDEX IF NOT EXISTS idx_meetings_meeting_date
  ON meetings (meeting_date DESC);

-- ---------------------------------------------------------------------------
-- meeting_action_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_action_items (
  id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id          UUID         NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  organisation_id     UUID         NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  title               VARCHAR(500) NOT NULL,
  assignee            VARCHAR(255) NOT NULL,
  assignee_id         UUID,
  due_date            VARCHAR(100),
  priority            VARCHAR(50)  NOT NULL DEFAULT 'medium',
  converted_to_task   BOOLEAN      NOT NULL DEFAULT FALSE,
  task_id             UUID         REFERENCES tasks(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_action_items_meeting_id
  ON meeting_action_items (meeting_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_meeting_action_items_organisation_id
  ON meeting_action_items (organisation_id);

CREATE INDEX IF NOT EXISTS idx_meeting_action_items_converted
  ON meeting_action_items (converted_to_task);
