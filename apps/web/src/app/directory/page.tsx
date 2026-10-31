"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Users,
  Search,
  UserPlus,
  Loader2,
  AlertCircle,
  X,
  ShieldCheck,
  Link2,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  MailPlus,
} from "lucide-react";
import { api, type CreatedInvitation, type Invitation } from "../../services/api";
import { EmployeeProfile, Department } from "../../types";
import { useRBAC } from "../../lib/useRBAC";

const ROLE_OPTIONS = ["member", "admin", "guest", "owner"] as const;

function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(!secret);
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-bold uppercase tracking-wider text-[#666666]">{label}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-xl border border-[#EDEDED] bg-[#F8F9FA] px-3 py-2 text-xs">
          {revealed ? value : "•".repeat(Math.min(value.length, 20))}
        </code>
        {secret && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="rounded-full bg-[#EDEDED] px-3 py-2 text-[11px] font-bold hover:bg-[#E2E2E2]"
          >
            {revealed ? "Hide" : "Show"}
          </button>
        )}
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              setRevealed(true); // clipboard unavailable: let them select it manually
            }
          }}
          className="flex items-center gap-1 rounded-full bg-[#74D96F] px-3 py-2 text-[11px] font-bold hover:bg-[#62CE5C]"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

const statusStyle: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  accepted: "bg-[#74D96F]/20 text-[#1F541D] border-[#74D96F]/40",
  revoked: "bg-[#EDEDED] text-[#666666] border-[#DEDEDE]",
  expired: "bg-rose-100 text-rose-700 border-rose-200",
};

const fieldClass =
  "w-full rounded-2xl border border-[#BEBEBE] bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#74D96F] focus:ring-2 focus:ring-[#74D96F]/20 transition";

function Avatar({ emp, size = "w-11 h-11" }: { emp: EmployeeProfile; size?: string }) {
  const initials = `${emp.firstName[0] ?? ""}${emp.lastName[0] ?? ""}`.toUpperCase() || "?";
  return (
    <div
      aria-hidden
      className={`${size} rounded-2xl bg-[#74D96F]/20 text-[#1F541D] font-bold text-sm flex items-center justify-center border border-[#74D96F]/30 shrink-0`}
    >
      {initials}
    </div>
  );
}

export default function DirectoryPage() {
  const { canManageEmployees } = useRBAC();
  // Role comes from localStorage, so render admin-only UI only after mount (avoids hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isAdmin = mounted && canManageEmployees;

  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [showInvites, setShowInvites] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    role: "member",
    designation: "",
    departmentId: "",
    password: "",
  });
  const [issued, setIssued] = useState<Pick<CreatedInvitation, "link" | "initialPassword"> & { email: string; note?: string } | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDept, setSelectedDept] = useState("all");
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeProfile | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    workEmail: "",
    designation: "",
    departmentId: "",
  });

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [emps, depts] = await Promise.all([api.getEmployees(), api.getDepartments()]);
      setEmployees(emps);
      setDepartments(depts);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load people");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const loadInvitations = async () => {
    setInvitesError(null);
    try {
      setInvitations(await api.listInvitations());
    } catch (err) {
      setInvitesError(err instanceof Error ? err.message : "Failed to load invitations");
    }
  };

  useEffect(() => {
    if (isAdmin) void loadInvitations();
  }, [isAdmin]);

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteBusy(true);
    setInviteError(null);
    try {
      const res = await api.createInvitation({
        email: inviteForm.email.trim(),
        firstName: inviteForm.firstName.trim(),
        lastName: inviteForm.lastName.trim(),
        role: inviteForm.role,
        designation: inviteForm.designation.trim() || undefined,
        departmentId: inviteForm.departmentId || undefined,
        password: inviteForm.password || undefined,
      });
      setIssued({ link: res.link, initialPassword: res.initialPassword, email: res.invitation.email, note: res.note });
      setInviteOpen(false);
      setInviteForm({ email: "", firstName: "", lastName: "", role: "member", designation: "", departmentId: "", password: "" });
      await loadInvitations();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not create the invitation");
    } finally {
      setInviteBusy(false);
    }
  };

  const regenerate = async (inv: Invitation, resetPassword: boolean) => {
    setRowBusy(inv.id);
    setInvitesError(null);
    try {
      const res = await api.regenerateInvitation(inv.id, { resetPassword });
      setIssued({ link: res.link, initialPassword: res.initialPassword, email: inv.email });
      await loadInvitations();
    } catch (err) {
      setInvitesError(err instanceof Error ? err.message : "Could not regenerate the link");
    } finally {
      setRowBusy(null);
    }
  };

  const revoke = async (inv: Invitation) => {
    if (!window.confirm(`Revoke the invitation for ${inv.email}? Their link will stop working.`)) return;
    setRowBusy(inv.id);
    setInvitesError(null);
    try {
      await api.revokeInvitation(inv.id);
      await loadInvitations();
    } catch (err) {
      setInvitesError(err instanceof Error ? err.message : "Could not revoke the invitation");
    } finally {
      setRowBusy(null);
    }
  };

  const openForm = () => {
    const user = api.getSession()?.user;
    setForm({
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      workEmail: user?.email ?? "",
      designation: "",
      departmentId: "",
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setFormError(null);
    try {
      const created = await api.addEmployee({
        ...form,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        workEmail: form.workEmail.trim(),
      });
      setEmployees((prev) => [created, ...prev]);
      setIsFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setIsSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((emp) => {
      const matchesSearch =
        !q ||
        `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(q) ||
        emp.designation?.toLowerCase().includes(q) ||
        emp.workEmail.toLowerCase().includes(q) ||
        emp.skills.some((s) => s.name.toLowerCase().includes(q));
      const matchesDept = selectedDept === "all" || emp.departmentId === selectedDept;
      return matchesSearch && matchesDept;
    });
  }, [employees, searchQuery, selectedDept]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#262626] flex items-center space-x-2">
            <Users className="w-6 h-6 text-[#56BE51]" />
            <span>People</span>
          </h1>
          <p className="text-sm text-[#666666] mt-0.5">Everyone in your organisation, with their role and skills.</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button
              onClick={openForm}
              className="px-4 py-2 rounded-full border border-[#BEBEBE] bg-white hover:border-[#74D96F] text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add my profile</span>
            </button>
            <button
              onClick={() => {
                setInviteError(null);
                setInviteOpen(true);
              }}
              className="px-4 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <MailPlus className="w-4 h-4" />
              <span>Invite employee</span>
            </button>
          </div>
        )}
      </div>

      {isAdmin && (
        <section className="rounded-3xl border border-[#EDEDED] bg-white">
          <button
            type="button"
            onClick={() => setShowInvites((v) => !v)}
            aria-expanded={showInvites}
            className="flex w-full items-center justify-between px-5 py-3.5 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-bold">
              <Link2 className="h-4 w-4 text-[#56BE51]" /> Invitations
              <span className="rounded-full bg-[#EDEDED] px-2 py-0.5 text-[10px] font-bold">
                {invitations.filter((i) => i.status === "pending").length} pending
              </span>
            </span>
            <span className="text-[11px] text-[#666666]">{showInvites ? "Hide" : "Show"}</span>
          </button>
          {showInvites && (
            <div className="space-y-2 border-t border-[#EDEDED] px-5 py-4">
              {invitesError && (
                <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {invitesError}
                </div>
              )}
              {invitations.length === 0 && !invitesError && (
                <p className="text-xs text-[#666666]">
                  No invitations yet. Use “Invite employee” to create a one-time link for a specific person.
                </p>
              )}
              {invitations.map((inv) => (
                <div key={inv.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-[#F8F9FA] px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold">
                      {inv.firstName} {inv.lastName}
                    </div>
                    <div className="truncate text-[11px] text-[#666666]">
                      {inv.email} · {inv.role} ·{" "}
                      {inv.status === "pending"
                        ? `expires ${new Date(inv.expiresAt).toLocaleDateString()}`
                        : inv.status === "accepted" && inv.acceptedAt
                          ? `joined ${new Date(inv.acceptedAt).toLocaleDateString()}`
                          : inv.status}
                    </div>
                  </div>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase ${statusStyle[inv.status]}`}>
                    {inv.status}
                  </span>
                  {(inv.status === "pending" || inv.status === "expired") && (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={rowBusy === inv.id}
                        onClick={() => regenerate(inv, false)}
                        title="Issue a fresh link (the old one stops working)"
                        className="flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold border border-[#EDEDED] hover:border-[#74D96F] disabled:opacity-50"
                      >
                        <RefreshCw className="h-3 w-3" /> New link
                      </button>
                      {inv.accountIsNew && (
                        <button
                          type="button"
                          disabled={rowBusy === inv.id}
                          onClick={() => regenerate(inv, true)}
                          title="Issue a fresh link and set a new password"
                          className="rounded-full bg-white px-3 py-1.5 text-[11px] font-bold border border-[#EDEDED] hover:border-[#74D96F] disabled:opacity-50"
                        >
                          New link + password
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={rowBusy === inv.id}
                        onClick={() => revoke(inv)}
                        aria-label={`Revoke invitation for ${inv.email}`}
                        className="rounded-full p-1.5 text-[#9E9E9E] hover:bg-white hover:text-rose-600 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#666666] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Search people"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, role, email or skill"
            className="w-full rounded-full border border-[#BEBEBE]/60 bg-white pl-10 pr-4 py-2.5 text-sm placeholder-[#999999] focus:outline-none focus:border-[#74D96F]"
          />
        </div>
        <select
          aria-label="Filter by department"
          value={selectedDept}
          onChange={(e) => setSelectedDept(e.target.value)}
          className="rounded-full border border-[#BEBEBE]/60 bg-white px-4 py-2.5 text-sm focus:outline-none focus:border-[#74D96F]"
        >
          <option value="all">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
          <span className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{loadError}</span>
          </span>
          <button onClick={load} className="font-bold underline cursor-pointer">
            Retry
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-3xl bg-white border border-[#EDEDED] animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 && !loadError ? (
        <div className="rounded-3xl border border-dashed border-[#BEBEBE] bg-white p-10 text-center space-y-2">
          <p className="text-sm font-bold text-[#262626]">
            {employees.length === 0 ? "No profiles yet" : "No one matches your search"}
          </p>
          <p className="text-xs text-[#666666]">
            {employees.length === 0
              ? "Invite your team, or add your own profile, to get the directory started."
              : "Try a different name, skill, or department."}
          </p>
          {employees.length === 0 && isAdmin && (
            <button onClick={openForm} className="mt-2 px-4 py-2 rounded-full bg-[#74D96F] text-xs font-bold cursor-pointer">
              Add my profile
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((emp) => (
            <button
              key={emp.id}
              onClick={() => setSelectedEmployee(emp)}
              className="text-left rounded-3xl border border-[#BEBEBE]/40 bg-white p-5 hover:border-[#74D96F] hover:shadow-md transition space-y-3 cursor-pointer"
            >
              <div className="flex items-start space-x-3.5">
                <Avatar emp={emp} />
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-sm text-[#262626] truncate">
                    {emp.firstName} {emp.lastName}
                  </h3>
                  <p className="text-xs text-[#666666] truncate">{emp.designation || "No title set"}</p>
                  <p className="text-[11px] text-[#9E9E9E] truncate">{emp.departmentName || "No department"}</p>
                </div>
              </div>
              {emp.skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-3 border-t border-[#EDEDED]">
                  {emp.skills.slice(0, 3).map((s) => (
                    <span key={s.name} className="text-[10px] px-2.5 py-0.5 rounded-full bg-[#EDEDED] text-[#262626] font-medium">
                      {s.name}
                    </span>
                  ))}
                  {emp.skills.length > 3 && (
                    <span className="text-[10px] px-2 py-0.5 text-[#666666]">+{emp.skills.length - 3}</span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {selectedEmployee && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
          onMouseDown={(e) => e.target === e.currentTarget && setSelectedEmployee(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl text-[#262626] space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-4">
                <Avatar emp={selectedEmployee} size="w-14 h-14" />
                <div>
                  <h3 className="text-lg font-bold">
                    {selectedEmployee.firstName} {selectedEmployee.lastName}
                  </h3>
                  <p className="text-xs text-[#666666]">{selectedEmployee.designation || "No title set"}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedEmployee(null)}
                aria-label="Close"
                className="p-1.5 rounded-full text-[#666666] hover:bg-[#EDEDED] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-[#9E9E9E]">Email</dt>
                <dd className="font-medium break-all">{selectedEmployee.workEmail}</dd>
              </div>
              <div>
                <dt className="text-[#9E9E9E]">Department</dt>
                <dd className="font-medium">{selectedEmployee.departmentName || "–"}</dd>
              </div>
              <div>
                <dt className="text-[#9E9E9E]">Status</dt>
                <dd className="font-medium capitalize">{selectedEmployee.employmentStatus}</dd>
              </div>
            </dl>

            <div>
              <div className="text-[11px] font-bold text-[#666666] uppercase tracking-wider mb-2">Skills</div>
              {selectedEmployee.skills.length === 0 ? (
                <p className="text-xs text-[#666666]">No skills recorded yet.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-2">
                  {selectedEmployee.skills.map((sk) => (
                    <li key={sk.name} className="flex items-center justify-between p-2.5 rounded-2xl bg-[#F8F9FA] border border-[#EDEDED] text-xs">
                      <span className="flex items-center space-x-1.5 font-semibold">
                        {sk.verified && <ShieldCheck className="w-3.5 h-3.5 text-[#56BE51]" />}
                        <span>{sk.name}</span>
                      </span>
                      <span className="text-[10px] text-[#666666] capitalize">{sk.proficiency}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {inviteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
          onMouseDown={(e) => e.target === e.currentTarget && !inviteBusy && setInviteOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Invite employee"
        >
          <form onSubmit={submitInvite} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl text-[#262626] space-y-4 max-h-[90vh] overflow-y-auto animate-scale-in">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">Invite an employee</h3>
              <button type="button" onClick={() => setInviteOpen(false)} aria-label="Close" className="p-1.5 rounded-full text-[#666666] hover:bg-[#EDEDED] cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#666666]">
              This creates a one-time link for this person only. Your organisation sets their starting password.
            </p>
            {inviteError && (
              <div role="alert" className="flex items-start space-x-2 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{inviteError}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold space-y-1">
                <span>First name</span>
                <input required className={fieldClass} value={inviteForm.firstName} onChange={(e) => setInviteForm({ ...inviteForm, firstName: e.target.value })} />
              </label>
              <label className="text-xs font-semibold space-y-1">
                <span>Last name</span>
                <input className={fieldClass} value={inviteForm.lastName} onChange={(e) => setInviteForm({ ...inviteForm, lastName: e.target.value })} />
              </label>
            </div>
            <label className="block text-xs font-semibold space-y-1">
              <span>Email</span>
              <input required type="email" className={fieldClass} value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold space-y-1">
                <span>Role</span>
                <select className={fieldClass} value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold space-y-1">
                <span>Department</span>
                <select className={fieldClass} value={inviteForm.departmentId} onChange={(e) => setInviteForm({ ...inviteForm, departmentId: e.target.value })}>
                  <option value="">None</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-xs font-semibold space-y-1">
              <span>Job title</span>
              <input className={fieldClass} value={inviteForm.designation} onChange={(e) => setInviteForm({ ...inviteForm, designation: e.target.value })} />
            </label>
            <label className="block text-xs font-semibold space-y-1">
              <span>Starting password</span>
              <input
                type="text"
                autoComplete="off"
                minLength={8}
                placeholder="Leave blank to generate a strong one"
                className={fieldClass}
                value={inviteForm.password}
                onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })}
              />
              <span className="block text-[11px] font-normal text-[#9E9E9E]">Shown once after you create the invitation; it isn't stored.</span>
            </label>
            <div className="flex justify-end space-x-2 pt-2">
              <button type="button" onClick={() => setInviteOpen(false)} className="px-4 py-2 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-xs font-semibold cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={inviteBusy} className="px-5 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs font-bold disabled:opacity-60 flex items-center space-x-1.5 cursor-pointer">
                {inviteBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{inviteBusy ? "Creating…" : "Create invitation"}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {issued && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4" role="dialog" aria-modal="true" aria-label="Invitation ready">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl text-[#262626] space-y-4 animate-scale-in">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-base">Invitation ready for {issued.email}</h3>
                <p className="mt-1 text-xs text-[#666666]">
                  {issued.note ?? "Share the link with this person. It works once and expires automatically."}
                </p>
              </div>
              <button type="button" onClick={() => setIssued(null)} aria-label="Close" className="p-1.5 rounded-full text-[#666666] hover:bg-[#EDEDED] cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <CopyField label="One-time invitation link" value={issued.link} />
            {issued.initialPassword && <CopyField label="Starting password" value={issued.initialPassword} secret />}
            <div role="note" className="rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11px] text-amber-900">
              {issued.initialPassword
                ? "Copy both now. For security the password can't be shown again; use “New link + password” later if you need to reissue it. Send them over different channels if you can."
                : "Copy the link now; it can't be shown again. Use “New link” to reissue it."}
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => setIssued(null)} className="px-5 py-2 rounded-full bg-[#262626] text-white text-xs font-bold cursor-pointer">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {isFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
          onMouseDown={(e) => e.target === e.currentTarget && !isSaving && setIsFormOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Add profile"
        >
          <form onSubmit={handleSave} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl text-[#262626] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">Add your profile</h3>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                aria-label="Close"
                className="p-1.5 rounded-full text-[#666666] hover:bg-[#EDEDED] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div role="alert" className="flex items-start space-x-2 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold space-y-1">
                <span>First name</span>
                <input required className={fieldClass} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              </label>
              <label className="text-xs font-semibold space-y-1">
                <span>Last name</span>
                <input className={fieldClass} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              </label>
            </div>
            <label className="block text-xs font-semibold space-y-1">
              <span>Work email</span>
              <input required type="email" className={fieldClass} value={form.workEmail} onChange={(e) => setForm({ ...form, workEmail: e.target.value })} />
            </label>
            <label className="block text-xs font-semibold space-y-1">
              <span>Job title</span>
              <input className={fieldClass} value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
            </label>
            <label className="block text-xs font-semibold space-y-1">
              <span>Department</span>
              <select className={fieldClass} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">None</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="px-4 py-2 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs font-bold disabled:opacity-60 flex items-center space-x-1.5 cursor-pointer"
              >
                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isSaving ? "Saving..." : "Save profile"}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
