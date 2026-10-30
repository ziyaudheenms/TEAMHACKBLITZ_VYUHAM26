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

  // Auto-enroll the creator as 'owner' of the new organisation
  const { error: memberError } = await supabase.from("organisation_members").insert({
    organisation_id: data.id,
    user_id: auth.userId,
    role: "owner",
  });
  if (memberError) {
    // Without an owner the org would be unreachable, so roll it back.
    await supabase.from("organisations").delete().eq("id", data.id);
    return c.json({ error: { message: "Failed to enrol organisation owner" } }, 500);
  }

  const organisation = toOrganisationResponse((data ?? {}) as Record<string, unknown>);
  return c.json({ ...organisation, role: "owner" }, 201);
});

// GET /api/v1/organisations
organisationsRoutes.get("/", async (c) => {
  const auth = await getAuthContext(c);
  if (!auth) {
    return c.json({ error: { message: "Unauthorized" } }, 401);
  }

  const supabase = getSupabaseServiceClient();

  // Super admins see every organisation.
  if (auth.isSuperAdmin) {
    const { data, error } = await supabase.from("organisations").select("*").order("created_at", { ascending: false });
    if (error) return c.json({ error: { message: error.message } }, 500);
    return c.json(
      { organisations: (data ?? []).map((row) => ({ ...toOrganisationResponse(row as Record<string, unknown>), role: "owner" })) },
      200
    );
  }

  // Everyone else: only organisations they are a member of
  const { data: memberRows } = await supabase
    .from("organisation_members")
    .select("organisation_id, role")
    .eq("user_id", auth.userId)
    .is("left_at", null);

  const memberOrgIds = (memberRows ?? []).map((r) => r.organisation_id as string);
  const roleByOrg: Record<string, string> = {};
  for (const r of memberRows ?? []) {
    roleByOrg[r.organisation_id as string] = r.role as string;
  }

  // Tenant isolation: a user only ever sees organisations they belong to.
  if (memberOrgIds.length === 0) {
    return c.json({ organisations: [] }, 200);
  }

  const { data, error } = await supabase
    .from("organisations")
    .select("*")
    .in("id", memberOrgIds)
    .order("created_at", { ascending: false });
  if (error) {
    return c.json({ error: { message: error.message } }, 500);
  }

  const organisations = (data ?? []).map((row) => ({
    ...toOrganisationResponse(row as Record<string, unknown>),
    role: roleByOrg[String(row.id)] ?? null,
  }));

  return c.json({ organisations }, 200);
});

// POST /api/v1/organisations/:id/members  — invite a user into the org
organisationsRoutes.post("/:id/members", async (c) => {
  const auth = await getAuthContext(c);
  if (!auth) return c.json({ error: { message: "Unauthorized" } }, 401);

  const orgId = c.req.param("id");
  const supabase = getSupabaseServiceClient();

  // Only admins/owners of this org may invite others
  const { data: callerMembership } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", auth.userId)
    .is("left_at", null)
    .maybeSingle();

  const callerRole = auth.isSuperAdmin ? "owner" : (callerMembership?.role as string | undefined);
  if (!callerRole || !["admin", "owner"].includes(callerRole)) {
    return c.json({ error: { message: "Requires admin role in this organisation" } }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const userId = body?.userId;
  const role = body?.role ?? "member";

  if (!userId) return c.json({ error: { message: "userId required" } }, 400);
  if (!["owner", "admin", "member", "guest"].includes(role)) {
    return c.json({ error: { message: "Invalid role" } }, 400);
  }
  // Privilege-escalation guard: only an owner may mint another owner.
  if (role === "owner" && callerRole !== "owner") {
    return c.json({ error: { message: "Only an owner can grant the owner role" } }, 403);
  }

  // Admins may not change an existing owner's role (that would be a takeover/demotion).
  const { data: target } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (target?.role === "owner" && callerRole !== "owner") {
    return c.json({ error: { message: "Only an owner can change another owner's role" } }, 403);
  }

  const { data, error } = await supabase
    .from("organisation_members")
    .upsert(
      { organisation_id: orgId, user_id: userId, role, invited_by: auth.userId, left_at: null },
      { onConflict: "organisation_id,user_id" }
    )
    .select()
    .single();

  if (error) return c.json({ error: { message: error.message } }, 400);

  return c.json({ success: true, member: data }, 201);
});

export default organisationsRoutes;
