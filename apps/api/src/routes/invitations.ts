/**
 * /api/v1/invitations — onboard a new employee with a link made for that one person.
 *
 * Flow
 *   1. An org admin (or the super admin acting in an org) creates an invitation for a specific
 *      email. The organisation chooses the person's initial password (or the server generates one).
 *      An inactive account is created with that password, and the admin receives a one-time link
 *      plus the password to hand over. The password is never stored.
 *   2. The person opens the link. Accepting it activates the account, joins them to the
 *      organisation with the chosen role and creates their directory profile. They then sign in
 *      with the password the organisation gave them (or choose their own on the accept page).
 *
 * Security
 *   - Link tokens are 256-bit random values; only their SHA-256 hash is stored.
 *   - A link works exactly once, expires (default 7 days) and can be revoked.
 *   - Accepting is an atomic compare-and-set on `status = 'pending'`, so a link can't be raced.
 *   - Choosing a new password on accept is only allowed for accounts created by this invitation,
 *     so a link can never be used to take over a pre-existing account.
 *   - Blocked users cannot be activated by a link.
 *   - Public endpoints return the same generic message for unknown/used/expired/revoked tokens
 *     where that avoids leaking which tokens exist.
 */

import { createHash, randomBytes, randomInt } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { enforceRole, writeAuditLog } from "../lib/auth";
import { getSupabaseServiceClient, isUserBlocked } from "../lib/supabase";

const invitationsRoutes = new Hono();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ["owner", "admin", "member", "guest"] as const;
const BAN_FOREVER = "876000h";
const INVITE_TTL_DAYS = Math.max(1, Number(process.env.INVITE_TTL_DAYS) || 7);
const GENERIC_INVALID = "This invitation link is invalid or has expired.";

const err = (message: string, details?: unknown) => ({ error: { message, ...(details ? { details } : {}) } });

// ─── helpers ──────────────────────────────────────────────────────────────────

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

/** Readable, unambiguous password (no 0/O/1/l/I). ~16 chars from a 54-symbol alphabet. */
function generatePassword(length = 16): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

function webBaseUrl(c: Context): string {
  const configured = process.env.WEB_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  // Fall back to the browser origin that called us (the web app), never the API's own origin.
  const origin = c.req.header("Origin");
  return origin && /^https?:\/\//.test(origin) ? origin.replace(/\/$/, "") : "http://localhost:3000";
}

const inviteLink = (c: Context, token: string) => `${webBaseUrl(c)}/invite/${token}`;
const expiryIso = () => new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();

async function findAuthUserByEmail(email: string) {
  const supabase = getSupabaseServiceClient();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

function toInvitation(row: Record<string, unknown>) {
  const expired = row.status === "pending" && new Date(row.expires_at as string).getTime() < Date.now();
  return {
    id: row.id as string,
    email: row.email as string,
    firstName: row.first_name as string,
    lastName: (row.last_name as string) ?? "",
    role: row.role as string,
    designation: (row.designation as string | null) ?? null,
    departmentId: (row.department_id as string | null) ?? null,
    status: (expired ? "expired" : row.status) as string,
    expiresAt: row.expires_at as string,
    acceptedAt: (row.accepted_at as string | null) ?? null,
    createdAt: row.created_at as string,
    accountIsNew: Boolean(row.account_created_by_invite),
  };
}

// ─── Admin: create ────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).default(""),
  role: z.enum(ROLES).default("member"),
  designation: z.string().trim().max(150).optional(),
  departmentId: z.string().regex(UUID_RE).optional(),
  /** Organisation-chosen initial password. Omit to have one generated. */
  password: z.string().min(8).max(128).optional(),
});

invitationsRoutes.post("/", async (c) => {
  const { context: auth, response } = await enforceRole(c, "admin");
  if (response) return response;
  if (!auth.organisationId) return c.json(err("No active organisation"), 403);

  const parsed = CreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err("Validation failed", parsed.error.flatten().fieldErrors), 400);
  const input = parsed.data;

  // Only an owner may mint another owner.
  if (input.role === "owner" && auth.role !== "owner") {
    return c.json(err("Only an owner can invite someone as owner"), 403);
  }

  const supabase = getSupabaseServiceClient();
  const orgId = auth.organisationId;

  if (input.departmentId) {
    const { data: dept } = await supabase
      .from("departments")
      .select("id")
      .eq("id", input.departmentId)
      .eq("organisation_id", orgId)
      .maybeSingle();
    if (!dept) return c.json(err("Department not found in this organisation"), 404);
  }

  const { data: pending } = await supabase
    .from("employee_invitations")
    .select("id")
    .eq("organisation_id", orgId)
    .eq("email", input.email) // always stored lower-cased
    .eq("status", "pending")
    .maybeSingle();
  if (pending) {
    return c.json(err("A pending invitation already exists for this email. Regenerate its link instead."), 409);
  }

  // Existing person? Attach them; never touch their password.
  let existing: Awaited<ReturnType<typeof findAuthUserByEmail>>;
  try {
    existing = await findAuthUserByEmail(input.email);
  } catch (e) {
    return c.json(err(`Could not look up the account: ${(e as Error).message}`), 500);
  }

  let userId: string;
  let accountCreated = false;
  let initialPassword: string | null = null;

  if (existing) {
    userId = existing.id;
    if (existing.app_metadata?.is_super_admin === true) {
      return c.json(err("This account cannot be invited to an organisation this way"), 403);
    }
    const { data: member } = await supabase
      .from("organisation_members")
      .select("id")
      .eq("organisation_id", orgId)
      .eq("user_id", userId)
      .is("left_at", null)
      .maybeSingle();
    if (member) return c.json(err("This person is already a member of the organisation"), 409);
  } else {
    initialPassword = input.password ?? generatePassword();
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: input.email,
      password: initialPassword,
      email_confirm: true,
      user_metadata: { firstName: input.firstName, lastName: input.lastName },
      // Inactive until the link is opened: they cannot sign in or refresh a session.
      ban_duration: BAN_FOREVER,
    });
    if (createErr || !created.user) {
      return c.json(err(createErr?.message ?? "Could not create the account"), 400);
    }
    userId = created.user.id;
    accountCreated = true;
  }

  const token = newToken();
  const { data: row, error: insertErr } = await supabase
    .from("employee_invitations")
    .insert({
      organisation_id: orgId,
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      role: input.role,
      designation: input.designation ?? null,
      department_id: input.departmentId ?? null,
      token_hash: hashToken(token),
      expires_at: expiryIso(),
      user_id: userId,
      account_created_by_invite: accountCreated,
      invited_by: auth.userId,
    })
    .select("*")
    .single();

  if (insertErr || !row) {
    if (accountCreated) await supabase.auth.admin.deleteUser(userId).catch(() => {});
    const missing = /relation .* does not exist|schema cache/i.test(insertErr?.message ?? "");
    return c.json(
      err(missing ? "Invitations are not set up yet. Apply database migration 009." : "Could not create the invitation"),
      500
    );
  }

  await writeAuditLog({
    organisationId: orgId,
    actorId: auth.userId,
    action: "invitation.create",
    resourceType: "invitation",
    resourceId: row.id as string,
    metadata: { email: input.email, role: input.role, accountCreated },
  });

  return c.json(
    {
      invitation: toInvitation(row),
      link: inviteLink(c, token),
      // Shown to the admin exactly once; it is not stored and cannot be retrieved later.
      initialPassword,
      note: accountCreated
        ? "Give the person the link and this password. The link works once and the password is not shown again."
        : "This person already has an account. They keep their existing password.",
    },
    201
  );
});

// ─── Admin: list / regenerate / revoke ────────────────────────────────────────

invitationsRoutes.get("/", async (c) => {
  const { context: auth, response } = await enforceRole(c, "admin");
  if (response) return response;
  if (!auth.organisationId) return c.json(err("No active organisation"), 403);

  const { data, error } = await getSupabaseServiceClient()
    .from("employee_invitations")
    .select("*")
    .eq("organisation_id", auth.organisationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    const missing = /relation .* does not exist|schema cache/i.test(error.message);
    return c.json(err(missing ? "Invitations are not set up yet. Apply database migration 009." : error.message), 500);
  }
  return c.json({ invitations: (data ?? []).map((r) => toInvitation(r as Record<string, unknown>)) });
});

const RegenerateSchema = z.object({
  /** Also set a fresh organisation-chosen password (only for accounts this invitation created). */
  resetPassword: z.boolean().default(false),
  password: z.string().min(8).max(128).optional(),
});

invitationsRoutes.post("/:id/regenerate", async (c) => {
  const { context: auth, response } = await enforceRole(c, "admin");
  if (response) return response;
  if (!auth.organisationId) return c.json(err("No active organisation"), 403);

  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json(err("Invalid id"), 400);
  const parsed = RegenerateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json(err("Validation failed"), 400);

  const supabase = getSupabaseServiceClient();
  const { data: inv } = await supabase
    .from("employee_invitations")
    .select("*")
    .eq("id", id)
    .eq("organisation_id", auth.organisationId)
    .maybeSingle();
  if (!inv) return c.json(err("Invitation not found"), 404);
  if (inv.status === "accepted") return c.json(err("This invitation was already accepted"), 409);
  if (inv.status === "revoked") return c.json(err("This invitation was revoked. Create a new one."), 409);

  let initialPassword: string | null = null;
  if (parsed.data.resetPassword) {
    if (!inv.account_created_by_invite) {
      return c.json(err("This person already had an account; their password can't be reset from here"), 409);
    }
    initialPassword = parsed.data.password ?? generatePassword();
    const { error: pwErr } = await supabase.auth.admin.updateUserById(inv.user_id as string, { password: initialPassword });
    if (pwErr) return c.json(err(`Could not set the password: ${pwErr.message}`), 500);
  }

  const token = newToken();
  const { data: updated, error } = await supabase
    .from("employee_invitations")
    .update({ token_hash: hashToken(token), expires_at: expiryIso(), status: "pending", updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["pending", "expired"])
    .select("*")
    .maybeSingle();
  if (error || !updated) return c.json(err("Could not regenerate the link"), 409);

  await writeAuditLog({
    organisationId: auth.organisationId,
    actorId: auth.userId,
    action: "invitation.regenerate",
    resourceType: "invitation",
    resourceId: id,
    metadata: { passwordReset: Boolean(initialPassword) },
  });

  return c.json({ invitation: toInvitation(updated), link: inviteLink(c, token), initialPassword });
});

invitationsRoutes.delete("/:id", async (c) => {
  const { context: auth, response } = await enforceRole(c, "admin");
  if (response) return response;
  if (!auth.organisationId) return c.json(err("No active organisation"), 403);

  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json(err("Invalid id"), 400);

  const supabase = getSupabaseServiceClient();
  const { data: inv } = await supabase
    .from("employee_invitations")
    .select("*")
    .eq("id", id)
    .eq("organisation_id", auth.organisationId)
    .maybeSingle();
  if (!inv) return c.json(err("Invitation not found"), 404);
  if (inv.status === "accepted") return c.json(err("This invitation was already accepted"), 409);

  const { error } = await supabase
    .from("employee_invitations")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("id", id)
    .neq("status", "accepted");
  if (error) return c.json(err("Could not revoke the invitation"), 500);

  // An inactive account that only exists for this invitation is removed with it.
  if (inv.account_created_by_invite) {
    await supabase.auth.admin.deleteUser(inv.user_id as string).catch(() => {});
  }

  await writeAuditLog({
    organisationId: auth.organisationId,
    actorId: auth.userId,
    action: "invitation.revoke",
    resourceType: "invitation",
    resourceId: id,
    metadata: { email: inv.email },
  });
  return c.json({ success: true });
});

// ─── Public: preview + accept (the invited person, not signed in) ─────────────

const TokenSchema = z.object({ token: z.string().min(20).max(200) });

async function loadByToken(token: string) {
  const { data } = await getSupabaseServiceClient()
    .from("employee_invitations")
    .select("*")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  return data as Record<string, any> | null;
}

invitationsRoutes.post("/preview", async (c) => {
  const parsed = TokenSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err(GENERIC_INVALID), 404);

  const inv = await loadByToken(parsed.data.token);
  if (!inv || inv.status !== "pending" || new Date(inv.expires_at).getTime() < Date.now()) {
    return c.json(err(GENERIC_INVALID), 404);
  }

  const { data: org } = await getSupabaseServiceClient()
    .from("organisations")
    .select("name")
    .eq("id", inv.organisation_id)
    .maybeSingle();

  return c.json({
    organisationName: org?.name ?? "your organisation",
    email: inv.email,
    firstName: inv.first_name,
    lastName: inv.last_name,
    role: inv.role,
    designation: inv.designation,
    accountIsNew: Boolean(inv.account_created_by_invite),
    expiresAt: inv.expires_at,
  });
});

const AcceptSchema = z.object({
  token: z.string().min(20).max(200),
  /** Optional: choose your own password instead of the one the organisation set. */
  newPassword: z.string().min(8).max(128).optional(),
});

invitationsRoutes.post("/accept", async (c) => {
  const parsed = AcceptSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(err(GENERIC_INVALID), 404);
  const { token, newPassword } = parsed.data;

  const supabase = getSupabaseServiceClient();
  const tokenHash = hashToken(token);
  const nowIso = new Date().toISOString();

  const known = await loadByToken(token);
  if (!known) return c.json(err(GENERIC_INVALID), 404);
  if (known.status === "accepted") return c.json(err("This invitation has already been used. Sign in to continue."), 410);
  if (known.status === "revoked") return c.json(err(GENERIC_INVALID), 410);
  if (new Date(known.expires_at).getTime() < Date.now()) {
    await supabase.from("employee_invitations").update({ status: "expired" }).eq("id", known.id).eq("status", "pending");
    return c.json(err(GENERIC_INVALID), 410);
  }
  if (newPassword && !known.account_created_by_invite) {
    return c.json(err("This account already exists; sign in with your current password."), 400);
  }
  if ((await isUserBlocked(known.user_id)) !== false) {
    return c.json(err("This account can't be activated. Contact your administrator."), 403);
  }

  // Atomically claim the invitation. Of two simultaneous requests, exactly one wins.
  const { data: claimed } = await supabase
    .from("employee_invitations")
    .update({ status: "accepted", accepted_at: nowIso, updated_at: nowIso })
    .eq("token_hash", tokenHash)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .select("*")
    .maybeSingle();
  if (!claimed) return c.json(err("This invitation has already been used."), 409);

  const release = async () => {
    await supabase
      .from("employee_invitations")
      .update({ status: "pending", accepted_at: null, updated_at: new Date().toISOString() })
      .eq("id", claimed.id);
  };

  try {
    const orgId = claimed.organisation_id as string;
    const userId = claimed.user_id as string;

    const { data: existingMember } = await supabase
      .from("organisation_members")
      .select("id, role")
      .eq("organisation_id", orgId)
      .eq("user_id", userId)
      .is("left_at", null)
      .maybeSingle();

    if (!existingMember) {
      const { error: memberErr } = await supabase.from("organisation_members").upsert(
        { organisation_id: orgId, user_id: userId, role: claimed.role, invited_by: claimed.invited_by, left_at: null },
        { onConflict: "organisation_id,user_id" }
      );
      if (memberErr) throw new Error(memberErr.message);
    }

    const { data: profile } = await supabase
      .from("employee_profiles")
      .select("id")
      .eq("organisation_id", orgId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!profile) {
      const { error: profileErr } = await supabase.from("employee_profiles").insert({
        organisation_id: orgId,
        user_id: userId,
        first_name: claimed.first_name,
        last_name: claimed.last_name || "-",
        work_email: claimed.email,
        designation: claimed.designation,
        department_id: claimed.department_id,
        employment_status: "active",
      });
      if (profileErr) throw new Error(profileErr.message);
    }

    if (claimed.account_created_by_invite) {
      const { error: activateErr } = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: "none",
        ...(newPassword ? { password: newPassword } : {}),
      });
      if (activateErr) throw new Error(activateErr.message);
    }

    const { data: org } = await supabase.from("organisations").select("name").eq("id", orgId).maybeSingle();

    // Tell whoever sent the invitation (best effort; never blocks onboarding).
    await supabase
      .from("notifications")
      .insert({
        organisation_id: orgId,
        recipient_id: claimed.invited_by,
        actor_id: userId,
        category: "system",
        title: `${claimed.first_name} joined`,
        body: `${claimed.first_name} ${claimed.last_name ?? ""}`.trim() + ` accepted the invitation and joined as ${claimed.role}.`,
        link_url: "/directory",
        priority: "normal",
        is_read: false,
      })
      .then(() => {}, () => {});

    await writeAuditLog({
      organisationId: orgId,
      actorId: userId,
      action: "invitation.accept",
      resourceType: "invitation",
      resourceId: claimed.id as string,
      metadata: { email: claimed.email, role: claimed.role },
    });

    return c.json({
      success: true,
      email: claimed.email,
      organisationName: org?.name ?? "your organisation",
      usedOwnPassword: Boolean(newPassword),
      accountIsNew: Boolean(claimed.account_created_by_invite),
    });
  } catch (e) {
    console.error("[invitations] accept failed, releasing invitation:", (e as Error).message);
    await release();
    return c.json(err("We couldn't finish setting up your account. Please try the link again."), 500);
  }
});

export default invitationsRoutes;
