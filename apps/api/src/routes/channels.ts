/**
 * /api/v1/channels — team chat.
 *
 *   GET    /channels                     channels the caller can see (+ member counts)
 *   POST   /channels                     create a channel (member+)
 *   DELETE /channels/:id                 archive (admin+ or creator)
 *   GET    /channels/:id/messages        ?after=<created_at>&limit=
 *   POST   /channels/:id/messages        post a message (member+); "@BizContext" summons the copilot
 *   POST   /channels/:id/members         add someone to a private channel (admin+ or creator)
 *
 * Access rules
 *   - Public channel: any member of the organisation can read it (guests read-only).
 *   - Private channel: only channel_members; everyone else gets a 404 (existence isn't revealed).
 *   - Messages with is_ai are written only by this server, after the AI engine answers.
 *     The copilot runs with the *asker's* read-only tools, never write tools.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { getFullAuthContext, requireRole, writeAuditLog, type FullAuthContext } from "../lib/auth";
import { getSupabaseServiceClient } from "../lib/supabase";
import { aiEngineClient } from "../services/ai-engine.client";
import { READ_TOOLS, toolsForRole } from "./ai";

const channelsRoutes = new Hono();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MENTION_RE = /@bizcontext\b/i;
const COPILOT_NAME = "BizContext Copilot";
const err = (message: string, details?: unknown) => ({ error: { message, ...(details ? { details } : {}) } });

const normaliseName = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

type Ctx = FullAuthContext & { organisationId: string };

async function authorise(c: Context): Promise<{ ctx: Ctx; res: null } | { ctx: null; res: Response }> {
  const auth = await getFullAuthContext(c);
  if (!auth) return { ctx: null, res: c.json(err("Unauthorized"), 401) as unknown as Response };
  if (!auth.organisationId || !requireRole(auth, "guest")) {
    return { ctx: null, res: c.json(err("You are not a member of an organisation"), 403) as unknown as Response };
  }
  return { ctx: auth as Ctx, res: null };
}

/** The channel if the caller may see it, else null (private channels look nonexistent). */
async function visibleChannel(ctx: Ctx, channelId: string) {
  if (!UUID_RE.test(channelId)) return null;
  const supabase = getSupabaseServiceClient();
  const select = "id, organisation_id, name, description, is_private, created_by";
  let { data: ch, error } = await supabase
    .from("channels")
    .select(select)
    .eq("id", channelId)
    .eq("organisation_id", ctx.organisationId)
    .is("archived_at", null)
    .maybeSingle();
  // Migration 008 did not have archived_at. Keep existing channels usable while
  // deployments roll forward rather than treating them as nonexistent.
  if (error && missingColumn(error.message)) {
    ({ data: ch, error } = await supabase
      .from("channels")
      .select(select)
      .eq("id", channelId)
      .eq("organisation_id", ctx.organisationId)
      .maybeSingle());
  }
  if (error) return null;
  if (!ch) return null;
  if (ch.is_private) {
    const { data: m } = await supabase
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", channelId)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (!m) return null;
  }
  return ch;
}

async function activeMemberIds(orgId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await getSupabaseServiceClient()
    .from("organisation_members")
    .select("user_id")
    .eq("organisation_id", orgId)
    .is("left_at", null)
    .in("user_id", ids);
  return new Set((data ?? []).map((r) => r.user_id as string));
}

function toMessage(row: Record<string, any>) {
  return {
    id: row.id as string,
    channelId: row.channel_id as string,
    senderId: (row.sender_id as string | null) ?? "ai-bot",
    senderName: row.sender_name as string,
    isAi: Boolean(row.is_ai),
    content: row.content as string,
    createdAt: row.created_at as string,
    sources: Array.isArray(row.metadata?.sources) ? row.metadata.sources : undefined,
    reactions: [],
  };
}

const missingTable = (message?: string) => /relation .* does not exist|schema cache/i.test(message ?? "");
const missingColumn = (message?: string) => /column .* does not exist|schema cache/i.test(message ?? "");
const migrationHint = "Chat is not set up yet. Apply database migration 010.";

// ─── List / create ────────────────────────────────────────────────────────────

channelsRoutes.get("/", async (c) => {
  const { ctx, res } = await authorise(c);
  if (res) return res;
  const supabase = getSupabaseServiceClient();

  const load = (supportsArchive: boolean) => {
    let query = supabase
      .from("channels")
      .select("id, name, description, is_private, created_by, created_at")
      .eq("organisation_id", ctx.organisationId)
      .order("created_at", { ascending: true });
    if (supportsArchive) query = query.is("archived_at", null);
    return query;
  };

  let supportsArchive = true;
  let { data: channels, error } = await load(supportsArchive);
  if (error && missingColumn(error.message)) {
    supportsArchive = false;
    ({ data: channels, error } = await load(supportsArchive));
  }
  if (error) return c.json(err(missingTable(error.message) ? migrationHint : error.message), 500);

  // First visit to a new organisation: give it a #general channel.
  if ((channels ?? []).length === 0 && requireRole(ctx, "member")) {
    await supabase
      .from("channels")
      .upsert(
        { organisation_id: ctx.organisationId, name: "general", description: "Company-wide announcements and chat", created_by: ctx.userId },
        { onConflict: "organisation_id,name", ignoreDuplicates: true }
      );
    ({ data: channels, error } = await load(supportsArchive));
    if (error) return c.json(err(error.message), 500);
  }

  const all = channels ?? [];
  const privateIds = all.filter((ch) => ch.is_private).map((ch) => ch.id as string);

  const [{ data: mine }, { data: memberRows }, { count: orgCount }] = await Promise.all([
    privateIds.length
      ? supabase.from("channel_members").select("channel_id").eq("user_id", ctx.userId).in("channel_id", privateIds)
      : Promise.resolve({ data: [] as Array<{ channel_id: string }> }),
    privateIds.length
      ? supabase.from("channel_members").select("channel_id").in("channel_id", privateIds)
      : Promise.resolve({ data: [] as Array<{ channel_id: string }> }),
    supabase
      .from("organisation_members")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", ctx.organisationId)
      .is("left_at", null),
  ]);

  const mineSet = new Set((mine ?? []).map((r) => r.channel_id as string));
  const counts = new Map<string, number>();
  for (const r of memberRows ?? []) counts.set(r.channel_id as string, (counts.get(r.channel_id as string) ?? 0) + 1);

  return c.json(
    all
      .filter((ch) => !ch.is_private || mineSet.has(ch.id as string))
      .map((ch) => ({
        id: ch.id,
        name: ch.name,
        description: ch.description ?? "",
        isPrivate: Boolean(ch.is_private),
        memberCount: ch.is_private ? (counts.get(ch.id as string) ?? 0) : (orgCount ?? 0),
      }))
  );
});

const CreateChannelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
  isPrivate: z.boolean().default(false),
  memberIds: z.array(z.string().regex(UUID_RE)).max(200).default([]),
});

channelsRoutes.post("/", async (c) => {
  const { ctx, res } = await authorise(c);
  if (res) return res;
  if (!requireRole(ctx, "member")) return c.json(err("Requires 'member' role"), 403);

  const parsed = CreateChannelSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("Validation failed", parsed.error.flatten().fieldErrors), 400);
  const name = normaliseName(parsed.data.name);
  if (!name) return c.json(err("Channel name must contain letters or numbers"), 400);

  const supabase = getSupabaseServiceClient();
  const { data: ch, error } = await supabase
    .from("channels")
    .insert({
      organisation_id: ctx.organisationId,
      name,
      description: parsed.data.description,
      is_private: parsed.data.isPrivate,
      created_by: ctx.userId,
    })
    .select("id, name, description, is_private")
    .single();
  if (error || !ch) {
    if (missingTable(error?.message)) return c.json(err(migrationHint), 500);
    const dup = /duplicate|unique/i.test(error?.message ?? "");
    return c.json(err(dup ? `A channel named #${name} already exists` : "Could not create the channel"), dup ? 409 : 500);
  }

  let memberCount = 0;
  if (parsed.data.isPrivate) {
    // Only people who really belong to this organisation can be added.
    const valid = await activeMemberIds(ctx.organisationId, parsed.data.memberIds);
    const ids = new Set<string>([ctx.userId, ...valid]);
    const { error: mErr } = await supabase
      .from("channel_members")
      .insert([...ids].map((user_id) => ({ channel_id: ch.id, user_id, added_by: ctx.userId })));
    if (mErr) {
      await supabase.from("channels").delete().eq("id", ch.id);
      return c.json(err("Could not add channel members"), 500);
    }
    memberCount = ids.size;
  }

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    action: "channel.create",
    resourceType: "channel",
    resourceId: ch.id as string,
    metadata: { name, isPrivate: parsed.data.isPrivate },
  });

  return c.json(
    { id: ch.id, name: ch.name, description: ch.description ?? "", isPrivate: Boolean(ch.is_private), memberCount },
    201
  );
});

channelsRoutes.delete("/:id", async (c) => {
  const { ctx, res } = await authorise(c);
  if (res) return res;
  const ch = await visibleChannel(ctx, c.req.param("id"));
  if (!ch) return c.json(err("Channel not found"), 404);
  if (!requireRole(ctx, "admin") && ch.created_by !== ctx.userId) {
    return c.json(err("Only admins or the channel creator can archive a channel"), 403);
  }
  const { error } = await getSupabaseServiceClient()
    .from("channels")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", ch.id);
  if (error) return c.json(err("Could not archive the channel"), 500);
  await writeAuditLog({ organisationId: ctx.organisationId, actorId: ctx.userId, action: "channel.archive", resourceType: "channel", resourceId: ch.id as string });
  return c.json({ success: true });
});

channelsRoutes.post("/:id/members", async (c) => {
  const { ctx, res } = await authorise(c);
  if (res) return res;
  const ch = await visibleChannel(ctx, c.req.param("id"));
  if (!ch) return c.json(err("Channel not found"), 404);
  if (!ch.is_private) return c.json(err("Public channels are open to everyone in the organisation"), 400);
  if (!requireRole(ctx, "admin") && ch.created_by !== ctx.userId) {
    return c.json(err("Only admins or the channel creator can add members"), 403);
  }

  const parsed = z.object({ userId: z.string().regex(UUID_RE) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("userId is required"), 400);
  if (!(await activeMemberIds(ctx.organisationId, [parsed.data.userId])).has(parsed.data.userId)) {
    return c.json(err("That person is not a member of this organisation"), 404);
  }
  const { error } = await getSupabaseServiceClient()
    .from("channel_members")
    .upsert({ channel_id: ch.id, user_id: parsed.data.userId, added_by: ctx.userId }, { onConflict: "channel_id,user_id" });
  if (error) return c.json(err("Could not add the member"), 500);
  return c.json({ success: true }, 201);
});

// ─── Messages ─────────────────────────────────────────────────────────────────

channelsRoutes.get("/:id/messages", async (c) => {
  const { ctx, res } = await authorise(c);
  if (res) return res;
  const ch = await visibleChannel(ctx, c.req.param("id"));
  if (!ch) return c.json(err("Channel not found"), 404);

  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 200);
  const after = c.req.query("after");
  const supabase = getSupabaseServiceClient();

  const loadMessages = (includeMetadata: boolean) => {
    let query = supabase
      .from("channel_messages")
      .select(
        includeMetadata
          ? "id, channel_id, sender_id, sender_name, is_ai, content, metadata, created_at"
          : "id, channel_id, sender_id, sender_name, is_ai, content, created_at"
      )
      .eq("channel_id", ch.id as string);
    if (after) query = query.gt("created_at", after);
    return query.order("created_at", { ascending: Boolean(after) }).limit(limit);
  };

  if (after) {
    // Polling: everything newer than the last message the client has, oldest first.
    if (Number.isNaN(Date.parse(after))) return c.json(err("Invalid 'after' timestamp"), 400);
    let { data, error } = await loadMessages(true);
    // Some deployed databases still use the pre-metadata chat schema. Messages
    // remain fully readable there; sources simply are not attached to the row.
    if (error && missingColumn(error.message)) ({ data, error } = await loadMessages(false));
    if (error) return c.json(err("Failed to fetch messages"), 500);
    return c.json((data ?? []).map(toMessage));
  }

  // Initial load: the latest `limit` messages, returned oldest first.
  let { data, error } = await loadMessages(true);
  if (error && missingColumn(error.message)) ({ data, error } = await loadMessages(false));
  if (error) return c.json(err(missingTable(error.message) ? migrationHint : "Failed to fetch messages"), 500);
  return c.json((data ?? []).reverse().map(toMessage));
});

const SendSchema = z.object({ content: z.string().trim().min(1).max(4000) });

// One copilot answer at a time per channel keeps cost and noise bounded.
const copilotBusy = new Set<string>();

channelsRoutes.post("/:id/messages", async (c) => {
  const { ctx, res } = await authorise(c);
  if (res) return res;
  if (!requireRole(ctx, "member")) return c.json(err("Guests can read channels but not post"), 403);
  const ch = await visibleChannel(ctx, c.req.param("id"));
  if (!ch) return c.json(err("Channel not found"), 404);

  const parsed = SendSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("Message must be 1-4000 characters"), 400);

  const supabase = getSupabaseServiceClient();
  const messageSelect = "id, channel_id, sender_id, sender_name, is_ai, content, metadata, created_at";
  let { data: row, error } = await supabase
    .from("channel_messages")
    .insert({
      organisation_id: ctx.organisationId,
      channel_id: ch.id,
      sender_id: ctx.userId,
      sender_name: ctx.name,
      is_ai: false,
      content: parsed.data.content,
    })
    .select(messageSelect)
    .single();
  // The legacy chat table has neither organisation_id nor metadata. Its channel
  // foreign key still scopes messages safely, so use that compatible shape.
  if (error && missingColumn(error.message)) {
    ({ data: row, error } = await supabase
      .from("channel_messages")
      .insert({
        channel_id: ch.id,
        sender_id: ctx.userId,
        sender_name: ctx.name,
        is_ai: false,
        content: parsed.data.content,
      })
      .select("id, channel_id, sender_id, sender_name, is_ai, content, created_at")
      .single());
  }
  if (error || !row) return c.json(err("Could not send the message"), 500);

  const mentioned = MENTION_RE.test(parsed.data.content);
  if (mentioned) {
    const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
    // Reply in the background; clients see it on their next poll.
    void answerAsCopilot(ctx, ch.id as string, parsed.data.content, token).catch((e) =>
      console.error("[channels] copilot reply crashed:", e?.message)
    );
  }

  return c.json({ message: toMessage(row), copilotQueued: mentioned }, 201);
});

async function insertCopilotMessage(
  ctx: Ctx,
  channelId: string,
  content: string,
  invokedBy: string,
  sources?: Array<{ title: string; url?: string; type: string }>
) {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("channel_messages")
    .insert({
      organisation_id: ctx.organisationId,
      channel_id: channelId,
      sender_id: null,
      sender_name: COPILOT_NAME,
      is_ai: true,
      invoked_by: invokedBy,
      content: content.slice(0, 8000),
      metadata: sources?.length ? { sources } : null,
    });
  if (error && missingColumn(error.message)) {
    // sender_id was non-nullable before migration 010. Attribute a legacy AI
    // response to the invoking user while retaining the explicit AI flag/name.
    await supabase.from("channel_messages").insert({
      channel_id: channelId,
      sender_id: invokedBy,
      sender_name: COPILOT_NAME,
      is_ai: true,
      content: content.slice(0, 8000),
    });
  }
}

async function answerAsCopilot(ctx: Ctx, channelId: string, text: string, token?: string) {
  if (copilotBusy.has(channelId)) {
    await insertCopilotMessage(ctx, channelId, "I'm still answering the previous question. Ask again in a moment.", ctx.userId);
    return;
  }
  copilotBusy.add(channelId);
  try {
    const supabase = getSupabaseServiceClient();
    // Recent conversation (excluding the message that triggered this) for context.
    const { data: recent } = await supabase
      .from("channel_messages")
      .select("sender_name, is_ai, content")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .limit(11);
    const history = (recent ?? [])
      .slice(1)
      .reverse()
      .map((m) => ({
        role: m.is_ai ? ("assistant" as const) : ("user" as const),
        content: m.is_ai ? (m.content as string) : `${m.sender_name}: ${m.content}`,
      }));

    const prompt = text.replace(/@bizcontext\b/gi, "").trim() || text;
    try {
      const allowedTools = toolsForRole(ctx.role);
      const result = await aiEngineClient.runAgent({
        prompt,
        userId: ctx.userId,
        organisationId: ctx.organisationId,
        agentRole: "channel_assistant",
        // The copilot acts with the caller's role permissions (e.g. member+ can create/update tasks)
        allowedTools,
        chatHistory: history,
        metadata: { channelId, callerRole: ctx.role },
        authToken: token,
      });

      // Audit any consequential write tools executed via the channel copilot
      const writes = (result.tool_calls ?? []).filter((t) => !READ_TOOLS.includes(t.tool_name));
      if (writes.length) {
        await writeAuditLog({
          organisationId: ctx.organisationId,
          actorId: ctx.userId,
          actorType: "agent",
          action: "ai.tool_execution",
          resourceType: "channel_message",
          resourceId: channelId,
          metadata: { channelId, tools: writes.map((t) => ({ name: t.tool_name, status: t.status })) },
        });
      }

      const sources = (result.citations ?? []).slice(0, 6).map((ci) => ({
        title: ci.title,
        url: ci.url,
        type: ci.source_type,
      }));
      await insertCopilotMessage(ctx, channelId, result.response || "I don't have an answer for that.", ctx.userId, sources);
    } catch (e: any) {
      console.error("[channels] AI engine error:", e?.message);
      await insertCopilotMessage(ctx, channelId, "I couldn't reach the AI engine just now. Please try again in a moment.", ctx.userId);
    }
  } finally {
    copilotBusy.delete(channelId);
  }
}

export default channelsRoutes;
