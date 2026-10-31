"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ChevronDown,
  Brain,
  Zap,
  Globe,
  Shield,
  ArrowRight,
  BarChart3,
  MessageSquare,
  Users,
  FolderKanban,
  Video,
  Bot,
  CheckCircle2,
} from "lucide-react";

/* ──────────────────────────────────────────
   Animated counter
────────────────────────────────────────── */
function useCounter(target: number, duration = 1800) {
  const [count, setCount] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    const step = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const p = Math.min((ts - startRef.current) / duration, 1);
      setCount(Math.floor((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return count;
}

/* ──────────────────────────────────────────
   Feature Card (below fold)
────────────────────────────────────────── */
interface FCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  accent?: string;
  delay?: number;
}
function FeatureCard({ icon: Icon, title, description, accent = "#74D96F", delay = 0 }: FCardProps) {
  const [vis, setVis] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVis(true); }, { threshold: 0.12 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className="group relative bg-white rounded-3xl p-7 border border-[#EDEDED] hover:border-[#BEBEBE] cursor-default"
      style={{
        opacity: vis ? 1 : 0,
        transform: vis ? "translateY(0)" : "translateY(24px)",
        transition: `opacity 0.55s ease ${delay}ms, transform 0.55s ease ${delay}ms, border-color 0.25s`,
      }}
    >
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-5 transition-transform group-hover:scale-110" style={{ backgroundColor: `${accent}1a` }}>
        <Icon className="w-5 h-5" style={{ color: accent }} />
      </div>
      <h3 className="text-[0.9375rem] font-bold text-[#1a1a1a] mb-2">{title}</h3>
      <p className="text-sm text-[#666] leading-relaxed">{description}</p>
      <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: `linear-gradient(90deg,transparent,${accent},transparent)` }} />
    </div>
  );
}

/* ──────────────────────────────────────────
   Navigation — exact Agno style
────────────────────────────────────────── */
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 bg-white transition-shadow duration-200 ${scrolled ? "shadow-[0_1px_0_#e8e8e8]" : "border-b border-[#ebebeb]"}`}>
      <div className="max-w-[1180px] mx-auto px-4 sm:px-6 h-[52px] flex items-center justify-between">

        {/* Logo — matches Agno angular icon + wordmark */}
        <Link href="/" className="flex items-center gap-2 group">
          {/* Custom angular logo matching Agno's bracket-style icon */}
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="shrink-0">
            <path d="M4 24 L14 4 L24 24" stroke="#74D96F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            <path d="M8.5 17 L19.5 17" stroke="#74D96F" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          <span className="font-extrabold text-[#1a1a1a] text-[1.1rem] tracking-tight leading-none">BizContext</span>
        </Link>

        {/* Center nav links */}
        <nav className="hidden md:flex items-center gap-0.5">
          {[
            { label: "Products", drop: true },
            { label: "Resources", drop: true },
            { label: "Pricing", drop: false },
            { label: "Enterprise", drop: false },
          ].map((item) => (
            <a key={item.label} href="#" className="flex items-center gap-0.5 px-3.5 py-2 text-[0.875rem] text-[#444] hover:text-[#1a1a1a] font-medium rounded-lg hover:bg-[#f5f5f5] transition-colors">
              {item.label}
              {item.drop && <ChevronDown className="w-3.5 h-3.5 text-[#888] mt-px" />}
            </a>
          ))}
        </nav>

        {/* Right CTA pair */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Link href="/login" className="px-3 sm:px-4 py-1.5 text-[0.75rem] sm:text-[0.8125rem] font-semibold text-[#333] border border-[#ccc] rounded-md hover:border-[#aaa] hover:text-[#1a1a1a] transition-all tracking-wide uppercase">
            Login
          </Link>
          <Link href="/dashboard" className="px-3 sm:px-4 py-1.5 text-[0.75rem] sm:text-[0.8125rem] font-semibold text-white rounded-md transition-all tracking-wide uppercase hover:opacity-90" style={{ backgroundColor: "#74D96F", color: "#1a1a1a" }}>
            Sign Up
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ──────────────────────────────────────────
   Main Page
────────────────────────────────────────── */
export default function LandingPage() {
  const [vis, setVis] = useState(false);
  useEffect(() => { setTimeout(() => setVis(true), 60); }, []);

  const features = [
    { icon: Brain, title: "Second Brain for Your Org", description: "A living knowledge graph that ingests documents, meetings, and conversations — surfacing the right insight at the right moment.", accent: "#74D96F" },
    { icon: Bot, title: "Autonomous AI Agents", description: "Browser-capable B0–B4 agents that handle research, data extraction, and cross-system automation with human-in-the-loop approval gates.", accent: "#75A0C9" },
    { icon: FolderKanban, title: "Projects & Kanban", description: "AI-prioritized boards that auto-create tickets from meeting action items and keep stakeholders aligned without manual overhead.", accent: "#F09363" },
    { icon: Video, title: "Meeting Intelligence", description: "Upload recordings or stream live — AI extracts summaries, action items, decisions, and links them to existing projects.", accent: "#74D96F" },
    { icon: Users, title: "People & CV Intelligence", description: "Parse CVs, map skills, and surface team expertise instantly. Find the right person for every task inside your organisation.", accent: "#75A0C9" },
    { icon: BarChart3, title: "Operational Analytics", description: "Real-time SLA dashboards, audit logs, and AI-generated trend reports that turn raw data into actionable intelligence.", accent: "#F09363" },
    { icon: MessageSquare, title: "Unified Channels", description: "Chat, threads, and announcements — all searchable by the Second Brain. Never lose context across conversations again.", accent: "#74D96F" },
    { icon: Shield, title: "Zero-Trust Security", description: "End-to-end encryption, role-based access, SOC2 Type II compliant infrastructure built for enterprise organisations.", accent: "#56BE51" },
  ];

  const stats = [
    { value: 2400, suffix: "+", label: "Teams worldwide" },
    { value: 98, suffix: "%", label: "SLA accuracy" },
    { value: 12, suffix: "M+", label: "Tasks automated" },
    { value: 40, suffix: "+", label: "Integrations" },
  ];

  const logos = ["a.team", "MESH", "L'ANX", "KEYDATA", "Delphi", "Qiio", "MIYOHealth", "IBM", "Yahoo"];

  return (
    <div className="min-h-screen bg-white text-[#1a1a1a] antialiased" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <style>{`
        @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <Nav />

      {/* ══════════════════════════════════════════
          HERO — exact Agno layout
      ══════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-white" style={{ minHeight: "calc(100vh - 52px)", marginTop: "52px" }}>

        {/* ── Agno-exact diagonal gray polygon ── */}
        {/* Large angular shape bottom-left to mid area */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "linear-gradient(160deg, #f3f3f0 0%, #eeede9 35%, transparent 55%)",
            clipPath: "polygon(0 0, 62% 0, 38% 100%, 0 100%)",
          }}
        />
        {/* Secondary lighter sweep */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "linear-gradient(145deg, #f8f8f5 0%, #f1f0ec 20%, transparent 45%)",
            clipPath: "polygon(0 0, 48% 0, 28% 100%, 0 100%)",
          }}
        />

        {/* ── Content grid ── */}
        <div className="relative max-w-[1180px] mx-auto px-4 sm:px-6 flex flex-col lg:flex-row items-start lg:items-center h-full min-h-[calc(100vh-52px)]">

          {/* ── LEFT: Hero text ── */}
          <div
            className="relative z-10 flex-none w-full lg:w-[42%] pt-12 sm:pt-16 lg:pt-0 pb-8 lg:pb-0"
            style={{ opacity: vis ? 1 : 0, transform: vis ? "none" : "translateY(20px)", transition: "opacity 0.6s ease, transform 0.6s ease" }}
          >
            {/* Massive headline — Agno style: plain black, two lines */}
            <h1
              className="font-extrabold text-[#0d0d0d] leading-[1.08] tracking-[-0.035em] mb-5 text-3xl sm:text-4xl md:text-5xl lg:text-[3.5rem]"
            >
              Build your own<br />
              <span className="text-[#74D96F]">AI workspace</span>
            </h1>

            {/* Body — Agno style: small, gray, tight */}
            <p className="text-[#555] text-[0.9375rem] leading-[1.65] mb-8 max-w-md lg:max-w-[340px]">
              BizContext is a self-driving AI workspace that runs in your org. Build intelligent agents, automate operations, and let your team move at the speed of thought.
            </p>

            {/* CTAs — exact Agno layout: filled button + ghost text button inline */}
            <div className="flex items-center gap-4 flex-wrap">
              <Link
                href="/dashboard"
                className="inline-flex items-center px-5 py-2.5 rounded-md font-bold text-[0.875rem] tracking-wide uppercase text-[#1a1a1a] transition-all hover:opacity-90 hover:-translate-y-px"
                style={{ backgroundColor: "#74D96F", boxShadow: "0 2px 12px rgba(116,217,111,0.35)" }}
              >
                Get Started
              </Link>
              <button className="inline-flex items-center gap-1.5 text-[0.875rem] font-semibold text-[#444] hover:text-[#1a1a1a] transition-colors uppercase tracking-wide">
                Explore Features
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* ── RIGHT: App Screenshot — Agno style ── */}
          <div
            className="flex-1 relative lg:absolute lg:right-0 lg:top-0 lg:bottom-0 flex items-start lg:items-center w-full lg:w-auto"
            style={{
              opacity: vis ? 1 : 0,
              transform: vis ? "none" : "translateY(12px)",
              transition: "opacity 0.75s ease 0.12s, transform 0.75s ease 0.12s",
            }}
          >
            {/* The screenshot panel — dark frame, responsive width */}
            <div
              className="relative w-full max-w-[720px] lg:w-[clamp(420px,58vw,720px)] ml-auto mt-6 lg:mt-[52px] mb-12 lg:mb-0"
            >
              {/* Outer dark rounded frame */}
              <div
                className="overflow-hidden rounded-2xl lg:rounded-r-none border border-[#2a2a2a] lg:border-r-0"
                style={{
                  boxShadow: "-24px 24px 80px rgba(0,0,0,0.22), -4px 0 40px rgba(0,0,0,0.12)",
                }}
              >
                {/* Dark title bar — matches Agno's dark app chrome */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-[#1c1c1c] border-b border-[#303030]">
                  <div className="flex gap-1.5 shrink-0">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                    <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                    <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                  </div>
                  <div className="flex-1 flex items-center justify-center">
                    <div className="flex items-center gap-2 bg-[#2a2a2a] border border-[#3a3a3a] rounded px-3 py-0.5 max-w-[200px] w-full">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#74D96F]" />
                      <span className="text-[10px] text-[#777] font-mono truncate">bizcontext.ai/projects</span>
                    </div>
                  </div>
                </div>

                {/* Actual screenshot */}
                <Image
                  src="/app-screenshot.png"
                  alt="BizContext AI workspace — Projects & Kanban"
                  width={1008}
                  height={504}
                  className="w-full h-auto block"
                  priority
                  style={{ display: "block" }}
                />
              </div>

              {/* Floating status pill — subtle badge */}
              <div className="absolute -bottom-4 left-4 sm:left-6 bg-white border border-[#e8e8e8] rounded-full px-3 py-1 sm:px-3.5 sm:py-1.5 flex items-center gap-2 shadow-[0_4px_24px_rgba(0,0,0,0.1)]">
                <div className="w-2 h-2 rounded-full bg-[#74D96F] animate-pulse" />
                <span className="text-[10px] sm:text-[11px] font-semibold text-[#444]">4 agents running now</span>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ══════════════════════════════════════════
          LOGO MARQUEE — exact Agno bottom strip
      ══════════════════════════════════════════ */}
      <div className="border-t border-[#ebebeb] bg-white py-8 overflow-hidden">
        <div style={{ display: "flex", animation: "marquee 28s linear infinite", width: "max-content" }}>
          {[...logos, ...logos].map((name, i) => (
            <span key={i} className="inline-block mx-10 text-[#c4c4c4] font-bold text-[0.8125rem] tracking-[0.08em] uppercase select-none whitespace-nowrap">
              {name}
            </span>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════
          STATS BAR
      ══════════════════════════════════════════ */}
      <section className="border-t border-[#ebebeb] bg-[#f9f9f7] py-14 px-6">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-10">
          {stats.map((s) => {
            const c = useCounter(s.value);
            return (
              <div key={s.label} className="text-center">
                <div className="text-4xl font-extrabold tracking-tighter text-[#1a1a1a]">
                  {c.toLocaleString()}<span className="text-[#74D96F]">{s.suffix}</span>
                </div>
                <div className="mt-1 text-sm text-[#777] font-medium">{s.label}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ══════════════════════════════════════════
          HOW IT WORKS
      ══════════════════════════════════════════ */}
      <section className="py-24 px-6 max-w-[1180px] mx-auto">
        <div className="text-center mb-16">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold tracking-wide border mb-5" style={{ background: "#74D96F1a", borderColor: "#74D96F4d", color: "#1a6e17" }}>
            <Zap className="w-3 h-3" /> Quick Setup
          </span>
          <h2 className="text-4xl font-extrabold tracking-[-0.03em] text-[#1a1a1a]">Up and running in minutes</h2>
          <p className="mt-3 text-[0.9375rem] text-[#666] max-w-sm mx-auto">No lengthy onboarding. Connect, learn, automate.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-10 relative">
          <div className="hidden md:block absolute top-9 left-[33%] right-[33%] h-px" style={{ background: "linear-gradient(90deg, #ebebeb, #74D96F80, #ebebeb)" }} />
          {[
            { step: "01", title: "Connect your tools", desc: "Integrate with Slack, Notion, Google Drive, Jira, and 40+ enterprise tools in minutes." },
            { step: "02", title: "Let AI learn your org", desc: "BizContext ingests knowledge, maps relationships, and builds an intelligent org-wide context graph." },
            { step: "03", title: "Work smarter, not harder", desc: "Ask questions in natural language, auto-generate reports, and deploy agents for repetitive workflows." },
          ].map((s, i) => (
            <div key={i} className="text-center group">
              <div className="inline-flex w-[60px] h-[60px] rounded-[20px] bg-white border-2 border-[#e8e8e8] group-hover:border-[#74D96F80] items-center justify-center mb-5 transition-all group-hover:shadow-[0_6px_24px_rgba(116,217,111,0.2)]">
                <span className="text-[1.1rem] font-extrabold text-[#74D96F]">{s.step}</span>
              </div>
              <h3 className="text-[1.0625rem] font-bold text-[#1a1a1a] mb-2">{s.title}</h3>
              <p className="text-sm text-[#666] leading-relaxed max-w-[240px] mx-auto">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FEATURES BENTO — Agno-inspired layout
      ══════════════════════════════════════════ */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-[1180px] mx-auto">

          {/* Section heading — left-aligned like Agno */}
          <h2 className="text-[2.25rem] md:text-[2.75rem] font-extrabold tracking-[-0.035em] text-[#1a1a1a] mb-10 max-w-xl">
            Your AI workspace belongs to you
          </h2>

          {/* ── TOP ROW: 3 columns ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

            {/* Card 1 — Floating model icons + "Use any AI model" */}
            <div className="relative rounded-2xl border border-[#e8e8e8] bg-[#fafaf8] overflow-hidden p-6 flex flex-col justify-between min-h-[320px] group hover:border-[#d0d0d0] transition-colors">
              {/* Floating icon cluster */}
              <div className="relative flex-1 mb-6">
                {/* Central large icon */}
                <div className="absolute top-6 left-1/2 -translate-x-1/2 w-14 h-14 rounded-2xl bg-[#74D96F] flex items-center justify-center shadow-[0_8px_32px_rgba(116,217,111,0.35)]">
                  <Brain className="w-7 h-7 text-white" />
                </div>
                {/* Satellite icons */}
                <div className="absolute top-2 left-8 w-9 h-9 rounded-xl bg-white border border-[#e8e8e8] flex items-center justify-center shadow-sm">
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none"><circle cx="12" cy="12" r="9" stroke="#666" strokeWidth="1.5"/><text x="12" y="16" textAnchor="middle" fontSize="8" fontWeight="700" fill="#666">AI</text></svg>
                </div>
                <div className="absolute top-12 right-6 w-9 h-9 rounded-xl bg-white border border-[#e8e8e8] flex items-center justify-center shadow-sm">
                  <Bot className="w-4 h-4 text-[#75A0C9]" />
                </div>
                <div className="absolute top-1 right-10 w-7 h-7 rounded-lg bg-white border border-[#e8e8e8] flex items-center justify-center shadow-sm text-[11px] font-bold text-[#666]">G</div>
                <div className="absolute bottom-4 left-6 w-7 h-7 rounded-lg bg-white border border-[#e8e8e8] flex items-center justify-center shadow-sm">
                  <Zap className="w-3.5 h-3.5 text-[#F09363]" />
                </div>
                {/* Crosshair */}
                <div className="absolute bottom-2 right-8 text-[#d0d0d0] text-lg select-none">✛</div>
              </div>
              <div>
                <h3 className="text-[1rem] font-bold text-[#1a1a1a] mb-1.5">Use any AI model or provider</h3>
                <p className="text-[0.8125rem] text-[#666] leading-relaxed">Native support for Gemini, Claude, GPT-4, and open-source LLMs. BizContext handles the complexity for you.</p>
              </div>
            </div>

            {/* Card 2 — Two stacked feature cards (middle column) */}
            <div className="rounded-2xl border border-[#e8e8e8] bg-white overflow-hidden flex flex-col divide-y divide-[#f0f0f0]">
              {/* Top half */}
              <div className="p-6 flex-1 hover:bg-[#fafaf8] transition-colors">
                <div className="w-8 h-8 rounded-lg bg-[#74D96F]/15 flex items-center justify-center mb-4">
                  <FolderKanban className="w-4 h-4 text-[#56BE51]" />
                </div>
                <h3 className="text-[0.9375rem] font-bold text-[#1a1a1a] mb-1.5">Use any framework or no framework</h3>
                <p className="text-[0.8125rem] text-[#666] leading-relaxed">Deploy standalone or integrate with your existing stack — Next.js, FastAPI, or raw REST endpoints.</p>
              </div>
              {/* Bottom half */}
              <div className="p-6 flex-1 hover:bg-[#fafaf8] transition-colors">
                <div className="w-8 h-8 rounded-lg bg-[#75A0C9]/15 flex items-center justify-center mb-4">
                  <Globe className="w-4 h-4 text-[#75A0C9]" />
                </div>
                <h3 className="text-[0.9375rem] font-bold text-[#1a1a1a] mb-1.5">Run in any cloud, on-premise or locally</h3>
                <p className="text-[0.8125rem] text-[#666] leading-relaxed">Your workspace runs wherever you need it — AWS, GCP, Azure, bare metal, or a developer laptop.</p>
              </div>
            </div>

            {/* Card 3 — Floating app icons + "You own your data" */}
            <div className="relative rounded-2xl border border-[#e8e8e8] bg-[#f5faf5] overflow-hidden p-6 flex flex-col justify-between min-h-[320px] group hover:border-[#74D96F40] transition-colors">
              {/* Floating connected icon cloud */}
              <div className="relative flex-1 mb-6">
                {/* Center app icon */}
                <div className="absolute top-8 left-1/2 -translate-x-1/2 w-14 h-14 rounded-2xl bg-[#74D96F] flex items-center justify-center shadow-[0_8px_32px_rgba(116,217,111,0.3)]">
                  <svg viewBox="0 0 24 24" className="w-7 h-7 text-white" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="8" strokeOpacity="0.4" strokeWidth="1.5" />
                    <path d="M7.5 12h8.5a4 4 0 0 0-4-4c-3.5 0-4.5 3-4.5 4s1 4 4.5 4c2.5 0 3.8-1.5 4-2.5" />
                  </svg>
                </div>
                {/* Orbiting feature icons */}
                <div className="absolute top-3 left-5 w-9 h-9 rounded-xl bg-white border border-[#e4e4e4] flex items-center justify-center shadow-sm"><Video className="w-4 h-4 text-[#666]" /></div>
                <div className="absolute top-3 right-5 w-9 h-9 rounded-xl bg-white border border-[#e4e4e4] flex items-center justify-center shadow-sm"><MessageSquare className="w-4 h-4 text-[#666]" /></div>
                <div className="absolute bottom-4 left-3 w-9 h-9 rounded-xl bg-white border border-[#e4e4e4] flex items-center justify-center shadow-sm"><BarChart3 className="w-4 h-4 text-[#666]" /></div>
                <div className="absolute bottom-4 right-3 w-9 h-9 rounded-xl bg-white border border-[#e4e4e4] flex items-center justify-center shadow-sm"><Users className="w-4 h-4 text-[#666]" /></div>
                {/* Dashed connecting lines via SVG overlay */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20" viewBox="0 0 200 160" preserveAspectRatio="none">
                  <line x1="100" y1="80" x2="30" y2="20" stroke="#74D96F" strokeWidth="1" strokeDasharray="4,3"/>
                  <line x1="100" y1="80" x2="170" y2="20" stroke="#74D96F" strokeWidth="1" strokeDasharray="4,3"/>
                  <line x1="100" y1="80" x2="20" y2="140" stroke="#74D96F" strokeWidth="1" strokeDasharray="4,3"/>
                  <line x1="100" y1="80" x2="180" y2="140" stroke="#74D96F" strokeWidth="1" strokeDasharray="4,3"/>
                </svg>
              </div>
              <div>
                <h3 className="text-[1rem] font-bold text-[#1a1a1a] mb-1.5">You own your data</h3>
                <p className="text-[0.8125rem] text-[#666] leading-relaxed">Your data stays in your database — your second brain, your knowledge graph. Use it to power your learning loop.</p>
              </div>
            </div>
          </div>

          {/* ── BOTTOM ROW: 2 wide columns ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Card 4 — Endpoint tags + pricing */}
            <div className="rounded-2xl border border-[#e8e8e8] bg-white overflow-hidden p-6 flex flex-col gap-5">
              {/* Tag cloud */}
              <div className="flex flex-wrap gap-2">
                {["Knowledge Graph","MCP Server","Agent Harness","Structured Outputs","Gemini","Checkpointing","Durable Runtime","Event Buffering","Run Control","Rate Limits","Run History","Schedules","Metrics","Webhooks","OpenAI Compat"].map((tag) => (
                  <span key={tag} className="text-[11px] px-2.5 py-1 rounded-md border border-[#e8e8e8] bg-[#fafaf8] text-[#555] font-medium whitespace-nowrap">{tag}</span>
                ))}
              </div>
              {/* Big number */}
              <div>
                <div className="text-[2.5rem] font-extrabold tracking-tighter text-[#1a1a1a] leading-none">40+</div>
                <div className="text-[0.9375rem] font-semibold text-[#555] mt-0.5">Integrations</div>
              </div>
              <div className="border-t border-[#f0f0f0] pt-5">
                <h3 className="text-[1rem] font-bold text-[#1a1a1a] mb-1.5">Production concerns, handled end-to-end</h3>
                <p className="text-[0.8125rem] text-[#666] leading-relaxed mb-5">Agents are stateful, distributed services that are hard to run well. Our platform handles that so your team ships features.</p>
                {/* Pricing rows */}
                <div className="rounded-xl border border-[#f0f0f0] overflow-hidden">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-[#f0f0f0]">
                    <div>
                      <span className="text-[1.75rem] font-extrabold text-[#1a1a1a] leading-none">$0</span>
                      <div className="text-[11px] text-[#888] font-medium mt-0.5">hidden bills</div>
                    </div>
                    <div className="space-y-1.5 text-left sm:text-right">
                      {[["Storage","Unlimited"],["Retention","Unlimited"],["Audit Logs","Unlimited"]].map(([k,v]) => (
                        <div key={k} className="flex items-center sm:justify-end gap-3 text-[0.8125rem]">
                          <span className="text-[#888]">{k}</span>
                          <span className="font-bold text-[#74D96F]">{v}</span>
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#74D96F]" />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="px-4 py-3 bg-[#fafaf8]">
                    <div className="text-[0.875rem] font-bold text-[#1a1a1a] mb-0.5">Fixed pricing, no second bill</div>
                    <div className="text-[0.75rem] text-[#666]">We don&apos;t meter your data or compute. No storage fees, no retention fees, no per-trace charges.</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 5 — Governance table mockup */}
            <div className="rounded-2xl border border-[#e8e8e8] bg-white overflow-hidden flex flex-col">
              {/* Table mockup */}
              <div className="flex-1 p-6 pb-0">
                {/* Search bar */}
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#e8e8e8] bg-[#fafaf8] mb-4 text-[0.8125rem] text-[#aaa]">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  <span className="truncate">Search policies, roles, permissions…</span>
                </div>
                {/* Table wrapper */}
                <div className="overflow-x-auto -mx-2 px-2">
                  <div className="min-w-[280px]">
                    {/* Table header */}
                    <div className="grid grid-cols-3 text-[10px] font-bold text-[#aaa] uppercase tracking-widest px-3 mb-2">
                      <span>Resource</span><span>Type</span><span>Access</span>
                    </div>
                    {/* Table rows */}
                    {[
                      { name: "Knowledge Base", icon: <Brain className="w-3.5 h-3.5 text-[#74D96F] shrink-0"/>, type: "Role", access: "READ", color: "text-[#555]" },
                      { name: "Agent Registry", icon: <Bot className="w-3.5 h-3.5 text-[#75A0C9] shrink-0"/>, type: "Scope", access: "WRITE", color: "text-[#F09363]" },
                      { name: "Audit Logs", icon: <BarChart3 className="w-3.5 h-3.5 text-[#F09363] shrink-0"/>, type: "Policy", access: "ADMIN", color: "text-[#ED6B2D]" },
                      { name: "Browser Jobs", icon: <Globe className="w-3.5 h-3.5 text-[#666] shrink-0"/>, type: "Role", access: "APPROVE", color: "text-[#75A0C9]" },
                    ].map((row, i) => (
                      <div key={i} className={`grid grid-cols-3 items-center px-3 py-2.5 rounded-lg text-[0.8125rem] mb-1 ${i === 1 ? "bg-[#fafaf8] border border-[#f0f0f0]" : ""}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <input type="checkbox" readOnly className="w-3.5 h-3.5 rounded accent-[#74D96F] shrink-0" checked={i === 1} />
                          {row.icon}
                          <span className="font-medium text-[#1a1a1a] truncate">{row.name}</span>
                        </div>
                        <span className="text-[#888] truncate">{row.type}</span>
                        <span className={`font-bold text-xs ${row.color}`}>{row.access}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* Description footer */}
              <div className="p-6 pt-5 border-t border-[#f0f0f0] mt-4">
                <h3 className="text-[1rem] font-bold text-[#1a1a1a] mb-1.5">Governance built for agents</h3>
                <p className="text-[0.8125rem] text-[#666] leading-relaxed">Role-based access control, per-agent and per-tool permissions, user and admin approvals, audit logs and guardrails. Enforced at runtime.</p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FINAL CTA
      ══════════════════════════════════════════ */}
      <section className="py-24 px-6 bg-[#1a1a1a] relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[280px] rounded-full blur-[100px] pointer-events-none" style={{ background: "#74D96F0f" }} />
        <div className="relative max-w-[720px] mx-auto text-center">
          <h2 className="text-[2.5rem] md:text-[3rem] font-extrabold tracking-[-0.035em] text-white mb-5">
            Ready to give your org a <span style={{ color: "#74D96F" }}>Second Brain?</span>
          </h2>
          <p className="text-[0.9375rem] text-white/45 mb-10 max-w-md mx-auto leading-relaxed">Join 2,400+ teams. Start free, scale as you grow.</p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/dashboard" className="inline-flex items-center gap-2 px-8 py-3.5 rounded-md font-bold text-sm uppercase tracking-wide text-[#1a1a1a] transition-all hover:-translate-y-0.5" style={{ background: "#74D96F", boxShadow: "0 4px 24px rgba(116,217,111,0.35)" }}>
              Get Started — Free <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/login" className="inline-flex items-center gap-2 px-8 py-3.5 rounded-md border border-white/20 text-white font-bold text-sm uppercase tracking-wide hover:bg-white/10 transition-all">
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════ */}
      <footer className="bg-[#141414] px-6 py-9">
        <div className="max-w-[1180px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
              <path d="M4 24 L14 4 L24 24" stroke="#74D96F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <path d="M8.5 17 L19.5 17" stroke="#74D96F" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            <span className="text-white/65 text-sm font-semibold">BizContext AI</span>
          </div>
          <p className="text-white/22 text-xs">© 2026 BizContext AI · Built for Vyuham Hackathon</p>
          <div className="flex gap-6 text-[0.75rem] text-white/30 font-medium">
            {["Privacy", "Terms", "Security"].map((l) => <a key={l} href="#" className="hover:text-white/60 transition-colors">{l}</a>)}
          </div>
        </div>
      </footer>
    </div>
  );
}
