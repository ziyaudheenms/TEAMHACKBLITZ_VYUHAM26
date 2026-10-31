# API Specifications

API routes follow RESTful conventions under `/api/v1/*`.

## Endpoint Groups & Detailed Specifications
- `/api/v1/auth` - Authentication & sessions
- `/api/v1/organisations` - Org hierarchy & management
- `/api/v1/departments` - Department configuration
- `/api/v1/employees` - Employee directory & CV processing
- [`/api/v1/employee-documents`](./employee-documents.md) - CVs, certificates, portfolios
- `/api/v1/knowledge/pages` - Notion-like block pages
- [`/api/v1/files`](./files.md) - Asset storage & presigned URLs
- `/api/v1/projects` - Projects & milestones
- `/api/v1/tasks` - Task management & reviews
- [`/api/v1/tickets`](./tickets.md) - Internal ticketing & SLA
- [`/api/v1/meetings`](./meetings.md) - Meeting notes, OCR minutes, AI summaries & action items
- `/api/v1/notifications` - In-app alerts & preferences
- `/api/v1/agents` - Agent registry & configuration
- `/api/v1/agent-executions` - Agent invocation & logs

- `/api/v1/integrations` - Third-party connectors
- [`/api/v1/search`](./search.md) - Hybrid keyword + vector search
- `/api/v1/analytics` - System & operational analytics

## Global Contracts
- [Frontend-to-Backend API Contract](./FRONTEND_API_CONTRACT.md)
