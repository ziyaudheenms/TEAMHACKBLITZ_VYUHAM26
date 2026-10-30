/**
 * /api/v1/meetings
 *
 * Meeting Hub, Minutes, OCR Transcripts, AI Summary & Action Item Extractor.
 * Mapped to FRONTEND_API_CONTRACT.md Section 2.7, Migration 006, and IMPLEMENTATION.md.
 *
 * All routes require a valid Bearer token. Multi-tenant organisation scoping
 * is enforced on every request.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import {
  CreateMeetingSchema,
  UpdateMeetingSchema,
  MeetingQuerySchema,
  CreateMeetingActionItemSchema,
  UpdateMeetingActionItemSchema,
  ExtractActionItemsSchema,
  ConvertActionItemToTaskSchema,
} from "@bizcontext/validation";
import {
  parseMinutesContentHeuristic,
  buildMeetingAnalysisPrompt,
  type ExtractedActionItemResult,
} from "@bizcontext/module-meetings";
import { getSupabaseServiceClient } from "../lib/supabase";
import { getAuthContext, type AuthContext } from "../lib/auth";
import { aiEngineClient } from "../services/ai-engine.client";

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

interface UserOrgContext {
  userId: string;
  email: string;
  organisationId: string;
  userName: string;
}

/**
 * Resolves user authentication context and organisation membership.
 */
async function resolveOrgContext(
  c: Context
): Promise<{ ok: true; context: UserOrgContext } | { ok: false; response: Response }> {
  const auth = await getAuthContext(c);
  if (!auth) {
    return { ok: false, response: errorResponse(c, 401, "Unauthorized") as Response };
  }

  const supabase = getSupabaseServiceClient();

  // Header override if specified, otherwise query organisation_members
  const headerOrgId = c.req.header("X-Organisation-Id");
  let organisationId = headerOrgId;

  if (!organisationId) {
    const { data: member } = await supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", auth.userId)
      .is("left_at", null)
      .order("joined_at", { ascending: false })
      .limit(1)
      .single();

    if (member?.organisation_id) {
      organisationId = member.organisation_id as string;
    }
  }

  // Fallback to first organisation if available (e.g. initial dev seed)
  if (!organisationId) {
    const { data: firstOrg } = await supabase
      .from("organisations")
      .select("id")
      .limit(1)
      .single();
    organisationId = firstOrg?.id ?? "00000000-0000-0000-0000-000000000001";
  }

  const { data: profile } = await supabase
    .from("employee_profiles")
    .select("first_name, last_name")
    .eq("user_id", auth.userId)
    .limit(1)
    .single();

  const userName = profile
    ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || auth.email
    : auth.email || "Member";

  return {
    ok: true,
    context: {
      userId: auth.userId,
      email: auth.email,
      organisationId: organisationId || "00000000-0000-0000-0000-000000000001",
      userName,
    },
  };
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
    console.error("[meetings] audit_log error:", error.message);
  }
}

/** Formats database meeting row + action items into frontend Meeting shape */
function formatMeeting(
  row: Record<string, unknown>,
  actionItems: Array<Record<string, unknown>> = [],
  projectName?: string
) {
  const participantIds: string[] = Array.isArray(row.participant_ids)
    ? (row.participant_ids as string[])
    : [];
  const participantNames: string[] = Array.isArray(row.participant_names)
    ? (row.participant_names as string[])
    : [];

  return {
    id: String(row.id),
    organisationId: String(row.organisation_id),
    createdBy: row.created_by ? String(row.created_by) : "system",
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    title: String(row.title ?? "Untitled Meeting"),
    agenda: (row.agenda as string) ?? undefined,
    meetingDate: (row.meeting_date as string) ?? new Date().toISOString(),
    durationMinutes: Number(row.duration_minutes ?? 30),
    participantIds,
    participantNames,
    projectId: (row.project_id as string) ?? undefined,
    projectName: projectName || (row.project_name as string) || undefined,
    minutesContent: (row.minutes_content as string) ?? "",
    aiSummary: (row.ai_summary as string) ?? undefined,
    extractedActionItems: actionItems.map((act) => ({
      id: String(act.id),
      title: String(act.title),
      assignee: String(act.assignee),
      dueDate: String(act.due_date ?? ""),
      priority: (act.priority as "low" | "medium" | "high" | "urgent") || "medium",
      convertedToTask: Boolean(act.converted_to_task),
      taskId: (act.task_id as string) ?? undefined,
    })),
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const meetingsRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET / — list meetings with filters
// ---------------------------------------------------------------------------
meetingsRoutes.get("/", async (c) => {
  const auth = await resolveOrgContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const rawQuery = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = MeetingQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return errorResponse(c, 400, "Invalid query parameters", parsed.error.flatten().fieldErrors);
  }

  const { page, limit, projectId, search } = parsed.data;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("meetings")
    .select("*", { count: "exact" })
    .eq("organisation_id", ctx.organisationId)
    .order("meeting_date", { ascending: false });

  if (projectId) {
    query = query.eq("project_id", projectId);
  }
  if (search) {
    query = query.or(`title.ilike.%${search}%,agenda.ilike.%${search}%,minutes_content.ilike.%${search}%`);
  }

  const { data: meetings, error } = await query.range(from, to);

  if (error) {
    console.error("[meetings] list error:", error.message);
    return errorResponse(c, 500, "Failed to fetch meetings");
  }

  const meetingList = meetings ?? [];
  const meetingIds = meetingList.map((m) => m.id as string);

  // Fetch action items for all returned meetings
  let actionItemsByMeeting: Record<string, Array<Record<string, unknown>>> = {};
  if (meetingIds.length > 0) {
    const { data: actionItems } = await supabase
      .from("meeting_action_items")
      .select("*")
      .in("meeting_id", meetingIds)
      .order("created_at", { ascending: true });

    if (actionItems) {
      actionItemsByMeeting = actionItems.reduce(
        (acc, item) => {
          const mId = item.meeting_id as string;
          if (!acc[mId]) acc[mId] = [];
          acc[mId].push(item);
          return acc;
        },
        {} as Record<string, Array<Record<string, unknown>>>
      );
    }
  }

  // Fetch project names
  const projectIds = Array.from(new Set(meetingList.map((m) => m.project_id).filter(Boolean)));
  const projectNameMap: Record<string, string> = {};
  if (projectIds.length > 0) {
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name")
      .in("id", projectIds);
    if (projects) {
      for (const p of projects) {
        projectNameMap[p.id as string] = p.name as string;
      }
    }
  }

  const formatted = meetingList.map((row) =>
    formatMeeting(
      row,
      actionItemsByMeeting[row.id as string] || [],
      row.project_id ? projectNameMap[row.project_id as string] : undefined
    )
  );

  return c.json(formatted, 200);
});

// ---------------------------------------------------------------------------
// POST / — create meeting record
// ---------------------------------------------------------------------------
meetingsRoutes.post("/", async (c) => {
  const auth = await resolveOrgContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const body = await c.req.json().catch(() => null);
  const parsed = CreateMeetingSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const {
    title,
    agenda,
    meetingDate,
    durationMinutes,
    projectId,
    participantIds,
    participantNames,
    minutesContent,
    aiSummary,
    actionItems,
  } = parsed.data;

  const supabase = getSupabaseServiceClient();

  const insertMeeting = {
    organisation_id: ctx.organisationId,
    title,
    agenda: agenda ?? null,
    meeting_date: meetingDate,
    project_id: projectId ?? null,
    minutes_content: minutesContent ?? "",
    created_by: ctx.userId,
  };

  const { data: meeting, error: insertErr } = await supabase
    .from("meetings")
    .insert(insertMeeting)
    .select()
    .single();

  if (insertErr || !meeting) {
    console.error("[meetings] create error:", insertErr?.message);
    return errorResponse(c, 500, "Failed to create meeting");
  }

  const createdActionItems: Array<Record<string, unknown>> = [];

  // Insert any pre-specified action items
  if (actionItems && actionItems.length > 0) {
    const actionRows = actionItems.map((act) => ({
      meeting_id: meeting.id,
      organisation_id: ctx.organisationId,
      title: act.title,
      assignee: act.assignee,
      assignee_id: act.assigneeId ?? null,
      due_date: act.dueDate ?? null,
      priority: act.priority,
      converted_to_task: false,
    }));

    const { data: insertedActions } = await supabase
      .from("meeting_action_items")
      .insert(actionRows)
      .select();

    if (insertedActions) {
      createdActionItems.push(...insertedActions);
    }
  }

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "meeting",
    resourceId: meeting.id as string,
    action: "create",
    metadata: { title },
  });

  let projectName: string | undefined;
  if (projectId) {
    const { data: proj } = await supabase
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .single();
    projectName = proj?.name;
  }

  const formatted = formatMeeting(meeting, createdActionItems, projectName);
  return c.json(formatted, 201);
});

// ---------------------------------------------------------------------------
// GET /:id — get single meeting with action items
// ---------------------------------------------------------------------------
meetingsRoutes.get("/:id", async (c) => {
  const auth = await resolveOrgContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { id } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: meeting, error } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", id)
    .eq("organisation_id", ctx.organisationId)
    .single();

  if (error || !meeting) {
    return errorResponse(c, 404, "Meeting not found");
  }

  const { data: actionItems } = await supabase
    .from("meeting_action_items")
    .select("*")
    .eq("meeting_id", id)
    .order("created_at", { ascending: true });

  let projectName: string | undefined;
  if (meeting.project_id) {
    const { data: proj } = await supabase
      .from("projects")
      .select("name")
      .eq("id", meeting.project_id)
      .single();
    projectName = proj?.name;
  }

  const formatted = formatMeeting(meeting, actionItems ?? [], projectName);
  return c.json(formatted, 200);
});

// ---------------------------------------------------------------------------
// PATCH /:id — update meeting metadata or transcript
// ---------------------------------------------------------------------------
meetingsRoutes.patch("/:id", async (c) => {
  const auth = await resolveOrgContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { id } = c.req.param();
  const body = await c.req.json().catch(() => null);
  const parsed = UpdateMeetingSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const supabase = getSupabaseServiceClient();

  const { data: existing, error: fetchErr } = await supabase
    .from("meetings")
    .select("id")
    .eq("id", id)
    .eq("organisation_id", ctx.organisationId)
    .single();

  if (fetchErr || !existing) {
    return errorResponse(c, 404, "Meeting not found");
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  const {
    title,
    agenda,
    meetingDate,
    durationMinutes,
    projectId,
    participantIds,
    participantNames,
    minutesContent,
    aiSummary,
  } = parsed.data;

  if (title !== undefined) updates.title = title;
  if (agenda !== undefined) updates.agenda = agenda;
  if (meetingDate !== undefined) updates.meeting_date = meetingDate;
  if (durationMinutes !== undefined) updates.duration_minutes = durationMinutes;
  if (projectId !== undefined) updates.project_id = projectId;
  if (participantIds !== undefined) updates.participant_ids = participantIds;
  if (participantNames !== undefined) updates.participant_names = participantNames;
  if (minutesContent !== undefined) updates.minutes_content = minutesContent;
  if (aiSummary !== undefined) updates.ai_summary = aiSummary;

  const { data: updated, error: updateErr } = await supabase
    .from("meetings")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (updateErr || !updated) {
    return errorResponse(c, 500, "Failed to update meeting");
  }

  const { data: actionItems } = await supabase
    .from("meeting_action_items")
    .select("*")
    .eq("meeting_id", id)
    .order("created_at", { ascending: true });

  const formatted = formatMeeting(updated, actionItems ?? []);
  return c.json(formatted, 200);
});

// ---------------------------------------------------------------------------
// DELETE /:id — soft delete meeting
// ---------------------------------------------------------------------------
meetingsRoutes.delete("/:id", async (c) => {
  const auth = await resolveOrgContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { id } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: existing, error: fetchErr } = await supabase
    .from("meetings")
    .select("id, title")
    .eq("id", id)
    .eq("organisation_id", ctx.organisationId)
    .single();

  if (fetchErr || !existing) {
    return errorResponse(c, 404, "Meeting not found");
  }

  const { error: delErr } = await supabase
    .from("meetings")
    .delete()
    .eq("id", id);

  if (delErr) {
    return errorResponse(c, 500, "Failed to delete meeting");
  }

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "meeting",
    resourceId: id,
    action: "delete",
    metadata: { title: existing.title },
  });

  return c.json({ success: true }, 200);
});

// ---------------------------------------------------------------------------
// POST /:id/extract-action-items — AI Action Item & Summary Extraction
// ---------------------------------------------------------------------------
meetingsRoutes.post("/:id/extract-action-items", async (c) => {
  const auth = await resolveOrgContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const parsed = ExtractActionItemsSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const supabase = getSupabaseServiceClient();

  const { data: meeting, error: fetchErr } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", id)
    .eq("organisation_id", ctx.organisationId)
    .single();

  if (fetchErr || !meeting) {
    return errorResponse(c, 404, "Meeting not found");
  }

  const rawContent = parsed.data.minutesContent || meeting.minutes_content || "";
  const attendees: string[] = Array.isArray(meeting.participant_names)
    ? (meeting.participant_names as string[])
    : [];

  let aiSummary = "";
  let extractedItems: ExtractedActionItemResult[] = [];

  // 1. Attempt LLM extraction via AI Engine
  try {
    const prompt = buildMeetingAnalysisPrompt(meeting.title, rawContent, attendees);
    const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");

    const aiRes = await aiEngineClient.runAgent({
      prompt,
      userId: ctx.userId,
      organisationId: ctx.organisationId,
      agentRole: "meeting_secretary",
      systemPrompt: "You are an enterprise AI meeting secretary that extracts summaries and action items in strict JSON.",
      authToken: token,
    });

    if (aiRes.response) {
      // Clean JSON if model returned markdown code fences
      const cleanJson = aiRes.response
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
      const parsedAi = JSON.parse(cleanJson);
      if (parsedAi.aiSummary) aiSummary = String(parsedAi.aiSummary);
      if (Array.isArray(parsedAi.actionItems)) {
        extractedItems = parsedAi.actionItems.map((item: any) => ({
          title: String(item.title || "Follow-up task"),
          assignee: String(item.assignee || attendees[0] || "Team Member"),
          dueDate: String(item.dueDate || new Date().toISOString().slice(0, 10)),
          priority: (item.priority as "low" | "medium" | "high" | "urgent") || "medium",
          convertedToTask: false,
        }));
      }
    }
  } catch (err: any) {
    console.warn("[meetings] AI Engine extraction unavailable, using heuristic fallback:", err?.message);
  }

  // 2. Resilient fallback: If AI Engine failed or returned empty items, use heuristic parser
  if (!aiSummary || extractedItems.length === 0) {
    const heuristic = parseMinutesContentHeuristic(rawContent, attendees);
    if (!aiSummary) aiSummary = heuristic.aiSummary;
    if (extractedItems.length === 0) extractedItems = heuristic.actionItems;
  }

  // 3. Persist AI summary and updated minutes to database
  await supabase
    .from("meetings")
    .update({
      minutes_content: rawContent,
      ai_summary: aiSummary,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  // 4. Fetch existing action items to avoid duplicates
  const { data: existingActions } = await supabase
    .from("meeting_action_items")
    .select("id, title, converted_to_task, task_id")
    .eq("meeting_id", id);

  const existingTitles = new Set((existingActions ?? []).map((a) => a.title.toLowerCase().trim()));

  const newRows = extractedItems
    .filter((item) => !existingTitles.has(item.title.toLowerCase().trim()))
    .map((item) => ({
      meeting_id: id,
      organisation_id: ctx.organisationId,
      title: item.title,
      assignee: item.assignee,
      due_date: item.dueDate,
      priority: item.priority,
      converted_to_task: false,
    }));

  if (newRows.length > 0) {
    await supabase.from("meeting_action_items").insert(newRows);
  }

  // 5. Fetch full updated meeting & action items
  const { data: finalMeeting } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", id)
    .single();

  const { data: allActions } = await supabase
    .from("meeting_action_items")
    .select("*")
    .eq("meeting_id", id)
    .order("created_at", { ascending: true });

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "meeting",
    resourceId: id,
    action: "extract_action_items",
    metadata: { extractedCount: extractedItems.length },
  });

  const formatted = formatMeeting(finalMeeting ?? meeting, allActions ?? []);
  return c.json(formatted, 200);
});

// ---------------------------------------------------------------------------
// POST /:id/action-items/:actionId/convert-to-task — convert action item to Kanban task
// ---------------------------------------------------------------------------
meetingsRoutes.post("/:id/action-items/:actionId/convert-to-task", async (c) => {
  const auth = await resolveOrgContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { id: meetingId, actionId } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const parsed = ConvertActionItemToTaskSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const supabase = getSupabaseServiceClient();

  // Find meeting
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, title, project_id")
    .eq("id", meetingId)
    .eq("organisation_id", ctx.organisationId)
    .single();

  if (!meeting) {
    return errorResponse(c, 404, "Meeting not found");
  }

  // Find action item
  const { data: actionItem, error: actErr } = await supabase
    .from("meeting_action_items")
    .select("*")
    .eq("id", actionId)
    .eq("meeting_id", meetingId)
    .single();

  if (actErr || !actionItem) {
    return errorResponse(c, 404, "Action item not found");
  }

  const targetProjectId = parsed.data.projectId || meeting.project_id || null;

  // Lookup project name if project exists
  let projectName: string | null = null;
  if (targetProjectId) {
    const { data: proj } = await supabase
      .from("projects")
      .select("name")
      .eq("id", targetProjectId)
      .single();
    projectName = proj?.name ?? null;
  }

  // Create Kanban task
  const insertTask = {
    title: actionItem.title,
    description: `Auto-generated from meeting: "${meeting.title}". Assigned during action item extraction.`,
    project_id: targetProjectId,
    project_name: projectName,
    assignee_name: actionItem.assignee,
    primary_assignee_id: parsed.data.primaryAssigneeId ?? actionItem.assignee_id ?? null,
    priority: actionItem.priority || "medium",
    status: parsed.data.status || "open",
    due_date: actionItem.due_date ? new Date(actionItem.due_date).toISOString() : null,
    organisation_id: ctx.organisationId,
    created_by: ctx.userId,
    collaborator_ids: [],
    subtasks: [],
  };

  const { data: createdTask, error: taskErr } = await supabase
    .from("tasks")
    .insert(insertTask)
    .select()
    .single();

  if (taskErr || !createdTask) {
    console.error("[meetings] convert to task error:", taskErr?.message);
    return errorResponse(c, 500, "Failed to create task from action item");
  }

  // Mark action item as converted
  await supabase
    .from("meeting_action_items")
    .update({
      converted_to_task: true,
      task_id: createdTask.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", actionId);

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "meeting_action_item",
    resourceId: actionId,
    action: "convert_to_task",
    metadata: { taskId: createdTask.id, taskTitle: createdTask.title },
  });

  return c.json({
    success: true,
    task: createdTask,
    actionItemId: actionId,
  }, 201);
});

// Alias for convenience: POST /:id/convert-action-item with body { actionId }
meetingsRoutes.post("/:id/convert-action-item", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const actionId = body.actionId || body.actionItemId;
  if (!actionId) {
    return errorResponse(c, 400, "actionId is required in body");
  }

  // Delegate to the main convert handler
  const { id: meetingId } = c.req.param();
  c.req.param = ((name?: string) => {
    if (name === "id") return meetingId;
    if (name === "actionId") return actionId;
    return undefined as any;
  }) as any;

  // Call the conversion logic directly
  const auth = await resolveOrgContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const supabase = getSupabaseServiceClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, title, project_id")
    .eq("id", meetingId)
    .eq("organisation_id", ctx.organisationId)
    .single();

  if (!meeting) return errorResponse(c, 404, "Meeting not found");

  const { data: actionItem } = await supabase
    .from("meeting_action_items")
    .select("*")
    .eq("id", actionId)
    .eq("meeting_id", meetingId)
    .single();

  if (!actionItem) return errorResponse(c, 404, "Action item not found");

  const insertTask = {
    title: actionItem.title,
    description: `Auto-generated from meeting: "${meeting.title}". Assigned during action item extraction.`,
    project_id: meeting.project_id || null,
    assignee_name: actionItem.assignee,
    priority: actionItem.priority || "medium",
    status: "open",
    due_date: actionItem.due_date ? new Date(actionItem.due_date).toISOString() : null,
    organisation_id: ctx.organisationId,
    created_by: ctx.userId,
    collaborator_ids: [],
    subtasks: [],
  };

  const { data: createdTask, error: taskErr } = await supabase
    .from("tasks")
    .insert(insertTask)
    .select()
    .single();

  if (taskErr || !createdTask) {
    return errorResponse(c, 500, "Failed to create task from action item");
  }

  await supabase
    .from("meeting_action_items")
    .update({
      converted_to_task: true,
      task_id: createdTask.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", actionId);

  return c.json({
    success: true,
    task: createdTask,
    actionItemId: actionId,
  }, 201);
});

// ---------------------------------------------------------------------------
// POST /:id/action-items — add manual action item
// ---------------------------------------------------------------------------
meetingsRoutes.post("/:id/action-items", async (c) => {
  const auth = await resolveOrgContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { id: meetingId } = c.req.param();
  const body = await c.req.json().catch(() => null);
  const parsed = CreateMeetingActionItemSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const supabase = getSupabaseServiceClient();

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id")
    .eq("id", meetingId)
    .eq("organisation_id", ctx.organisationId)
    .single();

  if (!meeting) {
    return errorResponse(c, 404, "Meeting not found");
  }

  const { data: created, error } = await supabase
    .from("meeting_action_items")
    .insert({
      meeting_id: meetingId,
      organisation_id: ctx.organisationId,
      title: parsed.data.title,
      assignee: parsed.data.assignee,
      assignee_id: parsed.data.assigneeId ?? null,
      due_date: parsed.data.dueDate ?? null,
      priority: parsed.data.priority,
      converted_to_task: false,
    })
    .select()
    .single();

  if (error || !created) {
    return errorResponse(c, 500, "Failed to create action item");
  }

  return c.json(created, 201);
});

// ---------------------------------------------------------------------------
// PATCH /:id/action-items/:actionId — update an action item
// ---------------------------------------------------------------------------
meetingsRoutes.patch("/:id/action-items/:actionId", async (c) => {
  const auth = await resolveOrgContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { id: meetingId, actionId } = c.req.param();
  const body = await c.req.json().catch(() => null);
  const parsed = UpdateMeetingActionItemSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const supabase = getSupabaseServiceClient();

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.assignee !== undefined) updates.assignee = parsed.data.assignee;
  if (parsed.data.assigneeId !== undefined) updates.assignee_id = parsed.data.assigneeId;
  if (parsed.data.dueDate !== undefined) updates.due_date = parsed.data.dueDate;
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
  if (parsed.data.convertedToTask !== undefined) updates.converted_to_task = parsed.data.convertedToTask;

  const { data: updated, error } = await supabase
    .from("meeting_action_items")
    .update(updates)
    .eq("id", actionId)
    .eq("meeting_id", meetingId)
    .select()
    .single();

  if (error || !updated) {
    return errorResponse(c, 500, "Failed to update action item");
  }

  return c.json(updated, 200);
});

export default meetingsRoutes;
