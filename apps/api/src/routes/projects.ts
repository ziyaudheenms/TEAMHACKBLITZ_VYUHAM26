import { Hono } from "hono";
import type { Context } from "hono";
import { getSupabaseServiceClient } from "../lib/supabase";
import { getAuthContext } from "../lib/auth";

const projectsRoutes = new Hono();

// ---------------------------------------------------------------------------
// Helper: lightweight error response
// ---------------------------------------------------------------------------
function err(c: Context, status: 400 | 401 | 403 | 404 | 500, message: string) {
  return c.json({ error: { message } }, status);
}

// ---------------------------------------------------------------------------
// Row → API shape
// ---------------------------------------------------------------------------
function toProject(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    organisationId: (row.organisation_id as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    deletedAt: (row.deleted_at as string) ?? null,
    name: String(row.name ?? ""),
    description: (row.description as string) ?? null,
    status: (row.status as string) ?? "active",
    ownerId: (row.owner_id as string) ?? null,
    ownerName: (row.owner_name as string) ?? null,
    progressPercent: Number(row.progress_percent ?? 0),
    departmentName: (row.department_name as string) ?? null,
    tasksCount: (row.tasks_count as { total: number; done: number }) ?? { total: 0, done: 0 },
    dueDate: (row.due_date as string) ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /projects — list all active projects
// ---------------------------------------------------------------------------
projectsRoutes.get("/", async (c) => {
  const auth = await getAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");

  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[projects] list error:", error.message);
    return err(c, 500, "Failed to fetch projects");
  }

  return c.json({ data: (data ?? []).map((r) => toProject(r as Record<string, unknown>)) }, 200);
});

// ---------------------------------------------------------------------------
// POST /projects — create a new project
// ---------------------------------------------------------------------------
projectsRoutes.post("/", async (c) => {
  const auth = await getAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !body.name) {
    return err(c, 400, "name is required");
  }

  const supabase = getSupabaseServiceClient();

  const insert: Record<string, unknown> = {
    name: String(body.name).trim(),
    description: body.description ? String(body.description).trim() : null,
    status: (body.status as string) ?? "active",
    created_by: auth.userId,
  };

  if (body.organisationId) {
    insert.organisation_id = body.organisationId;
  }

  const { data, error } = await supabase
    .from("projects")
    .insert(insert)
    .select("*")
    .single();

  if (error || !data) {
    console.error("[projects] create error:", error?.message);
    return err(c, 500, "Failed to create project");
  }

  return c.json({ data: toProject(data as Record<string, unknown>) }, 201);
});

export default projectsRoutes;
