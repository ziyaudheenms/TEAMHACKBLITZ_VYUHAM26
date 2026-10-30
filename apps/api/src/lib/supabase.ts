import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

let anonClient: SupabaseClient | null = null;
let serviceClient: SupabaseClient | null = null;

export function getSupabaseAnonClient(): SupabaseClient {
  if (!anonClient) {
    anonClient = createClient(
      process.env.SUPABASE_URL || "http://localhost:54321",
      process.env.SUPABASE_ANON_KEY || ""
    );
  }
  return anonClient;
}

export function getSupabaseServiceClient(): SupabaseClient {
  if (!serviceClient) {
    serviceClient = createClient(
      process.env.SUPABASE_URL || "http://localhost:54321",
      process.env.SUPABASE_SERVICE_ROLE_KEY || ""
    );
  }
  return serviceClient;
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// ─── User blocking ────────────────────────────────────────────────────────────
// Looked up on every authenticated request so a block applies immediately. A short
// cache keeps this cheap; block/unblock invalidate it for the local process, and other
// instances converge within BLOCK_CACHE_TTL_MS.

const BLOCK_CACHE_TTL_MS = 5_000;
const blockCache = new Map<string, { blocked: boolean; expires: number }>();

export function invalidateBlockCache(userId: string): void {
  blockCache.delete(userId);
}

/** `true`/`false`, or `null` when the lookup failed. Callers must fail closed on `null`. */
export async function isUserBlocked(userId: string): Promise<boolean | null> {
  const hit = blockCache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.blocked;

  const { data, error } = await getSupabaseServiceClient()
    .from("user_blocks")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error(
      `[auth] user_blocks lookup failed (${error.message}). Has migration 008 been applied?`
    );
    return null;
  }

  if (blockCache.size > 5_000) blockCache.clear();
  const blocked = Boolean(data);
  blockCache.set(userId, { blocked, expires: Date.now() + BLOCK_CACHE_TTL_MS });
  return blocked;
}

// ─── Identity ─────────────────────────────────────────────────────────────────

export interface Identity {
  userId: string;
  email: string;
  /** From `app_metadata`, which only the service-role key can write. */
  isSuperAdmin: boolean;
  user: User;
}

export type IdentityResult =
  | { ok: true; identity: Identity }
  | { ok: false; reason: "invalid" | "blocked" | "unavailable" };

/**
 * The single place a bearer token becomes an identity. Rejects blocked users, so every
 * route that authenticates through here (directly or via the helpers below) enforces blocks.
 * Super admins can never be blocked.
 */
export async function resolveIdentity(token: string): Promise<IdentityResult> {
  const { data, error } = await getSupabaseAnonClient().auth.getUser(token);
  if (error || !data.user) return { ok: false, reason: "invalid" };

  const user = data.user;
  const isSuperAdmin = user.app_metadata?.is_super_admin === true;

  if (!isSuperAdmin) {
    const blocked = await isUserBlocked(user.id);
    if (blocked === null) return { ok: false, reason: "unavailable" };
    if (blocked) return { ok: false, reason: "blocked" };
  }

  return { ok: true, identity: { userId: user.id, email: user.email ?? "", isSuperAdmin, user } };
}

export async function resolveAuthUser(
  token: string
): Promise<{ userId: string | null; isSuperAdmin: boolean; error: Error | null }> {
  const result = await resolveIdentity(token);
  if (!result.ok) {
    const message =
      result.reason === "blocked"
        ? "Account blocked"
        : result.reason === "unavailable"
          ? "Authorization service unavailable"
          : "User not found";
    return { userId: null, isSuperAdmin: false, error: new Error(message) };
  }
  return { userId: result.identity.userId, isSuperAdmin: result.identity.isSuperAdmin, error: null };
}

/**
 * Which organisation (and role) a caller is acting in.
 *  - Regular users: their active membership. `headerOrgId` may only select among organisations
 *    they already belong to; it never grants access.
 *  - Super admins: any existing organisation, with owner rights (header, else the first org).
 */
export async function resolveMembership(
  userId: string,
  isSuperAdmin: boolean,
  headerOrgId?: string | null
): Promise<{ organisationId: string; role: string } | null> {
  const supabase = getSupabaseServiceClient();

  if (isSuperAdmin) {
    let q = supabase.from("organisations").select("id").order("created_at", { ascending: true }).limit(1);
    if (headerOrgId) q = supabase.from("organisations").select("id").eq("id", headerOrgId).limit(1);
    const { data } = await q.maybeSingle();
    return data?.id ? { organisationId: data.id as string, role: "owner" } : null;
  }

  let q = supabase
    .from("organisation_members")
    .select("organisation_id, role")
    .eq("user_id", userId)
    .is("left_at", null)
    .order("joined_at", { ascending: false })
    .limit(1);
  if (headerOrgId) q = q.eq("organisation_id", headerOrgId);
  const { data } = await q.maybeSingle();
  return data ? { organisationId: data.organisation_id as string, role: data.role as string } : null;
}
