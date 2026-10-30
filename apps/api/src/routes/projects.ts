import { Hono } from "hono";
import type { Context } from "hono";
import { getSupabaseServiceClient } from "../lib/supabase";
import { getFullAuthContext, requireRole, writeAuditLog } from "../lib/auth";

const projectsRoutes = new Hono();

function err(c: Context, status: 400 | 401 | 403 | 404 | 500, message: string) {
  return c.json({ error: { message } }, status);
}

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

// GET /projects — org-scoped list (any member)
projectsRoutes.get("/", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");
  if (!auth.organisationId || !requireRole(auth, "guest")) return err(c, 403, "Not a member of an organisation");

  const { data, error } = await getSupabaseServiceClient()
    .from("projects")
    .select("*")
    .eq("organisation_id", auth.organisationId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[projects] list error:", error.message);
    return err(c, 500, "Failed to fetch projects");
  }
  return c.json({ data: (data ?? []).map((r) => toProject(r as Record<string, unknown>)) }, 200);
});

// GET /projects/:id
projectsRoutes.get("/:id", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");
  if (!auth.organisationId || !requireRole(auth, "guest")) return err(c, 403, "Not a member of an organisation");

  const { data } = await getSupabaseServiceClient()
    .from("projects")
    .select("*")
    .eq("id", c.req.param("id"))
    .eq("organisation_id", auth.organisationId)
    .maybeSingle();
  if (!data) return err(c, 404, "Project not found");
  return c.json(toProject(data as Record<string, unknown>), 200);
});

// GET /projects/:id/tasks (used by the AI engine)
projectsRoutes.get("/:id/tasks", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");
  if (!auth.organisationId || !requireRole(auth, "guest")) return err(c, 403, "Not a member of an organisation");

  const { data, error } = await getSupabaseServiceClient()
    .from("tasks")
    .select("*")
    .eq("project_id", c.req.param("id"))
    .eq("organisation_id", auth.organisationId);
  if (error) return err(c, 500, "Failed to fetch tasks");
  return c.json(data ?? [], 200);
});

// POST /projects — member+
projectsRoutes.post("/", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");
  if (!auth.organisationId || !requireRole(auth, "member")) return err(c, 403, "Requires 'member' role");

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !body.name) return err(c, 400, "name is required");

  const { data, error } = await getSupabaseServiceClient()
    .from("projects")
    .insert({
      name: String(body.name).trim(),
      description: body.description ? String(body.description).trim() : null,
      status: (body.status as string) ?? "active",
      created_by: auth.userId,
      organisation_id: auth.organisationId, // never trust the body for tenancy
    })
    .select("*")
    .single();

  if (error || !data) {
    console.error("[projects] create error:", error?.message);
    return err(c, 500, "Failed to create project");
  }

  await writeAuditLog({
    organisationId: auth.organisationId,
    actorId: auth.userId,
    action: "project.create",
    resourceType: "project",
    resourceId: data.id as string,
  });
  return c.json({ data: toProject(data as Record<string, unknown>) }, 201);
});

// DELETE /projects/:id — admin+
projectsRoutes.delete("/:id", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");
  if (!auth.organisationId || !requireRole(auth, "admin")) return err(c, 403, "Requires 'admin' role");

  const id = c.req.param("id");
  const { error } = await getSupabaseServiceClient()
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("organisation_id", auth.organisationId);
  if (error) return err(c, 500, "Failed to delete project");

  await writeAuditLog({
    organisationId: auth.organisationId,
    actorId: auth.userId,
    action: "project.delete",
    resourceType: "project",
    resourceId: id,
  });
  return c.json({ success: true }, 200);
});

export default projectsRoutes;
