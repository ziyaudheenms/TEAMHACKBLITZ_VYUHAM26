# BizContext AI - Web Application

High-performance, spatial enterprise frontend for BizContext AI built with **Next.js 14 App Router**, **TypeScript**, and **Tailwind CSS**.

## Architecture & Features

This application implements the full frontend specification defined in `IMPLEMENTATION.md`:

1. **Second Brain Command Center (`/`)**:
   - Cross-module health overview (Projects, Urgent Tickets, Browser Jobs, Knowledge Corpus).
   - Omnipresent **Ask Second Brain (Cmd+K)** hybrid retrieval modal with semantic source citations and confidence scores.
   - Live audit trail activity feed.

2. **Knowledge Workspace (`/knowledge`)**:
   - Notion-style hierarchical document browser & markdown reader/editor.
   - Permission scoping (Public, Internal, Restricted).
   - AI Key Insights extractor synthesizing organizational memory.

3. **Projects & Kanban Operations (`/projects`)**:
   - Project progress tracking, milestone velocity, and multi-project filtering.
   - Interactive 5-column Kanban board (`Open`, `In Progress`, `In Review`, `Blocked`, `Done`).
   - Task creation modal with priority levels (`Urgent`, `High`, `Medium`, `Low`) and assignee selection.

4. **Tickets & SLA Dispatch (`/tickets`)**:
   - Category filtering (`Infrastructure`, `Access`, `IT`, `Dev`, `Design`, `HR`).
   - Dynamic SLA countdowns and breach warnings.
   - Full resolution discussion trail with real-time comment logging and status transitions.

5. **Meeting Minutes Hub & AI Action Items Extractor (`/meetings`)**:
   - Section 10.1 workflow: parses meeting transcripts and OCR logs.
   - AI extracts structured action items with assigned owners and deadlines.
   - One-click **"Convert to Task"** instantly syncs meeting action items directly into the Kanban project board.

6. **Communication & Channels (`/chat`)**:
   - Slack-inspired channels (`#general`, `#engineering`, `#agent-dev`, `#incident-response`).
   - Integrated **@BizContext** AI Copilot bot responding directly in-stream with grounded answers.

7. **People Intelligence & Employee Directory (`/directory`)**:
   - Searchable directory by verified skills, department, and role.
   - Detailed employee profile drawer with verified vs unverified skill matrix.
   - Section 10.2 workflow: **Interactive AI CV Extraction Studio** to upload and parse resumes into directory records.

8. **Specialized Agent Registry (`/agents`)**:
   - Registry of custom assistants (Second Brain Copilot, Autonomous Browser Worker, Meeting Secretary, CV Scanner).
   - Foundation model configuration, system instructions, and B0-B4 permission levels.
   - Egress domain whitelist management.

10. **Asset Storage & Presigned URLs (`/storage`)**:
    - Zero-trust asset catalog with byte sizes and MIME types.
    - Presigned URL download trigger.

11. **Operational Analytics & Audit Trail (`/analytics`)**:
    - SLA compliance metrics (98.4%), Average Resolution Time (1.4h), Agent Success Rate (97.6%), and pgvector latency (114ms).
    - Immutable cryptographic audit trail table.

12. **Organisation & API Settings (`/settings`)**:
    - Multi-tenant hierarchy management (Parent Org, Subsidiaries, Departments).
    - Real-time **API Backend Gateway Controller**: Live connection testing, ping diagnostics, and custom endpoint URL configuration.

---

## Backend API Connection & Resilient Fallback

The frontend includes a typed, unified API client (`src/services/api.ts`):
- Targets same-origin `/api/v1` on Vercel (or `process.env.NEXT_PUBLIC_API_URL` for an override).
- **Resilient Fallback Mode**: When the backend server is offline or being developed, the app seamlessly uses an interactive seed store with `localStorage` persistence.
- **Connection Indicator**: The top navigation bar displays a live indicator (🟢 Live Connected / 🟡 Demo Mode) with one-click ping testing.

## Getting Started

```bash
# Run development server
bun --cwd apps/web dev

# Production build
bun --cwd apps/web run build

# Start production server
bun --cwd apps/web start
```
