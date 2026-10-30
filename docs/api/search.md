# Search API

Base path: `/api/v1/search`

## Endpoints

### POST /search/ask-second-brain

Queries the AI engine (pgvector embeddings + BM25 keyword index) to answer natural language questions about organizational data.

**Request Body**
```json
{
  "query": "What are our B3 browser approval rules?"
}
```

**Response**
```json
{
  "answer": "According to organizational documents...",
  "sources": [
    {
      "title": "Browser Agent Security Guidelines",
      "category": "Security Policy",
      "matchConfidence": 96.4,
      "link": "/knowledge"
    }
  ],
  "suggestedActions": [
    { "label": "View Browser Approval Queue", "actionType": "navigate", "payload": "/browser-jobs" }
  ]
}
```

**Error Responses**
- `400 Bad Request` – missing or empty `query`
- `500 Internal Server Error` – AI engine unavailable

---

### GET /search

Global keyword search across all resource types.

**Query Parameters**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | ✅ | — | Search query (min 1 character) |
| `scope` | string | ❌ | `all` | Filter type: `all`, `employees`, `knowledge`, `projects`, `tickets`, `meetings`, `files` |

**Response**
```json
{
  "results": [
    {
      "id": "emp-1",
      "type": "employee",
      "title": "Priya Sharma",
      "subtitle": "AI Research Lead",
      "url": "/directory",
      "matchScore": 0.92,
      "createdAt": "2026-10-01T10:00:00Z"
    }
  ],
  "totalCount": 1,
  "query": "Priya",
  "scope": "all"
}
```

**Error Responses**
- `400 Bad Request` – missing or empty `q`

---

## SearchResult Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique resource ID |
| `type` | string | `employee`, `knowledge`, `project`, `ticket`, `meeting`, or `file` |
| `title` | string | Primary display text |
| `subtitle` | string? | Secondary display text (role, status, date, etc.) |
| `url` | string | Frontend navigation path |
| `matchScore` | number? | Relevance score 0–1 |
| `createdAt` | string? | ISO 8601 creation timestamp |

---

## Frontend Integration

The frontend integrates search via two surfaces:

1. **Second Brain Modal** (`⌘K`) — "Ask AI" tab sends POST to `/search/ask-second-brain`; "Search" tab sends GET to `/search` with debounce
2. **Global search bar** in the top header of `AppShell` — opens the Second Brain Modal on click

The modal falls back to local mock-data search when the backend is offline (Demo Mode).
