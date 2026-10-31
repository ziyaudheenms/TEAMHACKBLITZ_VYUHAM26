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


async def get_file_content(
    ctx: RunContext[HarnessContext],
    file_id: str,
) -> Dict[str, Any]:
    """Retrieves full text content, metadata, and extracted knowledge chunks of a stored document/file.
    
    Args:
        ctx: RunContext containing execution context and backend client.
        file_id: UUID of the file asset stored in the organisation's Second Brain.
    """
    if not ctx.deps.is_tool_allowed("get_file_content"):
        return {"error": "Permission denied: 'get_file_content' is not authorized."}

    logger.info("Fetching file content for file_id=%s", file_id)
    result = await ctx.deps.backend_client.get_file_content(
        file_id=file_id,
        token=ctx.deps.auth_token,
        org_id=ctx.deps.organisation_id,
        user_id=ctx.deps.user_id,
    )

    if isinstance(result, dict) and "data" in result and isinstance(result["data"], dict):
        file_data = result["data"].get("file", {})
        filename = file_data.get("filename", f"File {file_id}")
        full_text = result["data"].get("fullText", "")
        ctx.deps.add_citation(
            source_id=str(file_data.get("id", file_id)),
            title=str(filename),
            source_type="file",
            url=f"/storage?fileId={file_id}",
            snippet=full_text[:200] if full_text else str(file_data.get("summary", "")),
        )

    ctx.deps.record_tool_call("get_file_content", {"file_id": file_id}, result)
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
    if isinstance(result, dict) and "data" in result and isinstance(result["data"], dict):
        task_data = result["data"]
        task_id = str(task_data.get("id", ""))
        if task_id:
            ctx.deps.add_citation(
                source_id=task_id,
                title=f"Kanban Task: {title}",
                source_type="task",
                url=f"/projects?taskId={task_id}",
                snippet=f"Status: {task_data.get('status', 'open')} | Priority: {task_data.get('priority', priority)}",
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
    if isinstance(result, dict) and ("data" in result or "id" in result):
        task_data = result.get("data", result)
        task_id_str = str(task_data.get("id", task_id))
        ctx.deps.add_citation(
            source_id=task_id_str,
            title=f"Kanban Task: {task_data.get('title', task_id)}",
            source_type="task",
            url=f"/projects?taskId={task_id_str}",
            snippet=f"Moved to: {status}",
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


async def list_tasks(
    ctx: RunContext[HarnessContext],
    project_id: Optional[str] = None,
    status: Optional[str] = None,
) -> Dict[str, Any]:
    """Retrieves tasks from the Kanban board, optionally filtered by project ID and/or status ('open', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled').
    
    Args:
        ctx: RunContext containing execution context and backend client.
        project_id: Optional UUID of the project.
        status: Optional status column filter ('open', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled').
    """
    if not ctx.deps.is_tool_allowed("list_tasks"):
        return {"error": "Permission denied: 'list_tasks' is not authorized for this agent."}

    logger.info("Listing tasks for project_id=%s status=%s", project_id, status)
    result = await ctx.deps.backend_client.list_tasks(
        project_id=project_id,
        status=status,
        token=ctx.deps.auth_token,
        org_id=ctx.deps.organisation_id,
        user_id=ctx.deps.user_id,
    )
    ctx.deps.record_tool_call("list_tasks", {"project_id": project_id, "status": status}, result)
    return result


async def list_projects(
    ctx: RunContext[HarnessContext],
) -> Dict[str, Any]:
    """Retrieves all active projects in the workspace to discover project names and IDs.
    
    Args:
        ctx: RunContext containing execution context and backend client.
    """
    if not ctx.deps.is_tool_allowed("list_projects"):
        return {"error": "Permission denied: 'list_projects' is not authorized."}

    logger.info("Listing projects in organisation")
    result = await ctx.deps.backend_client.list_projects(
        token=ctx.deps.auth_token,
        org_id=ctx.deps.organisation_id,
        user_id=ctx.deps.user_id,
    )
    ctx.deps.record_tool_call("list_projects", {}, result)
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
    get_file_content,
    get_project_details,
    get_meeting_minutes,
    search_employee_directory,
    create_task,
    update_task_status,
    list_tasks,
    list_projects,
    create_ticket,
    call_backend_tool,
    web_search,
    fetch_web_page,
]
