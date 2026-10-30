import type { Context } from "hono";
import { extractBearerToken, getSupabaseServiceClient, resolveIdentity, type Identity } from "./supabase";

export type Role = "owner" | "admin" | "member" | "guest";

export interface AuthContext {
  userId: string;
  email: string;
  isSuperAdmin: boolean;
}

export interface FullAuthContext extends AuthContext {
  organisationId: string | null;
  role: Role | null;
  /** Display name from the auth profile (falls back to the email local part). */
  name: string;
}

function displayNameOf(identity: Identity): string {
  const meta = (identity.user.user_metadata ?? {}) as Record<string, unknown>;
  const first = typeof meta.firstName === "string" ? meta.firstName : "";
  const last = typeof meta.lastName === "string" ? meta.lastName : "";
  return `${first} ${last}`.trim() || identity.email.split("@")[0] || "Member";
}

const ROLE_HIERARCHY: Record<Role, number> = {
  guest: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

/**
 * Resolves the authenticated user from the Bearer token.
 * Returns null when the token is missing or invalid.
 */
export async function getAuthContext(c: Context): Promise<AuthContext | null> {
  const identity = await getIdentity(c);
  return identity ? { userId: identity.userId, email: identity.email, isSuperAdmin: identity.isSuperAdmin } : null;
}

/** Bearer token -> verified identity. Null if missing/invalid, or the account is blocked. */
export async function getIdentity(c: Context): Promise<Identity | null> {
  const token = extractBearerToken(c.req.header("Authorization"));
  if (!token) return null;
  const result = await resolveIdentity(token);
  return result.ok ? result.identity : null;
}

/**
 * Full auth context including the user's role in their active organisation.
 * Queries organisation_members for role resolution.
 * Returns null if the token is missing/invalid or the user has no org membership.
 */
export async function getFullAuthContext(c: Context): Promise<FullAuthContext | null> {
  const identity = await getIdentity(c);
  if (!identity) return null;

  const { userId, email, isSuperAdmin } = identity;
  const name = displayNameOf(identity);
  // The header only *selects* among organisations the user belongs to; it never grants access.
  const headerOrgId = c.req.header("X-Organisation-Id") ?? null;
  const serviceClient = getSupabaseServiceClient();

  // Super admins act in any organisation (with owner rights) by naming it in the header.
  if (isSuperAdmin) {
    let organisationId: string | null = null;
    if (headerOrgId) {
      const { data } = await serviceClient.from("organisations").select("id").eq("id", headerOrgId).maybeSingle();
      organisationId = data?.id ?? null;
    }
    return { userId, email, isSuperAdmin, organisationId, role: "owner", name };
  }

  let query = serviceClient
    .from("organisation_members")
    .select("organisation_id, role")
    .eq("user_id", userId)
    .is("left_at", null)
    .order("joined_at", { ascending: false })
    .limit(1);
  if (headerOrgId) query = query.eq("organisation_id", headerOrgId) as typeof query;

  const { data: member } = await query.maybeSingle();

  return {
    userId,
    email,
    isSuperAdmin,
    organisationId: (member?.organisation_id as string | undefined) ?? null,
    role: (member?.role as Role | undefined) ?? null,
    name,
  };
}

/** Resolves the caller and requires super admin. Returns a ready 401/403 response otherwise. */
export async function enforceSuperAdmin(
  c: Context
): Promise<{ identity: Identity; response: null } | { identity: null; response: Response }> {
  const identity = await getIdentity(c);
  if (!identity) {
    return { identity: null, response: c.json({ error: { message: "Unauthorized" } }, 401) as unknown as Response };
  }
  if (!identity.isSuperAdmin) {
    return {
      identity: null,
      response: c.json({ error: { message: "Super admin access required" } }, 403) as unknown as Response,
    };
  }
  return { identity, response: null };
}

/**
 * Returns true if the context's role meets or exceeds minRole in the hierarchy.
 */
export function requireRole(context: FullAuthContext | null, minRole: Role): boolean {
  if (!context?.role) return false;
  return ROLE_HIERARCHY[context.role] >= ROLE_HIERARCHY[minRole];
}

/**
 * Resolves auth and immediately returns a 401/403 JSON response when the
 * user doesn't meet minRole. Use inside route handlers:
 *
 *   const { context, response } = await enforceRole(c, "admin");
 *   if (response) return response;
 *   // context is guaranteed non-null here
 */
export async function enforceRole(
  c: Context,
  minRole: Role
): Promise<{ context: FullAuthContext; response: null } | { context: null; response: Response }> {
  const ctx = await getFullAuthContext(c);
  if (!ctx) {
    return {
      context: null,
      response: c.json({ error: { message: "Unauthorized" } }, 401) as unknown as Response,
    };
  }
  if (!requireRole(ctx, minRole)) {
    return {
      context: null,
      response: c.json(
        { error: { message: `Requires '${minRole}' role or higher` } },
        403
      ) as unknown as Response,
    };
  }
  return { context: ctx, response: null };
}

/**
 * Append an audit entry for consequential actions.
 * Best-effort — does not throw if the write fails.
 */
export async function writeAuditLog(opts: {
  organisationId: string | null;
  actorId: string;
  actorType?: "user" | "agent" | "system";
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = getSupabaseServiceClient();
    await supabase.from("audit_logs").insert({
      organisation_id: opts.organisationId,
      actor_id: opts.actorId,
      actor_type: opts.actorType ?? "user",
      action: opts.action,
      resource_type: opts.resourceType,
      resource_id: opts.resourceId,
      metadata: opts.metadata ?? {},
    });
  } catch {
    // Non-critical — swallow silently
  }
}
