"""API schemas for BizContext AI Engine."""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from app.harness.context import Citation, ToolExecutionRecord


class ChatMessage(BaseModel):
    """Single message in conversation history."""
    role: str = Field(..., description="'user' | 'assistant' | 'system'")
    content: str = Field(..., description="Message text content")


class AgentRunRequest(BaseModel):
    """Payload sent by the Backend when an AI query is triggered."""
    prompt: str = Field(..., description="User prompt or instruction to execute")
    user_id: str = Field(..., description="ID of the user making the request")
    organisation_id: str = Field(..., description="Tenant organisation ID for boundary isolation")
    conversation_id: Optional[str] = Field(None, description="Unique conversation or thread ID")
    agent_id: Optional[str] = Field(None, description="Optional agent registry ID")
    agent_role: Optional[str] = Field("general_assistant", description="Role or persona for the agent")
    allowed_tools: Optional[List[str]] = Field(None, description="Whitelist of allowed tools for this execution")
    chat_history: Optional[List[ChatMessage]] = Field(None, description="Prior conversation messages for context")
    system_prompt: Optional[str] = Field(None, description="Optional custom system prompt override")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Custom metadata for context")


class LiveOrbRequest(BaseModel):
    """A lightweight, click-triggered request from the floating assistant orb."""
    prompt: str = Field("Give a brief, helpful greeting and ask how you can help.")
    user_id: str
    organisation_id: str
    conversation_id: Optional[str] = None


class AgentRunResponse(BaseModel):
    """Complete response returned to the Backend."""
    response: str
    citations: List[Citation] = Field(default_factory=list)
    tool_calls: List[ToolExecutionRecord] = Field(default_factory=list)
    conversation_id: str
    agent_id: Optional[str] = None
    usage: Optional[Dict[str, int]] = None
    created_at: str


class ToolInfo(BaseModel):
    """Exposed tool descriptor."""
    name: str
    description: str
    parameters: Optional[Dict[str, Any]] = None


class ToolsListResponse(BaseModel):
    """List of tools supported by the AI Engine harness."""
    tools: List[ToolInfo]


class HealthResponse(BaseModel):
    """Health check status with provider diagnostic info."""
    status: str
    service: str
    version: str
    model: str
    gemini_configured: bool
