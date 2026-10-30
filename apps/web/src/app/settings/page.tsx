"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Settings,
  Building2,
  Server,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Plus,
  Loader2,
  Bell,
  Lock,
} from "lucide-react";
import { api, ApiStatus } from "../../services/api";
import { useRBAC } from "../../lib/useRBAC";
import { Organisation, Department, NotificationPreferences } from "../../types";

const fieldClass =
  "flex-1 min-w-0 rounded-full border border-[#BEBEBE]/60 bg-[#F8F9FA] px-4 py-2 text-xs focus:outline-none focus:border-[#74D96F] focus:bg-white";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/** The editable preference fields, exactly as the notifications route accepts them. */
type PrefKey = Exclude<keyof NotificationPreferences, "id" | "organisationId" | "userId" | "updatedAt">;
type PrefDraft = Record<PrefKey, boolean>;

const PREF_GROUPS: Array<{
  title: string;
  items: Array<{ key: PrefKey; label: string; hint: string }>;
}> = [
  {
    title: "Delivery channels",
    items: [
      { key: "inAppNotifications", label: "In-app notifications", hint: "Show alerts in the notification centre." },
      { key: "emailNotifications", label: "Email notifications", hint: "Also send alerts to your work email." },
      { key: "dailyDigest", label: "Daily digest", hint: "A once-a-day summary instead of one alert per event." },
    ],
  },
  {
    title: "What to notify me about",
    items: [
      { key: "taskAssigned", label: "Task assignments", hint: "When a task is assigned to you." },
      { key: "ticketUpdates", label: "Ticket updates", hint: "Status changes and comments on your tickets." },
      { key: "mentions", label: "Mentions", hint: "When someone mentions you." },
      { key: "approvalRequests", label: "Approval requests", hint: "Agent browser jobs and other items awaiting you." },
      { key: "systemAnnouncements", label: "System announcements", hint: "Organisation-wide notices." },
    ],
  },
];

const PREF_KEYS: PrefKey[] = PREF_GROUPS.flatMap((g) => g.items.map((i) => i.key));

const toDraft = (p: NotificationPreferences): PrefDraft =>
  Object.fromEntries(PREF_KEYS.map((k) => [k, Boolean(p[k])])) as PrefDraft;

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700"
    >
      <span className="flex items-center space-x-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span className="break-words">{message}</span>
      </span>
      {onRetry && (
        <button onClick={onRetry} className="font-bold underline cursor-pointer shrink-0">
          Retry
        </button>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { isAdmin } = useRBAC();

  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  /** True once the organisation list loaded successfully (so "empty" is real, not a failure). */
  const [orgsLoaded, setOrgsLoaded] = useState(false);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptsLoading, setDeptsLoading] = useState(false);
  const [deptsError, setDeptsError] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [draft, setDraft] = useState<PrefDraft | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsSaveError, setPrefsSaveError] = useState<string | null>(null);
  const [prefsSaved, setPrefsSaved] = useState(false);

  const [apiStatus, setApiStatus] = useState<ApiStatus>({ isLive: false, endpoint: api.getBaseUrl(), lastChecked: "" });
  const [urlInput, setUrlInput] = useState(api.getBaseUrl());
  const [isChecking, setIsChecking] = useState(false);
  const [pingOk, setPingOk] = useState<boolean | null>(null);
  const [pingMessage, setPingMessage] = useState<string | null>(null);

  const [orgName, setOrgName] = useState("");
  const [deptName, setDeptName] = useState("");
  const [saving, setSaving] = useState<"org" | "dept" | null>(null);
  const [orgActionError, setOrgActionError] = useState<string | null>(null);
  const [deptActionError, setDeptActionError] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadDepartments = useCallback(async () => {
    setDeptsLoading(true);
    setDeptsError(null);
    try {
      const list = await api.getDepartments();
      if (mounted.current) setDepartments(list);
    } catch (err) {
      if (mounted.current) setDeptsError(messageOf(err, "Failed to load departments"));
    } finally {
      if (mounted.current) setDeptsLoading(false);
    }
  }, []);

  const loadPreferences = useCallback(async () => {
    setPrefsLoading(true);
    setPrefsError(null);
    try {
      const p = await api.getNotificationPreferences();
      if (!mounted.current) return;
      setPrefs(p);
      setDraft(toDraft(p));
    } catch (err) {
      if (mounted.current) setPrefsError(messageOf(err, "Failed to load notification preferences"));
    } finally {
      if (mounted.current) setPrefsLoading(false);
    }
  }, []);

  /** Departments and notification preferences need an organisation membership, so load them after it. */
  const loadMemberData = useCallback(() => Promise.all([loadDepartments(), loadPreferences()]), [loadDepartments, loadPreferences]);

  const loadAll = useCallback(async () => {
    setOrgsLoading(true);
    setOrgsError(null);
    try {
      const orgs = await api.getOrganisations();
      if (!mounted.current) return;
      setOrganisations(orgs);
      setOrgsLoaded(true);
      setOrgsLoading(false);
      if (orgs.length > 0) await loadMemberData();
    } catch (err) {
      if (!mounted.current) return;
      setOrgsError(messageOf(err, "Failed to load organisation"));
      setOrgsLoading(false);
    }
  }, [loadMemberData]);

  useEffect(() => {
    void loadAll();
    return api.subscribeStatus((st) => {
      setApiStatus(st);
      setUrlInput(st.endpoint);
    });
  }, [loadAll]);

  const handleTestConnection = async () => {
    const url = urlInput.trim();
    if (!url) {
      setPingOk(false);
      setPingMessage("Enter the API base URL first.");
      return;
    }
    setIsChecking(true);
    setPingOk(null);
    setPingMessage(null);
    try {
      api.setBaseUrl(url);
      const ok = await api.checkApiHealth();
      setPingOk(ok);
      setPingMessage(
        ok
          ? "Connected to the API."
          : "Couldn't reach the API at that address. Check the URL and that the server is running."
      );
      if (ok && (orgsError || !orgsLoaded)) void loadAll();
    } catch (err) {
      setPingOk(false);
      setPingMessage(messageOf(err, "Connection test failed."));
    } finally {
      setIsChecking(false);
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving("org");
    setOrgActionError(null);
    try {
      const org = await api.createOrganisation(orgName.trim(), slugify(orgName));
      setOrganisations((prev) => [org, ...prev.filter((o) => o.id !== org.id)]);
      setOrgName("");
      void loadMemberData();
    } catch (err) {
      setOrgActionError(messageOf(err, "Could not create organisation"));
    } finally {
      setSaving(null);
    }
  };

  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving("dept");
    setDeptActionError(null);
    try {
      const dept = await api.createDepartment(deptName.trim());
      setDepartments((prev) =>
        [...prev.filter((d) => d.id !== dept.id), dept].sort((a, b) => a.name.localeCompare(b.name))
      );
      setDeptName("");
    } catch (err) {
      setDeptActionError(messageOf(err, "Could not create department"));
    } finally {
      setSaving(null);
    }
  };

  const toggleDraft = (key: PrefKey) => {
    setPrefsSaved(false);
    setDraft((d) => (d ? { ...d, [key]: !d[key] } : d));
  };

  const dirtyKeys = prefs && draft ? PREF_KEYS.filter((k) => draft[k] !== Boolean(prefs[k])) : [];

  const handleSavePrefs = async () => {
    if (!draft || !prefs || prefsSaving || dirtyKeys.length === 0) return;
    setPrefsSaving(true);
    setPrefsSaveError(null);
    setPrefsSaved(false);
    try {
      const changes = Object.fromEntries(dirtyKeys.map((k) => [k, draft[k]])) as Partial<NotificationPreferences>;
      const updated = await api.updateNotificationPreferences(changes);
      setPrefs(updated);
      setDraft(toDraft(updated));
      setPrefsSaved(true);
    } catch (err) {
      setPrefsSaveError(messageOf(err, "Could not save notification preferences"));
    } finally {
      setPrefsSaving(false);
    }
  };

  const hasOrg = organisations.length > 0;
  const canCreateOrg = orgsLoaded && !orgsError && !hasOrg;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-[#262626] flex items-center space-x-2">
          <Settings className="w-6 h-6 text-[#56BE51]" />
          <span>Settings</span>
        </h1>
        <p className="text-sm text-[#666666] mt-0.5">
          Your organisation, departments, notifications and server connection.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <section className="rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 space-y-5">
            <div className="flex items-center space-x-2">
              <Building2 className="w-4 h-4 text-[#56BE51]" />
              <h2 className="text-sm font-bold">Organisation</h2>
            </div>

            {orgsError && <ErrorBanner message={`Couldn't load your organisation: ${orgsError}`} onRetry={() => void loadAll()} />}

            {orgsLoading ? (
              <div className="h-16 rounded-2xl bg-[#F8F9FA] animate-pulse" aria-busy="true" />
            ) : hasOrg ? (
              <ul className="space-y-2">
                {organisations.map((org) => (
                  <li
                    key={org.id}
                    className="flex items-center justify-between p-3.5 rounded-2xl border border-[#EDEDED] bg-[#F8F9FA]"
                  >
                    <span className="font-bold text-sm">{org.name}</span>
                    <span className="text-xs text-[#666666] font-mono">{org.slug}</span>
                  </li>
                ))}
              </ul>
            ) : canCreateOrg ? (
              <form onSubmit={handleCreateOrg} className="space-y-2">
                <p className="text-xs text-[#666666]">
                  You don't belong to an organisation yet. Create one to get started.
                </p>
                <div className="flex space-x-2">
                  <input
                    required
                    minLength={2}
                    aria-label="Organisation name"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="Organisation name"
                    disabled={saving === "org"}
                    className={fieldClass}
                  />
                  <button
                    disabled={saving !== null || slugify(orgName).length < 2}
                    className="px-4 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs font-bold disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer"
                  >
                    {saving === "org" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>Create</span>
                  </button>
                </div>
                {orgActionError && <ErrorBanner message={orgActionError} />}
              </form>
            ) : null}

            <div className="pt-4 border-t border-[#EDEDED] space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#666666]">Departments</h3>

              {!hasOrg && !orgsLoading && !orgsError && (
                <p className="text-xs text-[#666666]">Create an organisation before adding departments.</p>
              )}

              {hasOrg && deptsError && (
                <ErrorBanner message={`Couldn't load departments: ${deptsError}`} onRetry={() => void loadDepartments()} />
              )}

              {hasOrg && deptsLoading && <div className="h-8 rounded-full bg-[#F8F9FA] animate-pulse" aria-busy="true" />}

              {hasOrg && !deptsLoading && !deptsError && departments.length === 0 && (
                <p className="text-xs text-[#666666]">No departments yet.</p>
              )}

              {departments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {departments.map((d) => (
                    <span key={d.id} className="text-xs px-3 py-1.5 rounded-full bg-[#EDEDED] font-semibold" title={d.description}>
                      {d.name}
                    </span>
                  ))}
                </div>
              )}

              {hasOrg &&
                (isAdmin ? (
                  <>
                    <form onSubmit={handleCreateDept} className="flex space-x-2">
                      <input
                        required
                        aria-label="New department name"
                        value={deptName}
                        onChange={(e) => setDeptName(e.target.value)}
                        placeholder="New department"
                        disabled={saving === "dept"}
                        className={fieldClass}
                      />
                      <button
                        disabled={saving !== null || !deptName.trim()}
                        className="px-4 py-2 rounded-full bg-[#262626] hover:bg-black text-white text-xs font-bold disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer"
                      >
                        {saving === "dept" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        <span>Add</span>
                      </button>
                    </form>
                    {deptActionError && <ErrorBanner message={deptActionError} />}
                  </>
                ) : (
                  <p className="text-[11px] text-[#9E9E9E] flex items-center space-x-1.5">
                    <Lock className="w-3 h-3" />
                    <span>Only organisation admins and owners can add departments.</span>
                  </p>
                ))}
            </div>
          </section>

          <section className="rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 space-y-4">
            <div className="flex items-center space-x-2">
              <Bell className="w-4 h-4 text-[#56BE51]" />
              <h2 className="text-sm font-bold">Notifications</h2>
            </div>

            {!hasOrg && !orgsLoading ? (
              <p className="text-xs text-[#666666]">
                {orgsError
                  ? "Notification preferences will load once your organisation does."
                  : "Join or create an organisation to manage notification preferences."}
              </p>
            ) : prefsLoading || (orgsLoading && !prefs) ? (
              <div className="space-y-2" aria-busy="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-10 rounded-2xl bg-[#F8F9FA] animate-pulse" />
                ))}
              </div>
            ) : prefsError ? (
              <ErrorBanner message={`Couldn't load preferences: ${prefsError}`} onRetry={() => void loadPreferences()} />
            ) : draft ? (
              <div className="space-y-5">
                {PREF_GROUPS.map((group) => (
                  <fieldset key={group.title} className="space-y-1.5" disabled={prefsSaving}>
                    <legend className="text-xs font-bold uppercase tracking-wider text-[#666666] mb-1.5">
                      {group.title}
                    </legend>
                    {group.items.map((item) => (
                      <label
                        key={item.key}
                        className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] cursor-pointer"
                      >
                        <span className="min-w-0">
                          <span className="block text-xs font-bold text-[#262626]">{item.label}</span>
                          <span className="block text-[11px] text-[#666666]">{item.hint}</span>
                        </span>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={draft[item.key]}
                          onChange={() => toggleDraft(item.key)}
                          className="w-4 h-4 accent-[#56BE51] shrink-0 cursor-pointer"
                        />
                      </label>
                    ))}
                  </fieldset>
                ))}

                {prefsSaveError && <ErrorBanner message={prefsSaveError} />}
                {prefsSaved && dirtyKeys.length === 0 && (
                  <div
                    role="status"
                    className="p-3 rounded-2xl text-xs flex items-center space-x-2 bg-[#74D96F]/15 text-[#1F541D]"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Preferences saved.</span>
                  </div>
                )}

                <div className="flex items-center justify-end space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (prefs) setDraft(toDraft(prefs));
                      setPrefsSaveError(null);
                    }}
                    disabled={prefsSaving || dirtyKeys.length === 0}
                    className="px-4 py-2 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSavePrefs()}
                    disabled={prefsSaving || dirtyKeys.length === 0}
                    className="px-4 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs font-bold disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer"
                  >
                    {prefsSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{prefsSaving ? "Saving..." : "Save preferences"}</span>
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[#666666]">No notification preferences are available.</p>
            )}
          </section>
        </div>

        <section className="rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 space-y-4 self-start">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Server className="w-4 h-4 text-[#56BE51]" />
              <h2 className="text-sm font-bold">API connection</h2>
            </div>
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                apiStatus.isLive ? "bg-[#74D96F]/20 text-[#1F541D]" : "bg-amber-100 text-amber-900"
              }`}
            >
              {apiStatus.isLive ? "Connected" : "Offline"}
            </span>
          </div>

          <label className="block text-xs font-semibold space-y-1.5">
            <span>API base URL</span>
            <div className="flex space-x-2">
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="http://localhost:3001/api/v1"
                className={`${fieldClass} font-mono`}
              />
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isChecking}
                className="px-4 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs font-bold disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? "animate-spin" : ""}`} />
                <span>Test</span>
              </button>
            </div>
          </label>

          {pingOk !== null && pingMessage && (
            <div
              role={pingOk ? "status" : "alert"}
              className={`p-3 rounded-2xl text-xs flex items-center space-x-2 ${
                pingOk ? "bg-[#74D96F]/15 text-[#1F541D]" : "bg-rose-50 text-rose-700"
              }`}
            >
              {pingOk ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              <span>{pingMessage}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
