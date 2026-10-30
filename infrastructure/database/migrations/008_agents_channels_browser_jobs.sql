-- 008_agents_channels_browser_jobs.sql

-- Extend agents table with more fields
ALTER TABLE agents ADD COLUMN IF NOT EXISTS role          VARCHAR(150);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS allowed_tools TEXT[];
ALTER TABLE agents ADD COLUMN IF NOT EXISTS allowed_domains TEXT[];
ALTER TABLE agents ADD COLUMN IF NOT EXISTS total_executions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS success_rate DECIMAL(5,2) NOT NULL DEFAULT 0.0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS created_by   UUID;

-- Extend browser_jobs with evidence and steps
ALTER TABLE browser_jobs ADD COLUMN IF NOT EXISTS steps JSONB DEFAULT '[]';
ALTER TABLE browser_jobs ADD COLUMN IF NOT EXISTS evidence_urls TEXT[] DEFAULT '{}';
ALTER TABLE browser_jobs ADD COLUMN IF NOT EXISTS output_summary TEXT;
ALTER TABLE browser_jobs ADD COLUMN IF NOT EXISTS approval_request JSONB;

-- Chat channels
CREATE TABLE IF NOT EXISTS channels (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    is_private      BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_channel_name_org UNIQUE (organisation_id, name)
);

-- Channel members
CREATE TABLE IF NOT EXISTS channel_members (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, user_id)
);

-- Chat messages
CREATE TABLE IF NOT EXISTS channel_messages (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_id   UUID NOT NULL,
    sender_name VARCHAR(200) NOT NULL,
    is_ai       BOOLEAN NOT NULL DEFAULT FALSE,
    content     TEXT NOT NULL,
    reactions   JSONB DEFAULT '[]',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON channel_messages(channel_id, created_at ASC);

-- Seed default channels for existing organisations
INSERT INTO channels (organisation_id, name, description, is_private)
SELECT id, 'general', 'General discussion for the whole team', FALSE
FROM organisations
WHERE NOT EXISTS (
    SELECT 1 FROM channels c WHERE c.organisation_id = organisations.id AND c.name = 'general'
);

INSERT INTO channels (organisation_id, name, description, is_private)
SELECT id, 'engineering', 'Engineering team channel', FALSE
FROM organisations
WHERE NOT EXISTS (
    SELECT 1 FROM channels c WHERE c.organisation_id = organisations.id AND c.name = 'engineering'
);
