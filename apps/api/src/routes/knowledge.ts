import { Hono } from "hono";
import { CreateKnowledgePageSchema } from "@bizcontext/validation";
import { getSupabaseServiceClient } from "../lib/supabase";
import { getAuthContext } from "../lib/auth";

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

// POST /api/v1/knowledge/pages
knowledgeRoutes.post("/pages", async (c) => {
  const auth = await getAuthContext(c);
  if (!auth) {
    return c.json({ error: { message: "Unauthorized" } }, 401);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = CreateKnowledgePageSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { message: "Validation failed" } }, 400);
  }

  const { organisationId, title, content, parentId, visibility } = parsed.data;
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("pages")
    .insert({
      organisation_id: organisationId,
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

  const page = toKnowledgePageResponse((data ?? {}) as Record<string, unknown>);
  return c.json(page, 201);
});

// GET /api/v1/knowledge/pages
knowledgeRoutes.get("/pages", async (c) => {
  const auth = await getAuthContext(c);
  if (!auth) {
    return c.json({ error: { message: "Unauthorized" } }, 401);
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("pages").select("*").order("created_at", {
    ascending: false,
  });

  if (error) {
    return c.json({ error: { message: error.message } }, 500);
  }

  const pages = (data ?? []).map((row) => toKnowledgePageResponse(row as Record<string, unknown>));
  return c.json({ pages }, 200);
});

// GET /api/v1/knowledge/pages/:id
knowledgeRoutes.get("/pages/:id", async (c) => {
  const auth = await getAuthContext(c);
  if (!auth) {
    return c.json({ error: { message: "Unauthorized" } }, 401);
  }

  const id = c.req.param("id");
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("pages").select("*").eq("id", id).single();

  if (error) {
    return c.json({ error: { message: "Page not found" } }, 404);
  }

  const page = toKnowledgePageResponse((data ?? {}) as Record<string, unknown>);
  return c.json(page, 200);
});

export default knowledgeRoutes;
