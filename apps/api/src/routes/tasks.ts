import { Hono } from "hono";
import type { Context } from "hono";
import { getSupabaseServiceClient } from "../lib/supabase";
import { getFullAuthContext, requireRole } from "../lib/auth";
import { refreshEmployeeMetrics } from "../services/assignment.service";

const tasksRoutes = new Hono();

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
    requiredSkills: Array.isArray(row.required_skills) ? (row.required_skills as string[]) : [],
    skillTags: Array.isArray(row.skill_tags) ? (row.skill_tags as string[]) : [],
  };
}

// GET /tasks — org-scoped list, optional ?projectId=
tasksRoutes.get("/", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");
  if (!auth.organisationId || !requireRole(auth, "guest")) return err(c, 403, "Not a member of an organisation");

  const projectId = c.req.query("projectId");
  let query = getSupabaseServiceClient()
    .from("tasks")
    .select("*")
    .eq("organisation_id", auth.organisationId)
    .order("created_at", { ascending: false });
  if (projectId) query = query.eq("project_id", projectId);

  const { data, error } = await query;
  if (error) {
    console.error("[tasks] list error:", error.message);
    return err(c, 500, "Failed to fetch tasks");
  }
  return c.json({ data: (data ?? []).map((r) => toTask(r as Record<string, unknown>)) }, 200);
});

// POST /tasks — member+
tasksRoutes.post("/", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");
  if (!auth.organisationId || !requireRole(auth, "member")) return err(c, 403, "Requires 'member' role");

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !body.title) return err(c, 400, "title is required");

  const { data, error } = await getSupabaseServiceClient()
    .from("tasks")
    .insert({
      title: String(body.title).trim(),
      description: body.description ? String(body.description).trim() : null,
      project_id: (body.projectId as string) ?? null,
      primary_assignee_id: (body.primaryAssigneeId as string) ?? null,
      priority: (body.priority as string) ?? "medium",
      status: (body.status as string) ?? "open",
      due_date: (body.dueDate as string) ?? null,
      required_skills: Array.isArray(body.requiredSkills)
        ? body.requiredSkills
        : Array.isArray(body.required_skills)
        ? body.required_skills
        : [],
      skill_tags: Array.isArray(body.skillTags)
        ? body.skillTags
        : Array.isArray(body.skill_tags)
        ? body.skill_tags
        : [],
      created_by: auth.userId,
      organisation_id: auth.organisationId,
    })
    .select("*")
    .single();

  if (error || !data) {
    console.error("[tasks] create error:", error?.message);
    return err(c, 500, "Failed to create task");
  }
  return c.json({ data: toTask(data as Record<string, unknown>) }, 201);
});

async function updateStatus(c: Context) {
  const auth = await getFullAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");
  if (!auth.organisationId || !requireRole(auth, "member")) return err(c, 403, "Requires 'member' role");

  const { id } = c.req.param();
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !body.status) return err(c, 400, "status is required");
  if (!VALID_STATUSES.includes(body.status as TaskStatus)) {
    return err(c, 400, `status must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  const { data, error } = await getSupabaseServiceClient()
    .from("tasks")
    .update({ status: body.status as string, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organisation_id", auth.organisationId)
    .select("*")
    .maybeSingle();

  if (error) return err(c, 500, "Failed to update task status");
  if (!data) return err(c, 404, "Task not found");

  // Async: refresh metrics for the assignee after task completion (fire-and-forget)
  const row = data as Record<string, unknown>;
  if (
    body.status === "done" &&
    row.primary_assignee_id &&
    row.organisation_id
  ) {
    void refreshEmployeeMetrics(
      String(row.organisation_id),
      String(row.primary_assignee_id)
    );
  }

  return c.json({ data: toTask(data as Record<string, unknown>) }, 200);
}

// PATCH /tasks/:id/status — Kanban lane (frontend)
tasksRoutes.patch("/:id/status", updateStatus);
// PATCH /tasks/:id — generic status update (AI engine tool)
tasksRoutes.patch("/:id", updateStatus);

export default tasksRoutes;
