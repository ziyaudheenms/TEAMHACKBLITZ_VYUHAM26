# BizContext AI

**An AI-powered Business Second Brain and Organisational Operating Workspace.**

BizContext AI is a unified workspace that helps an organisation remember what it knows, understand what is happening, coordinate its people, and act on work with permissioned browser-capable AI agents.

---

## Architecture & Monorepo Structure

```text
bizcontext-ai/
├── apps/
│   ├── web/                    # Next.js 14 App Router, React, TypeScript
│   ├── api/                    # Hono API server running on Bun
│   └── ai-engine/              # FastAPI: RAG, CV extraction, meeting action items
│
├── packages/
│   ├── ui/                     # Shared UI component primitives & tokens
│   ├── database/               # Database client, migrations, RLS helpers
│   ├── auth/                   # Supabase Auth & JWT token utilities
│   ├── permissions/            # Resource access policy engine & B0-B4 levels
│   ├── types/                  # Shared domain types & interfaces
│   ├── agent-sdk/              # Agent contracts, tool schemas, orchestrator client
│   ├── integrations/           # Third-party connector interfaces (Slack, Drive, etc.)
│   └── validation/             # Shared Zod validation schemas
│
├── modules/
│   ├── organisations/          # Organisations, companies, departments, teams
│   ├── employees/              # Employee directory, CV parsing, people intelligence
│   ├── knowledge/              # Notion-style knowledge workspace, block pages
│   ├── storage/                # Asset storage, previews, presigned URLs
│   ├── communication/          # Slack-style channels, direct messages, threads
│   ├── projects/               # Projects, milestones, progress
│   ├── tasks/                  # Tasks, subtasks, reviews, assignments
│   ├── tickets/                # Internal ticketing, categories, SLA tracking
│   ├── meetings/               # Meeting hub, minutes, OCR, AI action-item extraction
│   ├── notifications/          # Notification centre, real-time alerts, calendar
│   ├── agents/                 # Central agent registry, lifecycle, and review
│   ├── analytics/              # Project health, SLA metrics, agent reliability
│   └── administration/         # Role definitions, organisation settings, audit logs
│
├── workers/
│   ├── ingestion/              # Document parsing, OCR, text extraction
│   ├── embeddings/             # Chunking and vector embedding generation
│   ├── integrations-sync/      # Background connector synchronization
│   ├── notifications/          # Asynchronous email and webhook dispatching
│   └── scheduled-jobs/         # SLA escalation, recurring tasks, cron jobs
│
├── infrastructure/
│   ├── docker/                 # Docker Compose (Postgres+pgvector, Redis, MinIO)
│   ├── database/               # SQL migrations and seed data
│   ├── deployment/             # Deployment configurations
│   └── monitoring/             # Monitoring and logging configurations
│
└── docs/
    ├── architecture/           # Architecture overviews and ADRs
    ├── api/                    # REST API endpoint specifications
    ├── security/               # Isolation, RLS, browser safety, threat model
    └── implementation/         # Phased implementation roadmap & checklists
```

---

## Tooling & Standards

- **Runtime & Package Manager:** [Bun](https://bun.com/)
- **Linter:** [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) (Extremely fast Rust-based linter)
- **Formatter & Code Hygiene:** [Biome](https://biomejs.dev/)

### Common Commands

```bash
# Install all dependencies across workspaces
bun install

# Lint all code with Oxlint
bun run lint

# Format code with Biome
bun run format

# Check formatting and linting with Biome
bun run check

# Type check across workspaces
bun run typecheck

# Start local infrastructure (Postgres with pgvector, Redis, MinIO)
cd infrastructure/docker && docker compose up -d
```
