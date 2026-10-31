-- ============================================================
-- Migration 010: Team chat (channels, membership, messages)
-- ============================================================
-- * Public channels are visible to every organisation member.
-- * Private channels are visible only to channel_members.
-- * Messages are written only by the API. `is_ai` is set only by the server when the
--   BizContext Copilot replies, so users cannot impersonate the bot.
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS channels (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name            VARCHAR(80) NOT NULL,                  -- normalised: lowercase, a-z 0-9 - _
    description     TEXT NOT NULL DEFAULT '',
    is_private      BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      UUID NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at     TIMESTAMPTZ,
    UNIQUE (organisation_id, name)
);

-- Ensure archived_at exists even if the table was created by a prior migration without it.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_channels_org_active
    ON channels (organisation_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS channel_members (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    added_by   UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members (user_id);

CREATE TABLE IF NOT EXISTS channel_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_id       UUID,                                   -- NULL for the AI copilot
    sender_name     VARCHAR(200) NOT NULL,
    is_ai           BOOLEAN NOT NULL DEFAULT FALSE,
    invoked_by      UUID,                                   -- who @-mentioned the copilot
    content         TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),
    metadata        JSONB,                                  -- e.g. { "sources": [...] } for AI replies
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_messages_channel_time
    ON channel_messages (channel_id, created_at DESC);

ALTER TABLE channels         ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_messages ENABLE ROW LEVEL SECURITY;
