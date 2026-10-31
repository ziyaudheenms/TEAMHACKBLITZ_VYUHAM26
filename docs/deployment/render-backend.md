# Deploying Backend to Render (`@bizcontext/api`)

This guide explains how to deploy the BizContext AI backend (`apps/api`) to [Render](https://render.com).

---

## Deployment Options Overview

| Method | Recommended For | Setup Time | Notes |
| :--- | :--- | :--- | :--- |
| **Option 1: Blueprint (`render.yaml`)** | **Fastest & Automated** | 2 minutes | Auto-configures Docker, health check, and environment variables |
| **Option 2: Docker Web Service** | **Manual UI Setup** | 3 minutes | Uses official lightweight `oven/bun` container |
| **Option 3: Native Web Service** | **Non-Docker (Node/Bun)** | 4 minutes | Installs Bun via shell script in build command |

---

## Option 1: One-Click Blueprint Deployment (Recommended)

Render natively supports `render.yaml` Blueprints located at your repository root.

1. Push your repository to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com/), click **New +** > **Blueprint**.
3. Connect your repository (`TEAMHACKBLITZ_VYUHAM26`).
4. Render will automatically parse `render.yaml` and prompt you for the required environment variables.
5. Fill in your environment variables (see [Environment Variables Reference](#environment-variables-reference) below) and click **Apply**.

---

## Option 2: Manual Docker Web Service

1. Go to the [Render Dashboard](https://dashboard.render.com/) and click **New +** > **Web Service**.
2. Connect your Git repository.
3. Configure the following fields:
   - **Name**: `bizcontext-api`
   - **Region**: Oregon (or your preferred region closest to Supabase)
   - **Branch**: `main` (or your active branch)
   - **Root Directory**: leave blank (defaults to repository root)
   - **Runtime**: **Docker**
   - **Dockerfile Path**: `./Dockerfile` (or `./apps/api/Dockerfile`)
   - **Docker Context**: `.`
4. In **Advanced Settings**:
   - **Health Check Path**: `/health`
   - **Auto-Deploy**: `Yes`
5. Add the environment variables listed below, then click **Create Web Service**.

---

## Option 3: Manual Native Web Service (Node/Bun without Docker)

If you prefer using Render's native Linux environment instead of Docker:

1. Click **New +** > **Web Service** in Render.
2. Configure:
   - **Name**: `bizcontext-api`
   - **Runtime**: **Node**
   - **Root Directory**: leave blank (monorepo root)
   - **Build Command**:
     ```bash
     curl -fsSL https://bun.sh/install | bash && export PATH="$HOME/.bun/bin:$PATH" && bun install
     ```
   - **Start Command**:
     ```bash
     export PATH="$HOME/.bun/bin:$PATH" && bun apps/api/src/index.ts
     ```
   - **Health Check Path**: `/health`

---

## Environment Variables Reference

Configure these in the Render Dashboard under **Environment**:

| Variable | Required | Description | Example / Source |
| :--- | :---: | :--- | :--- |
| `PORT` | Auto | Injected automatically by Render (default 10000). The server dynamically binds to it. | `10000` |
| `HOST` | Yes | Network interface to bind to | `0.0.0.0` |
| `NODE_ENV` | Yes | Application environment | `production` |
| `SUPABASE_URL` | **Yes** | Your Supabase project URL | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | **Yes** | Supabase anonymous / public key | `eyJhbGci...` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Supabase Service Role secret key | `eyJhbGci...` |
| `SUPABASE_JWT_SECRET` | **Yes** | Supabase JWT Secret for token verification | `your-jwt-secret` |
| `DATABASE_URL` | Optional | Direct Postgres connection string (if using direct queries) | `postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres` |
| `CORS_ORIGIN` | **Yes** | Allowed frontend origin(s), comma-separated | `https://your-app.vercel.app,http://localhost:3000` |
| `OPENAI_API_KEY` | Optional | API key for OpenAI LLM models | `sk-...` |
| `GEMINI_API_KEY` | Optional | API key for Google Gemini models | `AIza...` |
| `ANTHROPIC_API_KEY` | Optional | API key for Anthropic Claude models | `sk-ant-...` |

---

## Connecting the Frontend (Vercel) to your Render Backend

Once Render finishes deploying, your service URL will look like:
`https://bizcontext-api.onrender.com`

1. Go to your frontend project settings in **Vercel** (or local `.env.production`):
   - Set `NEXT_PUBLIC_API_URL`:
     ```env
     NEXT_PUBLIC_API_URL=https://bizcontext-api.onrender.com/api/v1
     ```
2. In your Render Dashboard under **Environment**:
   - Update `CORS_ORIGIN` to include your Vercel deployment URL:
     ```env
     CORS_ORIGIN=https://your-frontend.vercel.app
     ```
3. Test the deployment:
   ```bash
   curl https://bizcontext-api.onrender.com/health
   # Response: {"status":"ok","version":"0.1.0","service":"bizcontext-api","timestamp":"..."}
   ```
