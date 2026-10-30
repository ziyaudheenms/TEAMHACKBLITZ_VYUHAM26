import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { aiEngineClient, type AIRunPayload } from "../services/ai-engine.client";
import { getFullAuthContext, requireRole, writeAuditLog, type FullAuthContext, type Role } from "../lib/auth";

export const aiRouter = new Hono();

// The browser receives only this short-lived URL; the ElevenLabs API key remains
// on the API server. Gemini requests still use POST /ai/live-orb below.
aiRouter.get("/live-orb/signed-url", async (c) => {
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!agentId || !apiKey) return c.json({ error: "Voice assistant is not configured." }, 503);
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { "xi-api-key": apiKey } }
    );
    if (!response.ok) {
      console.error("[AI /live-orb/signed-url]", response.status, await response.text());
      return c.json({ error: "Could not start the voice assistant." }, 502);
    }
    const body = (await response.json()) as { signed_url?: string };
    return body.signed_url ? c.json({ signedUrl: body.signed_url }) : c.json({ error: "Voice provider returned no signed URL." }, 502);
  } catch (error: any) {
    console.error("[AI /live-orb/signed-url]", error?.message);
    return c.json({ error: "Could not reach the voice provider." }, 502);
  }
});

// ─── POST /api/v1/ai/live-orb ───────────────────────────────────────────────
// A small, dedicated path for the floating orb. It forwards only to the AI
// Engine, where GEMINI_API_KEY is configured; the browser never receives it.
aiRouter.post("/live-orb", async (c) => {
  const body = await c.req.json().catch(() => ({} as { prompt?: string; conversationId?: string }));
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  try {
    const result = await aiEngineClient.respondFromOrb({
      prompt: body.prompt?.trim() || "Give a brief, helpful greeting and ask how you can help.",
      conversationId: body.conversationId,
      userId: c.req.header("X-User-Id") || "anonymous-user",
      organisationId: c.req.header("X-Organisation-Id") || "default-org",
      authToken: token,
    });
    return c.json(result);
  } catch (error: any) {
    console.error("[AI /live-orb]", error?.message);
    return c.json({ error: error.message || "Failed to get orb response" }, 500);
  }
});

const querySchema = z.object({
  prompt: z.string().min(1).max(8000),
  conversationId: z.string().optional(),
  agentRole: z.string().optional().default("general_assistant"),
  allowedTools: z.array(z.string()).optional(),
  chatHistory: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      })
    )
    .max(40)
    .optional(),
  metadata: z.record(z.unknown()).optional(),
  systemPrompt: z.string().optional(),
});

// ─── Role → AI tool allow-list ────────────────────────────────────────────────
// The agent acts with the *caller's* privileges. Read tools are open to every
// member; write tools need member+; browser automation needs admin+.
export const READ_TOOLS = [
  "search_second_brain",
  "get_knowledge_page",
  "get_project_details",
  "get_meeting_minutes",
  "search_employee_directory",
];
const WRITE_TOOLS = ["create_task", "update_task_status", "create_ticket"];
const ADMIN_TOOLS = ["dispatch_browser_job", "call_backend_tool"];
// Read-only (B1) public-web access: members and above.
const WEB_TOOLS = ["web_search", "fetch_web_page"];

function toolsForRole(role: Role | null): string[] {
  switch (role) {
    case "owner":
    case "admin":
      return [...READ_TOOLS, ...WRITE_TOOLS, ...WEB_TOOLS, ...ADMIN_TOOLS];
    case "member":
      return [...READ_TOOLS, ...WRITE_TOOLS, ...WEB_TOOLS];
    case "guest":
      return ["search_second_brain", "get_knowledge_page"];
    default:
      return [];
  }
}

/** Intersect the caller's request with what their role permits. */
function resolveAllowedTools(auth: FullAuthContext, requested?: string[]): string[] {
  const permitted = toolsForRole(auth.role);
  return requested ? requested.filter((t) => permitted.includes(t)) : permitted;
}

/**
 * Authenticates the caller and builds the engine payload from *verified* identity.
 * Client-supplied user/org headers are never trusted.
 */
async function buildPayload(
  c: Context,
  body: unknown
): Promise<{ payload: AIRunPayload; auth: FullAuthContext } | Response> {
  const auth = await getFullAuthContext(c);
  if (!auth) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!auth.organisationId || !requireRole(auth, "guest")) {
    return c.json({ error: { message: "You must belong to an organisation to use the AI assistant" } }, 403);
  }

  const parsed = querySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { message: "Invalid payload", details: parsed.error.issues } }, 400);
  }

  const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  return {
    auth,
    payload: {
      prompt: parsed.data.prompt,
      userId: auth.userId,
      organisationId: auth.organisationId,
      conversationId: parsed.data.conversationId,
      agentRole: parsed.data.agentRole,
      allowedTools: resolveAllowedTools(auth, parsed.data.allowedTools),
      chatHistory: parsed.data.chatHistory,
      // Callers may not override the system prompt unless admin (prompt-injection guard).
      systemPrompt: requireRole(auth, "admin") ? parsed.data.systemPrompt : undefined,
      metadata: { ...(parsed.data.metadata ?? {}), callerRole: auth.role },
      authToken: token,
    },
  };
}

// ─── GET /api/v1/ai/health ───────────────────────────────────────────────────
aiRouter.get("/health", async (c) => {
  const base = process.env.AI_ENGINE_URL || "http://localhost:8000";
  try {
    const res = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(3000) });
    const body = await res.json().catch(() => ({}));
    return c.json({ reachable: res.ok, engine: body }, res.ok ? 200 : 502);
  } catch (error: any) {
    return c.json({ reachable: false, error: error?.message ?? "unreachable" }, 502);
  }
});

// ─── POST /api/v1/ai/query ───────────────────────────────────────────────────
aiRouter.post("/query", async (c) => {
  const built = await buildPayload(c, await c.req.json().catch(() => null));
  if (built instanceof Response) return built;

  try {
    const result = await aiEngineClient.runAgent(built.payload);

    // Audit any consequential tool the agent executed on the user's behalf.
    const writes = (result.tool_calls ?? []).filter((t) => !READ_TOOLS.includes(t.tool_name));
    if (writes.length) {
      await writeAuditLog({
        organisationId: built.auth.organisationId,
        actorId: built.auth.userId,
        actorType: "agent",
        action: "ai.tool_execution",
        resourceType: "ai_conversation",
        metadata: { tools: writes.map((t) => ({ name: t.tool_name, status: t.status })) },
      });
    }
    return c.json(result);
  } catch (error: any) {
    console.error("[AI /query]", error?.message);
    return c.json({ error: { message: error?.message || "Failed to execute AI query" } }, 502);
  }
});

// ─── POST /api/v1/ai/council/stream (SSE) ────────────────────────────────────
// Four agents: Knowledge, Researcher and Browser run in parallel, then the CEO decides.
// Events: council_start | agent_start | agent_token | agent_done | council_done | error
// The council is read-only: write/admin tools are never granted to it, regardless of role.
aiRouter.post("/council/stream", async (c) => {
  const built = await buildPayload(c, await c.req.json().catch(() => null));
  if (built instanceof Response) return built;

  const councilTools = [...READ_TOOLS, ...WEB_TOOLS];
  built.payload.allowedTools = (built.payload.allowedTools ?? []).filter((t) => councilTools.includes(t));
  built.payload.agentRole = "council";
  built.payload.systemPrompt = undefined;

  try {
    const stream = await aiEngineClient.streamCouncil(built.payload);
    await writeAuditLog({
      organisationId: built.auth.organisationId,
      actorId: built.auth.userId,
      actorType: "agent",
      action: "ai.council_run",
      resourceType: "ai_conversation",
      metadata: { promptChars: built.payload.prompt.length },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error: any) {
    console.error("[AI /council/stream]", error?.message);
    return c.json({ error: { message: error?.message || "Failed to start the agent council" } }, 502);
  }
});

// ─── POST /api/v1/ai/stream (SSE) ────────────────────────────────────────────
// Events: token {delta} | tools | citations | done {response} | error {error}
aiRouter.post("/stream", async (c) => {
  const built = await buildPayload(c, await c.req.json().catch(() => null));
  if (built instanceof Response) return built;

  try {
    const stream = await aiEngineClient.streamAgent(built.payload);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error: any) {
    console.error("[AI /stream]", error?.message);
    return c.json({ error: { message: error?.message || "Failed to initiate AI stream" } }, 502);
  }
});
