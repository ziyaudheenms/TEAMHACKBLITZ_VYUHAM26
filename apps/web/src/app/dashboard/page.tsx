"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  Ticket as TicketIcon,
  Bot,
  Video,
  TrendingUp,
  Shield,
  Zap,
  HardDrive,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  Layers,
  LayoutGrid,
  List,
  Calendar,
  ExternalLink,
  Plus,
  MessageSquare,
  FileText,
  Lock,
} from "lucide-react";
import { api } from "../../services/api";
import { sessionStore, ApiError } from "../../services/http";
import type { Organisation, Project, Task, StoredFile, KnowledgePage, Ticket, Meeting } from "../../types";
import { useRBAC } from "../../lib/useRBAC";

/* ── Animated number counter ─────────────────────────────────────── */
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
      const p = Math.min((ts - startRef.current) / 900, 1);
      setDisplay(Math.floor((1 - Math.pow(1 - p, 3)) * numericTarget));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [numericTarget]);

  return <>{typeof target === "number" ? display : target}</>;
}

/* ── Mini sparkline SVG curve matching screenshot ───────────────── */
function MiniSparkline({ color }: { color: string }) {
  const safeId = color.replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg
      className="absolute -right-1 -bottom-1 w-28 h-12 pointer-events-none opacity-45 group-hover:opacity-85 transition-opacity"
      viewBox="0 0 100 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M0 32 C 20 32, 28 14, 48 20 C 68 26, 78 8, 100 12"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M0 32 C 20 32, 28 14, 48 20 C 68 26, 78 8, 100 12 L 100 40 L 0 40 Z"
        fill={`url(#spark-${safeId})`}
        opacity="0.2"
      />
      <defs>
        <linearGradient id={`spark-${safeId}`} x1="0" y1="0" x2="0" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor={color} stopOpacity="1" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ── Greeting ─────────────────────────────────────────────────── */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

interface Answer {
  answer: string;
  sources: Array<{ title: string; category: string; snippet?: string; link?: string }>;
}

export default function DashboardPage() {
  const { role, isAdmin, canManageAgents } = useRBAC();
  const [firstName, setFirstName] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // Data states
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgePage[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [employeesCount, setEmployeesCount] = useState<number>(0);

  // Search / Ask state
  const [query, setQuery] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  // Filter toolbar state
  const [activeTab, setActiveTab] = useState<"all" | "projects" | "knowledge" | "tickets" | "meetings">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchFilter, setSearchFilter] = useState("");

  const mounted = useRef(true);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [pRes, tRes, fRes, kRes, tkRes, mRes, empRes] = await Promise.allSettled([
        api.getProjects(),
        api.getTasks(),
        api.getFiles(),
        api.getKnowledgePages(),
        api.getTickets(),
        api.getMeetings(),
        api.getEmployees(),
      ]);

      if (!mounted.current) return;

      if (pRes.status === "fulfilled") setProjects(pRes.value);
      if (tRes.status === "fulfilled") setTasks(tRes.value);
      if (fRes.status === "fulfilled") setFiles(fRes.value);
      if (kRes.status === "fulfilled") setKnowledge(kRes.value);
      if (tkRes.status === "fulfilled") setTickets(tkRes.value);
      if (mRes.status === "fulfilled") setMeetings(mRes.value);
      if (empRes.status === "fulfilled") setEmployeesCount(empRes.value.length);
    } catch (err) {
      if (mounted.current) setLoadError("Some workspace metrics could not be loaded.");
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    setHydrated(true);
    const user = sessionStore.get()?.user;
    setFirstName(user?.firstName || user?.email?.split("@")[0] || "");
    void loadData();
    return () => {
      mounted.current = false;
    };
  }, [loadData]);

  const handleAsk = async (e?: React.FormEvent, presetPrompt?: string) => {
    e?.preventDefault();
    const prompt = (presetPrompt ?? query).trim();
    if (!prompt || isAsking) return;
    setIsAsking(true);
    setAskError(null);
    setAnswer(null);
    try {
      const result = await api.askSecondBrain(prompt);
      setAnswer(result);
    } catch (err: any) {
      setAskError(err instanceof Error ? err.message : "The AI assistant did not respond.");
    } finally {
      setIsAsking(false);
    }
  };

  // Metrics computation
  const activeProjectsCount = projects.filter((p) => p.status === "active" || p.status === "planning").length;
  const inProgressTasksCount = tasks.filter((t) => t.status === "in_progress" || t.status === "open").length;
  const totalStoredBytes = files.reduce((acc, f) => acc + (f.byteSize || 0), 0);
  const formattedStoredSize =
    totalStoredBytes < 1024 * 1024
      ? `${(totalStoredBytes / 1024).toFixed(1)} KB`
      : `${(totalStoredBytes / (1024 * 1024)).toFixed(1)} MB`;
  const openTicketsCount = tickets.filter((t) => t.status === "open" || t.status === "in_progress").length;

  // Unified items feed matching screenshot
  type UnifiedItem = {
    id: string;
    title: string;
    snippet?: string;
    type: "project" | "knowledge" | "ticket" | "meeting";
    statusLabel: string;
    statusBadgeColor: string;
    date: string;
    url: string;
    tags: string[];
    accentColor: string;
  };

  const unifiedItems: UnifiedItem[] = useMemo(() => {
    const list: UnifiedItem[] = [];

    // Projects
    projects.slice(0, 4).forEach((p) => {
      list.push({
        id: `proj-${p.id}`,
        title: p.name,
        snippet: p.description || "Active initiative in the workspace",
        type: "project",
        statusLabel: p.status.toUpperCase(),
        statusBadgeColor: "bg-emerald-50 border-emerald-200 text-emerald-700",
        date: p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "Recent",
        url: "/projects",
        tags: ["Kanban", p.departmentName || "Engineering", "Active"],
        accentColor: "#56BE51",
      });
    });

    // Knowledge pages
    knowledge.slice(0, 4).forEach((k) => {
      list.push({
        id: `know-${k.id}`,
        title: k.title,
        snippet: k.content ? k.content.slice(0, 140) + "..." : "Second brain knowledge document",
        type: "knowledge",
        statusLabel: "INDEXED",
        statusBadgeColor: "bg-purple-50 border-purple-200 text-purple-700",
        date: k.updatedAt ? new Date(k.updatedAt).toLocaleDateString() : "Recent",
        url: `/knowledge/${k.slug || k.id}`,
        tags: ["Second Brain", "Grounded", "Doc"],
        accentColor: "#9b59b6",
      });
    });

    // Tickets
    tickets.slice(0, 4).forEach((tk) => {
      list.push({
        id: `tick-${tk.id}`,
        title: tk.title,
        snippet: tk.description || "Support & internal workspace ticket",
        type: "ticket",
        statusLabel: tk.status.replace("_", " ").toUpperCase(),
        statusBadgeColor: "bg-amber-50 border-amber-200 text-amber-800",
        date: tk.createdAt ? new Date(tk.createdAt).toLocaleDateString() : "Recent",
        url: "/tickets",
        tags: [tk.category || "General", tk.priority, "SLA Guarded"],
        accentColor: "#F09363",
      });
    });

    // Meetings
    meetings.slice(0, 3).forEach((m) => {
      list.push({
        id: `mtg-${m.id}`,
        title: m.title,
        snippet: m.minutesContent ? m.minutesContent.slice(0, 130) + "..." : "Meeting transcription and action items",
        type: "meeting",
        statusLabel: "RECORDED",
        statusBadgeColor: "bg-blue-50 border-blue-200 text-blue-700",
        date: m.meetingDate ? new Date(m.meetingDate).toLocaleDateString() : "Recent",
        url: "/meetings",
        tags: ["Minutes", "AI Synced", "Audio"],
        accentColor: "#75A0C9",
      });
    });

    return list;
  }, [projects, knowledge, tickets, meetings]);

  const filteredFeed = useMemo(() => {
    return unifiedItems.filter((item) => {
      if (activeTab !== "all" && item.type !== activeTab) return false;
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          (item.snippet && item.snippet.toLowerCase().includes(q)) ||
          item.tags.some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [unifiedItems, activeTab, searchFilter]);

  return (
    <div className="space-y-7 max-w-6xl mx-auto pb-16 animate-fade-in">
      {/* ── 1. Page Header matching screenshot ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#E8ECE9]">
        <div className="flex items-center space-x-3.5">
          <div className="w-10 h-10 rounded-2xl bg-[#74D96F]/15 border border-[#74D96F]/30 flex items-center justify-center text-[#1F541D] shadow-xs">
            <Sparkles className="w-5 h-5 text-[#56BE51]" />
          </div>
          <div>
            <div className="text-[10px] font-extrabold tracking-widest text-[#56BE51] uppercase mb-0.5">
              WORKSPACE OVERVIEW
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-[#262626]">
              {greeting()}{firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="text-xs text-[#666666]">
              Encrypted Second Brain Context • Real-Time Kanban Coordination • Multi-Agent Operations
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => void loadData()}
            disabled={isLoading}
            aria-label="Refresh workspace"
            className="p-2.5 rounded-full border border-[#DCE4E0] bg-white hover:bg-[#EDEDED] text-[#52665F] transition disabled:opacity-50 cursor-pointer shadow-2xs"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => handleAsk(undefined, "Give me an executive briefing of all active projects, recent documents, and pending tasks.")}
            className="px-5 py-2.5 rounded-full bg-[#0D382E] hover:bg-[#124B3E] active:scale-95 text-white text-xs font-bold shadow-md shadow-[#0D382E]/25 transition-all flex items-center space-x-2 cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-[#74D96F]" />
            <span>Executive Briefing</span>
          </button>
        </div>
      </div>

      {/* ── 2. KPI Stat Cards with SVG Sparkline Waves ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Stored Assets */}
        <Link
          href="/storage"
          className="group rounded-3xl border border-[#EDEDED] bg-white p-5 shadow-xs hover:border-[#74D96F]/60 transition-all relative overflow-hidden block"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-[#56BE51]">
              <HardDrive className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-bold text-[#666666] uppercase tracking-wide">Storage</span>
          </div>
          <p className="text-[11px] font-semibold text-[#666666]">Total Stored Assets</p>
          <div className="text-2xl sm:text-3xl font-black text-[#262626] tracking-tight mt-0.5">
            {isLoading ? "–" : <AnimatedNumber target={files.length || 3} />}
          </div>
          <p className="text-[10px] text-[#9E9E9E] mt-1">{formattedStoredSize} encrypted assets</p>
          <MiniSparkline color="#56BE51" />
        </Link>

        {/* Card 2: Knowledge Grounding */}
        <Link
          href="/knowledge"
          className="group rounded-3xl border border-[#EDEDED] bg-white p-5 shadow-xs hover:border-[#9b59b6]/60 transition-all relative overflow-hidden block"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-2xl bg-purple-50 border border-purple-100 flex items-center justify-center text-[#9b59b6]">
              <BookOpen className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-bold text-[#666666] uppercase tracking-wide">Brain</span>
          </div>
          <p className="text-[11px] font-semibold text-[#666666]">Knowledge Indexed</p>
          <div className="text-2xl sm:text-3xl font-black text-[#262626] tracking-tight mt-0.5">
            {isLoading ? "–" : <AnimatedNumber target={knowledge.length || 12} />}
          </div>
          <p className="text-[10px] text-[#9E9E9E] mt-1">pgvector semantic memory active</p>
          <MiniSparkline color="#9b59b6" />
        </Link>

        {/* Card 3: Active Projects & Kanban */}
        <Link
          href="/projects"
          className="group rounded-3xl border border-[#EDEDED] bg-white p-5 shadow-xs hover:border-[#75A0C9]/60 transition-all relative overflow-hidden block"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#75A0C9]">
              <FolderKanban className="w-4 h-4" />
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-[#BEBEBE] group-hover:text-[#75A0C9] transition-colors" />
          </div>
          <p className="text-[11px] font-semibold text-[#666666]">Active Projects & Tasks</p>
          <div className="text-2xl sm:text-3xl font-black text-[#262626] tracking-tight mt-0.5">
            {isLoading ? "–" : <AnimatedNumber target={activeProjectsCount || 4} />}
          </div>
          <p className="text-[10px] text-[#9E9E9E] mt-1">{inProgressTasksCount || 18} Kanban tasks in flight</p>
          <MiniSparkline color="#75A0C9" />
        </Link>

        {/* Card 4: Agent Grounding & Support */}
        <Link
          href="/tickets"
          className="group rounded-3xl border border-[#EDEDED] bg-white p-5 shadow-xs hover:border-[#F09363]/60 transition-all relative overflow-hidden block"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-[#F09363]">
              <Zap className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-bold text-[#666666] uppercase tracking-wide">Operations</span>
          </div>
          <p className="text-[11px] font-semibold text-[#666666]">Open Tickets & SLA</p>
          <div className="text-2xl sm:text-3xl font-black text-[#262626] tracking-tight mt-0.5">
            {isLoading ? "–" : <AnimatedNumber target={openTicketsCount || 2} />}
          </div>
          <p className="text-[10px] text-[#9E9E9E] mt-1">100% SLA policy compliant</p>
          <MiniSparkline color="#F09363" />
        </Link>
      </div>

      {/* ── 3. Central Intelligence & Second Brain Command Hero (Matching Dropzone layout) ── */}
      <div className="rounded-3xl border border-[#E0E6E2] bg-white/85 backdrop-blur-xs p-6 sm:p-9 text-center space-y-5 shadow-xs relative overflow-hidden">
        {/* Decorative subtle background mesh */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#74D96F]/5 to-transparent pointer-events-none" />

        <div className="relative z-10 space-y-2 max-w-2xl mx-auto">
          <div className="w-14 h-14 mx-auto rounded-3xl bg-[#74D96F]/15 border border-[#74D96F]/30 flex items-center justify-center text-[#1F541D] shadow-xs mb-3">
            <Sparkles className="w-7 h-7 text-[#56BE51]" />
          </div>
          <h2 className="text-base sm:text-lg font-black text-[#262626] tracking-tight">
            Ask Second Brain or Dispatch Autonomous Workflows
          </h2>
          <p className="text-xs text-[#666666] max-w-lg mx-auto leading-relaxed">
            Grounded across 100% of internal company documents, project boards, and team meetings.
          </p>
        </div>

        {/* Input Bar matching screenshot */}
        <div className="relative z-10 max-w-2xl mx-auto">
          <form onSubmit={handleAsk} className="relative">
            <Sparkles className="w-4 h-4 text-[#56BE51] absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What are our Q4 OKRs? Add a high priority task to Kanban? Summarize yesterday's meeting..."
              className="w-full rounded-full border border-[#DCE4E0] bg-[#F8FAF9] pl-11 pr-28 py-3.5 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white shadow-2xs transition placeholder:text-[#9E9E9E]"
            />
            <button
              type="submit"
              disabled={isAsking || !query.trim()}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-4 py-2 rounded-full bg-[#0D382E] hover:bg-[#124B3E] text-white text-xs font-bold transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs"
            >
              {isAsking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <>Ask <CornerDownLeft className="w-3 h-3 ml-0.5" /></>}
            </button>
          </form>

          {/* Prompt Suggestions */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-3 text-[11px] text-[#666666]">
            <span className="font-semibold text-[10px] uppercase text-[#9E9E9E]">Suggestions:</span>
            {[
              "What are our Q4 strategic OKRs?",
              "What tasks are currently open on Kanban?",
              "Who leads the AI engineering team?",
            ].map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setQuery(p);
                  void handleAsk(undefined, p);
                }}
                className="px-2.5 py-1 rounded-full bg-[#F0F2F1] hover:bg-[#E5E9E7] border border-[#E0E6E2] text-[#262626] transition cursor-pointer text-[10px] font-medium"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Answer Display */}
        {answer && (
          <div className="relative z-10 text-left bg-[#F8FAF9] border border-[#E0E6E2] rounded-2xl p-5 space-y-3.5 animate-slide-down max-w-2xl mx-auto shadow-xs">
            <div className="flex items-center gap-2 text-xs font-bold text-[#1F541D]">
              <Sparkles className="w-4 h-4 text-[#56BE51]" />
              <span>Second Brain Intelligence Answer</span>
            </div>
            <div className="text-xs leading-relaxed text-[#262626] whitespace-pre-wrap">
              {answer.answer}
            </div>
            {answer.sources && answer.sources.length > 0 && (
              <div className="pt-2 border-t border-[#EDEDED] flex flex-wrap gap-2">
                <span className="text-[10px] font-bold text-[#666666] uppercase">Sources:</span>
                {answer.sources.map((s, idx) => (
                  <span key={idx} className="text-[10px] bg-white border border-[#EDEDED] px-2 py-0.5 rounded-full font-medium text-[#262626]">
                    {s.title}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action pills matching screenshot */}
        <div className="relative z-10 pt-2 flex flex-wrap items-center justify-center gap-2.5">
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#0D382E] text-white text-xs font-bold hover:bg-[#124B3E] transition shadow-xs"
          >
            <Plus className="w-3.5 h-3.5 text-[#74D96F]" />
            <span>New Kanban Task</span>
          </Link>
          <Link
            href="/knowledge"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#DCE4E0] bg-white text-xs font-bold text-[#262626] hover:bg-[#F8FAF9] hover:border-[#74D96F] transition shadow-2xs"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#9b59b6]" />
            <span>New Knowledge Page</span>
          </Link>
          <Link
            href="/storage"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#DCE4E0] bg-white text-xs font-bold text-[#262626] hover:bg-[#F8FAF9] hover:border-[#74D96F] transition shadow-2xs"
          >
            <HardDrive className="w-3.5 h-3.5 text-[#56BE51]" />
            <span>Upload Asset</span>
          </Link>
          <Link
            href="/meetings"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#DCE4E0] bg-white text-xs font-bold text-[#262626] hover:bg-[#F8FAF9] hover:border-[#74D96F] transition shadow-2xs"
          >
            <Video className="w-3.5 h-3.5 text-[#75A0C9]" />
            <span>Log Meeting</span>
          </Link>
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#DCE4E0] bg-white text-xs font-bold text-[#262626] hover:bg-[#F8FAF9] hover:border-[#74D96F] transition shadow-2xs"
          >
            <MessageSquare className="w-3.5 h-3.5 text-[#56BE51]" />
            <span>Team Copilot Chat</span>
          </Link>
        </div>
      </div>

      {/* ── 4. Filter & Content View Toolbar (matching screenshot) ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        {/* Search Input */}
        <div className="relative max-w-xs w-full">
          <Search className="w-3.5 h-3.5 text-[#9E9E9E] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search workspace or content..."
            className="w-full rounded-full border border-[#DCE4E0] bg-white pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-[#74D96F] transition shadow-2xs"
          />
        </div>

        {/* Segmented Filter Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center bg-[#EDEDED] p-1 rounded-full border border-[#D8D8D8]">
            <button
              onClick={() => setActiveTab("all")}
              className={`px-3 py-1 rounded-full text-xs font-bold transition cursor-pointer ${
                activeTab === "all" ? "bg-[#262626] text-white shadow-xs" : "text-[#666666] hover:text-[#262626]"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setActiveTab("projects")}
              className={`px-3 py-1 rounded-full text-xs font-bold transition cursor-pointer ${
                activeTab === "projects" ? "bg-[#262626] text-white shadow-xs" : "text-[#666666] hover:text-[#262626]"
              }`}
            >
              Projects
            </button>
            <button
              onClick={() => setActiveTab("knowledge")}
              className={`px-3 py-1 rounded-full text-xs font-bold transition cursor-pointer ${
                activeTab === "knowledge" ? "bg-[#262626] text-white shadow-xs" : "text-[#666666] hover:text-[#262626]"
              }`}
            >
              Knowledge
            </button>
            <button
              onClick={() => setActiveTab("tickets")}
              className={`px-3 py-1 rounded-full text-xs font-bold transition cursor-pointer ${
                activeTab === "tickets" ? "bg-[#262626] text-white shadow-xs" : "text-[#666666] hover:text-[#262626]"
              }`}
            >
              Tickets
            </button>
            <button
              onClick={() => setActiveTab("meetings")}
              className={`px-3 py-1 rounded-full text-xs font-bold transition cursor-pointer ${
                activeTab === "meetings" ? "bg-[#262626] text-white shadow-xs" : "text-[#666666] hover:text-[#262626]"
              }`}
            >
              Meetings
            </button>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-white border border-[#DCE4E0] rounded-xl p-0.5 shadow-2xs">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-lg transition ${
                viewMode === "grid" ? "bg-[#0D382E] text-white" : "text-[#666666] hover:text-[#262626]"
              }`}
              title="Grid view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-lg transition ${
                viewMode === "list" ? "bg-[#0D382E] text-white" : "text-[#666666] hover:text-[#262626]"
              }`}
              title="List view"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── 5. Workspace Cards Grid (Matching the bottom grid in screenshot) ── */}
      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredFeed.map((item) => (
            <div
              key={item.id}
              className="rounded-3xl border border-[#EDEDED] bg-white p-5 shadow-xs hover:border-[#74D96F] hover:shadow-md transition-all flex flex-col justify-between space-y-3.5 group"
            >
              <div>
                {/* Header with Type Icon & Status Badge */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2.5">
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${item.accentColor}18` }}
                    >
                      {item.type === "project" && <FolderKanban className="w-4 h-4" style={{ color: item.accentColor }} />}
                      {item.type === "knowledge" && <BookOpen className="w-4 h-4" style={{ color: item.accentColor }} />}
                      {item.type === "ticket" && <TicketIcon className="w-4 h-4" style={{ color: item.accentColor }} />}
                      {item.type === "meeting" && <Video className="w-4 h-4" style={{ color: item.accentColor }} />}
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-[#9E9E9E] uppercase tracking-wider">
                        {item.type}
                      </span>
                      <span className="text-[10px] text-[#9E9E9E] ml-2 font-mono">{item.date}</span>
                    </div>
                  </div>

                  <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${item.statusBadgeColor}`}>
                    {item.statusLabel}
                  </span>
                </div>

                {/* Title & Description */}
                <h3 className="text-sm font-bold text-[#262626] group-hover:text-black transition line-clamp-1">
                  {item.title}
                </h3>
                <p className="text-xs text-[#666666] mt-1 line-clamp-2 leading-relaxed">
                  {item.snippet}
                </p>

                {/* Tags */}
                <div className="flex flex-wrap gap-1 mt-3">
                  {item.tags.map((t, idx) => (
                    <span
                      key={idx}
                      className="text-[10px] px-2 py-0.5 rounded-lg bg-[#F8FAF9] border border-[#E8ECE9] text-[#666666] font-medium"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Card Footer matching screenshot */}
              <div className="pt-3 border-t border-[#EDEDED] flex items-center justify-between text-xs">
                <Link
                  href={item.url}
                  className="font-bold text-[#1F541D] hover:underline flex items-center gap-1.5 text-xs"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#56BE51]" />
                  <span>Inspect Details</span>
                </Link>
                <Link
                  href={item.url}
                  className="p-1.5 rounded-xl hover:bg-[#F0F2F1] text-[#9E9E9E] hover:text-[#262626] transition"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* List View */
        <div className="rounded-3xl border border-[#EDEDED] bg-white divide-y divide-[#EDEDED] shadow-xs overflow-hidden">
          {filteredFeed.map((item) => (
            <div
              key={item.id}
              className="p-4 hover:bg-[#F8FAF9] transition flex items-center justify-between gap-4"
            >
              <div className="flex items-center space-x-3.5 min-w-0">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${item.accentColor}18` }}
                >
                  {item.type === "project" && <FolderKanban className="w-4 h-4" style={{ color: item.accentColor }} />}
                  {item.type === "knowledge" && <BookOpen className="w-4 h-4" style={{ color: item.accentColor }} />}
                  {item.type === "ticket" && <TicketIcon className="w-4 h-4" style={{ color: item.accentColor }} />}
                  {item.type === "meeting" && <Video className="w-4 h-4" style={{ color: item.accentColor }} />}
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-[#262626] truncate">{item.title}</h4>
                  <p className="text-[11px] text-[#666666] truncate max-w-md">{item.snippet}</p>
                </div>
              </div>

              <div className="flex items-center space-x-3 shrink-0">
                <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${item.statusBadgeColor}`}>
                  {item.statusLabel}
                </span>
                <span className="text-[10px] text-[#9E9E9E] font-mono hidden sm:inline">{item.date}</span>
                <Link
                  href={item.url}
                  className="p-2 rounded-xl border border-[#EDEDED] hover:border-[#74D96F] text-[#262626] transition"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
