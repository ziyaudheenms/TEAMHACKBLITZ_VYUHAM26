import { Hono } from "hono";
import { CreateOrganisationSchema } from "@bizcontext/validation";
import { getSupabaseServiceClient } from "../lib/supabase";
import { getAuthContext } from "../lib/auth";

const organisationsRoutes = new Hono();

export interface OrganisationResponse {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

function toOrganisationResponse(row: Record<string, unknown>): OrganisationResponse {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    slug: String(row.slug ?? ""),
    parentId: (row.parent_id as string | null) ?? null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

// POST /api/v1/organisations
organisationsRoutes.post("/", async (c) => {
  const auth = await getAuthContext(c);
  if (!auth) {
    return c.json({ error: { message: "Unauthorized" } }, 401);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = CreateOrganisationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { message: "Validation failed" } }, 400);
  }

  const { name, slug, parentId } = parsed.data;
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("organisations")
    .insert({
      name,
      slug,
      parent_id: parentId ?? null,
    })
    .select()
    .single();

  if (error) {
    return c.json({ error: { message: error.message } }, 400);
  }

  const organisation = toOrganisationResponse((data ?? {}) as Record<string, unknown>);
  return c.json(organisation, 201);
});

// GET /api/v1/organisations
organisationsRoutes.get("/", async (c) => {
  const auth = await getAuthContext(c);
  if (!auth) {
    return c.json({ error: { message: "Unauthorized" } }, 401);
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("organisations").select("*").order("created_at", {
    ascending: false,
  });

  if (error) {
    return c.json({ error: { message: error.message } }, 500);
  }

  const organisations = (data ?? []).map((row) =>
    toOrganisationResponse(row as Record<string, unknown>)
  );

  return c.json({ organisations }, 200);
});

export default organisationsRoutes;
