import { Hono } from "hono";
import { CreateKnowledgePageSchema } from "@bizcontext/validation";
import { getSupabaseServiceClient } from "../lib/supabase";
import { getFullAuthContext, requireRole, writeAuditLog, type FullAuthContext } from "../lib/auth";

const knowledgeRoutes = new Hono();

export interface KnowledgePageResponse {
  id: string;
  organisationId: string | null;
  title: string;
  slug: string;
  content: string;
  parentId: string | null;
  visibility: "public" | "internal" | "restricted";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function toKnowledgePageResponse(row: Record<string, unknown>): KnowledgePageResponse {
  return {
    id: String(row.id ?? ""),
    organisationId: (row.organisation_id as string) ?? null,
    title: String(row.title ?? ""),
    slug: String(row.slug ?? ""),
    content: String(row.content ?? ""),
    parentId: (row.parent_id as string) ?? null,
    visibility: (row.visibility as KnowledgePageResponse["visibility"]) ?? "internal",
    createdBy: (row.created_by as string) ?? null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    deletedAt: (row.deleted_at as string) ?? null,
  };
}

/** Visibility tiers a role may read. Restricted pages are also readable by their author. */
function readableVisibilities(auth: FullAuthContext): string[] {
  if (requireRole(auth, "admin")) return ["public", "internal", "restricted"];
  if (requireRole(auth, "member")) return ["public", "internal"];
  return ["public"];
}

function canReadPage(auth: FullAuthContext, page: KnowledgePageResponse): boolean {
  return readableVisibilities(auth).includes(page.visibility) || page.createdBy === auth.userId;
}

// POST /api/v1/knowledge/pages — member+
knowledgeRoutes.post("/pages", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!auth.organisationId || !requireRole(auth, "member")) {
    return c.json({ error: { message: "Requires 'member' role" } }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = CreateKnowledgePageSchema.safeParse({
    ...(body ?? {}),
    organisationId: auth.organisationId,
  });
  if (!parsed.success) return c.json({ error: { message: "Validation failed" } }, 400);

  const { title, content, parentId, visibility } = parsed.data;

  // Only admins may publish restricted pages
  if (visibility === "restricted" && !requireRole(auth, "admin")) {
    return c.json({ error: { message: "Only admins can create restricted pages" } }, 403);
  }

  const { data, error } = await getSupabaseServiceClient()
    .from("pages")
    .insert({
      organisation_id: auth.organisationId,
      title,
      slug: slugify(title),
      content: content ?? "",
      parent_id: parentId ?? null,
      visibility,
      created_by: auth.userId,
    })
    .select()
    .single();

  if (error) {
    if (error.message.includes("duplicate key")) {
      return c.json({ error: { message: "A page with this slug already exists" } }, 409);
    }
    return c.json({ error: { message: error.message } }, 400);
  }

  await writeAuditLog({
    organisationId: auth.organisationId,
    actorId: auth.userId,
    action: "knowledge.create",
    resourceType: "page",
    resourceId: data.id as string,
    metadata: { visibility },
  });

  return c.json(toKnowledgePageResponse((data ?? {}) as Record<string, unknown>), 201);
});

// GET /api/v1/knowledge/pages — org-scoped, visibility-filtered
knowledgeRoutes.get("/pages", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!auth.organisationId) return c.json({ error: { message: "Not a member of an organisation" } }, 403);

  const { data, error } = await getSupabaseServiceClient()
    .from("pages")
    .select("*")
    .eq("organisation_id", auth.organisationId)
    .order("created_at", { ascending: false });

  if (error) return c.json({ error: { message: error.message } }, 500);

  const pages = (data ?? [])
    .map((row) => toKnowledgePageResponse(row as Record<string, unknown>))
    .filter((p) => canReadPage(auth, p));
  return c.json({ pages }, 200);
});

// GET /api/v1/knowledge/pages/:idOrSlug
knowledgeRoutes.get("/pages/:id", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!auth.organisationId) return c.json({ error: { message: "Not a member of an organisation" } }, 403);

  const idOrSlug = c.req.param("id");
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

  const { data } = await getSupabaseServiceClient()
    .from("pages")
    .select("*")
    .eq(isUuid ? "id" : "slug", idOrSlug)
    .eq("organisation_id", auth.organisationId)
    .limit(1)
    .maybeSingle();

  if (!data) return c.json({ error: { message: "Page not found" } }, 404);

  const page = toKnowledgePageResponse(data as Record<string, unknown>);
  if (!canReadPage(auth, page)) return c.json({ error: { message: "Page not found" } }, 404);
  return c.json(page, 200);
});

// DELETE /api/v1/knowledge/pages/:id — admin+ or author
knowledgeRoutes.delete("/pages/:id", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!auth.organisationId) return c.json({ error: { message: "Not a member of an organisation" } }, 403);

  const id = c.req.param("id");
  const supabase = getSupabaseServiceClient();
  const { data: page } = await supabase
    .from("pages")
    .select("id, created_by")
    .eq("id", id)
    .eq("organisation_id", auth.organisationId)
    .maybeSingle();
  if (!page) return c.json({ error: { message: "Page not found" } }, 404);

  if (!requireRole(auth, "admin") && page.created_by !== auth.userId) {
    return c.json({ error: { message: "Only admins or the author can delete this page" } }, 403);
  }

  const { error } = await supabase.from("pages").delete().eq("id", id).eq("organisation_id", auth.organisationId);
  if (error) return c.json({ error: { message: error.message } }, 500);

  await writeAuditLog({
    organisationId: auth.organisationId,
    actorId: auth.userId,
    action: "knowledge.delete",
    resourceType: "page",
    resourceId: id,
  });
  return c.json({ success: true }, 200);
});

export default knowledgeRoutes;
