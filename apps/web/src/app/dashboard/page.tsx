"use client";

import React, { useState, useEffect, useRef } from "react";
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
} from "lucide-react";
import { api } from "../../services/api";
import { sessionStore } from "../../services/http";
import type { Organisation } from "../../types";
import { useRBAC } from "../../lib/useRBAC";

/* ── Animated counter ──────────────────────────────────────────── */
function AnimatedNumber({ target }: { target: number | string }) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);
  const numericTarget = typeof target === "number" ? target : Number(target) || 0;

  useEffect(() => {
    if (numericTarget === 0) return;
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
interface Overview {
  organisations: Organisation[];
  employeeCount: number;
  departmentCount: number;
  projectCount: number;
  ticketCount: number;
}

interface Answer {
  answer: string;
  sources: Array<{ title: string; category: string; snippet?: string; url?: string }>;
}

export default function DashboardPage() {
  const { role, isAdmin, canManageAgents } = useRBAC();
  const [firstName, setFirstName] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  useEffect(() => {
    const user = sessionStore.get()?.user;
    setFirstName(user?.firstName || user?.email?.split("@")[0] || "");

    setOverviewLoading(true);
    Promise.all([
      api.getOrganisations(),
      api.getEmployees(),
      api.getDepartments(),
      api.getProjects().catch(() => []),
      api.getTickets().catch(() => []),
    ])
      .then(([organisations, employees, departments, projects, tickets]) =>
        setOverview({
          organisations,
          employeeCount: employees.length,
          departmentCount: departments.length,
          projectCount: projects.length,
          ticketCount: tickets.filter((t) => t.status === "open" || t.status === "in_progress").length,
        })
      )
      .catch((err) =>
        setOverviewError(err instanceof Error ? err.message : "Failed to load overview")
      )
      .finally(() => setOverviewLoading(false));
  }, []);

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
      setAskError(err instanceof Error ? err.message : "The AI engine did not respond.");
    } finally {
      setIsAsking(false);
    }
  };

  const stats = [
    {
      label: "Organisation",
      value: overview ? (overview.organisations[0]?.name ?? "—") : 0,
      icon: Building2,
      href: "/settings",
      accent: "#74D96F",
      isText: true,
    },
    {
      label: "People",
      value: overview?.employeeCount ?? 0,
      icon: Users,
      href: "/directory",
      accent: "#75A0C9",
    },
    {
      label: "Departments",
      value: overview?.departmentCount ?? 0,
      icon: Network,
      href: "/settings",
      accent: "#F09363",
    },
    {
      label: "Active projects",
      value: overview?.projectCount ?? 0,
      icon: FolderKanban,
      href: "/projects",
      accent: "#9b59b6",
    },
    {
      label: "Open tickets",
      value: overview?.ticketCount ?? 0,
      icon: Ticket,
      href: "/tickets",
      accent: "#e74c3c",
    },
  ];

  const quickActions = [
    { icon: BookOpen, label: "New page", href: "/knowledge", color: "#75A0C9" },
    { icon: FolderKanban, label: "New project", href: "/projects", color: "#9b59b6" },
    { icon: Ticket, label: "Raise ticket", href: "/tickets", color: "#e74c3c" },
    { icon: Video, label: "Log meeting", href: "/meetings", color: "#F09363" },
    ...(canManageAgents
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
          {role && role !== "guest" && (
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

      {/* Error state */}
      {overviewError && (
        <div role="alert" className="flex items-start space-x-2 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700 animate-slide-down">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Couldn't load overview: {overviewError}</span>
        </div>
      )}

      {/* Stats grid */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {overviewLoading
          ? Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
          : stats.map(({ label, value, icon: Icon, href, accent, isText }, idx) => (
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
                    {isText ? (
                      <span className="text-base">{value}</span>
                    ) : (
                      <AnimatedNumber target={value as number} />
                    )}
                  </span>
                  <ArrowRight className="w-4 h-4 text-[#BEBEBE] group-hover:text-[#56BE51] group-hover:translate-x-0.5 transition" />
                </div>
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
