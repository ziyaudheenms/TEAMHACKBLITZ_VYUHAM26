"""Backend HTTP client for querying Second Brain data and executing backend tools."""

from typing import Any, Dict, List, Optional
import httpx
import logging

from app.config import settings

logger = logging.getLogger(__name__)


class BackendClient:
    """Asynchronous client that connects the AI Harness to the BizContext Backend API."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout: Optional[float] = None,
        service_token: Optional[str] = None,
    ):
        self.base_url = (base_url or settings.backend_api_base_url).rstrip("/")
        self.timeout = timeout or settings.backend_request_timeout_seconds
        self.service_token = service_token or settings.backend_service_token
        self._client: Optional[httpx.AsyncClient] = None

    async def get_client(self) -> httpx.AsyncClient:
        """Returns or initializes the reusable AsyncClient."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                headers={"Accept": "application/json"},
            )
        return self._client

    async def close(self) -> None:
        """Closes the underlying HTTP client session."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    def _build_headers(
        self,
        token: Optional[str] = None,
        org_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, str]:
        """Constructs security and multi-tenancy headers for backend requests."""
        headers: Dict[str, str] = {
            "Content-Type": "application/json",
            "X-Client-Source": "ai-engine-harness",
        }
        effective_token = token or self.service_token
        if effective_token:
            headers["Authorization"] = f"Bearer {effective_token}"
        if org_id:
            headers["X-Organisation-Id"] = org_id
        if user_id:
            headers["X-User-Id"] = user_id
        return headers

    # -------------------------------------------------------------------------
    # Second Brain Knowledge & Context Retrieval
    # -------------------------------------------------------------------------

    async def search_second_brain(
        self,
        query: str,
        resource_types: Optional[List[str]] = None,
        limit: int = 5,
        token: Optional[str] = None,
        org_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Queries the backend hybrid search across knowledge pages, files, meetings, tasks, and projects."""
        client = await self.get_client()
        headers = self._build_headers(token=token, org_id=org_id, user_id=user_id)
        params: Dict[str, Any] = {"q": query, "limit": limit}
        if resource_types:
            params["types"] = ",".join(resource_types)

        try:
            response = await client.get("/api/v1/search", params=params, headers=headers)
            if response.status_code == 200:
                return response.json()
            return {
                "error": f"Backend returned status {response.status_code}",
                "detail": response.text,
                "results": [],
            }
        except httpx.RequestError as exc:
            logger.warning("Failed to contact backend for second brain search: %s", exc)
            return {
                "error": f"Backend connection failed: {str(exc)}",
                "results": [],
            }

    async def get_knowledge_page(
        self,
        page_id_or_slug: str,
        token: Optional[str] = None,
        org_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Retrieves a full knowledge page (content, blocks, author, status)."""
        client = await self.get_client()
        headers = self._build_headers(token=token, org_id=org_id, user_id=user_id)
        try:
            response = await client.get(
                f"/api/v1/knowledge/pages/{page_id_or_slug}", headers=headers
            )
            if response.status_code == 200:
                return response.json()
            return {
                "error": f"Knowledge page '{page_id_or_slug}' not found or inaccessible (status {response.status_code})"
            }
        except httpx.RequestError as exc:
            logger.warning("Failed to fetch knowledge page %s: %s", page_id_or_slug, exc)
            return {"error": f"Backend request error: {str(exc)}"}

    async def get_file_content(
        self,
        file_id: str,
        token: Optional[str] = None,
        org_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetches the extracted content, summary, and knowledge chunks of a stored asset file."""
        client = await self.get_client()
        headers = self._build_headers(token=token, org_id=org_id, user_id=user_id)
        try:
            response = await client.get(f"/api/v1/files/{file_id}/content", headers=headers)
            if response.status_code == 200:
                return response.json()
            return {"error": f"File content for '{file_id}' not found (status {response.status_code})"}
        except httpx.RequestError as exc:
            logger.warning("Failed to fetch file content %s: %s", file_id, exc)
            return {"error": f"Backend request error: {str(exc)}"}

    async def get_project_context(
        self,
        project_id: str,
        token: Optional[str] = None,
        org_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetches project overview, owners, status, and related tasks."""
        client = await self.get_client()
        headers = self._build_headers(token=token, org_id=org_id, user_id=user_id)
        try:
            proj_res = await client.get(f"/api/v1/projects/{project_id}", headers=headers)
            tasks_res = await client.get(
                f"/api/v1/projects/{project_id}/tasks", headers=headers
            )
            proj_data = proj_res.json() if proj_res.status_code == 200 else {"id": project_id}
            tasks_data = tasks_res.json() if tasks_res.status_code == 200 else []
            return {"project": proj_data, "tasks": tasks_data}
        except httpx.RequestError as exc:
            logger.warning("Failed to fetch project %s: %s", project_id, exc)
            return {"error": f"Backend request error: {str(exc)}"}

    async def get_meeting_details(
        self,
        meeting_id: str,
        token: Optional[str] = None,
        org_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetches meeting details including agenda, participantIds, and minutesContent."""
        client = await self.get_client()
        headers = self._build_headers(token=token, org_id=org_id, user_id=user_id)
        try:
            response = await client.get(f"/api/v1/meetings/{meeting_id}", headers=headers)
            if response.status_code == 200:
                return response.json()
            return {"error": f"Meeting '{meeting_id}' not found (status {response.status_code})"}
        except httpx.RequestError as exc:
            logger.warning("Failed to fetch meeting %s: %s", meeting_id, exc)
            return {"error": f"Backend request error: {str(exc)}"}

    async def search_employees(
        self,
        skills: Optional[List[str]] = None,
        query: Optional[str] = None,
        token: Optional[str] = None,
        org_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Searches employee profiles for verified skills and department expertise."""
        client = await self.get_client()
        headers = self._build_headers(token=token, org_id=org_id, user_id=user_id)
        params: Dict[str, Any] = {}
        if skills:
            params["skills"] = ",".join(skills)
        if query:
            params["q"] = query

        try:
            response = await client.get("/api/v1/employees", params=params, headers=headers)
            if response.status_code == 200:
                return response.json()
            return {"employees": [], "error": f"Backend status {response.status_code}"}
        except httpx.RequestError as exc:
            logger.warning("Failed to search employees: %s", exc)
            return {"employees": [], "error": f"Backend request error: {str(exc)}"}

    # -------------------------------------------------------------------------
    # Backend Action Tools
    # -------------------------------------------------------------------------

    async def create_task(
        self,
        task_data: Dict[str, Any],
        token: Optional[str] = None,
        org_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Calls the backend to create a task in the system."""
        client = await self.get_client()
        headers = self._build_headers(token=token, org_id=org_id, user_id=user_id)
        try:
            response = await client.post("/api/v1/tasks", json=task_data, headers=headers)
            if response.status_code in (200, 201):
                return response.json()
            return {
                "error": f"Failed to create task (status {response.status_code})",
                "detail": response.text,
            }
        except httpx.RequestError as exc:
            logger.warning("Failed to create task via backend: %s", exc)
            return {"error": f"Backend request error: {str(exc)}"}

    async def update_task(
        self,
        task_id: str,
        update_data: Dict[str, Any],
        token: Optional[str] = None,
        org_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Calls the backend to update a task's status or metadata."""
        client = await self.get_client()
        headers = self._build_headers(token=token, org_id=org_id, user_id=user_id)
        try:
            response = await client.patch(
                f"/api/v1/tasks/{task_id}", json=update_data, headers=headers
            )
            if response.status_code == 200:
                return response.json()
            return {
                "error": f"Failed to update task {task_id} (status {response.status_code})",
                "detail": response.text,
            }
        except httpx.RequestError as exc:
            logger.warning("Failed to update task %s: %s", task_id, exc)
            return {"error": f"Backend request error: {str(exc)}"}

    async def create_ticket(
        self,
        ticket_data: Dict[str, Any],
        token: Optional[str] = None,
        org_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Calls the backend to create an operational ticket."""
        client = await self.get_client()
        headers = self._build_headers(token=token, org_id=org_id, user_id=user_id)
        try:
            response = await client.post("/api/v1/tickets", json=ticket_data, headers=headers)
            if response.status_code in (200, 201):
                return response.json()
            return {
                "error": f"Failed to create ticket (status {response.status_code})",
                "detail": response.text,
            }
        except httpx.RequestError as exc:
            logger.warning("Failed to create ticket: %s", exc)
            return {"error": f"Backend request error: {str(exc)}"}

    async def list_tasks(
        self,
        project_id: Optional[str] = None,
        status: Optional[str] = None,
        token: Optional[str] = None,
        org_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetches tasks from the backend, optionally filtered by project_id and status."""
        client = await self.get_client()
        headers = self._build_headers(token=token, org_id=org_id, user_id=user_id)
        params: Dict[str, Any] = {}
        if project_id:
            params["projectId"] = project_id
        try:
            response = await client.get("/api/v1/tasks", params=params, headers=headers)
            if response.status_code == 200:
                res_data = response.json()
                if status and isinstance(res_data, dict) and "data" in res_data and isinstance(res_data["data"], list):
                    filtered = [t for t in res_data["data"] if str(t.get("status", "")).lower() == status.lower()]
                    return {"data": filtered}
                return res_data
            return {"tasks": [], "error": f"Failed to list tasks (status {response.status_code})"}
        except httpx.RequestError as exc:
            logger.warning("Failed to list tasks: %s", exc)
            return {"tasks": [], "error": f"Backend request error: {str(exc)}"}

    async def list_projects(
        self,
        token: Optional[str] = None,
        org_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetches active projects from the backend."""
        client = await self.get_client()
        headers = self._build_headers(token=token, org_id=org_id, user_id=user_id)
        try:
            response = await client.get("/api/v1/projects", headers=headers)
            if response.status_code == 200:
                return response.json()
            return {"projects": [], "error": f"Failed to list projects (status {response.status_code})"}
        except httpx.RequestError as exc:
            logger.warning("Failed to list projects: %s", exc)
            return {"projects": [], "error": f"Backend request error: {str(exc)}"}

    async def execute_tool(
        self,
        tool_name: str,
        parameters: Dict[str, Any],
        token: Optional[str] = None,
        org_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generic invoker for any backend tool endpoint registered in the system."""
        client = await self.get_client()
        headers = self._build_headers(token=token, org_id=org_id, user_id=user_id)
        try:
            response = await client.post(
                f"/api/v1/agents/tools/{tool_name}/execute",
                json={"parameters": parameters},
                headers=headers,
            )
            if response.status_code == 200:
                return response.json()
            return {
                "error": f"Tool '{tool_name}' execution failed with status {response.status_code}",
                "detail": response.text,
            }
        except httpx.RequestError as exc:
            logger.warning("Failed to execute tool %s: %s", tool_name, exc)
            return {"error": f"Backend request error: {str(exc)}"}


backend_client_instance = BackendClient()
