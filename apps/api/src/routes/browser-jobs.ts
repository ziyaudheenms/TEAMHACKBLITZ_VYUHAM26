/**
 * /api/v1/browser-jobs
 *
 * Browser Automation Job queue — submit, list, approve, and cancel jobs.
 * RBAC: listing requires 'member'; creating requires 'member';
 *       approving/cancelling requires 'admin'.
 */

import { Hono } from "hono";
import { z } from "zod";
import { getSupabaseServiceClient } from "../lib/supabase";
import { enforceRole, getFullAuthContext, requireRole, writeAuditLog } from "../lib/auth";

const browserJobsRoutes = new Hono();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CreateJobSchema = z.object({
  // Optional: the AI engine may dispatch without a registered agent (it sends a placeholder id).
  agentId: z
    .string()
    .optional()
    .transform((v) => (v && UUID_RE.test(v) ? v : undefined)),
  goal: z.string().min(1),
  targetUrl: z.string().url(),
  permissionLevel: z.enum(["B0", "B1", "B2", "B3", "B4"]).default("B1"),
});

const ApproveJobSchema = z.object({
  approved: z.boolean(),
  note: z.string().optional(),
});

// ─── Shape helper ─────────────────────────────────────────────────────────────

function toJobResponse(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    organisationId: row.organisation_id ?? null,
    createdBy: row.created_by ?? null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    agentId: String(row.agent_id ?? ""),
    agentName: String(row.agent_name ?? ""),
    goal: String(row.goal ?? ""),
    targetUrl: String(row.target_url ?? ""),
    permissionLevel: String(row.permission_level ?? "B1"),
    status: String(row.status ?? "queued"),
    steps: (row.steps as unknown[]) ?? [],
    evidenceUrls: (row.evidence_urls as string[]) ?? [],
    approvalRequest: row.approval_request ?? null,
    outputSummary: row.output_summary ?? null,
  };
}

// ─── GET /api/v1/browser-jobs ─────────────────────────────────────────────────

browserJobsRoutes.get("/", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!auth.organisationId) return c.json({ error: { message: "No active organisation" } }, 403);

  const supabase = getSupabaseServiceClient();

  // Join with agents to pull the agent name
  const { data, error } = await supabase
    .from("browser_jobs")
    .select(`*, agents(name)`)
    .eq("organisation_id", auth.organisationId)
    .order("created_at", { ascending: false });

  if (error) return c.json({ error: { message: error.message } }, 500);

  const jobs = (data ?? []).map((row: Record<string, unknown>) => {
    const agentName = (row.agents as Record<string, unknown>)?.name ?? "";
    return toJobResponse({ ...row, agent_name: agentName });
  });

  return c.json(jobs);
});

// ─── GET /api/v1/browser-jobs/:id ────────────────────────────────────────────

browserJobsRoutes.get("/:id", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!auth.organisationId) return c.json({ error: { message: "No active organisation" } }, 403);

  const id = c.req.param("id");
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("browser_jobs")
    .select(`*, agents(name)`)
    .eq("id", id)
    .eq("organisation_id", auth.organisationId)
    .maybeSingle();

  if (error) return c.json({ error: { message: error.message } }, 500);
  if (!data) return c.json({ error: { message: "Browser job not found" } }, 404);

  const agentName = (data.agents as Record<string, unknown>)?.name ?? "";
  return c.json(toJobResponse({ ...data, agent_name: agentName } as Record<string, unknown>));
});

// ─── POST /api/v1/browser-jobs (member+) ─────────────────────────────────────

browserJobsRoutes.post("/", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!auth.organisationId) return c.json({ error: { message: "No active organisation" } }, 403);

  const body = await c.req.json().catch(() => null);
  const parsed = CreateJobSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { message: "Validation failed", details: parsed.error.issues } }, 400);

  // B3/B4 jobs park in `awaiting_approval` until an admin signs off.
  const highRisk = ["B3", "B4"].includes(parsed.data.permissionLevel);
  if (!requireRole(auth, "member")) {
    return c.json({ error: { message: "Requires 'member' role to launch browser jobs" } }, 403);
  }

  // If an agent is named, it must belong to the same org, be active, and permit this level.
  const supabase = getSupabaseServiceClient();
  let agent: Record<string, unknown> | null = null;
  if (parsed.data.agentId) {
    const { data } = await supabase
      .from("agents")
      .select("id, name, browser_permission, status")
      .eq("id", parsed.data.agentId)
      .eq("organisation_id", auth.organisationId)
      .maybeSingle();
    if (!data) return c.json({ error: { message: "Agent not found in this organisation" } }, 404);
    if (data.status !== "active") {
      return c.json({ error: { message: `Agent is ${data.status}; only active agents can run jobs` } }, 409);
    }
    const rank = (l: string) => Number(l.slice(1));
    if (rank(parsed.data.permissionLevel) > rank(String(data.browser_permission))) {
      return c.json(
        { error: { message: `Agent is capped at ${data.browser_permission}; requested ${parsed.data.permissionLevel}` } },
        403
      );
    }
    agent = data as Record<string, unknown>;
  }

  const initialStatus = highRisk ? "awaiting_approval" : "queued";
  const approvalRequest = highRisk
    ? {
        actionDescription: parsed.data.goal,
        riskReason: `Permission level ${parsed.data.permissionLevel} requires human approval`,
        requestedAt: new Date().toISOString(),
      }
    : null;

  const { data, error } = await supabase
    .from("browser_jobs")
    .insert({
      organisation_id: auth.organisationId,
      created_by: auth.userId,
      agent_id: parsed.data.agentId ?? null,
      goal: parsed.data.goal,
      target_url: parsed.data.targetUrl,
      permission_level: parsed.data.permissionLevel,
      status: initialStatus,
      steps: [],
      evidence_urls: [],
      approval_request: approvalRequest,
    })
    .select()
    .single();

  if (error) return c.json({ error: { message: error.message } }, 400);

  await writeAuditLog({
    organisationId: auth.organisationId,
    actorId: auth.userId,
    action: "browser_job.create",
    resourceType: "browser_job",
    resourceId: data.id as string,
    metadata: { goal: parsed.data.goal, permissionLevel: parsed.data.permissionLevel },
  });

  return c.json(toJobResponse({ ...data, agent_name: agent?.name ?? "" } as Record<string, unknown>), 201);
});

// ─── POST /api/v1/browser-jobs/:id/approve (admin+) ──────────────────────────

browserJobsRoutes.post("/:id/approve", async (c) => {
  const { context: auth, response: errRes } = await enforceRole(c, "admin");
  if (errRes) return errRes;
  if (!auth.organisationId) return c.json({ error: { message: "No active organisation" } }, 403);

  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = ApproveJobSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { message: "Validation failed" } }, 400);

  const supabase = getSupabaseServiceClient();
  const newStatus = parsed.data.approved ? "running" : "cancelled";

  // Record the approval step
  const approvalStep = {
    stepNumber: 0,
    action: parsed.data.approved ? "approved" : "rejected",
    target: "human-approval",
    status: "completed",
    timestamp: new Date().toISOString(),
    details: parsed.data.note ?? (parsed.data.approved ? "Approved by admin" : "Rejected by admin"),
  };

  const { data: existing } = await supabase
    .from("browser_jobs")
    .select("steps")
    .eq("id", id)
    .eq("organisation_id", auth.organisationId)
    .maybeSingle();

  const currentSteps = (existing?.steps as unknown[]) ?? [];
  const updatedSteps = [approvalStep, ...currentSteps];

  const { data, error } = await supabase
    .from("browser_jobs")
    .update({
      status: newStatus,
      steps: updatedSteps,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organisation_id", auth.organisationId)
    .select(`*, agents(name)`)
    .maybeSingle();

  if (error) return c.json({ error: { message: error.message } }, 400);
  if (!data) return c.json({ error: { message: "Browser job not found" } }, 404);

  await writeAuditLog({
    organisationId: auth.organisationId,
    actorId: auth.userId,
    action: parsed.data.approved ? "browser_job.approve" : "browser_job.reject",
    resourceType: "browser_job",
    resourceId: id,
    metadata: { note: parsed.data.note },
  });

  const agentName = (data.agents as Record<string, unknown>)?.name ?? "";
  return c.json(toJobResponse({ ...data, agent_name: agentName } as Record<string, unknown>));
});

// ─── POST /api/v1/browser-jobs/:id/cancel (member+ owns job, or admin) ───────

browserJobsRoutes.post("/:id/cancel", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!auth.organisationId) return c.json({ error: { message: "No active organisation" } }, 403);

  const id = c.req.param("id");
  const supabase = getSupabaseServiceClient();

  const { data: job } = await supabase
    .from("browser_jobs")
    .select("created_by, status")
    .eq("id", id)
    .eq("organisation_id", auth.organisationId)
    .maybeSingle();

  if (!job) return c.json({ error: { message: "Browser job not found" } }, 404);

  const isOwnerOfJob = job.created_by === auth.userId;
  const isAdminUser = ["admin", "owner"].includes(auth.role ?? "");

  if (!isOwnerOfJob && !isAdminUser) {
    return c.json({ error: { message: "Not authorized to cancel this job" } }, 403);
  }

  const terminal = ["completed", "failed", "cancelled"];
  if (terminal.includes(job.status as string)) {
    return c.json({ error: { message: `Job is already ${job.status}` } }, 409);
  }

  const { data, error } = await supabase
    .from("browser_jobs")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(`*, agents(name)`)
    .maybeSingle();

  if (error) return c.json({ error: { message: error.message } }, 400);

  await writeAuditLog({
    organisationId: auth.organisationId,
    actorId: auth.userId,
    action: "browser_job.cancel",
    resourceType: "browser_job",
    resourceId: id,
  });

  const agentName = (data?.agents as Record<string, unknown>)?.name ?? "";
  return c.json(toJobResponse({ ...data, agent_name: agentName } as Record<string, unknown>));
});

export default browserJobsRoutes;
