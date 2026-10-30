/**
 * /api/v1/tickets
 *
 * Internal Ticketing & SLA Management endpoint group.
 * Mapped to IMPLEMENTATION.md Sections 2.7, 8.3, 10.3, and 11.
 *
 * All routes require a valid Bearer token. Tenant isolation is enforced
 * in application code using organisation_id and role/resource-level permissions.
 *
 * Security & SLA Rules
 * --------------------
 * • Lifecycles: 'open', 'assigned', 'acknowledged', 'in_progress', 'waiting',
 *   'resolved', 'closed', 'reopened'.
 * • Categories: 'it', 'access', 'infrastructure', 'hr', 'design', 'dev', 'finance', 'general'.
 * • Dynamic SLA: Automatically calculated from priority (Urgent: 4h, High: 12h, Medium: 24h, Low: 72h).
 * • Auditing: Sensitive events ('create', 'view', 'status_change', 'comment', 'delete')
 *   are logged to `audit_logs` and `ticket_activity`.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import {
  CreateTicketSchema,
  UpdateTicketSchema,
  UpdateTicketStatusSchema,
  AddTicketCommentSchema,
  TicketQuerySchema,
} from "@bizcontext/validation";
import {
  calculateSlaTarget,
  isSlaBreached,
  formatTicketNumber,
  type TicketPriority,
  type TicketStatus,
} from "@bizcontext/module-tickets";
import {
  extractBearerToken,
  resolveAuthUser,
  resolveMembership,
  getSupabaseServiceClient,
} from "../lib/supabase";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorResponse(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500,
  message: string,
  details?: object
) {
  return c.json({ error: { message, ...(details ? { details } : {}) } }, status);
}

interface UserContext {
  userId: string;
  organisationId: string;
  role: string;
  userName: string;
  avatar?: string;
}

/**
 * Resolves the authenticated user, verifies organisation membership,
 * and fetches the user's full name.
 */
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

  const supabase = getSupabaseServiceClient();

  const membership = await resolveMembership(userId, isSuperAdmin, c.req.header("X-Organisation-Id"));
  if (!membership) {
    return {
      ok: false,
      response: errorResponse(c, 403, "You are not an active member of any organisation") as Response,
    };
  }
  const member = { organisation_id: membership.organisationId, role: membership.role };

  const { data: profile } = await supabase
    .from("employee_profiles")
    .select("first_name, last_name")
    .eq("user_id", userId)
    .eq("organisation_id", member.organisation_id)
    .limit(1)
    .maybeSingle();

  const userName = profile
    ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || "Member"
    : "Member";

  return {
    ok: true,
    context: {
      userId,
      organisationId: member.organisation_id as string,
      role: member.role as string,
      userName,
    },
  };
}

function canAdminister(role: string): boolean {
  return role === "admin" || role === "owner";
}

async function writeAuditLog(opts: {
  organisationId: string;
  actorId: string;
  resourceType: string;
  resourceId: string;
  action: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("audit_logs").insert({
    organisation_id: opts.organisationId,
    actor_id: opts.actorId,
    resource_type: opts.resourceType,
    resource_id: opts.resourceId,
    action: opts.action,
    metadata: opts.metadata ?? null,
  });
  if (error) {
    console.error("[tickets] audit_log error:", error.message);
  }
}

async function recordTicketActivity(opts: {
  ticketId: string;
  actorId: string;
  action: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("ticket_activity").insert({
    ticket_id: opts.ticketId,
    actor_id: opts.actorId,
    action: opts.action,
    details: opts.details ?? null,
  });
  if (error) {
    console.error("[tickets] ticket_activity insert error:", error.message);
  }
}

/** Formats a database ticket row into frontend Ticket domain model */
function formatTicket(row: Record<string, unknown>, comments: Array<Record<string, unknown>> = []) {
  const status = (row.status as TicketStatus) || "open";
  const slaTarget = (row.sla_target as string) || null;
  const slaBreached = isSlaBreached(slaTarget, status);

  return {
    id: row.id as string,
    organisationId: row.organisation_id as string,
    ticketNumber: (row.ticket_number as string) || `TICK-${row.id}`,
    title: row.title as string,
    description: (row.description as string) || "",
    category: (row.category as string) || "general",
    priority: (row.priority as TicketPriority) || "medium",
    status,
    requesterId: row.requester_id as string,
    requesterName: (row.requester_name as string) || "Colleague",
    assigneeId: (row.assignee_id as string) ?? null,
    assigneeName: (row.assignee_name as string) || (row.assignee_id ? "Assigned Lead" : undefined),
    departmentId: (row.department_id as string) ?? null,
    slaTarget: slaTarget ? new Date(slaTarget).toISOString() : "In 24 hours",
    slaBreached,
    resolutionNotes: (row.resolution_notes as string) ?? null,
    resolvedAt: (row.resolved_at as string) ?? null,
    closedAt: (row.closed_at as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    comments: comments.map((c) => ({
      id: c.id as string,
      author: (c.author_name as string) || "Colleague",
      avatar: (c.avatar as string) || undefined,
      text: c.text as string,
      isInternal: Boolean(c.is_internal),
      createdAt: c.created_at as string,
    })),
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const ticketsRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET / — list tickets with filters & SLA calculation
// ---------------------------------------------------------------------------
ticketsRoutes.get("/", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const rawQuery = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = TicketQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return errorResponse(c, 400, "Invalid query parameters", parsed.error.flatten().fieldErrors);
  }

  const { page, limit, category, priority, status, assigneeId, requesterId, search } = parsed.data;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("tickets")
    .select(
      "id, organisation_id, ticket_number, title, description, category, priority, status, requester_id, assignee_id, department_id, sla_target, sla_breached, resolution_notes, resolved_at, closed_at, created_at, updated_at",
      { count: "exact" }
    )
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (category) query = query.eq("category", category);
  if (priority) query = query.eq("priority", priority);
  if (status) query = query.eq("status", status);
  if (assigneeId) query = query.eq("assignee_id", assigneeId);
  if (requesterId) query = query.eq("requester_id", requesterId);
  if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

  const { data, error } = await query.range(from, to);

  if (error) {
    console.error("[tickets] list error:", error.message);
    return errorResponse(c, 500, "Failed to fetch tickets");
  }

  const ticketIds = (data ?? []).map((t) => t.id as string);

  // Fetch comments for these tickets
  let commentsByTicket: Record<string, Array<Record<string, unknown>>> = {};
  if (ticketIds.length > 0) {
    const { data: comments } = await supabase
      .from("ticket_comments")
      .select("*")
      .in("ticket_id", ticketIds)
      .order("created_at", { ascending: true });

    if (comments) {
      commentsByTicket = comments.reduce(
        (acc, comment) => {
          const tId = comment.ticket_id as string;
          if (!acc[tId]) acc[tId] = [];
          acc[tId].push(comment);
          return acc;
        },
        {} as Record<string, Array<Record<string, unknown>>>
      );
    }
  }

  const formattedTickets = (data ?? []).map((row) =>
    formatTicket(row, commentsByTicket[row.id as string] || [])
  );

  return c.json(formattedTickets, 200);
});

// ---------------------------------------------------------------------------
// POST / — create ticket
// ---------------------------------------------------------------------------
ticketsRoutes.post("/", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const body = await c.req.json().catch(() => null);
  const parsed = CreateTicketSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const { title, description, category, priority, assigneeId, departmentId, slaTarget } =
    parsed.data;

  const supabase = getSupabaseServiceClient();

  // Generate sequential ticket number
  const { count } = await supabase
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", ctx.organisationId);

  const ticketNumber = formatTicketNumber((count ?? 0) + 1045);

  // Calculate default SLA deadline if not provided
  const computedSla = calculateSlaTarget(priority as TicketPriority);
  const finalSlaTarget = slaTarget ? new Date(slaTarget) : computedSla.targetDate;

  const { data: ticket, error: insertError } = await supabase
    .from("tickets")
    .insert({
      organisation_id: ctx.organisationId,
      ticket_number: ticketNumber,
      title,
      description,
      category,
      priority,
      status: "open",
      requester_id: ctx.userId,
      assignee_id: assigneeId ?? null,
      department_id: departmentId ?? null,
      sla_target: finalSlaTarget.toISOString(),
      sla_breached: false,
    })
    .select()
    .single();

  if (insertError || !ticket) {
    console.error("[tickets] insert error:", insertError?.message);
    return errorResponse(c, 500, "Failed to create ticket");
  }

  await recordTicketActivity({
    ticketId: ticket.id as string,
    actorId: ctx.userId,
    action: "created",
    details: { ticketNumber, priority, category },
  });

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "ticket",
    resourceId: ticket.id as string,
    action: "create",
    metadata: { ticketNumber, title },
  });

  const formatted = formatTicket({ ...ticket, requester_name: ctx.userName }, []);
  return c.json(formatted, 201);
});

// ---------------------------------------------------------------------------
// GET /:id — get single ticket with comments & activity
// ---------------------------------------------------------------------------
ticketsRoutes.get("/:id", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { id } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: ticket, error } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", id)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (error || !ticket) {
    return errorResponse(c, 404, "Ticket not found");
  }

  // Fetch comments
  const { data: comments } = await supabase
    .from("ticket_comments")
    .select("*")
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "ticket",
    resourceId: id,
    action: "view",
  });

  const formatted = formatTicket(ticket, comments ?? []);
  return c.json(formatted, 200);
});

// ---------------------------------------------------------------------------
// PATCH /:id/status — update ticket status
// ---------------------------------------------------------------------------
ticketsRoutes.patch("/:id/status", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { id } = c.req.param();
  const body = await c.req.json().catch(() => null);
  const parsed = UpdateTicketStatusSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const { status, resolutionNotes } = parsed.data;
  const supabase = getSupabaseServiceClient();

  const { data: existing, error: fetchErr } = await supabase
    .from("tickets")
    .select("id, status")
    .eq("id", id)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !existing) {
    return errorResponse(c, 404, "Ticket not found");
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    status,
    updated_at: now,
  };

  if (status === "resolved") {
    updates.resolved_at = now;
  }
  if (status === "closed") {
    updates.closed_at = now;
  }
  if (resolutionNotes !== undefined) {
    updates.resolution_notes = resolutionNotes;
  }

  const { data: updated, error: updateErr } = await supabase
    .from("tickets")
    .update(updates)
    .eq("id", id)
    .eq("organisation_id", ctx.organisationId)
    .select()
    .single();

  if (updateErr || !updated) {
    console.error("[tickets] update status error:", updateErr?.message);
    return errorResponse(c, 500, "Failed to update ticket status");
  }

  await recordTicketActivity({
    ticketId: id,
    actorId: ctx.userId,
    action: "status_changed",
    details: { oldStatus: existing.status, newStatus: status, resolutionNotes },
  });

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "ticket",
    resourceId: id,
    action: "status_change",
    metadata: { oldStatus: existing.status, newStatus: status },
  });

  const { data: comments } = await supabase
    .from("ticket_comments")
    .select("*")
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });

  const formatted = formatTicket(updated, comments ?? []);
  return c.json(formatted, 200);
});

// ---------------------------------------------------------------------------
// PATCH /:id — update ticket details
// ---------------------------------------------------------------------------
ticketsRoutes.patch("/:id", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { id } = c.req.param();
  const body = await c.req.json().catch(() => null);
  const parsed = UpdateTicketSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const supabase = getSupabaseServiceClient();

  const { data: existing, error: fetchErr } = await supabase
    .from("tickets")
    .select("id, priority, status")
    .eq("id", id)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !existing) {
    return errorResponse(c, 404, "Ticket not found");
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    updated_at: now,
  };

  const { title, description, category, priority, assigneeId, departmentId, status, resolutionNotes } =
    parsed.data;

  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (category !== undefined) updates.category = category;
  if (assigneeId !== undefined) updates.assignee_id = assigneeId;
  if (departmentId !== undefined) updates.department_id = departmentId;
  if (resolutionNotes !== undefined) updates.resolution_notes = resolutionNotes;

  if (priority !== undefined) {
    updates.priority = priority;
    const newSla = calculateSlaTarget(priority as TicketPriority);
    updates.sla_target = newSla.targetDate.toISOString();
  }

  if (status !== undefined) {
    updates.status = status;
    if (status === "resolved") updates.resolved_at = now;
    if (status === "closed") updates.closed_at = now;
  }

  const { data: updated, error: updateErr } = await supabase
    .from("tickets")
    .update(updates)
    .eq("id", id)
    .eq("organisation_id", ctx.organisationId)
    .select()
    .single();

  if (updateErr || !updated) {
    return errorResponse(c, 500, "Failed to update ticket");
  }

  await recordTicketActivity({
    ticketId: id,
    actorId: ctx.userId,
    action: "updated",
    details: parsed.data,
  });

  const { data: comments } = await supabase
    .from("ticket_comments")
    .select("*")
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });

  const formatted = formatTicket(updated, comments ?? []);
  return c.json(formatted, 200);
});

// ---------------------------------------------------------------------------
// POST /:id/comments — append discussion or resolution note
// ---------------------------------------------------------------------------
ticketsRoutes.post("/:id/comments", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { id } = c.req.param();
  const body = await c.req.json().catch(() => null);
  const parsed = AddTicketCommentSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const { text, isInternal } = parsed.data;
  const supabase = getSupabaseServiceClient();

  const { data: ticket, error: fetchErr } = await supabase
    .from("tickets")
    .select("id")
    .eq("id", id)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !ticket) {
    return errorResponse(c, 404, "Ticket not found");
  }

  const { error: commentErr } = await supabase.from("ticket_comments").insert({
    ticket_id: id,
    author_id: ctx.userId,
    author_name: ctx.userName,
    avatar: ctx.avatar ?? null,
    text,
    is_internal: isInternal,
  });

  if (commentErr) {
    console.error("[tickets] comment insert error:", commentErr.message);
    return errorResponse(c, 500, "Failed to post comment");
  }

  await supabase
    .from("tickets")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);

  await recordTicketActivity({
    ticketId: id,
    actorId: ctx.userId,
    action: "comment_added",
    details: { isInternal },
  });

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "ticket",
    resourceId: id,
    action: "comment",
  });

  // Fetch all comments and return full updated ticket
  const { data: comments } = await supabase
    .from("ticket_comments")
    .select("*")
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });

  const { data: fullTicket } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", id)
    .single();

  const formatted = formatTicket(fullTicket ?? ticket, comments ?? []);
  return c.json(formatted, 201);
});

// ---------------------------------------------------------------------------
// GET /:id/activity — view ticket lifecycle audit timeline
// ---------------------------------------------------------------------------
ticketsRoutes.get("/:id/activity", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { id } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: ticket } = await supabase
    .from("tickets")
    .select("id")
    .eq("id", id)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (!ticket) {
    return errorResponse(c, 404, "Ticket not found");
  }

  const { data: activities, error } = await supabase
    .from("ticket_activity")
    .select("*")
    .eq("ticket_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    return errorResponse(c, 500, "Failed to fetch ticket activity");
  }

  return c.json({ data: activities ?? [] }, 200);
});

// ---------------------------------------------------------------------------
// DELETE /:id — soft-delete ticket
// ---------------------------------------------------------------------------
ticketsRoutes.delete("/:id", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { id } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: ticket, error: fetchErr } = await supabase
    .from("tickets")
    .select("id, requester_id")
    .eq("id", id)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !ticket) {
    return errorResponse(c, 404, "Ticket not found");
  }

  if (!canAdminister(ctx.role) && ticket.requester_id !== ctx.userId) {
    return errorResponse(c, 403, "Only the requester or an administrator can delete this ticket");
  }

  const { error: deleteErr } = await supabase
    .from("tickets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (deleteErr) {
    return errorResponse(c, 500, "Failed to delete ticket");
  }

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "ticket",
    resourceId: id,
    action: "delete",
  });

  return c.json({ success: true }, 200);
});

export default ticketsRoutes;
