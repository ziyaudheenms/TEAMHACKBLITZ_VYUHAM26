import { beforeEach, describe, expect, mock, test } from "bun:test";

// One shared Supabase mock for the whole file (Bun applies mock.module process-wide).
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ADMIN_ID = "33333333-3333-4333-8333-333333333333";

const tokens: Record<string, { id: string; email: string; app_metadata: Record<string, unknown> }> = {
  "tok-admin": { id: ADMIN_ID, email: "admin@gmail.com", app_metadata: { is_super_admin: true } },
  "tok-user": { id: USER_ID, email: "u@x.com", app_metadata: {} },
};
const authUsers: Record<string, { id: string; app_metadata: Record<string, unknown> }> = {
  [USER_ID]: { id: USER_ID, app_metadata: {} },
  [OTHER_ADMIN_ID]: { id: OTHER_ADMIN_ID, app_metadata: { is_super_admin: true } },
};

let blockedIds = new Set<string>();
let blockLookupError: string | null = null;
let upserts: Array<{ table: string; row: any }> = [];
let bans: Array<{ id: string; attrs: any }> = [];

mock.module("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (t: string) =>
        tokens[t] ? { data: { user: tokens[t] }, error: null } : { data: { user: null }, error: new Error("bad") },
      admin: {
        getUserById: async (id: string) => ({ data: { user: authUsers[id] ?? null }, error: null }),
        updateUserById: async (id: string, attrs: any) => {
          bans.push({ id, attrs });
          return { error: null };
        },
      },
    },
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, val: string) => ({
          maybeSingle: async () => {
            if (table !== "user_blocks") return { data: null, error: null };
            if (blockLookupError) return { data: null, error: { message: blockLookupError } };
            return { data: blockedIds.has(val) ? { user_id: val } : null, error: null };
          },
        }),
      }),
      upsert: async (row: any) => {
        upserts.push({ table, row });
        return { error: null };
      },
      insert: async () => ({ error: null }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

const { default: adminRoutes } = await import("./admin");
const { resolveIdentity, resolveAuthUser, invalidateBlockCache } = await import("../lib/supabase");

const call = (path: string, token?: string, method = "POST", body: unknown = {}) =>
  adminRoutes.request(path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  upserts = [];
  bans = [];
  blockedIds = new Set();
  blockLookupError = null;
  for (const id of [USER_ID, ADMIN_ID, OTHER_ADMIN_ID]) invalidateBlockCache(id);
});

describe("identity resolution (shared by every authenticated route)", () => {
  test("accepts a normal user", async () => {
    const r = await resolveIdentity("tok-user");
    expect(r.ok && r.identity.isSuperAdmin).toBe(false);
  });

  test("recognises a super admin from app_metadata", async () => {
    const r = await resolveIdentity("tok-admin");
    expect(r.ok && r.identity.isSuperAdmin).toBe(true);
  });

  test("rejects an invalid token", async () => {
    expect(await resolveIdentity("nope")).toEqual({ ok: false, reason: "invalid" });
  });

  test("rejects a blocked user as soon as the cache is invalidated", async () => {
    expect((await resolveIdentity("tok-user")).ok).toBe(true);
    blockedIds.add(USER_ID);
    invalidateBlockCache(USER_ID); // what the block endpoint does
    expect(await resolveIdentity("tok-user")).toEqual({ ok: false, reason: "blocked" });
  });

  test("lets a user back in after unblock", async () => {
    blockedIds.add(USER_ID);
    expect((await resolveIdentity("tok-user")).ok).toBe(false);
    blockedIds.delete(USER_ID);
    invalidateBlockCache(USER_ID);
    expect((await resolveIdentity("tok-user")).ok).toBe(true);
  });

  test("a super admin is never blocked, even with a stray block row", async () => {
    blockedIds.add(ADMIN_ID);
    expect((await resolveIdentity("tok-admin")).ok).toBe(true);
  });

  test("fails closed when the block lookup errors (e.g. migration 008 missing)", async () => {
    blockLookupError = "relation user_blocks does not exist";
    expect(await resolveIdentity("tok-user")).toEqual({ ok: false, reason: "unavailable" });
  });

  test("resolveAuthUser (tickets/meetings/files/...) surfaces a block as an auth error", async () => {
    blockedIds.add(USER_ID);
    const r = await resolveAuthUser("tok-user");
    expect(r.userId).toBeNull();
    expect(r.error?.message).toBe("Account blocked");
  });
});

describe("admin routes authorisation", () => {
  test("401 without a token", async () => {
    expect((await call("/users", undefined, "GET")).status).toBe(401);
  });

  test("403 for a regular user on every mutating endpoint", async () => {
    const attempts: Array<[string, string]> = [
      [`/users/${OTHER_ADMIN_ID}/block`, "POST"],
      [`/users/${USER_ID}/unblock`, "POST"],
      ["/users", "POST"],
      ["/organisations", "POST"],
      [`/organisations/${ADMIN_ID}/members/${USER_ID}`, "PUT"],
      [`/organisations/${ADMIN_ID}/members/${USER_ID}`, "DELETE"],
    ];
    for (const [path, method] of attempts) {
      expect((await call(path, "tok-user", method)).status).toBe(403);
    }
    expect(upserts).toHaveLength(0);
    expect(bans).toHaveLength(0);
  });

  test("a blocked super-admin-looking token is still just a normal blocked user", async () => {
    blockedIds.add(USER_ID);
    expect((await call("/users", "tok-user", "GET")).status).toBe(401);
  });
});

describe("blocking", () => {
  test("a super admin can block a regular user (table row + auth ban)", async () => {
    const res = await call(`/users/${USER_ID}/block`, "tok-admin", "POST", { reason: "spam" });
    expect(res.status).toBe(200);
    expect(upserts[0]).toMatchObject({ table: "user_blocks", row: { user_id: USER_ID, reason: "spam", blocked_by: ADMIN_ID } });
    expect(bans[0]).toMatchObject({ id: USER_ID, attrs: { ban_duration: expect.stringMatching(/h$/) } });
  });

  test("cannot block yourself", async () => {
    expect((await call(`/users/${ADMIN_ID}/block`, "tok-admin")).status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  test("cannot block another super admin", async () => {
    expect((await call(`/users/${OTHER_ADMIN_ID}/block`, "tok-admin")).status).toBe(403);
    expect(upserts).toHaveLength(0);
  });

  test("rejects malformed ids", async () => {
    expect((await call("/users/not-a-uuid/block", "tok-admin")).status).toBe(400);
  });

  test("unblock clears the auth ban", async () => {
    const res = await call(`/users/${USER_ID}/unblock`, "tok-admin");
    expect(res.status).toBe(200);
    expect(bans[0]).toMatchObject({ id: USER_ID, attrs: { ban_duration: "none" } });
  });
});

describe("validation", () => {
  test("create user rejects short passwords and bad emails", async () => {
    expect((await call("/users", "tok-admin", "POST", { email: "a@b.co", password: "short", firstName: "A" })).status).toBe(400);
    expect((await call("/users", "tok-admin", "POST", { email: "nope", password: "longenough", firstName: "A" })).status).toBe(400);
  });
});
