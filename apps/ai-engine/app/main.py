"""BizContext AI Engine - Service Entry Point.

FastAPI service implementing the Pydantic AI Harness, Second Brain retrieval,
backend tool execution, and real-time agent orchestration with Google Gemini.
"""

from contextlib import asynccontextmanager
import logging
import os
from typing import Dict, Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Suppress banner in production logs if not set
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

from app.api.routes import router as api_router
from app.api.extract_routes import router as extract_router
from app.client.backend_client import backend_client_instance
from app.config import settings

# Configure logging
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ai_engine")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for service startup and shutdown."""
    logger.info("Starting BizContext AI Engine service...")
    logger.info("Backend API target: %s", settings.backend_api_base_url)
    logger.info("Configured Gemini model: %s", settings.effective_model_name)
    logger.info("Gemini API key configured: %s", bool(settings.effective_gemini_api_key))

    # Pre-initialize HTTP client
    await backend_client_instance.get_client()

    yield

    # Cleanup connections on shutdown
    logger.info("Shutting down BizContext AI Engine service...")
    await backend_client_instance.close()


app = FastAPI(
    title="BizContext AI Engine",
    description=(
        "Pydantic AI Harness service for BizContext. "
        "Orchestrates Gemini agents, Second Brain knowledge retrieval, and backend action tools."
    ),
    version="0.2.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routes
app.include_router(api_router)
app.include_router(extract_router)


@app.get("/", tags=["Discovery"])
async def root() -> Dict[str, Any]:
    """Root endpoint declaring service capabilities and endpoints."""
    return {
        "service": "bizcontext-ai-engine",
        "description": "Pydantic AI Harness with Gemini for Business Second Brain",
        "version": "0.2.0",
        "endpoints": {
            "agent_run": "/api/v1/agent/run",
            "agent_stream": "/api/v1/agent/stream",
            "orb_respond": "/api/v1/orb/respond",
            "agent_tools": "/api/v1/agent/tools",
            "health": "/api/v1/health",
        },
        "capabilities": [
            "pydantic-ai-harness",
            "gemini-provider",
            "second-brain-hybrid-retrieval",
            "backend-tool-dispatch",
            "action-execution-guardrails",
            "source-grounded-citations",
            "sse-streaming",
        ],
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", os.getenv("AI_ENGINE_PORT", str(settings.ai_engine_port))))
    host = os.getenv("HOST", os.getenv("AI_ENGINE_HOST", settings.ai_engine_host))
    uvicorn.run("app.main:app", host=host, port=port)

