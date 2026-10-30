import { Hono } from "hono";
import type { Context } from "hono";
import { SignUpSchema, LoginSchema, RefreshTokenSchema } from "@bizcontext/validation";
import {
  getSupabaseAnonClient,
  getSupabaseServiceClient,
  isUserBlocked,
  resolveIdentity,
  resolveMembership,
} from "../lib/supabase";
import type { Session, User } from "@supabase/supabase-js";

const authRoutes = new Hono();

export interface AuthUserResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface AuthSessionResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

export interface AuthMeResponse {
  user: AuthUserResponse;
  organisationId: string | null;
  role: string | null;
  isSuperAdmin: boolean;
}

/** True (and the just-issued session revoked) when the user is blocked. Fails closed on lookup errors. */
async function rejectIfBlocked(user: User, accessToken: string): Promise<boolean> {
  if (user.app_metadata?.is_super_admin === true) return false;
  const blocked = await isUserBlocked(user.id);
  if (blocked === false) return false;
  await getSupabaseServiceClient().auth.admin.signOut(accessToken, "global").catch(() => {});
  return true;
}

function toUserResponse(user: User): AuthUserResponse {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const firstName =
    typeof metadata.firstName === "string"
      ? metadata.firstName
      : typeof metadata.first_name === "string"
        ? (metadata.first_name as string)
        : "";
  const lastName =
    typeof metadata.lastName === "string"
      ? metadata.lastName
      : typeof metadata.last_name === "string"
        ? (metadata.last_name as string)
        : "";

  return {
    id: user.id,
    email: user.email ?? "",
    firstName,
    lastName,
  };
}

function toSessionResponse(session: Session): AuthSessionResponse {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    tokenType: session.token_type,
  };
}

function errorMessage(c: Context, status: 400 | 401 | 403 | 500, message: string) {
  return c.json({ error: { message } }, status);
}

// POST /api/v1/auth/signup
authRoutes.post("/signup", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = SignUpSchema.safeParse(body);
  if (!parsed.success) {
    return errorMessage(c, 400, "Validation failed");
  }

  const { email, password, firstName, lastName } = parsed.data;
  const anonClient = getSupabaseAnonClient();
  const serviceClient = getSupabaseServiceClient();

  let user: User | null = null;
  let session: Session | null = null;

  // Try creating the user pre-confirmed via service-role admin API first.
  // This bypasses Supabase free-tier email rate limiting (2 emails/hr) and requires no confirmation email.
  const { data: createData, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { firstName, lastName },
  });

  if (createError) {
    const msg = createError.message.toLowerCase();
    if (msg.includes("already registered") || msg.includes("already been registered") || createError.status === 422) {
      return errorMessage(c, 400, "An account with this email already exists");
    }

    // Fall back to standard anon signUp if admin.createUser encountered an unexpected issue
    console.warn("[auth/signup] admin.createUser failed, falling back to anon signUp:", createError.message);
    const { data: signUpData, error: signUpError } = await anonClient.auth.signUp({
      email,
      password,
      options: {
        data: { firstName, lastName },
      },
    });

    if (signUpError) {
      if (signUpError.status === 422 || signUpError.message.toLowerCase().includes("already registered")) {
        return errorMessage(c, 400, "An account with this email already exists");
      }
      return errorMessage(c, 400, signUpError.message);
    }

    if (!signUpData.user) {
      return errorMessage(c, 400, "Signup failed: no user returned");
    }

    user = signUpData.user;
    session = signUpData.session;

    if (!session) {
      // Auto-confirm user if pending
      await serviceClient.auth.admin.updateUserById(user.id, { email_confirm: true }).catch(() => {});
    }
  } else {
    user = createData.user;
  }

  // Obtain an authenticated session for the user
  if (!session) {
    const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signInData.session || !signInData.user) {
      return errorMessage(c, 500, "Signup succeeded but session creation failed. Please log in.");
    }

    session = signInData.session;
    user = signInData.user;
  }

  return c.json({ user: toUserResponse(user), session: toSessionResponse(session) }, 201);
});

// POST /api/v1/auth/login
authRoutes.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return errorMessage(c, 400, "Validation failed");
  }

  const { email, password } = parsed.data;
  const supabase = getSupabaseAnonClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Supabase reports banned accounts as "User is banned"; give them our clearer message.
    if (/banned/i.test(error.message)) return errorMessage(c, 403, "This account has been blocked. Contact an administrator.");
    return errorMessage(c, 401, error.message || "Invalid email or password");
  }

  if (!data.session || !data.user) {
    return errorMessage(c, 401, "Invalid email or password");
  }

  if (await rejectIfBlocked(data.user, data.session.access_token)) {
    return errorMessage(c, 403, "This account has been blocked. Contact an administrator.");
  }

  return c.json({ user: toUserResponse(data.user), session: toSessionResponse(data.session) }, 200);
});

// POST /api/v1/auth/logout
authRoutes.post("/logout", async (c) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!token) {
    return errorMessage(c, 401, "Missing bearer token");
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.auth.admin.signOut(token, "local");

  if (error) {
    return errorMessage(c, 500, "Failed to revoke session");
  }

  return c.json({ success: true }, 200);
});

// POST /api/v1/auth/refresh
authRoutes.post("/refresh", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RefreshTokenSchema.safeParse(body);
  if (!parsed.success) {
    return errorMessage(c, 400, "Validation failed");
  }

  const supabase = getSupabaseAnonClient();
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: parsed.data.refreshToken,
  });

  if (error) {
    return errorMessage(c, 401, "Failed to refresh session");
  }

  if (!data.session || !data.user) {
    return errorMessage(c, 401, "Failed to refresh session");
  }

  if (await rejectIfBlocked(data.user, data.session.access_token)) {
    return errorMessage(c, 401, "This account has been blocked. Contact an administrator.");
  }

  return c.json({ user: toUserResponse(data.user), session: toSessionResponse(data.session) }, 200);
});

// GET /api/v1/auth/me
authRoutes.get("/me", async (c) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!token) {
    return errorMessage(c, 401, "Missing bearer token");
  }

  const result = await resolveIdentity(token);
  if (!result.ok) {
    return errorMessage(
      c,
      401,
      result.reason === "blocked" ? "This account has been blocked. Contact an administrator." : "Invalid or expired token"
    );
  }
  const { user, isSuperAdmin } = result.identity;

  // Source of truth for org + role is organisation_members (RBAC); super admins act in any org as owner.
  const membership = await resolveMembership(user.id, isSuperAdmin, c.req.header("X-Organisation-Id"));
  const organisationId = membership?.organisationId ?? null;
  const role = isSuperAdmin ? "owner" : (membership?.role ?? null);

  const meResponse: AuthMeResponse = {
    user: toUserResponse(user),
    organisationId,
    role,
    isSuperAdmin,
  };

  return c.json(meResponse, 200);
});

export default authRoutes;
