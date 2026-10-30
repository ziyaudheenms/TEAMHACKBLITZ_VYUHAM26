import { Hono } from "hono";
import type { Context } from "hono";
import { getSupabaseServiceClient } from "../lib/supabase";
import { getAuthContext } from "../lib/auth";

const tasksRoutes = new Hono();

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function err(c: Context, status: 400 | 401 | 403 | 404 | 500, message: string) {
  return c.json({ error: { message } }, status);
}

const VALID_STATUSES = ["open", "in_progress", "in_review", "blocked", "done", "cancelled"] as const;
type TaskStatus = (typeof VALID_STATUSES)[number];

function toTask(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    organisationId: (row.organisation_id as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    deletedAt: (row.deleted_at as string) ?? null,
    title: String(row.title ?? ""),
    description: (row.description as string) ?? null,
    projectId: (row.project_id as string) ?? null,
    projectName: (row.project_name as string) ?? null,
    primaryAssigneeId: (row.primary_assignee_id as string) ?? null,
    assigneeName: (row.assignee_name as string) ?? null,
    assigneeAvatar: (row.assignee_avatar as string) ?? null,
    collaboratorIds: Array.isArray(row.collaborator_ids) ? row.collaborator_ids : [],
    priority: (row.priority as string) ?? "medium",
    status: (row.status as string) ?? "open",
    dueDate: (row.due_date as string) ?? null,
    subtasks: Array.isArray(row.subtasks) ? row.subtasks : [],
  };
}

// ---------------------------------------------------------------------------
// GET /tasks — list tasks, optional ?projectId=
// ---------------------------------------------------------------------------
tasksRoutes.get("/", async (c) => {
  const auth = await getAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");

  const projectId = c.req.query("projectId");
  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("tasks")
    .select("*")
    .order("created_at", { ascending: false });

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[tasks] list error:", error.message);
    return err(c, 500, "Failed to fetch tasks");
  }

  return c.json({ data: (data ?? []).map((r) => toTask(r as Record<string, unknown>)) }, 200);
});

// ---------------------------------------------------------------------------
// POST /tasks — create a new task
// ---------------------------------------------------------------------------
tasksRoutes.post("/", async (c) => {
  const auth = await getAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !body.title) {
    return err(c, 400, "title is required");
  }

  const supabase = getSupabaseServiceClient();

  const insert: Record<string, unknown> = {
    title: String(body.title).trim(),
    description: body.description ? String(body.description).trim() : null,
    project_id: (body.projectId as string) ?? null,
    primary_assignee_id: (body.primaryAssigneeId as string) ?? null,
    priority: (body.priority as string) ?? "medium",
    status: (body.status as string) ?? "open",
    due_date: (body.dueDate as string) ?? null,
    created_by: auth.userId,
  };

  if (body.organisationId) {
    insert.organisation_id = body.organisationId;
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert(insert)
    .select("*")
    .single();

  if (error || !data) {
    console.error("[tasks] create error:", error?.message);
    return err(c, 500, "Failed to create task");
  }

  return c.json({ data: toTask(data as Record<string, unknown>) }, 201);
});

// ---------------------------------------------------------------------------
// PATCH /tasks/:id/status — update Kanban lane
// ---------------------------------------------------------------------------
tasksRoutes.patch("/:id/status", async (c) => {
  const auth = await getAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");

  const { id } = c.req.param();
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;

  if (!body || !body.status) {
    return err(c, 400, "status is required");
  }

  if (!VALID_STATUSES.includes(body.status as TaskStatus)) {
    return err(c, 400, `status must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  const supabase = getSupabaseServiceClient();

  // Verify the task exists
  const { data: existing, error: fetchError } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return err(c, 404, "Task not found");
  }

  const { data, error } = await supabase
    .from("tasks")
    .update({
      status: body.status as string,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    console.error("[tasks] status update error:", error?.message);
    return err(c, 500, "Failed to update task status");
  }

  return c.json({ data: toTask(data as Record<string, unknown>) }, 200);
});

export default tasksRoutes;
