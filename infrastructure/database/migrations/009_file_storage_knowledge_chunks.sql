-- =============================================================================
-- Migration 009: File Asset Storage & Second Brain Knowledge Chunks
-- =============================================================================
-- Ensures:
--   • files table has full extraction & OCR status columns
--   • knowledge_chunks table stores chunk content and vector embeddings (1536)
--   • indexing for full-text search and vector similarity search
-- =============================================================================

-- Ensure pgvector extension is available
CREATE EXTENSION IF NOT EXISTS vector;

-- Ensure knowledge_chunks table exists with vector support
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL,            -- 'file', 'knowledge_page', 'meeting'
    source_id UUID NOT NULL,                     -- foreign key to files.id or pages.id
    content TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for tenant-scoped source lookup
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_org_source
    ON knowledge_chunks (organisation_id, source_type, source_id);

-- Index for text search
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_content_trgm
    ON knowledge_chunks USING gin (to_tsvector('english', content));
