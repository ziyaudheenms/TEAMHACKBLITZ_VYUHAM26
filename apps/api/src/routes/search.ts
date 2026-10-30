import { Hono } from "hono";
import { z } from "zod";
import { aiEngineClient } from "../services/ai-engine.client";
import { getSupabaseServiceClient } from "../lib/supabase";
import { getFullAuthContext, requireRole } from "../lib/auth";

export const searchRoutes = new Hono();

interface SearchResult {
  id: string;
  type: "employee" | "knowledge" | "project" | "ticket" | "meeting" | "file";
  title: string;
  subtitle?: string;
  snippet?: string;
  url: string;
  createdAt?: string;
}

const VALID_SCOPES = ["all", "employees", "knowledge", "projects", "tickets", "meetings", "files"] as const;
type Scope = (typeof VALID_SCOPES)[number];

// The AI engine passes resource types ("knowledge", "file", "meeting", ...) in `types`.
const TYPE_TO_SCOPE: Record<string, Scope> = {
  employee: "employees",
  employees: "employees",
  knowledge: "knowledge",
  knowledge_page: "knowledge",
  page: "knowledge",
  project: "projects",
  projects: "projects",
  task: "projects",
  ticket: "tickets",
  tickets: "tickets",
  meeting: "meetings",
  meetings: "meetings",
  file: "files",
  files: "files",
};

const askSchema = z.object({ query: z.string().min(1, "query must not be empty") });

/** Strip characters that carry meaning in PostgREST `or()` filters / LIKE patterns. */
function sanitize(q: string): string {
  return q.replace(/[,()%*\\]/g, " ").trim().slice(0, 100);
}

function snippetOf(text: unknown, q: string): string | undefined {
  if (typeof text !== "string" || !text) return undefined;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  const start = Math.max(0, idx - 60);
  return text.slice(start, start + 220).trim();
}

// ─── POST /search/ask-second-brain ───────────────────────────────────────────
searchRoutes.post("/ask-second-brain", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!auth.organisationId) return c.json({ error: { message: "Not a member of an organisation" } }, 403);

  const parsed = askSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { message: "query is required" } }, 400);

  const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  try {
    const result = await aiEngineClient.runAgent({
      prompt: parsed.data.query,
      userId: auth.userId,
      organisationId: auth.organisationId,
      agentRole: "knowledge_search",
      authToken: token,
    });
    return c.json({
      answer: result.response,
      sources: (result.citations ?? []).map((ci) => ({
        title: ci.title,
        category: ci.source_type,
        link: ci.url,
        snippet: ci.snippet,
      })),
      suggestedActions: [],
    });
  } catch (error: any) {
    console.error("[Search /ask-second-brain] AI engine unavailable:", error?.message);
    return c.json({ error: { message: "The AI engine is unavailable right now." } }, 502);
  }
});

// ─── GET /search?q=&scope=&types=&limit= ─────────────────────────────────────
searchRoutes.get("/", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!auth.organisationId) return c.json({ error: { message: "Not a member of an organisation" } }, 403);

  const q = sanitize(c.req.query("q") ?? "");
  if (!q) return c.json({ error: { message: "q must not be empty" } }, 400);

  const rawScope = c.req.query("scope") ?? "all";
  const scopes = new Set<Scope>();
  const typesParam = c.req.query("types");
  if (typesParam) {
    for (const t of typesParam.split(",")) {
      const s = TYPE_TO_SCOPE[t.trim().toLowerCase()];
      if (s) scopes.add(s);
    }
  } else if ((VALID_SCOPES as readonly string[]).includes(rawScope) && rawScope !== "all") {
    scopes.add(rawScope as Scope);
  }
  const all = scopes.size === 0;
  const want = (s: Scope) => all || scopes.has(s);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 5, 1), 25);

  const orgId = auth.organisationId;
  const supabase = getSupabaseServiceClient();
  const like = `%${q}%`;
  const results: SearchResult[] = [];

  const tasks: Array<PromiseLike<void>> = [];

  if (want("employees")) {
    tasks.push(
      supabase
        .from("employee_profiles")
        .select("id, first_name, last_name, designation, work_email, created_at")
        .eq("organisation_id", orgId)
        .is("deleted_at", null)
        .or(`first_name.ilike.${like},last_name.ilike.${like},designation.ilike.${like},work_email.ilike.${like}`)
        .limit(limit)
        .then(({ data }) => {
          for (const r of data ?? []) {
            results.push({
              id: r.id,
              type: "employee",
              title: `${r.first_name} ${r.last_name}`.trim(),
              subtitle: r.designation ?? r.work_email,
              url: "/directory",
              createdAt: r.created_at,
            });
          }
        })
    );
  }

  if (want("knowledge")) {
    const visibilities = requireRole(auth, "admin")
      ? ["public", "internal", "restricted"]
      : requireRole(auth, "member")
        ? ["public", "internal"]
        : ["public"];
    tasks.push(
      supabase
        .from("pages")
        .select("id, title, slug, content, visibility, created_at")
        .eq("organisation_id", orgId)
        .in("visibility", visibilities)
        .or(`title.ilike.${like},content.ilike.${like}`)
        .limit(limit)
        .then(({ data }) => {
          for (const r of data ?? []) {
            results.push({
              id: r.id,
              type: "knowledge",
              title: r.title,
              subtitle: r.visibility,
              snippet: snippetOf(r.content, q),
              url: `/knowledge?page=${r.slug ?? r.id}`,
              createdAt: r.created_at,
            });
          }
        })
    );
  }

  if (want("projects")) {
    tasks.push(
      supabase
        .from("projects")
        .select("id, name, description, status, created_at")
        .eq("organisation_id", orgId)
        .or(`name.ilike.${like},description.ilike.${like}`)
        .limit(limit)
        .then(({ data }) => {
          for (const r of data ?? []) {
            results.push({
              id: r.id,
              type: "project",
              title: r.name,
              subtitle: r.status,
              snippet: snippetOf(r.description, q),
              url: "/projects",
              createdAt: r.created_at,
            });
          }
        })
    );
  }

  if (want("tickets")) {
    tasks.push(
      supabase
        .from("tickets")
        .select("id, ticket_number, title, description, status, created_at")
        .eq("organisation_id", orgId)
        .or(`title.ilike.${like},description.ilike.${like},ticket_number.ilike.${like}`)
        .limit(limit)
        .then(({ data }) => {
          for (const r of data ?? []) {
            results.push({
              id: r.id,
              type: "ticket",
              title: r.title,
              subtitle: `${r.ticket_number} · ${r.status}`,
              snippet: snippetOf(r.description, q),
              url: "/tickets",
              createdAt: r.created_at,
            });
          }
        })
    );
  }

  if (want("meetings")) {
    tasks.push(
      supabase
        .from("meetings")
        .select("id, title, agenda, minutes_content, meeting_date, created_at")
        .eq("organisation_id", orgId)
        .or(`title.ilike.${like},agenda.ilike.${like},minutes_content.ilike.${like}`)
        .limit(limit)
        .then(({ data }) => {
          for (const r of data ?? []) {
            results.push({
              id: r.id,
              type: "meeting",
              title: r.title,
              subtitle: String(r.meeting_date ?? "").slice(0, 10),
              snippet: snippetOf(r.minutes_content ?? r.agenda, q),
              url: "/meetings",
              createdAt: r.created_at,
            });
          }
        })
    );
  }

  if (want("files")) {
    tasks.push(
      supabase
        .from("files")
        .select("id, filename, mime_type, visibility, created_at")
        .eq("organisation_id", orgId)
        .is("deleted_at", null)
        .ilike("filename", like)
        .limit(limit)
        .then(({ data }) => {
          for (const r of data ?? []) {
            // Restricted files are not discoverable by non-admins.
            if (r.visibility === "restricted" && !requireRole(auth, "admin")) continue;
            results.push({
              id: r.id,
              type: "file",
              title: r.filename,
              subtitle: r.mime_type,
              url: "/storage",
              createdAt: r.created_at,
            });
          }
        })
    );
  }

  await Promise.all(tasks);

  return c.json({
    results,
    totalCount: results.length,
    query: q,
    scope: all ? "all" : [...scopes].join(","),
  });
});

export default searchRoutes;
