"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  FolderKanban,
  Lock,
  RefreshCw,
  ShieldCheck,
  Ticket,
  Users,
  ListChecks,
  Video,
  BookOpen,
} from "lucide-react";
import { api } from "../../services/api";
import { ApiError } from "../../services/http";
import { useRBAC } from "../../lib/useRBAC";

// ---------------------------------------------------------------------------
// Response types (mirrors apps/api/src/routes/analytics.ts)
// ---------------------------------------------------------------------------

type Counts = Record<string, number>;

interface Overview {
  generatedAt: string;
  projects: { total: number; active: number };
  tasks: { total: number; open: number; done: number; overdue: number; completionRate: number };
  tickets: { total: number; open: number; resolved: number; slaBreached: number; resolutionRate: number };
  members: { active: number };
  meetings: { total: number };
  knowledge: { pages: number; files: number };
}

interface ProjectSummary {
  id: string;
  name: string;
  status: string | null;
  createdAt: string;
  milestones: { total: number; done: number };
  tasks: { total: number; done: number };
  taskCompletionRate: number | null;
}

interface ProjectsAnalytics {
  generatedAt: string;
  since: string;
  statusDistribution: Counts;
  total: number;
  projects: ProjectSummary[];
}

interface TasksAnalytics {
  generatedAt: string;
  since: string;
  total: number;
  completed: number;
  overdue: number;
  completionRate: number;
  overdueRate: number;
  byStatus: Counts;
  byPriority: Counts;
  workload: {
    assigneesWithOpenTasks: number;
    avgOpenTasksPerAssignee: number;
    maxOpenTasksOnOneAssignee: number;
  };
}

interface TicketsAnalytics {
  generatedAt: string;
  since: string;
  total: number;
  resolved: number;
  slaBreached: number;
  resolutionRate: number;
  slaComplianceRate: number;
  resolutionTime: {
    avgHours: number | null;
    medianHours: number | null;
    p90Hours: number | null;
  };
  byStatus: Counts;
  byPriority: Counts;
  byCategory: Counts;
}

interface MeetingsAnalytics {
  generatedAt: string;
  since: string;
  meetings: {
    total: number;
    withMinutes: number;
    withAiSummary: number;
    totalDurationMinutes: number;
    avgDurationMinutes: number;
  };
  actionItems: {
    total: number;
    completed: number;
    convertedToTask: number;
    completionRate: number | null;
    conversionRate: number | null;
  };
}

interface KnowledgeAnalytics {
  generatedAt: string;
  since: string;
  pages: { total: number; newInPeriod: number };
  files: {
    total: number;
    newInPeriod: number;
    totalStorageBytes: number;
    totalStorageMB: number;
    byTypeGroup: Counts;
  };
}

interface AgentsAnalytics {
  generatedAt: string;
  since: string;
  executions: {
    total: number;
    success: number;
    errors: number;
    successRate: number | null;
    errorRate: number | null;
    avgDurationMs: number | null;
    byStatus: Counts;
  };
  byAgent: { agentId: string; total: number; success: number; error: number }[];
  approvals: {
    total: number;
    byStatus: Counts;
    approvalRate: number | null;
  };
}

interface PeopleAnalytics {
  generatedAt: string;
  headcount: { activeMembers: number; pendingInvitations: number };
  byRole: Counts;
  byDepartment: Counts;
  byEmploymentStatus: Counts;
  topVerifiedSkills: { skill: string; count: number }[];
}

interface ActivityLog {
  id: string;
  actorId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  action: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface ActivityAnalytics {
  generatedAt: string;
  since: string;
  pagination: { page: number; limit: number; total: number; totalPages: number };
  summary: { byAction: Counts; byResourceType: Counts };
  logs: ActivityLog[];
}

// ---------------------------------------------------------------------------
// Loading state helpers
// ---------------------------------------------------------------------------

interface Section<T> {
  data: T | null;
  error: string | null;
  forbidden: boolean;
}

const emptySection = <T,>(): Section<T> => ({ data: null, error: null, forbidden: false });

function toSection<T>(result: PromiseSettledResult<T>): Section<T> {
  if (result.status === "fulfilled") return { data: result.value, error: null, forbidden: false };
  const err = result.reason;
  if (err instanceof ApiError) {
    if (err.status === 403) return { data: null, error: null, forbidden: true };
    if (err.status === 0) return { data: null, error: "The server is unreachable.", forbidden: false };
    return { data: null, error: err.message || `Request failed (${err.status}).`, forbidden: false };
  }
  return {
    data: null,
    error: err instanceof Error ? err.message : "Something went wrong.",
    forbidden: false,
  };
}

interface Dashboard {
  overview: Section<Overview>;
  projects: Section<ProjectsAnalytics>;
  tasks: Section<TasksAnalytics>;
  tickets: Section<TicketsAnalytics>;
  meetings: Section<MeetingsAnalytics>;
  knowledge: Section<KnowledgeAnalytics>;
  agents: Section<AgentsAnalytics>;
  people: Section<PeopleAnalytics>;
  activity: Section<ActivityAnalytics>;
  agentNames: Record<string, string>;
}

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

const DASH = "–";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const fmtNum = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? n.toLocaleString() : DASH;

const fmtPct = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? `${n}%` : DASH;

function fmtHours(h: number | null | undefined): string {
  if (typeof h !== "number" || !Number.isFinite(h)) return DASH;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h >= 48) return `${(h / 24).toFixed(1)} days`;
  return `${h} hrs`;
}

function fmtDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return DASH;
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${(s / 60).toFixed(1)} min`;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return DASH;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const titleCase = (s: string | null | undefined) =>
  s ? s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : DASH;

const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : DASH);

function describeLog(log: ActivityLog): string {
  const meta = log.metadata;
  if (meta && typeof meta === "object") {
    for (const key of ["title", "name", "subject"]) {
      const v = (meta as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  return log.resourceId ? `${titleCase(log.resourceType)} · ${shortId(log.resourceId)}` : titleCase(log.resourceType);
}

// ---------------------------------------------------------------------------
// Presentational components
// ---------------------------------------------------------------------------

const CARD = "rounded-3xl border border-[#EDEDED] bg-white shadow-sm";

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-xl ${className}`} aria-hidden="true" />;
}

function SectionMessage({
  icon,
  children,
  tone = "neutral",
  onRetry,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  tone?: "neutral" | "error";
  onRetry?: () => void;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-xs ${
        tone === "error"
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-[#EDEDED] bg-[#FAFAFA] text-[#666666]"
      }`}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="flex-1">{children}</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-full border border-red-200 bg-white px-3 py-1 text-[11px] font-semibold text-red-800 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#56BE51]"
        >
          Retry
        </button>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon,
  loading,
  className = "",
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  loading: boolean;
  className?: string;
}) {
  return (
    <div className={`${CARD} card-hover p-5 animate-slide-up ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#666666]">{label}</span>
        <div className="rounded-xl bg-[#74D96F]/15 p-2 text-[#1F541D]" aria-hidden="true">
          {icon}
        </div>
      </div>
      {loading ? (
        <>
          <Skeleton className="mt-3 h-8 w-24" />
          <Skeleton className="mt-3 h-3 w-36" />
        </>
      ) : (
        <>
          <div className="mt-3 text-2xl font-extrabold text-[#262626]">{value}</div>
          <p className="mt-2 text-[11px] text-[#666666]">{hint}</p>
        </>
      )}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`${CARD} p-6 space-y-4 animate-slide-up ${className}`} aria-label={title}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[#262626]">{title}</h2>
          {subtitle && <p className="text-xs text-[#666666]">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Bar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-2 w-full overflow-hidden rounded-full bg-[#EDEDED]"
    >
      <div className="h-full rounded-full bg-[#74D96F]" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Breakdown({ title, counts, loading }: { title: string; counts: Counts | undefined; loading: boolean }) {
  const entries = Object.entries(counts ?? {}).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((acc, [, n]) => acc + n, 0);
  return (
    <div>
      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wide text-[#666666]">{title}</h3>
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-xs text-[#666666]">No data in this period.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map(([key, n]) => (
            <li key={key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-[#262626]">{titleCase(key)}</span>
                <span className="font-mono text-[#666666]">{n.toLocaleString()}</span>
              </div>
              <Bar value={total > 0 ? (n / total) * 100 : 0} label={`${titleCase(key)} share of ${title}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#FAFAFA] border border-[#EDEDED] px-4 py-3">
      <div className="text-[11px] font-semibold text-[#666666]">{label}</div>
      <div className="mt-1 text-base font-bold text-[#262626]">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const EMPTY_DASHBOARD: Dashboard = {
  overview: emptySection(),
  projects: emptySection(),
  tasks: emptySection(),
  tickets: emptySection(),
  meetings: emptySection(),
  knowledge: emptySection(),
  agents: emptySection(),
  people: emptySection(),
  activity: emptySection(),
  agentNames: {},
};

export default function AnalyticsPage() {
  const rbac = useRBAC();
  const [mounted, setMounted] = useState(false);
  const [days, setDays] = useState<Range>(30);
  const [loading, setLoading] = useState(true);
  const [dash, setDash] = useState<Dashboard>(EMPTY_DASHBOARD);
  const requestId = useRef(0);

  useEffect(() => setMounted(true), []);

  const canView = rbac.canViewAnalytics;
  const isAdmin = rbac.isAdmin;

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);

    const since = encodeURIComponent(new Date(Date.now() - days * 86_400_000).toISOString());
    const q = `?since=${since}`;

    const never = <T,>(): Promise<T> => Promise.reject(new ApiError("Restricted", 403));

    const [overview, projects, tasks, tickets, meetings, knowledge, agents, people, activity, agentList] =
      await Promise.allSettled([
        api.getJson<Overview>("/analytics/overview"),
        api.getJson<ProjectsAnalytics>(`/analytics/projects${q}`),
        api.getJson<TasksAnalytics>(`/analytics/tasks${q}`),
        api.getJson<TicketsAnalytics>(`/analytics/tickets${q}`),
        api.getJson<MeetingsAnalytics>(`/analytics/meetings${q}`),
        api.getJson<KnowledgeAnalytics>(`/analytics/knowledge${q}`),
        isAdmin ? api.getJson<AgentsAnalytics>(`/analytics/agents${q}`) : never<AgentsAnalytics>(),
        isAdmin ? api.getJson<PeopleAnalytics>("/analytics/people") : never<PeopleAnalytics>(),
        isAdmin
          ? api.getJson<ActivityAnalytics>(`/analytics/activity${q}&limit=25`)
          : never<ActivityAnalytics>(),
        isAdmin ? api.getAgents() : Promise.resolve([]),
      ]);

    if (id !== requestId.current) return; // a newer request superseded this one

    const agentNames: Record<string, string> = {};
    if (agentList.status === "fulfilled") {
      for (const a of agentList.value) {
        if (a.id && a.name) agentNames[a.id] = a.name;
      }
    }

    setDash({
      overview: toSection(overview),
      projects: toSection(projects),
      tasks: toSection(tasks),
      tickets: toSection(tickets),
      meetings: toSection(meetings),
      knowledge: toSection(knowledge),
      agents: toSection(agents),
      people: toSection(people),
      activity: toSection(activity),
      agentNames,
    });
    setLoading(false);
  }, [days, isAdmin]);

  useEffect(() => {
    if (!mounted || !canView) return;
    void load();
  }, [mounted, canView, load]);

  if (!mounted) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-3xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="space-y-6">
        <Header days={days} setDays={setDays} onRefresh={load} loading={false} disabled />
        <SectionMessage icon={<Lock className="h-4 w-4" />}>
          Analytics are available to members, admins and owners. Ask an organisation admin for access.
        </SectionMessage>
      </div>
    );
  }

  const { overview, projects, tasks, tickets, meetings, knowledge, agents, people, activity, agentNames } = dash;

  const coreSections = [overview, projects, tasks, tickets, meetings, knowledge];
  const everyCoreFailed = !loading && coreSections.every((s) => s.data === null);
  const firstError = coreSections.find((s) => s.error)?.error ?? "Could not load analytics.";

  const ov = overview.data;
  const tk = tickets.data;
  const ts = tasks.data;

  const headcount = people.data?.headcount.activeMembers ?? ov?.members.active;
  const ticketsInRange = tk?.total ?? 0;

  return (
    <div className="space-y-6" aria-busy={loading}>
      <Header days={days} setDays={setDays} onRefresh={load} loading={loading} />

      {everyCoreFailed ? (
        <SectionMessage tone="error" icon={<AlertTriangle className="h-4 w-4" />} onRetry={load}>
          <p className="font-semibold">Analytics could not be loaded.</p>
          <p className="mt-0.5">{firstError}</p>
        </SectionMessage>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Open Tickets"
              value={fmtNum(ov?.tickets.open)}
              hint={ov ? `${fmtNum(ov.tickets.total)} tickets in total (all time)` : "Unavailable"}
              icon={<Ticket className="h-4 w-4" />}
              loading={loading}
              className="stagger-1"
            />
            <KpiCard
              label="Resolved Tickets"
              value={fmtNum(tk?.resolved)}
              hint={tk ? `${fmtPct(tk.resolutionRate)} of ${fmtNum(tk.total)} raised in last ${days} days` : "Unavailable"}
              icon={<CheckCircle2 className="h-4 w-4" />}
              loading={loading}
              className="stagger-2"
            />
            <KpiCard
              label="SLA Compliance"
              value={tk && ticketsInRange > 0 ? fmtPct(tk.slaComplianceRate) : DASH}
              hint={
                tk
                  ? ticketsInRange > 0
                    ? `${fmtNum(tk.slaBreached)} breached in last ${days} days`
                    : `No tickets in last ${days} days`
                  : "Unavailable"
              }
              icon={<ShieldCheck className="h-4 w-4" />}
              loading={loading}
              className="stagger-3"
            />
            <KpiCard
              label="Avg Time to Resolve"
              value={fmtHours(tk?.resolutionTime.avgHours)}
              hint={
                tk && tk.resolutionTime.medianHours !== null
                  ? `Median ${fmtHours(tk.resolutionTime.medianHours)} · p90 ${fmtHours(tk.resolutionTime.p90Hours)}`
                  : tk
                    ? "No resolved tickets in this period"
                    : "Unavailable"
              }
              icon={<Clock className="h-4 w-4" />}
              loading={loading}
              className="stagger-4"
            />
            <KpiCard
              label="Task Completion"
              value={ts && ts.total > 0 ? fmtPct(ts.completionRate) : DASH}
              hint={
                ts
                  ? ts.total > 0
                    ? `${fmtNum(ts.completed)} of ${fmtNum(ts.total)} tasks created in last ${days} days`
                    : `No tasks created in last ${days} days`
                  : "Unavailable"
              }
              icon={<ListChecks className="h-4 w-4" />}
              loading={loading}
              className="stagger-5"
            />
            <KpiCard
              label="Overdue Tasks"
              value={fmtNum(ov?.tasks.overdue)}
              hint={ov ? `${fmtNum(ov.tasks.open)} open of ${fmtNum(ov.tasks.total)} (all time)` : "Unavailable"}
              icon={<AlertTriangle className="h-4 w-4" />}
              loading={loading}
              className="stagger-6"
            />
            <KpiCard
              label="Active Projects"
              value={fmtNum(ov?.projects.active)}
              hint={ov ? `${fmtNum(ov.projects.total)} projects in total` : "Unavailable"}
              icon={<FolderKanban className="h-4 w-4" />}
              loading={loading}
              className="stagger-7"
            />
            <KpiCard
              label="Headcount"
              value={fmtNum(headcount)}
              hint={
                people.data
                  ? `${fmtNum(people.data.headcount.pendingInvitations)} pending invitations`
                  : "Active organisation members"
              }
              icon={<Users className="h-4 w-4" />}
              loading={loading}
              className="stagger-8"
            />
          </div>

          {/* Ticket breakdown */}
          <Panel
            title="Ticket Breakdown"
            subtitle={`Tickets created in the last ${days} days`}
            right={
              tk && (
                <span className="rounded-full border border-[#BEBEBE]/40 bg-[#EDEDED] px-3 py-1 text-xs font-medium text-[#262626]">
                  {fmtNum(tk.total)} tickets
                </span>
              )
            }
          >
            {tickets.error ? (
              <SectionMessage tone="error" icon={<AlertTriangle className="h-4 w-4" />} onRetry={load}>
                Ticket analytics failed to load: {tickets.error}
              </SectionMessage>
            ) : !loading && tk && tk.total === 0 ? (
              <SectionMessage icon={<Ticket className="h-4 w-4" />}>
                No tickets were created in the last {days} days.
              </SectionMessage>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <Breakdown title="By status" counts={tk?.byStatus} loading={loading} />
                <Breakdown title="By priority" counts={tk?.byPriority} loading={loading} />
                <Breakdown title="By category" counts={tk?.byCategory} loading={loading} />
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Project health */}
            <Panel
              title="Project Health"
              subtitle={`Task progress for projects created in the last ${days} days`}
              right={
                projects.data && (
                  <span className="rounded-full border border-[#BEBEBE]/40 bg-[#EDEDED] px-3 py-1 text-xs font-medium text-[#262626]">
                    {fmtNum(projects.data.total)} projects
                  </span>
                )
              }
            >
              {projects.error ? (
                <SectionMessage tone="error" icon={<AlertTriangle className="h-4 w-4" />} onRetry={load}>
                  Project analytics failed to load: {projects.error}
                </SectionMessage>
              ) : loading ? (
                <div className="space-y-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !projects.data || projects.data.projects.length === 0 ? (
                <SectionMessage icon={<FolderKanban className="h-4 w-4" />}>
                  No projects were created in the last {days} days.
                </SectionMessage>
              ) : (
                <ul className="max-h-96 space-y-4 overflow-y-auto pr-1">
                  {projects.data.projects.map((p) => (
                    <li key={p.id}>
                      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                        <span className="truncate font-semibold text-[#262626]">{p.name}</span>
                        <span className="shrink-0 font-mono text-[#666666]">
                          {p.taskCompletionRate === null ? "No tasks" : `${p.taskCompletionRate}%`}
                        </span>
                      </div>
                      <Bar value={p.taskCompletionRate ?? 0} label={`${p.name} task completion`} />
                      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-[#666666]">
                        <span>{titleCase(p.status)}</span>
                        <span>
                          Tasks {p.tasks.done}/{p.tasks.total}
                        </span>
                        <span>
                          Milestones {p.milestones.done}/{p.milestones.total}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* Tasks, meetings, knowledge */}
            <Panel title="Work & Knowledge" subtitle={`Activity in the last ${days} days`}>
              <div className="space-y-5">
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#666666]">
                    <ListChecks className="h-3.5 w-3.5" aria-hidden="true" /> Tasks
                  </h3>
                  {tasks.error ? (
                    <SectionMessage tone="error" onRetry={load}>
                      Task analytics failed to load: {tasks.error}
                    </SectionMessage>
                  ) : loading ? (
                    <Skeleton className="h-16 w-full" />
                  ) : ts && ts.total > 0 ? (
                    <div className="grid grid-cols-3 gap-3">
                      <Stat label="Created" value={fmtNum(ts.total)} />
                      <Stat label="Overdue" value={`${fmtNum(ts.overdue)} (${fmtPct(ts.overdueRate)})`} />
                      <Stat
                        label="Avg open / assignee"
                        value={ts.workload.assigneesWithOpenTasks > 0 ? String(ts.workload.avgOpenTasksPerAssignee) : DASH}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-[#666666]">No tasks created in this period.</p>
                  )}
                </div>

                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#666666]">
                    <Video className="h-3.5 w-3.5" aria-hidden="true" /> Meetings
                  </h3>
                  {meetings.error ? (
                    <SectionMessage tone="error" onRetry={load}>
                      Meeting analytics failed to load: {meetings.error}
                    </SectionMessage>
                  ) : loading ? (
                    <Skeleton className="h-16 w-full" />
                  ) : meetings.data && meetings.data.meetings.total > 0 ? (
                    <div className="grid grid-cols-3 gap-3">
                      <Stat label="Meetings" value={fmtNum(meetings.data.meetings.total)} />
                      <Stat label="Avg duration" value={`${fmtNum(meetings.data.meetings.avgDurationMinutes)} min`} />
                      <Stat label="Action items done" value={fmtPct(meetings.data.actionItems.completionRate)} />
                    </div>
                  ) : (
                    <p className="text-xs text-[#666666]">No meetings in this period.</p>
                  )}
                </div>

                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#666666]">
                    <BookOpen className="h-3.5 w-3.5" aria-hidden="true" /> Knowledge
                  </h3>
                  {knowledge.error ? (
                    <SectionMessage tone="error" onRetry={load}>
                      Knowledge analytics failed to load: {knowledge.error}
                    </SectionMessage>
                  ) : loading ? (
                    <Skeleton className="h-16 w-full" />
                  ) : knowledge.data ? (
                    <div className="grid grid-cols-3 gap-3">
                      <Stat
                        label="Pages"
                        value={`${fmtNum(knowledge.data.pages.total)} (+${fmtNum(knowledge.data.pages.newInPeriod)})`}
                      />
                      <Stat
                        label="Files"
                        value={`${fmtNum(knowledge.data.files.total)} (+${fmtNum(knowledge.data.files.newInPeriod)})`}
                      />
                      <Stat label="Storage" value={`${fmtNum(knowledge.data.files.totalStorageMB)} MB`} />
                    </div>
                  ) : (
                    <p className="text-xs text-[#666666]">Unavailable.</p>
                  )}
                </div>
              </div>
            </Panel>
          </div>

          {/* Admin-only sections */}
          {!isAdmin ? (
            <SectionMessage icon={<Lock className="h-4 w-4" />}>
              Agent reliability and the audit activity timeline are only available to admins and owners.
            </SectionMessage>
          ) : (
            <>
              <Panel
                title="Agent Reliability"
                subtitle={`Agent executions and approvals in the last ${days} days`}
                right={
                  <span className="flex items-center gap-1 rounded-full border border-[#BEBEBE]/40 bg-[#EDEDED] px-3 py-1 text-xs font-medium text-[#262626]">
                    <Bot className="h-3.5 w-3.5" aria-hidden="true" /> Admin
                  </span>
                }
              >
                {agents.forbidden ? (
                  <SectionMessage icon={<Lock className="h-4 w-4" />}>
                    Your role does not have access to agent analytics.
                  </SectionMessage>
                ) : agents.error ? (
                  <SectionMessage tone="error" icon={<AlertTriangle className="h-4 w-4" />} onRetry={load}>
                    Agent analytics failed to load: {agents.error}
                  </SectionMessage>
                ) : loading ? (
                  <Skeleton className="h-32 w-full" />
                ) : !agents.data || agents.data.executions.total === 0 ? (
                  <SectionMessage icon={<Bot className="h-4 w-4" />}>
                    No agent executions in the last {days} days.
                  </SectionMessage>
                ) : (
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <Stat label="Executions" value={fmtNum(agents.data.executions.total)} />
                      <Stat label="Success rate" value={fmtPct(agents.data.executions.successRate)} />
                      <Stat label="Avg duration" value={fmtDuration(agents.data.executions.avgDurationMs)} />
                      <Stat
                        label="Approval rate"
                        value={
                          agents.data.approvals.total > 0
                            ? `${fmtPct(agents.data.approvals.approvalRate)} of ${fmtNum(agents.data.approvals.total)}`
                            : DASH
                        }
                      />
                    </div>
                    <ul className="space-y-3">
                      {agents.data.byAgent.map((a) => {
                        const rate = a.total > 0 ? Math.round((a.success / a.total) * 100) : null;
                        const name = agentNames[a.agentId] ?? `Agent ${shortId(a.agentId)}`;
                        return (
                          <li key={a.agentId}>
                            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                              <span className="truncate font-semibold text-[#262626]">{name}</span>
                              <span className="shrink-0 font-mono text-[#666666]">
                                {a.success}/{a.total} ok · {a.error} failed · {fmtPct(rate)}
                              </span>
                            </div>
                            <Bar value={rate ?? 0} label={`${name} success rate`} />
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </Panel>

              <Panel
                title="Activity & Audit Timeline"
                subtitle={`Most recent audit events from the last ${days} days`}
                right={
                  activity.data && (
                    <span className="rounded-full border border-[#BEBEBE]/40 bg-[#EDEDED] px-3 py-1 font-mono text-xs font-medium text-[#262626]">
                      {fmtNum(activity.data.pagination.total)} events
                    </span>
                  )
                }
              >
                {activity.forbidden ? (
                  <SectionMessage icon={<Lock className="h-4 w-4" />}>
                    Your role does not have access to audit activity.
                  </SectionMessage>
                ) : activity.error ? (
                  <SectionMessage tone="error" icon={<AlertTriangle className="h-4 w-4" />} onRetry={load}>
                    Activity log failed to load: {activity.error}
                  </SectionMessage>
                ) : loading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : !activity.data || activity.data.logs.length === 0 ? (
                  <SectionMessage icon={<Activity className="h-4 w-4" />}>
                    No audit events were recorded in the last {days} days.
                  </SectionMessage>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2" aria-label="Events by resource type">
                      {Object.entries(activity.data.summary.byResourceType).map(([type, n]) => (
                        <span
                          key={type}
                          className="rounded-full border border-[#BEBEBE]/40 bg-[#EDEDED] px-2.5 py-0.5 text-[11px] font-medium text-[#262626]"
                        >
                          {titleCase(type)} · {n}
                        </span>
                      ))}
                    </div>
                    <ol className="relative space-y-4 border-l border-[#EDEDED] pl-5">
                      {activity.data.logs.map((log) => (
                        <li key={log.id} className="relative">
                          <span
                            className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#56BE51]"
                            aria-hidden="true"
                          />
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-[#262626]">{titleCase(log.action)}</span>
                            <time dateTime={log.createdAt} className="font-mono text-[11px] text-[#666666]">
                              {fmtDateTime(log.createdAt)}
                            </time>
                          </div>
                          <p className="mt-0.5 text-[11px] text-[#666666]">
                            {describeLog(log)} · by <span className="font-mono">{shortId(log.actorId)}</span>
                          </p>
                        </li>
                      ))}
                    </ol>
                    {activity.data.pagination.total > activity.data.logs.length && (
                      <p className="text-[11px] text-[#666666]">
                        Showing the latest {activity.data.logs.length} of {fmtNum(activity.data.pagination.total)} events.
                      </p>
                    )}
                  </>
                )}
              </Panel>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header with date-range selector
// ---------------------------------------------------------------------------

function Header({
  days,
  setDays,
  onRefresh,
  loading,
  disabled = false,
}: {
  days: Range;
  setDays: (d: Range) => void;
  onRefresh: () => void;
  loading: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-[#EDEDED] pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="flex items-center space-x-2 text-xl font-bold text-[#262626] md:text-2xl">
          <BarChart3 className="h-6 w-6 text-[#74D96F]" aria-hidden="true" />
          <span>Operational Intelligence & Analytics</span>
        </h1>
        <p className="mt-0.5 text-xs text-[#666666]">
          Live metrics for tickets, tasks, projects, agents and audit activity.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <div role="group" aria-label="Date range" className="flex rounded-full border border-[#EDEDED] bg-white p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              disabled={disabled}
              aria-pressed={days === r}
              onClick={() => setDays(r)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#56BE51] disabled:opacity-50 ${
                days === r ? "bg-[#74D96F] text-[#1F541D]" : "text-[#666666] hover:bg-[#EDEDED]"
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || disabled}
          aria-label="Refresh analytics"
          className="rounded-full border border-[#EDEDED] bg-white p-2 text-[#666666] transition hover:bg-[#EDEDED] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#56BE51] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
