"""Pydantic AI Agent definitions and factory for BizContext AI Engine."""

import logging
from typing import List, Optional
from pydantic_ai import Agent, RunContext
from pydantic_ai.models import Model

from app.harness.context import HarnessContext
from app.harness.models import SYSTEM_PROMPT_HARNESS, get_harness_model
from app.harness.tools import ALL_HARNESS_TOOLS

logger = logging.getLogger(__name__)


def create_bizcontext_agent(
    model: Optional[Model] = None,
    custom_system_prompt: Optional[str] = None,
    tools: Optional[List] = None,
) -> Agent[HarnessContext, str]:
    """Creates a configured Pydantic AI Agent connected to the Gemini model and Second Brain tools."""
    resolved_model = model or get_harness_model()
    base_instructions = custom_system_prompt or SYSTEM_PROMPT_HARNESS
    # `None` means all tools; an explicit empty list means a tool-less agent (e.g. the CEO).
    assigned_tools = ALL_HARNESS_TOOLS if tools is None else tools

    agent = Agent(
        model=resolved_model,
        deps_type=HarnessContext,
        system_prompt=base_instructions,
        tools=assigned_tools,
        retries=2,
    )

    @agent.system_prompt
    def inject_session_context(ctx: RunContext[HarnessContext]) -> str:
        """Injects dynamic execution context into the prompt: tenant org, user, and agent role."""
        parts = [
            f"EXECUTION METADATA:",
            f"- User ID: {ctx.deps.user_id}",
            f"- Organisation ID: {ctx.deps.organisation_id}",
            f"- Conversation ID: {ctx.deps.conversation_id}",
            f"- Agent Role: {ctx.deps.agent_role}",
        ]
        if ctx.deps.allowed_tools:
            parts.append(f"- Permitted Tools: {', '.join(ctx.deps.allowed_tools)}")
        if ctx.deps.extra_metadata:
            parts.append(f"- Additional Context: {ctx.deps.extra_metadata}")
        return "\n".join(parts)

    return agent


# Default singleton agent instance
default_agent = create_bizcontext_agent()
