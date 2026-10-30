"use client";

import React, { useState } from "react";
import { Brain, Check, ChevronDown, Crown, Globe, Loader2, Search, XCircle } from "lucide-react";
import type { AgentKey, CouncilAgentState } from "./chatTypes";
import { Markdown } from "./Markdown";

const ICONS: Record<AgentKey, React.ElementType> = {
  knowledge: Brain,
  researcher: Search,
  browser: Globe,
  ceo: Crown,
};

const ACCENT: Record<AgentKey, string> = {
  knowledge: "#75A0C9",
  researcher: "#F09363",
  browser: "#9b59b6",
  ceo: "#56BE51",
};

function StatusIcon({ status }: { status: CouncilAgentState["status"] }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-[#56BE51]" aria-label="Working" />;
  if (status === "done") return <Check className="h-3.5 w-3.5 text-[#56BE51]" aria-label="Done" />;
  if (status === "error") return <XCircle className="h-3.5 w-3.5 text-rose-500" aria-label="Failed" />;
  return <span className="h-2 w-2 rounded-full bg-[#BEBEBE]" aria-label="Waiting" />;
}

function statusLabel(a: CouncilAgentState): string {
  if (a.status === "waiting") return a.id === "ceo" ? "Waits for the reports" : "Queued";
  if (a.status === "running") return a.toolCalls || a.tools.length ? "Working with tools…" : "Thinking…";
  if (a.status === "error") return a.error ?? "Failed";
  return a.toolCalls ? `Done · ${a.toolCalls} tool call${a.toolCalls > 1 ? "s" : ""}` : "Done";
}

export function CouncilPanel({ agents }: { agents: CouncilAgentState[] }) {
  const [open, setOpen] = useState<AgentKey | null>(null);
  const specialists = agents.filter((a) => a.id !== "ceo");
  const ceo = agents.find((a) => a.id === "ceo");
  const phase =
    ceo?.status === "running" || ceo?.status === "done" || ceo?.status === "error"
      ? "The CEO is deciding"
      : specialists.some((a) => a.status === "running")
        ? `${specialists.filter((a) => a.status === "running").length} agents working in parallel`
        : "Starting the council";

  const card = (a: CouncilAgentState) => {
    const Icon = ICONS[a.id];
    const expanded = open === a.id;
    const canExpand = a.text.trim().length > 0;
    return (
      <div key={a.id} className="rounded-2xl border border-[#EDEDED] bg-white">
        <button
          type="button"
          disabled={!canExpand}
          aria-expanded={expanded}
          onClick={() => setOpen(expanded ? null : a.id)}
          className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition enabled:hover:bg-[#F8F9FA] disabled:cursor-default"
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${ACCENT[a.id]}1f` }}
          >
            <Icon className="h-4 w-4" style={{ color: ACCENT[a.id] }} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold text-[#262626]">{a.name}</span>
            <span className={`block truncate text-[11px] ${a.status === "error" ? "text-rose-600" : "text-[#666666]"}`}>
              {statusLabel(a)}
            </span>
          </span>
          <StatusIcon status={a.status} />
          {canExpand && (
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#9E9E9E] transition-transform ${expanded ? "rotate-180" : ""}`} />
          )}
        </button>
        {expanded && (
          <div className="max-h-72 overflow-y-auto border-t border-[#EDEDED] px-4 py-3 text-xs text-[#262626]">
            <Markdown text={a.text} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="my-3 space-y-2 rounded-3xl border border-[#EDEDED] bg-[#F8F9FA] p-3" role="status" aria-live="polite">
      <div className="px-1 text-[11px] font-bold uppercase tracking-wider text-[#666666]">{phase}</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{specialists.map(card)}</div>
      {ceo && card(ceo)}
    </div>
  );
}
