/**
 * Creates (or promotes) the platform super admin.
 *
 *   bun run seed:admin
 *
 * Defaults to admin@gmail.com / 12345678 for local development. Override with
 *   SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD
 * Idempotent: if the user already exists it is promoted, and its password is only
 * changed when SUPER_ADMIN_RESET_PASSWORD=1.
 *
 * The flag is stored in `app_metadata.is_super_admin`, which only the service-role key can write.
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Bun loads .env automatically).
 */

import { createClient } from "@supabase/supabase-js";

const DEFAULT_EMAIL = "admin@gmail.com";
const DEFAULT_PASSWORD = "12345678";

const email = (process.env.SUPER_ADMIN_EMAIL || DEFAULT_EMAIL).trim().toLowerCase();
const password = process.env.SUPER_ADMIN_PASSWORD || DEFAULT_PASSWORD;
const resetPassword = process.env.SUPER_ADMIN_RESET_PASSWORD === "1";
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (!url || !serviceKey) fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env).");

// A publicly known password on a privileged account is only acceptable on a dev machine.
if (process.env.NODE_ENV === "production" && password === DEFAULT_PASSWORD) {
  fail("Refusing to use the default password in production. Set SUPER_ADMIN_PASSWORD to a strong secret.");
}
if (password.length < 8) fail("SUPER_ADMIN_PASSWORD must be at least 8 characters.");

const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function findUserByEmail(target: string) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`Could not list users: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

const existing = await findUserByEmail(email);

if (existing) {
  const { error } = await supabase.auth.admin.updateUserById(existing.id, {
    app_metadata: { ...existing.app_metadata, is_super_admin: true },
    email_confirm: true,
    ban_duration: "none",
    ...(resetPassword ? { password } : {}),
  });
  if (error) fail(`Could not promote ${email}: ${error.message}`);
  // A super admin must never be left blocked.
  await supabase.from("user_blocks").delete().eq("user_id", existing.id);
  console.log(`✔ ${email} already existed and is now a super admin.`);
  console.log(resetPassword ? "  Password was reset." : "  Password unchanged (set SUPER_ADMIN_RESET_PASSWORD=1 to reset it).");
} else {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { firstName: "Super", lastName: "Admin" },
    app_metadata: { is_super_admin: true },
  });
  if (error || !data.user) fail(`Could not create ${email}: ${error?.message}`);
  console.log(`✔ Created super admin ${email}`);
}

if (password === DEFAULT_PASSWORD) {
  console.warn("⚠ This account uses the default development password. Change it before any shared deployment.");
}
