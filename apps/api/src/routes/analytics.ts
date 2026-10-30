/**
 * /api/v1/analytics
 *
 * System & Operational Analytics endpoint group.
 * Mapped to IMPLEMENTATION.md Sections 2.10, 8.x (all table groups), and 11.
 *
 * Dashboards provided:
 *  - GET /overview               — High-level org-wide snapshot
 *  - GET /projects               — Project health & milestone progress
 *  - GET /tasks                  — Task completion, overdue, workload
 *  - GET /tickets                — Ticket volume, resolution time & SLA
 *  - GET /meetings               — Meeting action-item completion rates
 *  - GET /knowledge              — Knowledge usage & file activity
 *  - GET /agents                 — Agent usage, outcomes & approval rates
 *  - GET /people                 — Operational headcount & team metrics
 *  - GET /activity               — Audit log / activity timeline
 *
 * Security
 * --------
 * • All routes require a valid Bearer token.
 * • Tenant isolation is enforced via organisation_id on every query.
 * • Only 'admin' or 'owner' roles can access agent & full audit analytics;
 *   regular members receive a restricted view.
 * • People analytics are designed for operational support, not surveillance.
 *   Individual employee activity counters are NOT exposed.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import {
  extractBearerToken,
  resolveAuthUser,
  resolveMembership,
  getSupabaseServiceClient,
} from "../lib/supabase";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function errorResponse(
  c: Context,
  status: 400 | 401 | 403 | 404 | 422 | 500,
  message: string,
  details?: object
) {
  return c.json({ error: { message, ...(details ? { details } : {}) } }, status);
}

interface UserContext {
  userId: string;
  organisationId: string;
  role: string;
}

async function resolveUserContext(
  c: Context
): Promise<{ ok: true; context: UserContext } | { ok: false; response: Response }> {
  const token = extractBearerToken(c.req.header("Authorization"));
  if (!token) {
    return { ok: false, response: errorResponse(c, 401, "Missing bearer token") as Response };
  }

  const { userId, isSuperAdmin, error: authError } = await resolveAuthUser(token);
  if (authError || !userId) {
    return { ok: false, response: errorResponse(c, 401, authError?.message ?? "Invalid or expired token") as Response };
  }

  const membership = await resolveMembership(userId, isSuperAdmin, c.req.header("X-Organisation-Id"));
  if (!membership) {
    return {
      ok: false,
      response: errorResponse(c, 403, "You are not an active member of any organisation") as Response,
    };
  }
  const member = { organisation_id: membership.organisationId, role: membership.role };

  return {
    ok: true,
    context: {
      userId,
      organisationId: member.organisation_id as string,
      role: member.role as string,
    },
  };
}

/** Parse an optional ISO date query param into a Date or fall back to a default */
function parseDateParam(value: string | undefined, fallbackDaysBack: number): string {
  if (value) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date();
  d.setDate(d.getDate() - fallbackDaysBack);
  return d.toISOString();
}

function isAdmin(role: string): boolean {
  return role === "admin" || role === "owner";
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const analyticsRoutes = new Hono();

// ===========================================================================
// GET /overview — Org-wide snapshot
// ===========================================================================
/**
 * Returns a high-level snapshot of the organisation:
 *   projects, tasks, tickets, members, meetings, files, notifications counts.
 * No PII, no individual counters.
 */
analyticsRoutes.get("/overview", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.context;

  const supabase = getSupabaseServiceClient();

  const [
    { count: totalProjects },
    { count: activeProjects },
    { count: totalTasks },
    { count: openTasks },
    { count: doneTasks },
    { count: overdueTasks },
    { count: totalTickets },
    { count: openTickets },
    { count: resolvedTickets },
    { count: slaBreachedTickets },
    { count: totalMembers },
    { count: totalMeetings },
    { count: totalFiles },
    { count: totalPages },
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .is("deleted_at", null),

    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("status", "active")
      .is("deleted_at", null),

    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .is("deleted_at", null),

    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .in("status", ["open", "in_progress", "blocked", "in_review"])
      .is("deleted_at", null),

    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("status", "done")
      .is("deleted_at", null),

    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .lt("due_date", new Date().toISOString())
      .not("status", "in", '("done","cancelled")')
      .is("deleted_at", null),

    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .is("deleted_at", null),

    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .in("status", ["open", "assigned", "acknowledged", "in_progress"])
      .is("deleted_at", null),

    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .in("status", ["resolved", "closed"])
      .is("deleted_at", null),

    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("sla_breached", true)
      .is("deleted_at", null),

    supabase
      .from("organisation_members")
      .select("user_id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .is("left_at", null),

    supabase
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .is("deleted_at", null),

    supabase
      .from("files")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .is("deleted_at", null),

    supabase
      .from("pages")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .is("deleted_at", null),
  ]);

  return c.json(
    {
      organisationId,
      generatedAt: new Date().toISOString(),
      projects: {
        total: totalProjects ?? 0,
        active: activeProjects ?? 0,
      },
      tasks: {
        total: totalTasks ?? 0,
        open: openTasks ?? 0,
        done: doneTasks ?? 0,
        overdue: overdueTasks ?? 0,
        completionRate:
          (totalTasks ?? 0) > 0
            ? Math.round(((doneTasks ?? 0) / (totalTasks ?? 1)) * 100)
            : 0,
      },
      tickets: {
        total: totalTickets ?? 0,
        open: openTickets ?? 0,
        resolved: resolvedTickets ?? 0,
        slaBreached: slaBreachedTickets ?? 0,
        resolutionRate:
          (totalTickets ?? 0) > 0
            ? Math.round(((resolvedTickets ?? 0) / (totalTickets ?? 1)) * 100)
            : 0,
      },
      members: {
        active: totalMembers ?? 0,
      },
      meetings: {
        total: totalMeetings ?? 0,
      },
      knowledge: {
        pages: totalPages ?? 0,
        files: totalFiles ?? 0,
      },
    },
    200
  );
});

// ===========================================================================
// GET /projects — Project health & milestone progress
// ===========================================================================
analyticsRoutes.get("/projects", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.context;

  const supabase = getSupabaseServiceClient();
  const since = parseDateParam(c.req.query("since"), 90);

  // All projects
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, status, created_at, updated_at")
    .eq("organisation_id", organisationId)
    .is("deleted_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (!projects) {
    return errorResponse(c, 500, "Failed to fetch project analytics");
  }

  const projectIds = projects.map((p) => p.id as string);

  // Milestone summary
  const { data: milestones } = projectIds.length
    ? await supabase
        .from("project_milestones")
        .select("project_id, status")
        .in("project_id", projectIds)
    : { data: [] };

  // Task summary per project
  const { data: taskCounts } = projectIds.length
    ? await supabase
        .from("tasks")
        .select("project_id, status")
        .in("project_id", projectIds)
        .is("deleted_at", null)
    : { data: [] };

  // Build per-project breakdown
  const milestonesByProject: Record<string, { total: number; done: number }> = {};
  for (const m of milestones ?? []) {
    const pid = m.project_id as string;
    if (!milestonesByProject[pid]) milestonesByProject[pid] = { total: 0, done: 0 };
    milestonesByProject[pid].total += 1;
    if ((m.status as string) === "completed") milestonesByProject[pid].done += 1;
  }

  const tasksByProject: Record<string, { total: number; done: number; overdue: number }> = {};
  const now = new Date().toISOString();
  for (const t of taskCounts ?? []) {
    const pid = t.project_id as string;
    if (!pid) continue;
    if (!tasksByProject[pid]) tasksByProject[pid] = { total: 0, done: 0, overdue: 0 };
    tasksByProject[pid].total += 1;
    if ((t.status as string) === "done") tasksByProject[pid].done += 1;
    // overdue is tracked separately by due_date; here we just aggregate status
  }

  // Status distribution
  const statusDist: Record<string, number> = {};
  for (const p of projects) {
    const s = (p.status as string) ?? "unknown";
    statusDist[s] = (statusDist[s] ?? 0) + 1;
  }

  const projectSummaries = projects.map((p) => {
    const pid = p.id as string;
    const ms = milestonesByProject[pid] ?? { total: 0, done: 0 };
    const ts = tasksByProject[pid] ?? { total: 0, done: 0, overdue: 0 };
    return {
      id: pid,
      name: p.name,
      status: p.status,
      createdAt: p.created_at,
      milestones: { total: ms.total, done: ms.done },
      tasks: { total: ts.total, done: ts.done },
      taskCompletionRate:
        ts.total > 0 ? Math.round((ts.done / ts.total) * 100) : null,
    };
  });

  return c.json(
    {
      organisationId,
      generatedAt: new Date().toISOString(),
      since,
      statusDistribution: statusDist,
      total: projects.length,
      projects: projectSummaries,
    },
    200
  );
});

// ===========================================================================
// GET /tasks — Task completion, overdue & workload analytics
// ===========================================================================
analyticsRoutes.get("/tasks", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.context;

  const supabase = getSupabaseServiceClient();
  const since = parseDateParam(c.req.query("since"), 30);
  const projectId = c.req.query("projectId");

  let query = supabase
    .from("tasks")
    .select("id, status, priority, due_date, created_at, primary_assignee_id")
    .eq("organisation_id", organisationId)
    .is("deleted_at", null)
    .gte("created_at", since);

  if (projectId) query = query.eq("project_id", projectId);

  const { data: tasks, error } = await query;

  if (error) {
    return errorResponse(c, 500, "Failed to fetch task analytics");
  }

  const now = new Date();

  // Status distribution
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  let overdueCount = 0;
  let completedCount = 0;
  const workloadByAssignee: Record<string, number> = {};

  for (const t of tasks ?? []) {
    const status = (t.status as string) ?? "open";
    const priority = (t.priority as string) ?? "medium";

    byStatus[status] = (byStatus[status] ?? 0) + 1;
    byPriority[priority] = (byPriority[priority] ?? 0) + 1;

    if (status === "done") completedCount += 1;

    if (
      t.due_date &&
      new Date(t.due_date as string) < now &&
      !["done", "cancelled"].includes(status)
    ) {
      overdueCount += 1;
    }

    // Workload: count open tasks per assignee (anonymised by ID)
    const assigneeId = t.primary_assignee_id as string | null;
    if (assigneeId && !["done", "cancelled"].includes(status)) {
      workloadByAssignee[assigneeId] = (workloadByAssignee[assigneeId] ?? 0) + 1;
    }
  }

  const total = tasks?.length ?? 0;

  // Compute workload distribution (buckets, not per-person PII)
  const workloadValues = Object.values(workloadByAssignee);
  const avgWorkload =
    workloadValues.length > 0
      ? parseFloat((workloadValues.reduce((a, b) => a + b, 0) / workloadValues.length).toFixed(1))
      : 0;
  const maxWorkload = workloadValues.length > 0 ? Math.max(...workloadValues) : 0;

  return c.json(
    {
      organisationId,
      generatedAt: new Date().toISOString(),
      since,
      projectId: projectId ?? null,
      total,
      completed: completedCount,
      overdue: overdueCount,
      completionRate: total > 0 ? Math.round((completedCount / total) * 100) : 0,
      overdueRate: total > 0 ? Math.round((overdueCount / total) * 100) : 0,
      byStatus,
      byPriority,
      workload: {
        assigneesWithOpenTasks: workloadValues.length,
        avgOpenTasksPerAssignee: avgWorkload,
        maxOpenTasksOnOneAssignee: maxWorkload,
      },
    },
    200
  );
});

// ===========================================================================
// GET /tickets — Ticket volume, resolution time & SLA performance
// ===========================================================================
analyticsRoutes.get("/tickets", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.context;

  const supabase = getSupabaseServiceClient();
  const since = parseDateParam(c.req.query("since"), 30);

  const { data: tickets, error } = await supabase
    .from("tickets")
    .select(
      "id, status, priority, category, sla_breached, created_at, resolved_at, closed_at, sla_target"
    )
    .eq("organisation_id", organisationId)
    .is("deleted_at", null)
    .gte("created_at", since);

  if (error) {
    return errorResponse(c, 500, "Failed to fetch ticket analytics");
  }

  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let slaBreachedCount = 0;
  let resolvedCount = 0;
  const resolutionTimesMs: number[] = [];

  for (const t of tickets ?? []) {
    const status = (t.status as string) ?? "open";
    const priority = (t.priority as string) ?? "medium";
    const category = (t.category as string) ?? "general";

    byStatus[status] = (byStatus[status] ?? 0) + 1;
    byPriority[priority] = (byPriority[priority] ?? 0) + 1;
    byCategory[category] = (byCategory[category] ?? 0) + 1;

    if (t.sla_breached) slaBreachedCount += 1;

    const resolvedAt = t.resolved_at ?? t.closed_at;
    if (resolvedAt) {
      resolvedCount += 1;
      const resMs =
        new Date(resolvedAt as string).getTime() -
        new Date(t.created_at as string).getTime();
      if (resMs > 0) resolutionTimesMs.push(resMs);
    }
  }

  const total = tickets?.length ?? 0;

  const avgResolutionHours =
    resolutionTimesMs.length > 0
      ? parseFloat(
          (
            resolutionTimesMs.reduce((a, b) => a + b, 0) /
            resolutionTimesMs.length /
            3_600_000
          ).toFixed(1)
        )
      : null;

  const sortedTimes = [...resolutionTimesMs].sort((a, b) => a - b);
  const p50Index = Math.floor(sortedTimes.length * 0.5);
  const p90Index = Math.floor(sortedTimes.length * 0.9);
  const medianResolutionHours =
    sortedTimes.length > 0
      ? parseFloat((sortedTimes[p50Index] / 3_600_000).toFixed(1))
      : null;
  const p90ResolutionHours =
    sortedTimes.length > 0
      ? parseFloat((sortedTimes[p90Index] / 3_600_000).toFixed(1))
      : null;

  return c.json(
    {
      organisationId,
      generatedAt: new Date().toISOString(),
      since,
      total,
      resolved: resolvedCount,
      slaBreached: slaBreachedCount,
      resolutionRate: total > 0 ? Math.round((resolvedCount / total) * 100) : 0,
      slaComplianceRate:
        total > 0 ? Math.round(((total - slaBreachedCount) / total) * 100) : 100,
      resolutionTime: {
        avgHours: avgResolutionHours,
        medianHours: medianResolutionHours,
        p90Hours: p90ResolutionHours,
      },
      byStatus,
      byPriority,
      byCategory,
    },
    200
  );
});

// ===========================================================================
// GET /meetings — Meeting action-item completion & engagement
// ===========================================================================
analyticsRoutes.get("/meetings", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.context;

  const supabase = getSupabaseServiceClient();
  const since = parseDateParam(c.req.query("since"), 30);

  const { data: meetings, error: meetingsErr } = await supabase
    .from("meetings")
    .select("id, duration_minutes, has_minutes, has_ai_summary, created_at, meeting_date")
    .eq("organisation_id", organisationId)
    .is("deleted_at", null)
    .gte("created_at", since);

  if (meetingsErr) {
    return errorResponse(c, 500, "Failed to fetch meeting analytics");
  }

  const meetingIds = (meetings ?? []).map((m) => m.id as string);

  // Action items
  const { data: actionItems } = meetingIds.length
    ? await supabase
        .from("meeting_action_items")
        .select("meeting_id, status, converted_to_task")
        .in("meeting_id", meetingIds)
    : { data: [] };

  let totalActionItems = 0;
  let completedActionItems = 0;
  let convertedToTask = 0;

  for (const ai of actionItems ?? []) {
    totalActionItems += 1;
    if ((ai.status as string) === "done" || (ai.status as string) === "completed") {
      completedActionItems += 1;
    }
    if (ai.converted_to_task) convertedToTask += 1;
  }

  const totalMeetings = meetings?.length ?? 0;
  const withMinutes = (meetings ?? []).filter((m) => m.has_minutes).length;
  const withAiSummary = (meetings ?? []).filter((m) => m.has_ai_summary).length;
  const totalDurationMinutes = (meetings ?? []).reduce(
    (acc, m) => acc + ((m.duration_minutes as number) ?? 0),
    0
  );

  return c.json(
    {
      organisationId,
      generatedAt: new Date().toISOString(),
      since,
      meetings: {
        total: totalMeetings,
        withMinutes,
        withAiSummary,
        totalDurationMinutes,
        avgDurationMinutes:
          totalMeetings > 0
            ? Math.round(totalDurationMinutes / totalMeetings)
            : 0,
      },
      actionItems: {
        total: totalActionItems,
        completed: completedActionItems,
        convertedToTask,
        completionRate:
          totalActionItems > 0
            ? Math.round((completedActionItems / totalActionItems) * 100)
            : null,
        conversionRate:
          totalActionItems > 0
            ? Math.round((convertedToTask / totalActionItems) * 100)
            : null,
      },
    },
    200
  );
});

// ===========================================================================
// GET /knowledge — Knowledge workspace & file usage
// ===========================================================================
analyticsRoutes.get("/knowledge", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.context;

  const supabase = getSupabaseServiceClient();
  const since = parseDateParam(c.req.query("since"), 30);

  const [
    { count: totalPages },
    { count: newPages },
    { data: fileData },
    { count: newFiles },
  ] = await Promise.all([
    supabase
      .from("pages")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .is("deleted_at", null),

    supabase
      .from("pages")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .is("deleted_at", null)
      .gte("created_at", since),

    supabase
      .from("files")
      .select("id, mime_type, size_bytes")
      .eq("organisation_id", organisationId)
      .is("deleted_at", null),

    supabase
      .from("files")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .is("deleted_at", null)
      .gte("created_at", since),
  ]);

  const totalFiles = fileData?.length ?? 0;
  const totalStorageBytes = (fileData ?? []).reduce(
    (acc, f) => acc + ((f.size_bytes as number) ?? 0),
    0
  );

  // MIME type grouping
  const byMimeGroup: Record<string, number> = {};
  for (const f of fileData ?? []) {
    const mime = (f.mime_type as string) ?? "unknown";
    const group = mime.split("/")[0] ?? "other"; // image, application, text, …
    byMimeGroup[group] = (byMimeGroup[group] ?? 0) + 1;
  }

  return c.json(
    {
      organisationId,
      generatedAt: new Date().toISOString(),
      since,
      pages: {
        total: totalPages ?? 0,
        newInPeriod: newPages ?? 0,
      },
      files: {
        total: totalFiles,
        newInPeriod: newFiles ?? 0,
        totalStorageBytes,
        totalStorageMB: parseFloat((totalStorageBytes / 1_048_576).toFixed(2)),
        byTypeGroup: byMimeGroup,
      },
    },
    200
  );
});

// ===========================================================================
// GET /agents — Agent usage, outcomes, error & approval rates  (admin only)
// ===========================================================================
analyticsRoutes.get("/agents", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const { organisationId, role } = auth.context;

  if (!isAdmin(role)) {
    return errorResponse(c, 403, "Agent analytics require admin or owner role");
  }

  const supabase = getSupabaseServiceClient();
  const since = parseDateParam(c.req.query("since"), 30);

  const { data: executions, error } = await supabase
    .from("agent_executions")
    .select("id, agent_id, status, error_message, created_at, completed_at")
    .eq("organisation_id", organisationId)
    .gte("created_at", since);

  if (error) {
    return errorResponse(c, 500, "Failed to fetch agent analytics");
  }

  const byStatus: Record<string, number> = {};
  const byAgent: Record<string, { total: number; success: number; error: number }> = {};
  let totalDurationMs = 0;
  let completedWithDuration = 0;

  for (const ex of executions ?? []) {
    const status = (ex.status as string) ?? "unknown";
    const agentId = (ex.agent_id as string) ?? "unknown";

    byStatus[status] = (byStatus[status] ?? 0) + 1;

    if (!byAgent[agentId]) byAgent[agentId] = { total: 0, success: 0, error: 0 };
    byAgent[agentId].total += 1;
    if (status === "completed") byAgent[agentId].success += 1;
    if (status === "failed" || status === "error") byAgent[agentId].error += 1;

    if (ex.completed_at && ex.created_at) {
      const dur =
        new Date(ex.completed_at as string).getTime() -
        new Date(ex.created_at as string).getTime();
      if (dur > 0) {
        totalDurationMs += dur;
        completedWithDuration += 1;
      }
    }
  }

  // Approval stats
  const { data: approvals } = await supabase
    .from("agent_approvals")
    .select("status, created_at")
    .eq("organisation_id", organisationId)
    .gte("created_at", since);

  const approvalByStatus: Record<string, number> = {};
  for (const a of approvals ?? []) {
    const s = (a.status as string) ?? "pending";
    approvalByStatus[s] = (approvalByStatus[s] ?? 0) + 1;
  }

  const total = executions?.length ?? 0;
  const successCount = byStatus["completed"] ?? 0;
  const errorCount = (byStatus["failed"] ?? 0) + (byStatus["error"] ?? 0);

  return c.json(
    {
      organisationId,
      generatedAt: new Date().toISOString(),
      since,
      executions: {
        total,
        success: successCount,
        errors: errorCount,
        successRate: total > 0 ? Math.round((successCount / total) * 100) : null,
        errorRate: total > 0 ? Math.round((errorCount / total) * 100) : null,
        avgDurationMs:
          completedWithDuration > 0
            ? Math.round(totalDurationMs / completedWithDuration)
            : null,
        byStatus,
      },
      byAgent: Object.entries(byAgent).map(([id, stats]) => ({ agentId: id, ...stats })),
      approvals: {
        total: approvals?.length ?? 0,
        byStatus: approvalByStatus,
        approvalRate:
          (approvals?.length ?? 0) > 0
            ? Math.round(
                ((approvalByStatus["approved"] ?? 0) / (approvals?.length ?? 1)) * 100
              )
            : null,
      },
    },
    200
  );
});

// ===========================================================================
// GET /people — Operational headcount & team composition  (admin only)
// ===========================================================================
/**
 * People analytics are strictly operational:
 *  - Headcount by department
 *  - Employment status distribution
 *  - Skill tag distribution (from verified employee_skills)
 *  - No individual activity counters or performance proxies
 */
analyticsRoutes.get("/people", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const { organisationId, role } = auth.context;

  if (!isAdmin(role)) {
    return errorResponse(c, 403, "People analytics require admin or owner role");
  }

  const supabase = getSupabaseServiceClient();

  // Active members
  const { data: members } = await supabase
    .from("organisation_members")
    .select("user_id, role, joined_at")
    .eq("organisation_id", organisationId)
    .is("left_at", null);

  const totalActive = members?.length ?? 0;

  // Role distribution
  const byRole: Record<string, number> = {};
  for (const m of members ?? []) {
    const r = (m.role as string) ?? "member";
    byRole[r] = (byRole[r] ?? 0) + 1;
  }

  // Department headcount
  const { data: deptMembers } = await supabase
    .from("department_members")
    .select("department_id, departments(name)")
    .eq("organisation_id", organisationId);

  const byDepartment: Record<string, number> = {};
  for (const dm of deptMembers ?? []) {
    const deptName =
      (dm.departments as { name?: string } | null)?.name ?? "Unknown Department";
    byDepartment[deptName] = (byDepartment[deptName] ?? 0) + 1;
  }

  // Employee profile counts (status distribution)
  const { data: profiles } = await supabase
    .from("employee_profiles")
    .select("employment_status")
    .eq("organisation_id", organisationId);

  const byEmploymentStatus: Record<string, number> = {};
  for (const p of profiles ?? []) {
    const s = (p.employment_status as string) ?? "active";
    byEmploymentStatus[s] = (byEmploymentStatus[s] ?? 0) + 1;
  }

  // Top skills (verified only)
  const { data: skills } = await supabase
    .from("employee_skills")
    .select("skill_name, is_verified")
    .eq("organisation_id", organisationId)
    .eq("is_verified", true)
    .limit(500);

  const skillFreq: Record<string, number> = {};
  for (const s of skills ?? []) {
    const name = (s.skill_name as string) ?? "unknown";
    skillFreq[name] = (skillFreq[name] ?? 0) + 1;
  }
  const topSkills = Object.entries(skillFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([skill, count]) => ({ skill, count }));

  // Onboarding pipeline: pending invitations
  const { count: pendingInvitations } = await supabase
    .from("employee_invitations")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", organisationId)
    .eq("status", "pending");

  return c.json(
    {
      organisationId,
      generatedAt: new Date().toISOString(),
      headcount: {
        activeMembers: totalActive,
        pendingInvitations: pendingInvitations ?? 0,
      },
      byRole,
      byDepartment,
      byEmploymentStatus,
      topVerifiedSkills: topSkills,
    },
    200
  );
});

// ===========================================================================
// GET /activity — Audit log timeline  (admin only)
// ===========================================================================
analyticsRoutes.get("/activity", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const { organisationId, role } = auth.context;

  if (!isAdmin(role)) {
    return errorResponse(c, 403, "Audit activity analytics require admin or owner role");
  }

  const supabase = getSupabaseServiceClient();
  const since = parseDateParam(c.req.query("since"), 7);
  const resourceType = c.req.query("resourceType");
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") ?? "50", 10)));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("audit_logs")
    .select("id, actor_id, resource_type, resource_id, action, metadata, created_at", {
      count: "exact",
    })
    .eq("organisation_id", organisationId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (resourceType) query = query.eq("resource_type", resourceType);

  const { data: logs, count, error } = await query;

  if (error) {
    return errorResponse(c, 500, "Failed to fetch activity logs");
  }

  // Action frequency breakdown
  const byAction: Record<string, number> = {};
  const byResourceType: Record<string, number> = {};
  for (const l of logs ?? []) {
    const action = (l.action as string) ?? "unknown";
    const rt = (l.resource_type as string) ?? "unknown";
    byAction[action] = (byAction[action] ?? 0) + 1;
    byResourceType[rt] = (byResourceType[rt] ?? 0) + 1;
  }

  return c.json(
    {
      organisationId,
      generatedAt: new Date().toISOString(),
      since,
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
      summary: {
        byAction,
        byResourceType,
      },
      logs: (logs ?? []).map((l) => ({
        id: l.id,
        actorId: l.actor_id,
        resourceType: l.resource_type,
        resourceId: l.resource_id,
        action: l.action,
        metadata: l.metadata,
        createdAt: l.created_at,
      })),
    },
    200
  );
});

export default analyticsRoutes;
