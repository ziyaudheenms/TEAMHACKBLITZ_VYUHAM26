/**
 * /api/v1/admin — platform super-admin console.
 *
 * Every route requires `app_metadata.is_super_admin` (only settable with the service-role
 * key; users cannot grant it to themselves). Capabilities:
 *   - list / create users, block / unblock users
 *   - list / create organisations
 *   - manage organisation members and roles
 *
 * Safety rules enforced here:
 *   - a super admin cannot block themselves, and super admins can never be blocked
 *   - an organisation can never be left without an owner
 */

import { Hono } from "hono";
import { z } from "zod";
import { enforceSuperAdmin, writeAuditLog } from "../lib/auth";
import { getSupabaseServiceClient, invalidateBlockCache } from "../lib/supabase";

const adminRoutes = new Hono();

const ROLES = ["owner", "admin", "member", "guest"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAN_FOREVER = "876000h"; // ~100 years; Supabase has no "permanent" value

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

const err = (message: string, details?: unknown) => ({ error: { message, ...(details ? { details } : {}) } });

// ─── Users ────────────────────────────────────────────────────────────────────

adminRoutes.get("/users", async (c) => {
  const { response } = await enforceSuperAdmin(c);
  if (response) return response;

  const page = Math.max(Number(c.req.query("page")) || 1, 1);
  const search = (c.req.query("search") ?? "").toLowerCase().trim();
  const supabase = getSupabaseServiceClient();

  const { data: list, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
  if (error) return c.json(err(error.message), 500);

  const [{ data: blocks }, { data: members }, { data: orgs }] = await Promise.all([
    supabase.from("user_blocks").select("user_id, reason, blocked_at"),
    supabase.from("organisation_members").select("user_id, organisation_id, role").is("left_at", null),
    supabase.from("organisations").select("id, name"),
  ]);

  const blockById = new Map((blocks ?? []).map((b) => [b.user_id as string, b]));
  const orgName = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  const membershipsByUser = new Map<string, Array<{ organisationId: string; organisationName: string; role: string }>>();
  for (const m of members ?? []) {
    const arr = membershipsByUser.get(m.user_id as string) ?? [];
    arr.push({
      organisationId: m.organisation_id as string,
      organisationName: orgName.get(m.organisation_id as string) ?? "Unknown",
      role: m.role as string,
    });
    membershipsByUser.set(m.user_id as string, arr);
  }

  let users = list.users.map((u) => {
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const block = blockById.get(u.id);
    return {
      id: u.id,
      email: u.email ?? "",
      firstName: typeof meta.firstName === "string" ? meta.firstName : "",
      lastName: typeof meta.lastName === "string" ? meta.lastName : "",
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      isSuperAdmin: u.app_metadata?.is_super_admin === true,
      blocked: Boolean(block),
      blockReason: (block?.reason as string | null) ?? null,
      blockedAt: (block?.blocked_at as string | null) ?? null,
      memberships: membershipsByUser.get(u.id) ?? [],
    };
  });

  if (search) {
    users = users.filter((u) => `${u.email} ${u.firstName} ${u.lastName}`.toLowerCase().includes(search));
  }
  return c.json({ users, page, hasMore: list.users.length === 200 });
});

const CreateUserSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).default(""),
  organisationId: z.string().regex(UUID_RE).optional(),
  role: z.enum(ROLES).default("member"),
  designation: z.string().trim().max(150).optional(),
});

adminRoutes.post("/users", async (c) => {
  const { identity, response } = await enforceSuperAdmin(c);
  if (response) return response;

  const parsed = CreateUserSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("Validation failed", parsed.error.flatten().fieldErrors), 400);
  const { email, password, firstName, lastName, organisationId, role, designation } = parsed.data;
  const supabase = getSupabaseServiceClient();

  if (organisationId) {
    const { data: org } = await supabase.from("organisations").select("id").eq("id", organisationId).maybeSingle();
    if (!org) return c.json(err("Organisation not found"), 404);
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { firstName, lastName },
  });
  if (error || !data.user) {
    const exists = /already|registered|exists/i.test(error?.message ?? "");
    return c.json(err(exists ? "A user with this email already exists" : (error?.message ?? "Could not create user")), exists ? 409 : 400);
  }
  const user = data.user;

  const warnings: string[] = [];
  if (organisationId) {
    const { error: memberErr } = await supabase
      .from("organisation_members")
      .insert({ organisation_id: organisationId, user_id: user.id, role, invited_by: identity.userId });
    if (memberErr) warnings.push(`User created but could not be added to the organisation: ${memberErr.message}`);

    // Also list them in the people directory.
    const { error: profileErr } = await supabase.from("employee_profiles").insert({
      organisation_id: organisationId,
      user_id: user.id,
      first_name: firstName,
      last_name: lastName || "-",
      work_email: email,
      designation: designation ?? null,
      employment_status: "active",
    });
    if (profileErr) warnings.push(`Directory profile was not created: ${profileErr.message}`);
  }

  await writeAuditLog({
    organisationId: organisationId ?? null,
    actorId: identity.userId,
    action: "admin.user_create",
    resourceType: "user",
    resourceId: user.id,
    metadata: { email, role: organisationId ? role : null },
  });

  return c.json({ id: user.id, email: user.email, warnings }, 201);
});

const BlockSchema = z.object({ reason: z.string().trim().max(500).optional() });

adminRoutes.post("/users/:id/block", async (c) => {
  const { identity, response } = await enforceSuperAdmin(c);
  if (response) return response;

  const targetId = c.req.param("id");
  if (!UUID_RE.test(targetId)) return c.json(err("Invalid user id"), 400);
  if (targetId === identity.userId) return c.json(err("You cannot block your own account"), 400);

  const parsed = BlockSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json(err("Validation failed"), 400);

  const supabase = getSupabaseServiceClient();
  const { data: target, error: lookupErr } = await supabase.auth.admin.getUserById(targetId);
  if (lookupErr || !target.user) return c.json(err("User not found"), 404);
  if (target.user.app_metadata?.is_super_admin === true) return c.json(err("Super admins cannot be blocked"), 403);

  // The table is the source of truth (checked on every request); the Supabase ban additionally
  // stops new sign-ins and token refreshes at the auth layer.
  const { error: insertErr } = await supabase.from("user_blocks").upsert({
    user_id: targetId,
    reason: parsed.data.reason ?? null,
    blocked_by: identity.userId,
    blocked_at: new Date().toISOString(),
  });
  if (insertErr) return c.json(err(`Could not record the block: ${insertErr.message}`), 500);
  invalidateBlockCache(targetId);

  const { error: banErr } = await supabase.auth.admin.updateUserById(targetId, { ban_duration: BAN_FOREVER });

  await writeAuditLog({
    organisationId: null,
    actorId: identity.userId,
    action: "admin.user_block",
    resourceType: "user",
    resourceId: targetId,
    metadata: { reason: parsed.data.reason ?? null, authBanApplied: !banErr },
  });

  return c.json({ success: true, blocked: true, authBanApplied: !banErr });
});

adminRoutes.post("/users/:id/unblock", async (c) => {
  const { identity, response } = await enforceSuperAdmin(c);
  if (response) return response;

  const targetId = c.req.param("id");
  if (!UUID_RE.test(targetId)) return c.json(err("Invalid user id"), 400);

  const supabase = getSupabaseServiceClient();
  const { error: delErr } = await supabase.from("user_blocks").delete().eq("user_id", targetId);
  if (delErr) return c.json(err(`Could not remove the block: ${delErr.message}`), 500);
  invalidateBlockCache(targetId);

  const { error: banErr } = await supabase.auth.admin.updateUserById(targetId, { ban_duration: "none" });

  await writeAuditLog({
    organisationId: null,
    actorId: identity.userId,
    action: "admin.user_unblock",
    resourceType: "user",
    resourceId: targetId,
    metadata: { authBanCleared: !banErr },
  });

  return c.json({ success: true, blocked: false, authBanCleared: !banErr });
});

// ─── Organisations ────────────────────────────────────────────────────────────

adminRoutes.get("/organisations", async (c) => {
  const { response } = await enforceSuperAdmin(c);
  if (response) return response;

  const supabase = getSupabaseServiceClient();
  const [{ data: orgs, error }, { data: members }] = await Promise.all([
    supabase.from("organisations").select("id, name, slug, created_at").order("created_at", { ascending: false }),
    supabase.from("organisation_members").select("organisation_id").is("left_at", null),
  ]);
  if (error) return c.json(err(error.message), 500);

  const counts = new Map<string, number>();
  for (const m of members ?? []) counts.set(m.organisation_id as string, (counts.get(m.organisation_id as string) ?? 0) + 1);

  return c.json({
    organisations: (orgs ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      createdAt: o.created_at,
      memberCount: counts.get(o.id as string) ?? 0,
    })),
  });
});

const CreateOrgSchema = z.object({
  name: z.string().trim().min(2).max(255),
  slug: z.string().trim().max(100).optional(),
  ownerUserId: z.string().regex(UUID_RE).optional(),
});

adminRoutes.post("/organisations", async (c) => {
  const { identity, response } = await enforceSuperAdmin(c);
  if (response) return response;

  const parsed = CreateOrgSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("Validation failed", parsed.error.flatten().fieldErrors), 400);

  const slug = slugify(parsed.data.slug || parsed.data.name);
  if (!slug) return c.json(err("Could not derive a valid slug"), 400);
  const supabase = getSupabaseServiceClient();

  if (parsed.data.ownerUserId) {
    const { data: owner } = await supabase.auth.admin.getUserById(parsed.data.ownerUserId);
    if (!owner.user) return c.json(err("Owner user not found"), 404);
  }

  const { data: org, error } = await supabase
    .from("organisations")
    .insert({ name: parsed.data.name, slug })
    .select("id, name, slug, created_at")
    .single();
  if (error || !org) {
    const dup = /duplicate|unique/i.test(error?.message ?? "");
    return c.json(err(dup ? `Slug "${slug}" is already taken` : (error?.message ?? "Could not create organisation")), dup ? 409 : 400);
  }

  if (parsed.data.ownerUserId) {
    const { error: memberErr } = await supabase
      .from("organisation_members")
      .insert({ organisation_id: org.id, user_id: parsed.data.ownerUserId, role: "owner", invited_by: identity.userId });
    if (memberErr) {
      await supabase.from("organisations").delete().eq("id", org.id);
      return c.json(err(`Could not assign the owner: ${memberErr.message}`), 500);
    }
  }

  await writeAuditLog({
    organisationId: org.id as string,
    actorId: identity.userId,
    action: "admin.organisation_create",
    resourceType: "organisation",
    resourceId: org.id as string,
    metadata: { name: org.name, ownerUserId: parsed.data.ownerUserId ?? null },
  });

  return c.json({ id: org.id, name: org.name, slug: org.slug, createdAt: org.created_at, memberCount: parsed.data.ownerUserId ? 1 : 0 }, 201);
});

// ─── Organisation members ─────────────────────────────────────────────────────

const SetMemberSchema = z.object({ role: z.enum(ROLES) });

async function ownerCount(orgId: string): Promise<number> {
  const { count } = await getSupabaseServiceClient()
    .from("organisation_members")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", orgId)
    .eq("role", "owner")
    .is("left_at", null);
  return count ?? 0;
}

/** Add a user to an organisation, or change their role. */
adminRoutes.put("/organisations/:orgId/members/:userId", async (c) => {
  const { identity, response } = await enforceSuperAdmin(c);
  if (response) return response;

  const { orgId, userId } = c.req.param();
  if (!UUID_RE.test(orgId) || !UUID_RE.test(userId)) return c.json(err("Invalid id"), 400);
  const parsed = SetMemberSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("Validation failed"), 400);

  const supabase = getSupabaseServiceClient();
  const [{ data: org }, { data: user }] = await Promise.all([
    supabase.from("organisations").select("id").eq("id", orgId).maybeSingle(),
    supabase.auth.admin.getUserById(userId),
  ]);
  if (!org) return c.json(err("Organisation not found"), 404);
  if (!user.user) return c.json(err("User not found"), 404);

  const { data: existing } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();

  if (existing?.role === "owner" && parsed.data.role !== "owner" && (await ownerCount(orgId)) <= 1) {
    return c.json(err("An organisation must keep at least one owner"), 409);
  }

  const { error } = await supabase.from("organisation_members").upsert(
    {
      organisation_id: orgId,
      user_id: userId,
      role: parsed.data.role,
      invited_by: identity.userId,
      left_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organisation_id,user_id" }
  );
  if (error) return c.json(err(error.message), 400);

  await writeAuditLog({
    organisationId: orgId,
    actorId: identity.userId,
    action: existing ? "admin.member_role_change" : "admin.member_add",
    resourceType: "user",
    resourceId: userId,
    metadata: { role: parsed.data.role, previousRole: existing?.role ?? null },
  });
  return c.json({ success: true });
});

adminRoutes.delete("/organisations/:orgId/members/:userId", async (c) => {
  const { identity, response } = await enforceSuperAdmin(c);
  if (response) return response;

  const { orgId, userId } = c.req.param();
  if (!UUID_RE.test(orgId) || !UUID_RE.test(userId)) return c.json(err("Invalid id"), 400);

  const supabase = getSupabaseServiceClient();
  const { data: existing } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (!existing) return c.json(err("Membership not found"), 404);
  if (existing.role === "owner" && (await ownerCount(orgId)) <= 1) {
    return c.json(err("An organisation must keep at least one owner"), 409);
  }

  const { error } = await supabase
    .from("organisation_members")
    .update({ left_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("organisation_id", orgId)
    .eq("user_id", userId);
  if (error) return c.json(err(error.message), 500);

  await writeAuditLog({
    organisationId: orgId,
    actorId: identity.userId,
    action: "admin.member_remove",
    resourceType: "user",
    resourceId: userId,
  });
  return c.json({ success: true });
});

export default adminRoutes;
