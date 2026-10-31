# Deploying Backend & AI Agent Engine to Render

BizContext AI features **two interconnected backend services**:

1. **`bizcontext-api` (`apps/api`)**: The core Node/Bun/Hono API server handling database operations, auth, RBAC, workspaces, agent registry, and client requests.
2. **`bizcontext-ai-engine` (`apps/ai-engine`)**: The dedicated Python / FastAPI microservice running the **Pydantic AI Intelligence Harness** powered by **Google Gemini** (`gemini-2.5-flash`), second brain tool execution, and live streaming.

---

## Where is the AI Agent?

The AI Agent system spans two components:

1. **Agent Registry & Management (Inside `apps/api`)**:
   - Routes: `/api/v1/agents` and `/api/v1/agent-executions`
   - Frontend UI: Accessible at `/agents` in the web application
   - Manages agent personas, models, instructions, permissions, and tool whitelists.
2. **Autonomous Agent Execution Harness (Inside `apps/ai-engine`)**:
   - Location: [`apps/ai-engine/`](../../apps/ai-engine/)
   - Code: [`apps/ai-engine/app/harness/agents.py`](../../apps/ai-engine/app/harness/agents.py) & [`runner.py`](../../apps/ai-engine/app/harness/runner.py)
   - Performs LLM inference with Gemini, queries Second Brain knowledge, triggers actions (create tasks, assign tickets), and streams responses.
3. **How They Communicate**:
   - When users query the AI or invoke agents, `apps/api` proxies requests to `AI_ENGINE_URL` (`POST /api/v1/agent/run`, `/stream`, `/live-orb`).
   - The AI Engine calls back into `BACKEND_API_BASE_URL` to search knowledge pages, employees, and execute task actions.

---

## Deploying Both Services to Render

### Option 1: 1-Click Blueprint (Deploys API + AI Engine Together)

The repository root includes a [`render.yaml`](../../render.yaml) blueprint that configures both services and connects them automatically:

1. In the [Render Dashboard](https://dashboard.render.com/), click **New +** > **Blueprint**.
2. Select this repository.
3. Render automatically sets up:
   - `bizcontext-api` (Port 10000, Docker)
   - `bizcontext-ai-engine` (Port 8000, Docker)
   - Automatic internal networking (`AI_ENGINE_URL` and `BACKEND_API_BASE_URL` are linked)
4. Provide your keys:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
   - `GEMINI_API_KEY` (Get from [Google AI Studio](https://aistudio.google.com/))
5. Click **Apply**.

---

### Option 2: Deploy AI Engine Manually as a Render Web Service

If you already created `bizcontext-api` on Render and want to add `bizcontext-ai-engine`:

1. Click **New +** > **Web Service**.
2. Connect this repository.
3. Configure the AI Engine:
   - **Name**: `bizcontext-ai-engine`
   - **Runtime**: **Docker**
   - **Dockerfile Path**: `./apps/ai-engine/Dockerfile`
   - **Docker Context**: `./apps/ai-engine`
   - **Health Check Path**: `/api/v1/health`
4. Set Environment Variables:
   | Variable | Value |
   | :--- | :--- |
   | `PORT` | `8000` |
   | `HOST` | `0.0.0.0` |
   | `GEMINI_API_KEY` | Your Google Gemini API Key |
   | `GEMINI_MODEL` | `gemini-2.5-flash` |
   | `BACKEND_API_BASE_URL` | Your deployed backend URL (`https://bizcontext-api.onrender.com`) |
5. Click **Create Web Service**.
6. In your **`bizcontext-api`** service settings on Render, add:
   ```env
   AI_ENGINE_URL=https://bizcontext-ai-engine.onrender.com
   ```
