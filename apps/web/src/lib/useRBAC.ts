import { useState, useEffect } from "react";
import { sessionStore } from "../services/http";

/**
 * Lightweight RBAC hook that reads the role stored in the session.
 *
 * Roles (stored in StoredSession.role):
 *   "super_admin" → super-admin (all permissions)
 *   "admin"       → org admin (all org permissions)
 *   "member"      → regular org member
 *   anything else / null → guest / unauthenticated
 *
 * All reads happen client-side only (localStorage), so the hook
 * starts with safe defaults (false) until after hydration.
 * Every permission is also enforced server-side; these are UI hints only.
 */
export function useRBAC() {
  const [role, setRole] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const session = sessionStore.get();
    setRole(session?.role ?? null);
    setReady(true);
  }, []);

  const isSuperAdmin = ready && role === "super_admin";
  const isAdmin = ready && (isSuperAdmin || role === "admin");
  const isMember = ready && (isAdmin || role === "member");
  const isGuest = ready && !isMember;

  // Derived capability flags used across the app
  const canViewAnalytics = isMember;
  const canManageAgents = isAdmin;
  const canApproveBrowserJobs = isAdmin;

  return {
    role,
    ready,
    // Role booleans
    isSuperAdmin,
    isAdmin,
    isMember,
    isGuest,
    // Capability flags
    canViewAnalytics,
    canManageAgents,
    canApproveBrowserJobs,
  };
}
