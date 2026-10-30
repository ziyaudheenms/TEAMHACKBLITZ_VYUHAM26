/**
 * /api/v1/notifications
 *
 * In-App Alerts, Mentions, Notifications Centre & Delivery Preferences.
 * Mapped to IMPLEMENTATION.md Sections 2.9, 8.3, and 11.
 *
 * All routes require a valid Bearer token. Tenant isolation is enforced
 * in application code using organisation_id and recipient_id.
 *
 * Security & Delivery Rules
 * -------------------------
 * • Notifications are private to the recipient within an organisation.
 * • Preferences control delivery by channel (in-app, email) and event category.
 * • Real-time badge unread counter endpoint for responsive UI headers.
 * • Fast mark-all-read and dismiss / soft-delete flows.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import {
  NotificationQuerySchema,
  CreateNotificationSchema,
  UpdateNotificationPreferencesSchema,
} from "@bizcontext/validation";
import {
  formatNotification,
  getDefaultPreferences,
  shouldDeliverNotification,
  type NotificationCategory,
} from "@bizcontext/module-notifications";
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

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const notificationsRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /unread-count — fast badge counter for headers
// ---------------------------------------------------------------------------
notificationsRoutes.get("/unread-count", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const supabase = getSupabaseServiceClient();

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", ctx.organisationId)
    .eq("recipient_id", ctx.userId)
    .eq("is_read", false)
    .is("deleted_at", null);

  if (error) {
    return errorResponse(c, 500, "Failed to count unread notifications");
  }

  return c.json({ unreadCount: count ?? 0 }, 200);
});

// ---------------------------------------------------------------------------
// GET /preferences — fetch user notification preferences
// ---------------------------------------------------------------------------
notificationsRoutes.get("/preferences", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("organisation_id", ctx.organisationId)
    .eq("user_id", ctx.userId)
    .single();

  if (error || !data) {
    // Return default preferences when row does not exist yet
    const defaults = getDefaultPreferences(ctx.organisationId, ctx.userId);
    return c.json({ data: defaults }, 200);
  }

  return c.json(
    {
      data: {
        id: data.id,
        organisationId: data.organisation_id,
        userId: data.user_id,
        emailNotifications: Boolean(data.email_notifications),
        inAppNotifications: Boolean(data.in_app_notifications),
        taskAssigned: Boolean(data.task_assigned),
        ticketUpdates: Boolean(data.ticket_updates),
        mentions: Boolean(data.mentions),
        approvalRequests: Boolean(data.approval_requests),
        systemAnnouncements: Boolean(data.system_announcements),
        dailyDigest: Boolean(data.daily_digest),
        updatedAt: data.updated_at,
      },
    },
    200
  );
});

// ---------------------------------------------------------------------------
// PUT /preferences — update user notification preferences
// ---------------------------------------------------------------------------
notificationsRoutes.put("/preferences", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const body = await c.req.json().catch(() => null);
  const parsed = UpdateNotificationPreferencesSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const supabase = getSupabaseServiceClient();
  const now = new Date().toISOString();

  const updates: Record<string, unknown> = {
    organisation_id: ctx.organisationId,
    user_id: ctx.userId,
    updated_at: now,
  };

  const {
    emailNotifications,
    inAppNotifications,
    taskAssigned,
    ticketUpdates,
    mentions,
    approvalRequests,
    systemAnnouncements,
    dailyDigest,
  } = parsed.data;

  if (emailNotifications !== undefined) updates.email_notifications = emailNotifications;
  if (inAppNotifications !== undefined) updates.in_app_notifications = inAppNotifications;
  if (taskAssigned !== undefined) updates.task_assigned = taskAssigned;
  if (ticketUpdates !== undefined) updates.ticket_updates = ticketUpdates;
  if (mentions !== undefined) updates.mentions = mentions;
  if (approvalRequests !== undefined) updates.approval_requests = approvalRequests;
  if (systemAnnouncements !== undefined) updates.system_announcements = systemAnnouncements;
  if (dailyDigest !== undefined) updates.daily_digest = dailyDigest;

  const { data: updated, error } = await supabase
    .from("notification_preferences")
    .upsert(updates, { onConflict: "organisation_id,user_id" })
    .select()
    .single();

  if (error || !updated) {
    console.error("[notifications] update preferences error:", error?.message);
    return errorResponse(c, 500, "Failed to update notification preferences");
  }

  return c.json(
    {
      data: {
        id: updated.id,
        organisationId: updated.organisation_id,
        userId: updated.user_id,
        emailNotifications: Boolean(updated.email_notifications),
        inAppNotifications: Boolean(updated.in_app_notifications),
        taskAssigned: Boolean(updated.task_assigned),
        ticketUpdates: Boolean(updated.ticket_updates),
        mentions: Boolean(updated.mentions),
        approvalRequests: Boolean(updated.approval_requests),
        systemAnnouncements: Boolean(updated.system_announcements),
        dailyDigest: Boolean(updated.daily_digest),
        updatedAt: updated.updated_at,
      },
    },
    200
  );
});

// ---------------------------------------------------------------------------
// PATCH /read-all — mark all notifications as read for current user
// ---------------------------------------------------------------------------
notificationsRoutes.patch("/read-all", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const supabase = getSupabaseServiceClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("notifications")
    .update({
      is_read: true,
      read_at: now,
    })
    .eq("organisation_id", ctx.organisationId)
    .eq("recipient_id", ctx.userId)
    .eq("is_read", false)
    .is("deleted_at", null);

  if (error) {
    return errorResponse(c, 500, "Failed to mark all notifications as read");
  }

  return c.json({ success: true, timestamp: now }, 200);
});

// ---------------------------------------------------------------------------
// GET / — list notifications with pagination, filters & unread count
// ---------------------------------------------------------------------------
notificationsRoutes.get("/", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const rawQuery = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = NotificationQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return errorResponse(c, 400, "Invalid query parameters", parsed.error.flatten().fieldErrors);
  }

  const { page, limit, isRead, category } = parsed.data;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("notifications")
    .select(
      "id, organisation_id, recipient_id, actor_id, category, title, body, link_url, resource_type, resource_id, priority, is_read, read_at, metadata, created_at",
      { count: "exact" }
    )
    .eq("organisation_id", ctx.organisationId)
    .eq("recipient_id", ctx.userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (isRead !== undefined) query = query.eq("is_read", isRead);
  if (category) query = query.eq("category", category);

  const { data, error, count } = await query.range(from, to);

  if (error) {
    console.error("[notifications] list error:", error.message);
    return errorResponse(c, 500, "Failed to fetch notifications");
  }

  // Get total unread count for the user
  const { count: unreadCount } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", ctx.organisationId)
    .eq("recipient_id", ctx.userId)
    .eq("is_read", false)
    .is("deleted_at", null);

  const formatted = (data ?? []).map((row) => formatNotification(row));

  return c.json(
    {
      data: formatted,
      unreadCount: unreadCount ?? 0,
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    },
    200
  );
});

// ---------------------------------------------------------------------------
// POST / — dispatch a new notification
// ---------------------------------------------------------------------------
notificationsRoutes.post("/", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const body = await c.req.json().catch(() => null);
  const parsed = CreateNotificationSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const {
    recipientId,
    category,
    title,
    body: notifBody,
    linkUrl,
    resourceType,
    resourceId,
    priority,
    metadata,
  } = parsed.data;

  const supabase = getSupabaseServiceClient();

  // The recipient must belong to the sender's organisation (no cross-tenant messaging).
  const { data: recipientMembership } = await supabase
    .from("organisation_members")
    .select("id")
    .eq("organisation_id", ctx.organisationId)
    .eq("user_id", recipientId)
    .is("left_at", null)
    .maybeSingle();
  if (!recipientMembership) {
    return errorResponse(c, 404, "Recipient not found in this organisation");
  }

  // Check recipient preferences
  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("organisation_id", ctx.organisationId)
    .eq("user_id", recipientId)
    .single();

  const effectivePrefs = prefs
    ? {
        id: prefs.id,
        organisationId: prefs.organisation_id,
        userId: prefs.user_id,
        emailNotifications: Boolean(prefs.email_notifications),
        inAppNotifications: Boolean(prefs.in_app_notifications),
        taskAssigned: Boolean(prefs.task_assigned),
        ticketUpdates: Boolean(prefs.ticket_updates),
        mentions: Boolean(prefs.mentions),
        approvalRequests: Boolean(prefs.approval_requests),
        systemAnnouncements: Boolean(prefs.system_announcements),
        dailyDigest: Boolean(prefs.daily_digest),
        updatedAt: prefs.updated_at,
      }
    : getDefaultPreferences(ctx.organisationId, recipientId);

  // If user disabled in-app delivery for this category, skip
  if (!shouldDeliverNotification(effectivePrefs, category as NotificationCategory, "in_app")) {
    return c.json(
      {
        message: "Notification skipped based on recipient preferences",
        delivered: false,
      },
      200
    );
  }

  const { data: created, error } = await supabase
    .from("notifications")
    .insert({
      organisation_id: ctx.organisationId,
      recipient_id: recipientId,
      actor_id: ctx.userId,
      category,
      title,
      body: notifBody,
      link_url: linkUrl ?? null,
      resource_type: resourceType ?? null,
      resource_id: resourceId ?? null,
      priority,
      is_read: false,
      metadata: metadata ?? null,
    })
    .select()
    .single();

  if (error || !created) {
    console.error("[notifications] create error:", error?.message);
    return errorResponse(c, 500, "Failed to create notification");
  }

  return c.json(
    {
      data: formatNotification(created, ctx.userName),
      delivered: true,
    },
    201
  );
});

// ---------------------------------------------------------------------------
// PATCH /:id/read — mark single notification as read
// ---------------------------------------------------------------------------
notificationsRoutes.patch("/:id/read", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { id } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: existing, error: fetchErr } = await supabase
    .from("notifications")
    .select("id, recipient_id")
    .eq("id", id)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !existing) {
    return errorResponse(c, 404, "Notification not found");
  }

  if (existing.recipient_id !== ctx.userId) {
    return errorResponse(c, 403, "Access denied to notification");
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from("notifications")
    .update({
      is_read: true,
      read_at: now,
    })
    .eq("id", id)
    .select()
    .single();

  if (updateErr || !updated) {
    return errorResponse(c, 500, "Failed to update notification");
  }

  return c.json({ data: formatNotification(updated) }, 200);
});

// ---------------------------------------------------------------------------
// DELETE /:id — soft-delete / dismiss notification
// ---------------------------------------------------------------------------
notificationsRoutes.delete("/:id", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { id } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: existing, error: fetchErr } = await supabase
    .from("notifications")
    .select("id, recipient_id")
    .eq("id", id)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !existing) {
    return errorResponse(c, 404, "Notification not found");
  }

  if (existing.recipient_id !== ctx.userId) {
    return errorResponse(c, 403, "Access denied to notification");
  }

  const { error: deleteErr } = await supabase
    .from("notifications")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (deleteErr) {
    return errorResponse(c, 500, "Failed to dismiss notification");
  }

  return c.json({ success: true }, 200);
});

export default notificationsRoutes;
