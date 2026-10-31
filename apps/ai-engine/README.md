# BizContext AI - AI Engine Service

Python / FastAPI service implementing the **Pydantic AI Intelligence Harness** with **Google Gemini**.

## Key Capabilities

- **Pydantic AI Harness:** High-performance typed agent orchestration (`Agent[HarnessContext, str]`) powered by Gemini (`gemini-2.5-flash` or configurable model).
- **Second Brain Tool Integration:** The harness queries the backend Second Brain for knowledge pages, documents, meeting minutes, project status, employee skills, and operational tickets.
- **Backend Action Tools:** Automatically invokes backend endpoints to create tasks, update task states, create tickets, and dispatch browser worker jobs.
- **Strict Multi-Tenancy & Citations:** Injects `user_id`, `organisation_id`, and auth tokens into backend calls; captures source citations and tool execution traces.
- **Real-Time Streaming:** Server-Sent Events (SSE) streaming endpoint for live token generation and tool lifecycle monitoring.

## Architecture & Directory Layout

```
apps/ai-engine/
├── app/
│   ├── api/
│   │   ├── routes.py          # /api/v1/agent/run, /stream, /tools, /health
│   │   └── schemas.py         # Pydantic request and response schemas
│   ├── client/
│   │   └── backend_client.py  # Asynchronous HTTP client for querying backend Second Brain & tools
│   ├── harness/
│   │   ├── agents.py          # Pydantic AI Agent factory with dynamic prompt injection
│   │   ├── context.py         # HarnessContext dependency container & citation tracking
│   │   ├── models.py          # Gemini provider & model initialization
│   │   ├── runner.py          # Execution engine (sync & SSE streaming)
│   │   └── tools.py           # Second Brain & Backend action tools
│   ├── config.py              # Configuration & environment variables
│   └── main.py                # FastAPI app entry point & lifecycle
├── plan/
│   ├── BACKEND_INTEGRATION.md # Comprehensive guide for integrating apps/api with the AI Engine
│   └── README.md
├── requirements.txt
└── README.md
```

## Setup & Running

```bash
cd apps/ai-engine
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run service on port 8000
uvicorn app.main:app --port 8000 --reload
```

## Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Google Gemini API key | None |
| `GEMINI_MODEL` | Gemini model name | `gemini-2.5-flash` |
| `BACKEND_API_BASE_URL` | Backend Hono API base URL | `http://localhost:3001` |
| `BACKEND_SERVICE_TOKEN` | Service-to-service bearer token | None |
| `WEB_ALLOWED_DOMAINS` | Optional comma-separated allow-list for public pages opened by the browser tools | Any public host |
| `AI_ENGINE_PORT` | Port for the AI Engine | `8000` |
| `AI_ENGINE_HOST` | Host address | `0.0.0.0` |

Public web research uses Bing's RSS search endpoint first and DuckDuckGo's static
HTML endpoint as a fallback. Both are read-only and no provider credentials are
required. If one provider rate-limits or presents a bot challenge, the engine
automatically tries the other provider before reporting a search failure.

## Backend Integration Guide

For detailed instructions, sequence diagrams, and copy-paste ready TypeScript/Hono code to integrate the backend with this service, refer to [**plan/BACKEND_INTEGRATION.md**](./plan/BACKEND_INTEGRATION.md).
