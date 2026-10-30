export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: SessionUser;
  organisationId: string | null;
  role: string | null;
  /** UI hint only; every admin endpoint re-checks this on the server. */
  isSuperAdmin?: boolean;
}

interface AuthResponse {
  user: SessionUser;
  session: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
}

const SESSION_KEY = "bizcontext_session";
const AUTH_COOKIE = "bizcontext_auth";

export const sessionStore = {
  get(): StoredSession | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as StoredSession) : null;
    } catch {
      return null;
    }
  },

  set(session: StoredSession, remember = true) {
    if (typeof window === "undefined") return;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    const maxAge = remember ? 2592000 : 86400;
    document.cookie = `${AUTH_COOKIE}=1; path=/; max-age=${maxAge}; SameSite=Lax`;
  },

  clear() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(SESSION_KEY);
    document.cookie = `${AUTH_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
  },
};

export function toStoredSession(
  res: AuthResponse,
  previous?: Pick<StoredSession, "organisationId" | "role" | "isSuperAdmin"> | null
): StoredSession {
  return {
    accessToken: res.session.accessToken,
    refreshToken: res.session.refreshToken,
    expiresAt: Date.now() + res.session.expiresIn * 1000,
    user: res.user,
    organisationId: previous?.organisationId ?? null,
    role: previous?.role ?? null,
    isSuperAdmin: previous?.isSuperAdmin ?? false,
  };
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const err = body?.error;
    if (typeof err === "string") return err;
    if (err?.message) return err.message as string;
  } catch {
    // non-JSON body
  }
  return `Request failed (${res.status})`;
}

let refreshing: Promise<boolean> | null = null;

async function refreshSession(baseUrl: string): Promise<boolean> {
  const current = sessionStore.get();
  if (!current?.refreshToken) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${baseUrl}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
        if (!res.ok) return false;
        sessionStore.set(toStoredSession((await res.json()) as AuthResponse, current));
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/**
 * Authenticated JSON request. Throws ApiError on any failure, including
 * network errors (status 0). Refreshes the session once on a 401.
 */
export async function http<T>(
  baseUrl: string,
  path: string,
  init: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const { auth = true, ...options } = init;

  const send = () => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };
    const session = sessionStore.get();
    if (auth && session) {
      headers.Authorization = `Bearer ${session.accessToken}`;
      headers["X-User-Id"] = session.user.id;
      if (session.organisationId) headers["X-Organisation-Id"] = session.organisationId;
    }
    return fetch(`${baseUrl}${path}`, { ...options, headers });
  };

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && auth && (await refreshSession(baseUrl))) {
      res = await send();
    }
  } catch {
    throw new ApiError("Cannot reach the server. Check that the API is running.", 0);
  }

  if (!res.ok) {
    if (res.status === 401 && auth) {
      sessionStore.clear();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`;
      }
    }
    throw new ApiError(await parseError(res), res.status);
  }

  return (await res.json()) as T;
}

/**
 * Authenticated streaming POST (SSE). Returns the raw Response so the caller can read
 * the body incrementally. Refreshes the session once on a 401, like http().
 * Throws ApiError for network failures (status 0) and non-2xx responses.
 */
export async function streamRequest(
  baseUrl: string,
  path: string,
  body: unknown,
  signal?: AbortSignal
): Promise<Response> {
  const send = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "text/event-stream" };
    const session = sessionStore.get();
    if (session) {
      headers.Authorization = `Bearer ${session.accessToken}`;
      if (session.organisationId) headers["X-Organisation-Id"] = session.organisationId;
    }
    return fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal });
  };

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && (await refreshSession(baseUrl))) res = await send();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Cannot reach the server. Check that the API is running.", 0);
  }
  if (!res.ok || !res.body) throw new ApiError(await parseError(res), res.status);
  return res;
}

export type { AuthResponse };
