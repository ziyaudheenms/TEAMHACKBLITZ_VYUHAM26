"""FastAPI routing endpoints for agent queries, tool execution, and streaming."""

import json
import logging
import uuid
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, Header, HTTPException, Request, status
from sse_starlette.sse import EventSourceResponse

from app.api.schemas import (
    AgentRunRequest,
    AgentRunResponse,
    HealthResponse,
    LiveOrbRequest,
    ToolInfo,
    ToolsListResponse,
)
from app.config import settings
from app.harness.context import HarnessContext
from app.harness.council import council_roster, stream_council
from app.harness.runner import run_harness, stream_harness
from app.harness.tools import ALL_HARNESS_TOOLS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["Agent Harness"])


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    """Extracts bearer token from Authorization header if present."""
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return authorization


@router.post("/agent/run", response_model=AgentRunResponse)
async def run_agent(
    payload: AgentRunRequest,
    authorization: Optional[str] = Header(None),
) -> AgentRunResponse:
    """Executes an AI query through the Pydantic AI Harness.
    
    The backend calls this endpoint whenever a user query or agent execution is triggered.
    The harness runs with Gemini and queries the backend Second Brain for relevant data.
    """
    token = _extract_bearer_token(authorization)
    conversation_id = payload.conversation_id or str(uuid.uuid4())

    context = HarnessContext(
        user_id=payload.user_id,
        organisation_id=payload.organisation_id,
        conversation_id=conversation_id,
        auth_token=token,
        agent_id=payload.agent_id,
        agent_role=payload.agent_role or "general_assistant",
        allowed_tools=payload.allowed_tools,
        extra_metadata=payload.metadata or {},
    )

    chat_history_list = None
    if payload.chat_history:
        chat_history_list = [
            {"role": msg.role, "content": msg.content} for msg in payload.chat_history
        ]

    result = await run_harness(
        prompt=payload.prompt,
        context=context,
        chat_history=chat_history_list,
        custom_system_prompt=payload.system_prompt,
    )

    return AgentRunResponse(
        response=result.response,
        citations=result.citations,
        tool_calls=result.tool_calls,
        conversation_id=result.conversation_id,
        agent_id=result.agent_id,
        usage=result.usage,
        created_at=result.created_at,
    )


@router.post("/agent/stream")
async def stream_agent(
    payload: AgentRunRequest,
    authorization: Optional[str] = Header(None),
):
    """Streams real-time token chunks and tool lifecycle events using Server-Sent Events (SSE)."""
    token = _extract_bearer_token(authorization)
    conversation_id = payload.conversation_id or str(uuid.uuid4())

    context = HarnessContext(
        user_id=payload.user_id,
        organisation_id=payload.organisation_id,
        conversation_id=conversation_id,
        auth_token=token,
        agent_id=payload.agent_id,
        agent_role=payload.agent_role or "general_assistant",
        allowed_tools=payload.allowed_tools,
        extra_metadata=payload.metadata or {},
    )

    chat_history_list = None
    if payload.chat_history:
        chat_history_list = [
            {"role": msg.role, "content": msg.content} for msg in payload.chat_history
        ]

    async def sse_event_generator() -> AsyncGenerator[dict, None]:
        async for item in stream_harness(
            prompt=payload.prompt,
            context=context,
            chat_history=chat_history_list,
            custom_system_prompt=payload.system_prompt,
        ):
            # Yield dicts: EventSourceResponse formats them. A pre-formatted string
            # would be wrapped again and every line prefixed with `data:`.
            yield {"event": item.get("event", "message"), "data": json.dumps(item.get("data", {}), default=str)}

    return EventSourceResponse(sse_event_generator())


@router.post("/agent/council/stream")
async def stream_council_route(
    payload: AgentRunRequest,
    authorization: Optional[str] = Header(None),
):
    """Runs the Agent Council (Knowledge | Researcher | Browser in parallel, then CEO decision) over SSE."""
    context = HarnessContext(
        user_id=payload.user_id,
        organisation_id=payload.organisation_id,
        conversation_id=payload.conversation_id or str(uuid.uuid4()),
        auth_token=_extract_bearer_token(authorization),
        allowed_tools=payload.allowed_tools,
        extra_metadata=payload.metadata or {},
    )
    history = [{"role": m.role, "content": m.content} for m in payload.chat_history] if payload.chat_history else None
    return EventSourceResponse(stream_council(payload.prompt, context, history))


@router.get("/agent/council")
async def council_info():
    """Describes the council roster."""
    return {"agents": council_roster(), "parallel": ["knowledge", "researcher", "browser"], "final": "ceo"}


@router.post("/orb/respond", response_model=AgentRunResponse)
async def respond_from_orb(
    payload: LiveOrbRequest,
    authorization: Optional[str] = Header(None),
) -> AgentRunResponse:
    """Produces the orb's concise Gemini response without exposing its API key."""
    context = HarnessContext(
        user_id=payload.user_id,
        organisation_id=payload.organisation_id,
        conversation_id=payload.conversation_id or str(uuid.uuid4()),
        auth_token=_extract_bearer_token(authorization),
        agent_role="general_assistant",
    )
    result = await run_harness(
        prompt=payload.prompt,
        context=context,
        custom_system_prompt=(
            "You are BizContext's floating assistant. Respond in one or two concise, "
            "friendly sentences suitable for the small orb popover."
        ),
    )
    return AgentRunResponse(
        response=result.response,
        citations=result.citations,
        tool_calls=result.tool_calls,
        conversation_id=result.conversation_id,
        agent_id=result.agent_id,
        usage=result.usage,
        created_at=result.created_at,
    )


@router.get("/agent/tools", response_model=ToolsListResponse)
async def list_tools() -> ToolsListResponse:
    """Lists all tools available in the Pydantic AI Harness."""
    tools_list = []
    for tool_fn in ALL_HARNESS_TOOLS:
        name = getattr(tool_fn, "__name__", str(tool_fn))
        doc = getattr(tool_fn, "__doc__", "") or "No description provided."
        tools_list.append(
            ToolInfo(
                name=name,
                description=doc.strip().split("\n")[0],
            )
        )
    return ToolsListResponse(tools=tools_list)


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Returns the operational status and configuration of the AI Engine."""
    has_gemini = bool(settings.effective_gemini_api_key)
    return HealthResponse(
        status="ok",
        service="bizcontext-ai-engine",
        version="0.1.0",
        model=settings.effective_model_name,
        gemini_configured=has_gemini,
    )
