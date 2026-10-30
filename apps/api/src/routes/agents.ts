/**
 * /api/v1/agents
 *
 * Agent Registry — create, list, update, and control AI agents.
 * RBAC: listing agents requires 'member'; creating/updating/deleting requires 'admin'.
 */

import { Hono } from "hono";
import { z } from "zod";
import { getSupabaseServiceClient } from "../lib/supabase";
import { enforceRole, getFullAuthContext, writeAuditLog } from "../lib/auth";

const agentsRoutes = new Hono();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CreateAgentSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.string().max(100).optional(),
  description: z.string().max(1000).optional(),
  instructions: z.string().min(1),
  model: z.string().default("gemini-2.5-flash"),
  browserPermission: z.enum(["B0", "B1", "B2", "B3", "B4"]).default("B1"),
  allowedDomains: z.array(z.string()).default([]),
});

const UpdateAgentStatusSchema = z.object({
  status: z.enum(["draft", "submitted", "reviewed", "approved", "active", "suspended", "retired"]),
});

// ─── Shape helpers ────────────────────────────────────────────────────────────

function toAgentResponse(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    organisationId: row.organisation_id ?? null,
    createdBy: row.created_by ?? null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    name: String(row.name ?? ""),
    role: String(row.role ?? ""),
    description: String(row.description ?? ""),
    instructions: String(row.instructions ?? ""),
    model: String(row.model ?? "gemini-2.5-flash"),
    browserPermission: String(row.browser_permission ?? "B1"),
    status: String(row.status ?? "draft"),
    allowedDomains: (row.allowed_domains as string[]) ?? [],
    totalExecutions: Number(row.total_executions ?? 0),
    successRate: Number(row.success_rate ?? 0),
  };
}

// ─── GET /api/v1/agents ───────────────────────────────────────────────────────

agentsRoutes.get("/", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!auth.organisationId) return c.json({ error: { message: "No active organisation" } }, 403);

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("organisation_id", auth.organisationId)
    .order("created_at", { ascending: false });

  if (error) return c.json({ error: { message: error.message } }, 500);

  return c.json((data ?? []).map((row) => toAgentResponse(row as Record<string, unknown>)));
});

// ─── POST /api/v1/agents/tools/:tool/execute (admin+) ────────────────────────
// Generic tool bridge used by the AI engine's `call_backend_tool`.
// Strictly an allow-list of read-only, org-scoped tools.
const GENERIC_TOOLS: Record<string, { table: string; columns: string }> = {
  list_projects: { table: "projects", columns: "id, name, status, description" },
  list_tasks: { table: "tasks", columns: "id, title, status, priority, project_id, due_date" },
  list_tickets: { table: "tickets", columns: "id, ticket_number, title, status, priority, category" },
  list_meetings: { table: "meetings", columns: "id, title, meeting_date" },
};

agentsRoutes.post("/tools/:tool/execute", async (c) => {
  const { context: auth, response: errRes } = await enforceRole(c, "admin");
  if (errRes) return errRes;
  if (!auth.organisationId) return c.json({ error: { message: "No active organisation" } }, 403);

  const tool = GENERIC_TOOLS[c.req.param("tool")];
  if (!tool) {
    return c.json(
      { error: { message: `Unknown tool. Available: ${Object.keys(GENERIC_TOOLS).join(", ")}` } },
      404
    );
  }

  const { data, error } = await getSupabaseServiceClient()
    .from(tool.table)
    .select(tool.columns)
    .eq("organisation_id", auth.organisationId)
    .limit(50);
  if (error) return c.json({ error: { message: error.message } }, 500);

  await writeAuditLog({
    organisationId: auth.organisationId,
    actorId: auth.userId,
    actorType: "agent",
    action: `tool.${c.req.param("tool")}`,
    resourceType: "agent_tool",
  });
  return c.json({ result: data ?? [] });
});

// ─── GET /api/v1/agents/:id ───────────────────────────────────────────────────

agentsRoutes.get("/:id", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!auth.organisationId) return c.json({ error: { message: "No active organisation" } }, 403);

  const id = c.req.param("id");
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("id", id)
    .eq("organisation_id", auth.organisationId)
    .maybeSingle();

  if (error) return c.json({ error: { message: error.message } }, 500);
  if (!data) return c.json({ error: { message: "Agent not found" } }, 404);

  return c.json(toAgentResponse(data as Record<string, unknown>));
});

// ─── POST /api/v1/agents (admin+) ─────────────────────────────────────────────

agentsRoutes.post("/", async (c) => {
  const { context: auth, response: errRes } = await enforceRole(c, "admin");
  if (errRes) return errRes;
  if (!auth.organisationId) return c.json({ error: { message: "No active organisation" } }, 403);

  const body = await c.req.json().catch(() => null);
  const parsed = CreateAgentSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { message: "Validation failed", details: parsed.error.issues } }, 400);

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("agents")
    .insert({
      organisation_id: auth.organisationId,
      created_by: auth.userId,
      name: parsed.data.name,
      role: parsed.data.role ?? "",
      description: parsed.data.description ?? "",
      instructions: parsed.data.instructions,
      model: parsed.data.model,
      browser_permission: parsed.data.browserPermission,
      allowed_domains: parsed.data.allowedDomains,
      status: "draft",
    })
    .select()
    .single();

  if (error) return c.json({ error: { message: error.message } }, 400);

  await writeAuditLog({
    organisationId: auth.organisationId,
    actorId: auth.userId,
    action: "agent.create",
    resourceType: "agent",
    resourceId: data.id as string,
    metadata: { name: parsed.data.name },
  });

  return c.json(toAgentResponse(data as Record<string, unknown>), 201);
});

// ─── PATCH /api/v1/agents/:id/status (admin+) ────────────────────────────────

agentsRoutes.patch("/:id/status", async (c) => {
  const { context: auth, response: errRes } = await enforceRole(c, "admin");
  if (errRes) return errRes;
  if (!auth.organisationId) return c.json({ error: { message: "No active organisation" } }, 403);

  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = UpdateAgentStatusSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { message: "Validation failed" } }, 400);

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("agents")
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organisation_id", auth.organisationId)
    .select()
    .maybeSingle();

  if (error) return c.json({ error: { message: error.message } }, 400);
  if (!data) return c.json({ error: { message: "Agent not found" } }, 404);

  await writeAuditLog({
    organisationId: auth.organisationId,
    actorId: auth.userId,
    action: "agent.status_update",
    resourceType: "agent",
    resourceId: id,
    metadata: { newStatus: parsed.data.status },
  });

  return c.json(toAgentResponse(data as Record<string, unknown>));
});

// ─── DELETE /api/v1/agents/:id (admin+) ───────────────────────────────────────

agentsRoutes.delete("/:id", async (c) => {
  const { context: auth, response: errRes } = await enforceRole(c, "admin");
  if (errRes) return errRes;
  if (!auth.organisationId) return c.json({ error: { message: "No active organisation" } }, 403);

  const id = c.req.param("id");
  const supabase = getSupabaseServiceClient();

  // Soft-delete by setting status to 'retired' and recording the action
  const { data, error } = await supabase
    .from("agents")
    .update({ status: "retired", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organisation_id", auth.organisationId)
    .select()
    .maybeSingle();

  if (error) return c.json({ error: { message: error.message } }, 400);
  if (!data) return c.json({ error: { message: "Agent not found" } }, 404);

  await writeAuditLog({
    organisationId: auth.organisationId,
    actorId: auth.userId,
    action: "agent.retire",
    resourceType: "agent",
    resourceId: id,
  });

  return c.json({ success: true });
});

export default agentsRoutes;
