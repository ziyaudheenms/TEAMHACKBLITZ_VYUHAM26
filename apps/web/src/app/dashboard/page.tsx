"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Sparkles,
  Users,
  Building2,
  Network,
  ArrowRight,
  BookOpen,
  Loader2,
  AlertCircle,
  CornerDownLeft,
  FolderKanban,
  Ticket,
  Bot,
  Video,
  TrendingUp,
  Shield,
  Zap,
  HardDrive,
} from "lucide-react";
import { api } from "../../services/api";
import { sessionStore, ApiError } from "../../services/http";
import type { Organisation } from "../../types";
import { useRBAC } from "../../lib/useRBAC";

/* ── Animated counter ──────────────────────────────────────────── */
function AnimatedNumber({ target }: { target: number | string }) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);
  const numericTarget = typeof target === "number" ? target : Number(target) || 0;

  useEffect(() => {
    if (numericTarget === 0) {
      setDisplay(0);
      return;
    }
    startRef.current = null;
    const step = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const p = Math.min((ts - startRef.current) / 1200, 1);
      setDisplay(Math.floor((1 - Math.pow(1 - p, 3)) * numericTarget));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [numericTarget]);

  return <>{typeof target === "number" ? display : target}</>;
}

/* ── Skeleton card ─────────────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="rounded-3xl bg-white border border-[#EDEDED] p-5 space-y-3">
      <div className="skeleton h-3 w-20 rounded-full" />
      <div className="skeleton h-7 w-12 rounded-lg" />
    </div>
  );
}

/* ── Quick action tile ─────────────────────────────────────────── */
interface QuickActionProps {
  icon: React.ElementType;
  label: string;
  href: string;
  color: string;
  delay?: number;
}
function QuickAction({ icon: Icon, label, href, color, delay = 0 }: QuickActionProps) {
  return (
    <Link
      href={href}
      style={{ animationDelay: `${delay}ms` }}
      className="group flex flex-col items-center gap-2 p-4 rounded-2xl bg-white border border-[#EDEDED] hover:border-[#BEBEBE] card-hover text-center animate-slide-up cursor-pointer"
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
        style={{ backgroundColor: `${color}1a` }}
      >
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <span className="text-[11px] font-bold text-[#444] group-hover:text-[#262626]">{label}</span>
    </Link>
  );
}

/* ── Greeting ─────────────────────────────────────────────────── */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/* ── Page ────────────────────────────────────────────────────────── */
/** One overview figure: either loaded, or failed (so we never show a misleading 0). */
type Slot<T> = { ok: true; value: T } | { ok: false; error: string };

interface Overview {
  organisations: Slot<Organisation[]>;
  employees: Slot<number>;
  departments: Slot<number>;
  projects: Slot<number>;
  tickets: Slot<number>;
}

interface Answer {
  answer: string;
  sources: Array<{ title: string; category: string; snippet?: string; link?: string }>;
}

function toSlot<T, U>(result: PromiseSettledResult<T>, map: (v: T) => U): Slot<U> {
  if (result.status === "fulfilled") return { ok: true, value: map(result.value) };
  const reason = result.reason;
  return { ok: false, error: reason instanceof Error && reason.message ? reason.message : "Request failed" };
}

function aiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return `You don't have access to the AI assistant: ${err.message}`;
    if (err.status === 502 || err.status === 503 || err.status === 504) {
      return `The AI engine is unavailable right now. Try again in a moment. (${err.message})`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "The AI engine did not respond.";
}

export default function DashboardPage() {
  const { role, isAdmin, canManageAgents } = useRBAC();
  const [firstName, setFirstName] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  const [query, setQuery] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const mounted = useRef(true);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    const [orgs, employees, departments, projects, tickets] = await Promise.allSettled([
      api.getOrganisations(),
      api.getEmployees(),
      api.getDepartments(),
      api.getProjects(),
      api.getTickets(),
    ]);
    if (!mounted.current) return;
    setOverview({
      organisations: toSlot(orgs, (v) => v),
      employees: toSlot(employees, (v) => v.length),
      departments: toSlot(departments, (v) => v.length),
      projects: toSlot(projects, (v) => v.filter((p) => p.status === "active").length),
      tickets: toSlot(tickets, (v) => v.filter((t) => t.status === "open" || t.status === "in_progress").length),
    });
    setOverviewLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    setHydrated(true);
    const user = sessionStore.get()?.user;
    setFirstName(user?.firstName || user?.email?.split("@")[0] || "");
    void loadOverview();
    return () => {
      mounted.current = false;
    };
  }, [loadOverview]);

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = query.trim();
    if (!prompt || isAsking) return;
    setIsAsking(true);
    setAskError(null);
    setAnswer(null);
    try {
      setAnswer(await api.askSecondBrain(prompt));
    } catch (err) {
      setAskError(aiErrorMessage(err));
    } finally {
      setIsAsking(false);
    }
  };

  type Stat = {
    label: string;
    /** null = failed to load (rendered as "–"). */
    value: number | string | null;
    error?: string;
    icon: React.ElementType;
    href: string;
    accent: string;
    isText?: boolean;
  };

  const numeric = (slot: Slot<number> | undefined): Pick<Stat, "value" | "error"> =>
    !slot ? { value: null } : slot.ok ? { value: slot.value } : { value: null, error: slot.error };

  const orgSlot = overview?.organisations;
  const stats: Stat[] = [
    {
      label: "Organisation",
      ...(!orgSlot
        ? { value: null }
        : orgSlot.ok
        ? { value: orgSlot.value[0]?.name ?? "None yet" }
        : { value: null, error: orgSlot.error }),
      icon: Building2,
      href: "/settings",
      accent: "#74D96F",
      isText: true,
    },
    { label: "People", ...numeric(overview?.employees), icon: Users, href: "/directory", accent: "#75A0C9" },
    { label: "Departments", ...numeric(overview?.departments), icon: Network, href: "/settings", accent: "#F09363" },
    { label: "Active projects", ...numeric(overview?.projects), icon: FolderKanban, href: "/projects", accent: "#9b59b6" },
    { label: "Open tickets", ...numeric(overview?.tickets), icon: Ticket, href: "/tickets", accent: "#e74c3c" },
  ];

  const failedStats = stats.filter((s) => s.error);
  const allFailed = failedStats.length === stats.length;

  const quickActions = [
    { icon: BookOpen, label: "New page", href: "/knowledge", color: "#75A0C9" },
    { icon: HardDrive, label: "Asset storage", href: "/storage", color: "#56BE51" },
    { icon: FolderKanban, label: "New project", href: "/projects", color: "#9b59b6" },
    { icon: Ticket, label: "Raise ticket", href: "/tickets", color: "#e74c3c" },
    { icon: Video, label: "Log meeting", href: "/meetings", color: "#F09363" },
    ...(hydrated && canManageAgents
      ? [{ icon: Bot, label: "Deploy agent", href: "/agents", color: "#74D96F" }]
      : []),
  ];

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Greeting */}
      <div className="animate-slide-up">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#262626]">
            {greeting()}{firstName ? `, ${firstName}` : ""}
          </h1>
          {hydrated && role && role !== "guest" && (
            <span
              className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                role === "owner"
                  ? "bg-purple-100 text-purple-700 border-purple-200"
                  : role === "admin"
                  ? "bg-amber-100 text-amber-700 border-amber-200"
                  : "bg-green-100 text-green-700 border-green-200"
              }`}
            >
              {role}
            </span>
          )}
        </div>
        <p className="text-sm text-[#666666] mt-1">
          Ask your organisation's second brain, or jump back into your work.
        </p>
      </div>

      {/* Second Brain search */}
      <section className="rounded-3xl bg-white border border-[#EDEDED] shadow-xs p-5 sm:p-6 space-y-4 animate-slide-up" style={{ animationDelay: "60ms" }}>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-lg bg-[#74D96F]/20 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-[#56BE51]" />
          </div>
          <h2 className="text-sm font-bold text-[#262626]">Second Brain</h2>
          <span className="text-[10px] text-[#9E9E9E] font-medium">Ask anything about your organisation</span>
        </div>

        <form onSubmit={handleAsk} className="relative">
          <Sparkles className="w-4 h-4 text-[#56BE51] absolute left-4 top-1/2 -translate-y-1/2" />
          <label htmlFor="ask" className="sr-only">Ask the second brain</label>
          <input
            id="ask"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What are our Q4 OKRs? Who leads the AI team? What's the SLA policy?"
            className="w-full rounded-full border border-[#BEBEBE] bg-[#F8F9FA] pl-11 pr-24 py-3 text-sm focus:outline-none focus:border-[#74D96F] focus:bg-white transition"
          />
          <button
            type="submit"
            disabled={isAsking || !query.trim()}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center px-4 py-1.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs font-bold text-[#262626] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {isAsking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <>Ask <CornerDownLeft className="w-3 h-3 ml-1" /></>}
          </button>
        </form>

        {askError && (
          <div role="alert" className="flex items-start space-x-2 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700 animate-slide-down">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{askError}</span>
          </div>
        )}

        {answer && (
          <div className="space-y-3 animate-slide-down">
            <div className="text-sm leading-relaxed text-[#262626] whitespace-pre-wrap bg-[#F8F9FA] rounded-2xl p-4 border border-[#EDEDED]">
              {answer.answer}
            </div>
            {answer.sources.length > 0 && (
              <div className="pt-2 border-t border-[#EDEDED]">
                <div className="text-[11px] font-bold text-[#666666] uppercase tracking-wider mb-2">Sources</div>
                <ul className="space-y-1.5">
                  {answer.sources.map((s, i) => (
                    <li key={i} className="flex items-center space-x-2 text-xs text-[#262626]">
                      <BookOpen className="w-3.5 h-3.5 text-[#56BE51] shrink-0" />
                      <span className="font-semibold">{s.title}</span>
                      <span className="text-[#9E9E9E]">{s.category}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Error state: partial or total failure of the overview requests */}
      {!overviewLoading && failedStats.length > 0 && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700 animate-slide-down"
        >
          <span className="flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {allFailed ? "Couldn't load the overview" : `Couldn't load: ${failedStats.map((s) => s.label).join(", ")}`}
              {" "}({failedStats[0].error}). A dash means the figure is unknown, not zero.
            </span>
          </span>
          <button onClick={() => void loadOverview()} className="font-bold underline cursor-pointer shrink-0">
            Retry
          </button>
        </div>
      )}

      {/* Stats grid */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {overviewLoading
          ? Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
          : stats.map(({ label, value, error, icon: Icon, href, accent, isText }, idx) => (
              <Link
                key={label}
                href={href}
                style={{ animationDelay: `${idx * 60}ms` }}
                className="group rounded-3xl bg-white border border-[#EDEDED] p-5 hover:border-[#BEBEBE] card-hover shadow-xs animate-slide-up cursor-pointer"
              >
                <div className="flex items-center justify-between text-[#666666] mb-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
                  <div className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${accent}1a` }}>
                    <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
                  </div>
                </div>
                <div className="flex items-end justify-between">
                  <span className="text-2xl font-extrabold text-[#262626] truncate">
                    {value === null ? (
                      <span aria-label="Unavailable" className="text-[#BEBEBE]">–</span>
                    ) : isText ? (
                      <span className="text-base">{value}</span>
                    ) : (
                      <AnimatedNumber target={value as number} />
                    )}
                  </span>
                  <ArrowRight className="w-4 h-4 text-[#BEBEBE] group-hover:text-[#56BE51] group-hover:translate-x-0.5 transition" />
                </div>
                {error && (
                  <p className="text-[10px] text-rose-600 mt-1.5 truncate" title={error}>
                    Couldn't load
                  </p>
                )}
              </Link>
            ))}
      </section>

      {/* Quick actions */}
      <section className="space-y-3 animate-slide-up" style={{ animationDelay: "240ms" }}>
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#F09363]" />
          <h2 className="text-sm font-bold text-[#262626]">Quick actions</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {quickActions.map((a, i) => (
            <QuickAction key={a.label} {...a} delay={i * 50} />
          ))}
        </div>
      </section>

      {/* Admin panel pill */}
      {isAdmin && (
        <section
          className="rounded-3xl border border-amber-200 bg-amber-50 p-5 flex items-center justify-between animate-slide-up"
          style={{ animationDelay: "300ms" }}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
              <Shield className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-amber-900">Admin access</h3>
              <p className="text-xs text-amber-700">You can manage agents, approve browser jobs, and invite members.</p>
            </div>
          </div>
          <Link
            href="/agents"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition"
          >
            <Bot className="w-3.5 h-3.5" />
            Manage agents
          </Link>
        </section>
      )}

      {/* Trending */}
      <section className="rounded-3xl bg-white border border-[#EDEDED] p-5 space-y-4 animate-slide-up" style={{ animationDelay: "320ms" }}>
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#75A0C9]" />
          <h2 className="text-sm font-bold text-[#262626]">Jump back in</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "Knowledge base", sub: "Browse & create pages", href: "/knowledge", color: "#75A0C9", icon: BookOpen },
            { label: "Meetings hub", sub: "Minutes, recordings, actions", href: "/meetings", color: "#F09363", icon: Video },
            { label: "Analytics", sub: "Project health & SLA metrics", href: "/analytics", color: "#56BE51", icon: TrendingUp },
          ].map(({ label, sub, href, color, icon: Icon }) => (
            <Link
              key={label}
              href={href}
              className="group flex items-center gap-3 p-4 rounded-2xl border border-[#EDEDED] hover:border-[#BEBEBE] card-hover"
            >
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}1a` }}>
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-[#262626] group-hover:text-[#1a1a1a]">{label}</div>
                <div className="text-[10px] text-[#9E9E9E]">{sub}</div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-[#BEBEBE] group-hover:text-[#56BE51] ml-auto shrink-0 group-hover:translate-x-0.5 transition" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
