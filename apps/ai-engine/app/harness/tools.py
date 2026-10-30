"""Pydantic AI tools for querying the Second Brain and triggering backend actions."""

import logging
from typing import Any, Dict, List, Optional
from pydantic_ai import RunContext

from app.harness.context import HarnessContext
from app.harness.web import fetch_web_page, web_search

logger = logging.getLogger(__name__)


async def search_second_brain(
    ctx: RunContext[HarnessContext],
    query: str,
    resource_types: Optional[List[str]] = None,
    limit: int = 5,
) -> Dict[str, Any]:
    """Searches the organisation's Second Brain knowledge base (pages, documents, meetings, tasks, projects).
    
    Args:
        ctx: RunContext containing execution context and backend client.
        query: Semantic or keyword search query string.
        resource_types: Optional filter: ['knowledge', 'file', 'meeting', 'task', 'project'].
        limit: Maximum number of relevant records to retrieve (default 5).
    """
    if not ctx.deps.is_tool_allowed("search_second_brain"):
        return {"error": "Permission denied: 'search_second_brain' tool is not authorized for this session."}

    logger.info("Executing search_second_brain for query='%s'", query)
    result = await ctx.deps.backend_client.search_second_brain(
        query=query,
        resource_types=resource_types,
        limit=limit,
        token=ctx.deps.auth_token,
        org_id=ctx.deps.organisation_id,
        user_id=ctx.deps.user_id,
    )

    # Automatically extract citations from search results
    if isinstance(result, dict) and "results" in result and isinstance(result["results"], list):
        for item in result["results"]:
            if isinstance(item, dict) and "id" in item:
                ctx.deps.add_citation(
                    source_id=str(item.get("id")),
                    title=str(item.get("title") or item.get("name") or "Untitled Document"),
                    source_type=str(item.get("type") or "knowledge_page"),
                    url=item.get("url"),
                    snippet=item.get("snippet") or item.get("content", "")[:200],
                )

    ctx.deps.record_tool_call("search_second_brain", {"query": query, "resource_types": resource_types, "limit": limit}, result)
    return result


async def get_knowledge_page(
    ctx: RunContext[HarnessContext],
    page_id_or_slug: str,
) -> Dict[str, Any]:
    """Fetches full content, title, and metadata of a specific Knowledge Base page from the backend.
    
    Args:
        ctx: RunContext containing execution context and backend client.
        page_id_or_slug: Unique ID or slug of the knowledge page.
    """
    if not ctx.deps.is_tool_allowed("get_knowledge_page"):
        return {"error": "Permission denied: 'get_knowledge_page' is not authorized."}

    logger.info("Fetching knowledge page: %s", page_id_or_slug)
    result = await ctx.deps.backend_client.get_knowledge_page(
        page_id_or_slug=page_id_or_slug,
        token=ctx.deps.auth_token,
        org_id=ctx.deps.organisation_id,
        user_id=ctx.deps.user_id,
    )

    if isinstance(result, dict) and "id" in result:
        ctx.deps.add_citation(
            source_id=str(result.get("id")),
            title=str(result.get("title") or page_id_or_slug),
            source_type="knowledge_page",
            url=f"/knowledge/{result.get('slug', page_id_or_slug)}",
            snippet=str(result.get("content", ""))[:200],
        )

    ctx.deps.record_tool_call("get_knowledge_page", {"page_id_or_slug": page_id_or_slug}, result)
    return result


async def get_project_details(
    ctx: RunContext[HarnessContext],
    project_id: str,
) -> Dict[str, Any]:
    """Retrieves project overview, status, milestones, and associated tasks from the backend.
    
    Args:
        ctx: RunContext containing execution context and backend client.
        project_id: ID of the project.
    """
    if not ctx.deps.is_tool_allowed("get_project_details"):
        return {"error": "Permission denied: 'get_project_details' is not authorized."}

    logger.info("Fetching project details for project_id=%s", project_id)
    result = await ctx.deps.backend_client.get_project_context(
        project_id=project_id,
        token=ctx.deps.auth_token,
        org_id=ctx.deps.organisation_id,
        user_id=ctx.deps.user_id,
    )

    if isinstance(result, dict) and "project" in result:
        proj = result["project"]
        ctx.deps.add_citation(
            source_id=str(proj.get("id", project_id)),
            title=str(proj.get("name", f"Project {project_id}")),
            source_type="project",
            url=f"/projects/{project_id}",
            snippet=proj.get("description", ""),
        )

    ctx.deps.record_tool_call("get_project_details", {"project_id": project_id}, result)
    return result


async def get_meeting_minutes(
    ctx: RunContext[HarnessContext],
    meeting_id: str,
) -> Dict[str, Any]:
    """Retrieves meeting minutes, agenda, decisions, and participants from the backend.
    
    Args:
        ctx: RunContext containing execution context and backend client.
        meeting_id: Unique ID of the meeting record.
    """
    if not ctx.deps.is_tool_allowed("get_meeting_minutes"):
        return {"error": "Permission denied: 'get_meeting_minutes' is not authorized."}

    logger.info("Fetching meeting minutes for meeting_id=%s", meeting_id)
    result = await ctx.deps.backend_client.get_meeting_details(
        meeting_id=meeting_id,
        token=ctx.deps.auth_token,
        org_id=ctx.deps.organisation_id,
        user_id=ctx.deps.user_id,
    )

    if isinstance(result, dict) and "id" in result:
        ctx.deps.add_citation(
            source_id=str(result.get("id")),
            title=str(result.get("title") or f"Meeting on {result.get('meetingDate', 'Unknown')}"),
            source_type="meeting",
            url=f"/meetings/{meeting_id}",
            snippet=str(result.get("minutesContent", ""))[:200],
        )

    ctx.deps.record_tool_call("get_meeting_minutes", {"meeting_id": meeting_id}, result)
    return result


async def search_employee_directory(
    ctx: RunContext[HarnessContext],
    skills: Optional[List[str]] = None,
    query: Optional[str] = None,
) -> Dict[str, Any]:
    """Searches employee professional profiles for verified skills, designation, and department.
    
    Args:
        ctx: RunContext containing execution context and backend client.
        skills: List of skill names (e.g. ['FastAPI', 'TypeScript', 'PostgreSQL']).
        query: Free text query (name or title).
    """
    if not ctx.deps.is_tool_allowed("search_employee_directory"):
        return {"error": "Permission denied: 'search_employee_directory' is not authorized."}

    logger.info("Searching employee directory skills=%s query=%s", skills, query)
    result = await ctx.deps.backend_client.search_employees(
        skills=skills,
        query=query,
        token=ctx.deps.auth_token,
        org_id=ctx.deps.organisation_id,
        user_id=ctx.deps.user_id,
    )
    ctx.deps.record_tool_call("search_employee_directory", {"skills": skills, "query": query}, result)
    return result


async def create_task(
    ctx: RunContext[HarnessContext],
    title: str,
    description: Optional[str] = None,
    project_id: Optional[str] = None,
    priority: str = "medium",
    due_date: Optional[str] = None,
    assignee_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Creates a new task in the workspace.
    
    Args:
        ctx: RunContext containing execution context and backend client.
        title: Title of the task.
        description: Optional detailed description.
        project_id: Optional UUID of the associated project.
        priority: Priority level: 'low', 'medium', 'high', or 'urgent'.
        due_date: Optional ISO-8601 date string.
        assignee_id: Optional UUID of the user assigned to this task.
    """
    if not ctx.deps.is_tool_allowed("create_task"):
        return {"error": "Permission denied: 'create_task' is not authorized for this agent."}

    payload = {
        "title": title,
        "description": description,
        "projectId": project_id,
        "priority": priority,
        "dueDate": due_date,
        "primaryAssigneeId": assignee_id,
        "organisationId": ctx.deps.organisation_id,
        "createdBy": ctx.deps.user_id,
    }
    logger.info("Creating task via backend: %s", title)
    result = await ctx.deps.backend_client.create_task(
        task_data=payload,
        token=ctx.deps.auth_token,
        org_id=ctx.deps.organisation_id,
        user_id=ctx.deps.user_id,
    )
    ctx.deps.record_tool_call("create_task", payload, result)
    return result


async def update_task_status(
    ctx: RunContext[HarnessContext],
    task_id: str,
    status: str,
) -> Dict[str, Any]:
    """Updates the status of an existing task ('open', 'in_progress', 'blocked', 'done', 'cancelled').
    
    Args:
        ctx: RunContext containing execution context and backend client.
        task_id: UUID of the task.
        status: Target status value.
    """
    if not ctx.deps.is_tool_allowed("update_task_status"):
        return {"error": "Permission denied: 'update_task_status' is not authorized."}

    payload = {"status": status}
    logger.info("Updating task %s status to %s", task_id, status)
    result = await ctx.deps.backend_client.update_task(
        task_id=task_id,
        update_data=payload,
        token=ctx.deps.auth_token,
        org_id=ctx.deps.organisation_id,
        user_id=ctx.deps.user_id,
    )
    ctx.deps.record_tool_call("update_task_status", {"task_id": task_id, "status": status}, result)
    return result


async def create_ticket(
    ctx: RunContext[HarnessContext],
    title: str,
    description: str,
    category: str = "general",
    priority: str = "medium",
) -> Dict[str, Any]:
    """Creates a new ticket (e.g. IT, access, infrastructure, HR, dev, finance, general).
    
    Args:
        ctx: RunContext containing execution context and backend client.
        title: Short title of the issue or ticket.
        description: Detailed explanation of the problem.
        category: 'it' | 'access' | 'infrastructure' | 'hr' | 'design' | 'dev' | 'finance' | 'general'
        priority: 'low' | 'medium' | 'high' | 'urgent'
    """
    if not ctx.deps.is_tool_allowed("create_ticket"):
        return {"error": "Permission denied: 'create_ticket' is not authorized."}

    payload = {
        "title": title,
        "description": description,
        "category": category,
        "priority": priority,
        "requesterId": ctx.deps.user_id,
        "organisationId": ctx.deps.organisation_id,
    }
    logger.info("Creating ticket via backend: %s", title)
    result = await ctx.deps.backend_client.create_ticket(
        ticket_data=payload,
        token=ctx.deps.auth_token,
        org_id=ctx.deps.organisation_id,
        user_id=ctx.deps.user_id,
    )
    ctx.deps.record_tool_call("create_ticket", payload, result)
    return result


async def dispatch_browser_job(
    ctx: RunContext[HarnessContext],
    goal: str,
    target_url: str,
    permission_level: str = "B1",
) -> Dict[str, Any]:
    """Submits a browser automation job to the backend browser worker.
    
    Args:
        ctx: RunContext containing execution context and backend client.
        goal: Actionable description of the web task (e.g. 'Read latest release notes from vendor portal').
        target_url: Target URL to open.
        permission_level: Browser permission tier ('B0', 'B1', 'B2', 'B3', 'B4').
    """
    if not ctx.deps.is_tool_allowed("dispatch_browser_job"):
        return {"error": "Permission denied: 'dispatch_browser_job' is not authorized."}

    payload = {
        "agentId": ctx.deps.agent_id or "default-browser-agent",
        "goal": goal,
        "targetUrl": target_url,
        "permissionLevel": permission_level,
        "organisationId": ctx.deps.organisation_id,
        "createdBy": ctx.deps.user_id,
    }
    logger.info("Dispatching browser job for goal: %s on %s", goal, target_url)
    result = await ctx.deps.backend_client.dispatch_browser_job(
        job_data=payload,
        token=ctx.deps.auth_token,
        org_id=ctx.deps.organisation_id,
        user_id=ctx.deps.user_id,
    )
    ctx.deps.record_tool_call("dispatch_browser_job", payload, result)
    return result


async def call_backend_tool(
    ctx: RunContext[HarnessContext],
    tool_name: str,
    parameters: Dict[str, Any],
) -> Dict[str, Any]:
    """Invokes any registered backend tool by name with parameter dictionary.
    
    Args:
        ctx: RunContext containing execution context and backend client.
        tool_name: Registered identifier of the backend tool.
        parameters: Key-value payload arguments for the tool.
    """
    if not ctx.deps.is_tool_allowed(tool_name) and not ctx.deps.is_tool_allowed("call_backend_tool"):
        return {"error": f"Permission denied: Tool '{tool_name}' is not authorized."}

    logger.info("Calling generic backend tool '%s'", tool_name)
    result = await ctx.deps.backend_client.execute_tool(
        tool_name=tool_name,
        parameters=parameters,
        token=ctx.deps.auth_token,
        org_id=ctx.deps.organisation_id,
        user_id=ctx.deps.user_id,
    )
    ctx.deps.record_tool_call(tool_name, parameters, result)
    return result


# Standard tools list exposed to Pydantic AI Harness
ALL_HARNESS_TOOLS = [
    search_second_brain,
    get_knowledge_page,
    get_project_details,
    get_meeting_minutes,
    search_employee_directory,
    create_task,
    update_task_status,
    create_ticket,
    dispatch_browser_job,
    call_backend_tool,
    web_search,
    fetch_web_page,
]
