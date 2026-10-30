"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Ban,
  Building2,
  ChevronDown,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { api, type AdminOrganisation, type AdminUser } from "../../services/api";
import { sessionStore } from "../../services/http";

const ROLES = ["owner", "admin", "member", "guest"] as const;
const field =
  "w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs focus:outline-none focus:border-[#74D96F] focus:bg-white";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl animate-scale-in"
      >
        <div className="flex items-center justify-between border-b border-[#EDEDED] pb-3">
          <h3 className="text-sm font-bold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[#666666] hover:text-[#262626]">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"users" | "orgs">("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [orgs, setOrgs] = useState<AdminOrganisation[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "user" | "org" | { blockUser: AdminUser }>(null);

  // Form state
  const [uf, setUf] = useState({ email: "", password: "", firstName: "", lastName: "", organisationId: "", role: "member", designation: "" });
  const [of, setOf] = useState({ name: "", slug: "", ownerUserId: "" });
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [addOrg, setAddOrg] = useState<Record<string, { orgId: string; role: string }>>({});

  useEffect(() => {
    setAllowed(sessionStore.get()?.isSuperAdmin === true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, o] = await Promise.all([api.adminListUsers(search), api.adminListOrganisations()]);
      setUsers(u);
      setOrgs(o);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    if (!allowed) return;
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [allowed, load, search]);

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(success);
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const submitUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusy("create-user");
    try {
      const res = await api.adminCreateUser({
        email: uf.email.trim(),
        password: uf.password,
        firstName: uf.firstName.trim(),
        lastName: uf.lastName.trim(),
        organisationId: uf.organisationId || undefined,
        role: uf.organisationId ? uf.role : undefined,
        designation: uf.designation.trim() || undefined,
      });
      setModal(null);
      setUf({ email: "", password: "", firstName: "", lastName: "", organisationId: "", role: "member", designation: "" });
      setNotice(res.warnings.length ? `User created, with warnings: ${res.warnings.join(" ")}` : `Created ${res.email}.`);
      await load();
    } catch (e2) {
      setFormError(errMsg(e2));
    } finally {
      setBusy(null);
    }
  };

  const submitOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusy("create-org");
    try {
      const o = await api.adminCreateOrganisation({
        name: of.name.trim(),
        slug: of.slug.trim() || undefined,
        ownerUserId: of.ownerUserId || undefined,
      });
      setModal(null);
      setOf({ name: "", slug: "", ownerUserId: "" });
      setNotice(`Created organisation "${o.name}".`);
      await load();
    } catch (e2) {
      setFormError(errMsg(e2));
    } finally {
      setBusy(null);
    }
  };

  const confirmBlock = async () => {
    if (typeof modal !== "object" || !modal || !("blockUser" in modal)) return;
    const target = modal.blockUser;
    setModal(null);
    await run(`block-${target.id}`, () => api.adminSetBlocked(target.id, true, reason.trim() || undefined), `Blocked ${target.email}.`);
    setReason("");
  };

  if (allowed === null) return null;
  if (!allowed) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-[#EDEDED] bg-white p-8 text-center">
        <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-[#BEBEBE]" />
        <h1 className="text-sm font-bold">Super admin access required</h1>
        <p className="mt-1 text-xs text-[#666666]">Your account doesn't have access to the admin console.</p>
      </div>
    );
  }

  const me = sessionStore.get()?.user.id;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <ShieldCheck className="h-6 w-6 text-[#56BE51]" /> Admin console
          </h1>
          <p className="mt-1 text-sm text-[#666666]">Create people and organisations, assign roles, and block accounts.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setFormError(null); setModal("org"); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#BEBEBE] bg-white px-4 py-2 text-xs font-bold hover:border-[#74D96F]"
          >
            <Building2 className="h-3.5 w-3.5" /> New organisation
          </button>
          <button
            type="button"
            onClick={() => { setFormError(null); setModal("user"); }}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#74D96F] px-4 py-2 text-xs font-bold text-[#262626] hover:bg-[#62CE5C]"
          >
            <UserPlus className="h-3.5 w-3.5" /> New user
          </button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-700">{error}</div>}
      {notice && <div role="status" className="rounded-2xl border border-[#74D96F]/40 bg-[#74D96F]/10 px-4 py-2.5 text-xs text-[#1F541D]">{notice}</div>}

      <div role="tablist" className="flex w-fit gap-1 rounded-full bg-[#EDEDED] p-1">
        {([["users", "Users", Users], ["orgs", "Organisations", Building2]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition ${tab === id ? "bg-white shadow-xs" : "text-[#666666] hover:text-[#262626]"}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === "users" && (
        <section className="space-y-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            aria-label="Search users"
            className={`${field} max-w-sm`}
          />
          <div className="divide-y divide-[#EDEDED] overflow-hidden rounded-3xl border border-[#EDEDED] bg-white">
            {loading && <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-[#56BE51]" /></div>}
            {!loading && users.length === 0 && <p className="p-8 text-center text-xs text-[#666666]">No users found.</p>}
            {!loading && users.map((u) => {
              const isMe = u.id === me;
              const open = expanded === u.id;
              const add = addOrg[u.id] ?? { orgId: "", role: "member" };
              const name = `${u.firstName} ${u.lastName}`.trim() || u.email.split("@")[0];
              return (
                <div key={u.id} className={u.blocked ? "bg-rose-50/40" : ""}>
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : u.id)}
                      aria-expanded={open}
                      aria-label={`Toggle details for ${u.email}`}
                      className="rounded-lg p-1 text-[#9E9E9E] hover:bg-[#EDEDED]"
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-xs font-bold">{name}</span>
                        {u.isSuperAdmin && <span className="rounded-full border border-purple-200 bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-700">SUPER ADMIN</span>}
                        {u.blocked && <span className="rounded-full border border-rose-200 bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">BLOCKED</span>}
                        {isMe && <span className="text-[10px] text-[#9E9E9E]">(you)</span>}
                      </div>
                      <div className="truncate text-[11px] text-[#666666]">{u.email}</div>
                    </div>
                    <div className="hidden flex-wrap gap-1 md:flex">
                      {u.memberships.slice(0, 3).map((m) => (
                        <span key={m.organisationId} className="rounded-full bg-[#EDEDED] px-2 py-0.5 text-[10px] font-medium">
                          {m.organisationName} · {m.role}
                        </span>
                      ))}
                      {u.memberships.length > 3 && <span className="text-[10px] text-[#9E9E9E]">+{u.memberships.length - 3}</span>}
                    </div>
                    {!u.isSuperAdmin && !isMe && (
                      u.blocked ? (
                        <button
                          type="button"
                          disabled={busy === `block-${u.id}`}
                          onClick={() => run(`block-${u.id}`, () => api.adminSetBlocked(u.id, false), `Unblocked ${u.email}.`)}
                          className="inline-flex items-center gap-1 rounded-full bg-[#74D96F]/20 px-3 py-1.5 text-[11px] font-bold text-[#1F541D] hover:bg-[#74D96F]/35 disabled:opacity-50"
                        >
                          <UserCheck className="h-3.5 w-3.5" /> Unblock
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy === `block-${u.id}`}
                          onClick={() => { setReason(""); setModal({ blockUser: u }); }}
                          className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1.5 text-[11px] font-bold text-rose-700 hover:bg-rose-200 disabled:opacity-50"
                        >
                          <Ban className="h-3.5 w-3.5" /> Block
                        </button>
                      )
                    )}
                  </div>

                  {open && (
                    <div className="space-y-3 border-t border-[#EDEDED] bg-[#F8F9FA] px-4 py-3 text-xs animate-slide-down">
                      {u.blocked && u.blockReason && <p className="text-rose-700">Blocked: {u.blockReason}</p>}
                      <div className="text-[11px] text-[#666666]">
                        Joined {new Date(u.createdAt).toLocaleDateString()} · Last sign-in {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString() : "never"}
                      </div>
                      {u.memberships.length === 0 && <p className="text-[#666666]">Not a member of any organisation.</p>}
                      {u.memberships.map((m) => (
                        <div key={m.organisationId} className="flex items-center gap-2">
                          <span className="flex-1 truncate font-medium">{m.organisationName}</span>
                          <select
                            aria-label={`Role in ${m.organisationName}`}
                            value={m.role}
                            disabled={busy === `role-${u.id}-${m.organisationId}`}
                            onChange={(e) => run(`role-${u.id}-${m.organisationId}`, () => api.adminSetMemberRole(m.organisationId, u.id, e.target.value), "Role updated.")}
                            className="rounded-lg border border-[#BEBEBE]/60 bg-white px-2 py-1"
                          >
                            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <button
                            type="button"
                            aria-label={`Remove from ${m.organisationName}`}
                            onClick={() => window.confirm(`Remove ${u.email} from ${m.organisationName}?`) && run(`rm-${u.id}-${m.organisationId}`, () => api.adminRemoveMember(m.organisationId, u.id), "Member removed.")}
                            className="rounded-lg p-1.5 text-[#9E9E9E] hover:bg-white hover:text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <div className="flex flex-wrap items-center gap-2 border-t border-[#EDEDED] pt-3">
                        <select aria-label="Organisation to add" value={add.orgId} onChange={(e) => setAddOrg({ ...addOrg, [u.id]: { ...add, orgId: e.target.value } })} className="rounded-lg border border-[#BEBEBE]/60 bg-white px-2 py-1.5">
                          <option value="">Add to organisation…</option>
                          {orgs.filter((o) => !u.memberships.some((m) => m.organisationId === o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                        <select aria-label="Role" value={add.role} onChange={(e) => setAddOrg({ ...addOrg, [u.id]: { ...add, role: e.target.value } })} className="rounded-lg border border-[#BEBEBE]/60 bg-white px-2 py-1.5">
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <button
                          type="button"
                          disabled={!add.orgId || busy === `add-${u.id}`}
                          onClick={() => run(`add-${u.id}`, () => api.adminSetMemberRole(add.orgId, u.id, add.role), "Member added.")}
                          className="inline-flex items-center gap-1 rounded-full bg-[#74D96F] px-3 py-1.5 font-bold text-[#262626] hover:bg-[#62CE5C] disabled:opacity-40"
                        >
                          <Plus className="h-3 w-3" /> Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tab === "orgs" && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {loading && <div className="col-span-full flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-[#56BE51]" /></div>}
          {!loading && orgs.length === 0 && <p className="col-span-full rounded-3xl border border-[#EDEDED] bg-white p-8 text-center text-xs text-[#666666]">No organisations yet. Create the first one.</p>}
          {!loading && orgs.map((o) => (
            <div key={o.id} className="card-hover rounded-3xl border border-[#EDEDED] bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#74D96F]/20"><Building2 className="h-4 w-4 text-[#56BE51]" /></div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{o.name}</div>
                  <div className="text-[11px] text-[#9E9E9E]">/{o.slug}</div>
                </div>
              </div>
              <div className="mt-3 text-[11px] text-[#666666]">{o.memberCount} member{o.memberCount === 1 ? "" : "s"} · created {new Date(o.createdAt).toLocaleDateString()}</div>
            </div>
          ))}
        </section>
      )}

      {modal === "user" && (
        <Modal title="Create user" onClose={() => setModal(null)}>
          <form onSubmit={submitUser} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input required placeholder="First name" aria-label="First name" value={uf.firstName} onChange={(e) => setUf({ ...uf, firstName: e.target.value })} className={field} />
              <input placeholder="Last name" aria-label="Last name" value={uf.lastName} onChange={(e) => setUf({ ...uf, lastName: e.target.value })} className={field} />
            </div>
            <input required type="email" placeholder="Email" aria-label="Email" value={uf.email} onChange={(e) => setUf({ ...uf, email: e.target.value })} className={field} />
            <input required type="password" minLength={8} autoComplete="new-password" placeholder="Temporary password (min 8 characters)" aria-label="Password" value={uf.password} onChange={(e) => setUf({ ...uf, password: e.target.value })} className={field} />
            <div className="grid grid-cols-2 gap-3">
              <select aria-label="Organisation" value={uf.organisationId} onChange={(e) => setUf({ ...uf, organisationId: e.target.value })} className={field}>
                <option value="">No organisation</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <select aria-label="Role" disabled={!uf.organisationId} value={uf.role} onChange={(e) => setUf({ ...uf, role: e.target.value })} className={`${field} disabled:opacity-50`}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            {uf.organisationId && <input placeholder="Job title (optional)" aria-label="Job title" value={uf.designation} onChange={(e) => setUf({ ...uf, designation: e.target.value })} className={field} />}
            {formError && <p role="alert" className="text-xs text-rose-600">{formError}</p>}
            <button type="submit" disabled={busy === "create-user"} className="flex w-full items-center justify-center gap-2 rounded-full bg-[#74D96F] py-2.5 text-xs font-bold hover:bg-[#62CE5C] disabled:opacity-50">
              {busy === "create-user" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create user
            </button>
          </form>
        </Modal>
      )}

      {modal === "org" && (
        <Modal title="Create organisation" onClose={() => setModal(null)}>
          <form onSubmit={submitOrg} className="space-y-3">
            <input required minLength={2} placeholder="Organisation name" aria-label="Organisation name" value={of.name} onChange={(e) => setOf({ ...of, name: e.target.value })} className={field} />
            <input placeholder="Slug (optional, derived from name)" aria-label="Slug" value={of.slug} onChange={(e) => setOf({ ...of, slug: e.target.value })} className={field} />
            <select aria-label="Owner" value={of.ownerUserId} onChange={(e) => setOf({ ...of, ownerUserId: e.target.value })} className={field}>
              <option value="">No owner yet (only super admins can access it)</option>
              {users.filter((u) => !u.blocked).map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
            </select>
            {formError && <p role="alert" className="text-xs text-rose-600">{formError}</p>}
            <button type="submit" disabled={busy === "create-org"} className="flex w-full items-center justify-center gap-2 rounded-full bg-[#74D96F] py-2.5 text-xs font-bold hover:bg-[#62CE5C] disabled:opacity-50">
              {busy === "create-org" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create organisation
            </button>
          </form>
        </Modal>
      )}

      {typeof modal === "object" && modal && "blockUser" in modal && (
        <Modal title={`Block ${modal.blockUser.email}?`} onClose={() => setModal(null)}>
          <p className="text-xs text-[#666666]">
            They'll be signed out immediately and won't be able to sign in or use the API until unblocked.
          </p>
          <textarea
            placeholder="Reason (optional, visible to admins)"
            aria-label="Reason"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={field}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModal(null)} className="rounded-full bg-[#EDEDED] px-4 py-2 text-xs font-semibold hover:bg-[#E2E2E2]">Cancel</button>
            <button type="button" onClick={confirmBlock} className="rounded-full bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700">Block user</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
