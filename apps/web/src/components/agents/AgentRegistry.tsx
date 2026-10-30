"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Bot,
  Plus,
  Shield,
  Cpu,
  Globe,
  Terminal,
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Info,
} from "lucide-react";
import { api } from "../../services/api";
import { AgentRecord, BrowserPermissionLevel } from "../../types";
import { useRBAC } from "../../lib/useRBAC";

type AgentStatus = AgentRecord["status"];

/** The AI engine runs Gemini, so only Gemini models are offered. */
const MODEL_OPTIONS = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (fast, default)" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (deeper reasoning)" },
];
const DEFAULT_MODEL = MODEL_OPTIONS[0].value;

/** draft -> submitted -> reviewed -> approved -> active; suspended / retired sit outside the happy path. */
const LIFECYCLE: AgentStatus[] = ["draft", "submitted", "reviewed", "approved", "active"];

const NEXT_STEP: Partial<Record<AgentStatus, { to: AgentStatus; label: string }>> = {
  draft: { to: "submitted", label: "Submit for review" },
  submitted: { to: "reviewed", label: "Mark reviewed" },
  reviewed: { to: "approved", label: "Approve" },
  approved: { to: "active", label: "Activate" },
};

const STATUS_STYLE: Record<AgentStatus, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-300",
  submitted: "bg-sky-50 text-sky-700 border-sky-200",
  reviewed: "bg-indigo-50 text-indigo-700 border-indigo-200",
  approved: "bg-teal-50 text-teal-700 border-teal-200",
  active: "bg-[#74D96F]/20 text-[#1F541D] border-[#74D96F]/40",
  suspended: "bg-amber-50 text-amber-800 border-amber-200",
  retired: "bg-rose-50 text-rose-700 border-rose-200",
};

const STATUS_NOTE: Partial<Record<AgentStatus, string>> = {
  draft: "This agent is a draft. Browser jobs can't use it until it has been activated.",
  submitted: "Awaiting review. Browser jobs can't use this agent until it has been activated.",
  reviewed: "Reviewed, awaiting approval. Browser jobs can't use this agent until it has been activated.",
  approved: "Approved but not active yet. Activate it so browser jobs can use it.",
  suspended: "This agent is suspended and can't run jobs. Reactivate it to allow jobs again.",
  retired: "This agent is retired and can't run jobs.",
};

function StatusPill({ status, className = "" }: { status: AgentStatus; className?: string }) {
  return (
    <span
      className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase border ${STATUS_STYLE[status] ?? STATUS_STYLE.draft} ${className}`}
    >
      {status}
    </span>
  );
}

const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export default function AgentRegistry() {
  const { canManageAgents } = useRBAC();
  const [hydrated, setHydrated] = useState(false);
  const canManage = hydrated && canManageAgents;

  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);

  const [updatingStatus, setUpdatingStatus] = useState<AgentStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [permissionLevel, setPermissionLevel] = useState<BrowserPermissionLevel>("B1");
  const [allowedDomains, setAllowedDomains] = useState("github.com, docs.vyuham.ai");

  const mounted = useRef(true);
  const selectedAgent = agents.find((a) => a.id === selectedId) ?? null;
  const isUpdating = updatingStatus !== null;

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await api.getAgents();
      if (!mounted.current) return;
      setAgents(data);
      setSelectedId((cur) => (cur && data.some((a) => a.id === cur) ? cur : data[0]?.id ?? null));
    } catch (err) {
      if (mounted.current) setLoadError(messageOf(err, "Failed to load agents"));
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    setHydrated(true);
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const selectAgent = (id: string) => {
    setSelectedId(id);
    setStatusError(null);
    setNotice(null);
  };

  const openNewModal = () => {
    setCreateError(null);
    setIsNewModalOpen(true);
  };

  const closeNewModal = () => {
    if (isCreating) return;
    setIsNewModalOpen(false);
    setCreateError(null);
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating || !name.trim()) return;

    setIsCreating(true);
    setCreateError(null);
    try {
      const domains = allowedDomains.split(",").map((d) => d.trim()).filter(Boolean);
      const created = await api.createAgent({
        name: name.trim(),
        role: role.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        model,
        browserPermission: permissionLevel,
        allowedDomains: domains,
      });
      if (!mounted.current) return;

      setAgents((prev) => [created, ...prev.filter((a) => a.id !== created.id)]);
      setSelectedId(created.id);
      setStatusError(null);
      setNotice(
        created.status === "draft"
          ? `"${created.name}" was created as a draft. Move it through review and activate it before browser jobs can use it.`
          : `"${created.name}" was created.`
      );
      setIsNewModalOpen(false);
      setName("");
      setRole("");
      setDescription("");
      setInstructions("");
      setModel(DEFAULT_MODEL);
    } catch (err) {
      if (mounted.current) setCreateError(messageOf(err, "Could not create the agent"));
    } finally {
      if (mounted.current) setIsCreating(false);
    }
  };

  const changeStatus = async (agent: AgentRecord, status: AgentStatus) => {
    if (isUpdating) return;
    setUpdatingStatus(status);
    setStatusError(null);
    setNotice(null);
    try {
      const updated = await api.updateAgentStatus(agent.id, status);
      if (!mounted.current) return;
      setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch (err) {
      if (mounted.current) setStatusError(`Couldn't change status to "${status}": ${messageOf(err, "request failed")}`);
    } finally {
      if (mounted.current) setUpdatingStatus(null);
    }
  };

  const actionButton = (agent: AgentRecord, to: AgentStatus, label: string, style: string) => (
    <button
      key={to}
      disabled={isUpdating}
      onClick={() => void changeStatus(agent, to)}
      className={`px-3 py-1 rounded-full text-[10px] font-bold transition disabled:opacity-40 flex items-center space-x-1 cursor-pointer ${style}`}
    >
      {updatingStatus === to && <Loader2 className="w-3 h-3 animate-spin" />}
      <span>{label}</span>
    </button>
  );

  const lifecycleIndex = selectedAgent ? LIFECYCLE.indexOf(selectedAgent.status) : -1;

  return (
    <div className="space-y-4 animate-fade-in">
      {loadError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700"
        >
          <span className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="break-words">Couldn't load agents: {loadError}</span>
          </span>
          <button onClick={() => void load()} className="font-bold underline cursor-pointer shrink-0">
            Retry
          </button>
        </div>
      )}

      <div className="flex h-[calc(100vh-11rem)] flex-col md:flex-row gap-6">
        {/* Left List of Agents */}
        <div className="w-full md:w-80 flex flex-col shrink-0 rounded-3xl border border-[#BEBEBE]/40 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
            <div className="flex items-center space-x-2">
              <Bot className="w-4 h-4 text-[#74D96F]" />
              <span className="font-bold text-sm text-[#262626]">Agent Registry</span>
            </div>
            {canManage && (
              <button
                onClick={openNewModal}
                className="px-3 py-1.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition shadow-xs flex items-center space-x-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New</span>
              </button>
            )}
          </div>

          <div className="mt-3 flex-1 overflow-y-auto space-y-2 pr-1">
            {isLoading ? (
              <div className="space-y-2" aria-busy="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-2xl border border-[#EDEDED] p-3.5 space-y-2">
                    <div className="skeleton h-3 w-1/2 rounded-full" />
                    <div className="skeleton h-3 w-3/4 rounded-full" />
                  </div>
                ))}
              </div>
            ) : agents.length === 0 ? (
              !loadError && (
                <div className="h-full flex flex-col items-center justify-center text-center text-[#666666] space-y-2 px-4">
                  <Bot className="w-8 h-8 opacity-40 text-[#74D96F]" />
                  <p className="text-xs font-semibold text-[#262626]">No agents yet</p>
                  <p className="text-[11px]">
                    {canManage
                      ? "Register your first agent with the New button."
                      : "An admin needs to register an agent before it appears here."}
                  </p>
                </div>
              )
            ) : (
              agents.map((ag) => {
                const isSelected = selectedId === ag.id;
                return (
                  <button
                    key={ag.id}
                    onClick={() => selectAgent(ag.id)}
                    className={`w-full text-left p-3.5 rounded-2xl transition flex flex-col space-y-2 border cursor-pointer ${
                      isSelected
                        ? "bg-[#EDEDED]/90 border-[#74D96F] text-[#262626] shadow-xs"
                        : "bg-white border-[#EDEDED] hover:bg-[#EDEDED]/40 text-[#666666] hover:text-[#262626]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#262626] truncate">{ag.name}</span>
                      <StatusPill status={ag.status} className="shrink-0" />
                    </div>
                    <p className="text-[11px] text-[#666666] line-clamp-1">{ag.role}</p>
                    <div className="flex items-center justify-between text-[10px] text-[#666666] pt-1.5 border-t border-[#EDEDED]">
                      <span>{ag.model}</span>
                      <span className="font-bold">{ag.browserPermission}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Agent Configuration & Permissions */}
        <div className="flex-1 flex flex-col rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 shadow-sm overflow-hidden">
          {selectedAgent ? (
            <div className="flex-1 flex flex-col overflow-y-auto pr-1 space-y-6">
              {/* Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#EDEDED]">
                <div className="flex items-center space-x-3.5">
                  <div className="p-3 rounded-2xl bg-[#74D96F]/15 border border-[#74D96F]/40 text-[#1F541D]">
                    <Bot className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h1 className="text-lg font-bold text-[#262626]">{selectedAgent.name}</h1>
                      <StatusPill status={selectedAgent.status} />
                    </div>
                    <p className="text-xs text-[#666666]">{selectedAgent.role}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[#666666] font-mono">{selectedAgent.totalExecutions} total runs</span>
                  {canManage && (
                    <>
                      {NEXT_STEP[selectedAgent.status] &&
                        actionButton(
                          selectedAgent,
                          NEXT_STEP[selectedAgent.status]!.to,
                          NEXT_STEP[selectedAgent.status]!.label,
                          "bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626]"
                        )}
                      {(selectedAgent.status === "draft" ||
                        selectedAgent.status === "submitted" ||
                        selectedAgent.status === "reviewed") &&
                        actionButton(
                          selectedAgent,
                          "active",
                          "Activate now",
                          "bg-[#EDEDED] hover:bg-[#E2E2E2] text-[#262626]"
                        )}
                      {selectedAgent.status === "active" &&
                        actionButton(selectedAgent, "suspended", "Suspend", "bg-rose-100 hover:bg-rose-200 text-rose-700")}
                      {selectedAgent.status === "suspended" &&
                        actionButton(selectedAgent, "active", "Reactivate", "bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626]")}
                      {(selectedAgent.status === "active" || selectedAgent.status === "suspended") &&
                        actionButton(selectedAgent, "retired", "Retire", "bg-[#EDEDED] hover:bg-[#E2E2E2] text-[#262626]")}
                    </>
                  )}
                </div>
              </div>

              {statusError && (
                <div role="alert" className="flex items-start space-x-2 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="break-words">{statusError}</span>
                </div>
              )}

              {notice && !statusError && (
                <div role="status" className="flex items-start space-x-2 p-3 rounded-2xl bg-[#74D96F]/15 border border-[#74D96F]/40 text-xs text-[#1F541D]">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{notice}</span>
                </div>
              )}

              {/* Lifecycle */}
              <div className="rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] p-4 space-y-3">
                <h4 className="text-xs font-bold text-[#262626] uppercase tracking-wider">Lifecycle</h4>
                <ol className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase">
                  {LIFECYCLE.map((step, i) => {
                    const reached = lifecycleIndex >= i;
                    const current = selectedAgent.status === step;
                    return (
                      <li key={step} className="flex items-center gap-1.5">
                        <span
                          aria-current={current ? "step" : undefined}
                          className={`px-2.5 py-1 rounded-full border ${
                            current
                              ? STATUS_STYLE[step]
                              : reached
                              ? "bg-white text-[#262626] border-[#BEBEBE]/60"
                              : "bg-white text-[#9E9E9E] border-[#EDEDED]"
                          }`}
                        >
                          {step}
                        </span>
                        {i < LIFECYCLE.length - 1 && <span className="text-[#BEBEBE]">&rarr;</span>}
                      </li>
                    );
                  })}
                  {(selectedAgent.status === "suspended" || selectedAgent.status === "retired") && (
                    <li className="flex items-center gap-1.5">
                      <span className="text-[#BEBEBE]">&rarr;</span>
                      <span aria-current="step" className={`px-2.5 py-1 rounded-full border ${STATUS_STYLE[selectedAgent.status]}`}>
                        {selectedAgent.status}
                      </span>
                    </li>
                  )}
                </ol>
                {STATUS_NOTE[selectedAgent.status] && (
                  <p
                    className={`text-xs flex items-start space-x-2 ${
                      selectedAgent.status === "active" ? "text-[#1F541D]" : "text-amber-800"
                    }`}
                  >
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{STATUS_NOTE[selectedAgent.status]}</span>
                  </p>
                )}
                {!canManage && (
                  <p className="text-[10px] text-[#9E9E9E]">Admin role required to change an agent's status.</p>
                )}
              </div>

              {/* Spec Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] p-3.5 space-y-1">
                  <span className="text-[10px] uppercase font-semibold text-[#666666] block">AI Foundation Model</span>
                  <span className="font-bold text-[#262626] flex items-center space-x-1.5">
                    <Cpu className="w-3.5 h-3.5 text-[#74D96F]" />
                    <span className="break-all">{selectedAgent.model}</span>
                  </span>
                  {!selectedAgent.model.toLowerCase().startsWith("gemini") && (
                    <span className="flex items-start space-x-1 text-[10px] text-amber-800">
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                      <span>The AI engine runs Gemini; this model name isn't available to it.</span>
                    </span>
                  )}
                </div>

                <div className="rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] p-3.5 space-y-1">
                  <span className="text-[10px] uppercase font-semibold text-[#666666] block">Browser Permission</span>
                  <span className="font-bold text-[#262626] flex items-center space-x-1.5">
                    <Shield className="w-3.5 h-3.5 text-[#74D96F]" />
                    <span>Level {selectedAgent.browserPermission}</span>
                  </span>
                </div>

                <div className="rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] p-3.5 space-y-1">
                  <span className="text-[10px] uppercase font-semibold text-[#666666] block">Execution Success</span>
                  <span className="font-bold text-[#1F541D] flex items-center space-x-1.5">
                    <Activity className="w-3.5 h-3.5 text-[#74D96F]" />
                    <span>
                      {selectedAgent.totalExecutions > 0 ? `${selectedAgent.successRate}% reliability` : "No runs yet"}
                    </span>
                  </span>
                </div>
              </div>

              {/* Description */}
              <div className="rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] p-4 space-y-1">
                <h4 className="text-xs font-bold text-[#262626] uppercase tracking-wider">Description</h4>
                <p className="text-xs text-[#262626] leading-relaxed">
                  {selectedAgent.description || <span className="italic text-[#666666]">No description provided.</span>}
                </p>
              </div>

              {/* System Prompt / Instructions */}
              <div className="rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] p-4 space-y-2">
                <h4 className="text-xs font-bold text-[#262626] uppercase tracking-wider flex items-center space-x-1.5">
                  <Terminal className="w-3.5 h-3.5 text-[#74D96F]" />
                  <span>System Instructions & Behavioral Guardrails</span>
                </h4>
                <div className="p-3.5 rounded-xl bg-white text-xs text-[#262626] font-mono whitespace-pre-wrap leading-relaxed border border-[#BEBEBE]/60">
                  {selectedAgent.instructions}
                </div>
              </div>

              {/* Allowed Domains */}
              <div className="rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] p-4 space-y-2">
                <h4 className="text-xs font-bold text-[#262626] uppercase tracking-wider flex items-center space-x-1.5">
                  <Globe className="w-3.5 h-3.5 text-[#74D96F]" />
                  <span>Egress Whitelisted Domains ({selectedAgent.allowedDomains.length})</span>
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {selectedAgent.allowedDomains.length > 0 ? (
                    selectedAgent.allowedDomains.map((dom, i) => (
                      <span
                        key={i}
                        className="text-xs px-3 py-1 rounded-full bg-[#EDEDED] border border-[#BEBEBE]/40 text-[#262626] font-mono font-medium"
                      >
                        {dom}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-[#666666] italic">No external web egress allowed.</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[#666666] space-y-2">
              <Bot className="w-10 h-10 opacity-40 text-[#74D96F]" />
              <p className="text-xs">
                {isLoading ? "Loading agents..." : agents.length === 0 ? "No agent selected." : "Select an agent to inspect details."}
              </p>
              {hydrated && !canManageAgents && (
                <p className="text-[10px] bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1.5 rounded-full">
                  Admin role required to create or modify agents.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal: New Agent */}
      {isNewModalOpen && canManage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Register autonomous agent"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
        >
          <form
            onSubmit={handleCreateAgent}
            className="w-full max-w-lg rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 shadow-2xl text-[#262626] space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
              <h3 className="font-bold text-sm text-[#262626]">Register Autonomous Agent</h3>
              <button
                type="button"
                onClick={closeNewModal}
                disabled={isCreating}
                aria-label="Close"
                className="text-[#666666] hover:text-[#262626] disabled:opacity-40 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex items-start space-x-2 p-3 rounded-2xl bg-slate-50 border border-slate-200 text-[11px] text-slate-700">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                New agents are created as a <strong>draft</strong>. Browser jobs can't use an agent until it has been moved
                through review and activated.
              </span>
            </div>

            <fieldset disabled={isCreating} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#262626] mb-1">Agent Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Procurement Form Agent"
                  maxLength={120}
                  className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#262626] mb-1">Functional Role</label>
                <input
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="e.g. Cloud Invoice & Vendor Ingestion"
                  maxLength={100}
                  className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#262626] mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this agent accomplishes..."
                  rows={2}
                  maxLength={1000}
                  className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#262626] mb-1">System Instructions</label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Security policies and instructions (a least-privilege default is used if left empty)"
                  rows={3}
                  className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#262626] mb-1">Model</label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#262626] mb-1">Browser Permission</label>
                  <select
                    value={permissionLevel}
                    onChange={(e) => setPermissionLevel(e.target.value as BrowserPermissionLevel)}
                    className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                  >
                    <option value="B0">B0 (No Browser / Text Only)</option>
                    <option value="B1">B1 (Read-Only Inspection)</option>
                    <option value="B2">B2 (Form Staging)</option>
                    <option value="B3">B3 (Action / Human Approval)</option>
                    <option value="B4">B4 (High Risk / Dual Approval)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#262626] mb-1">
                  Allowed Egress Domains (Comma-separated)
                </label>
                <input
                  type="text"
                  value={allowedDomains}
                  onChange={(e) => setAllowedDomains(e.target.value)}
                  placeholder="github.com, console.aws.amazon.com"
                  className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                />
              </div>
            </fieldset>

            {createError && (
              <div role="alert" className="flex items-start space-x-2 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-words">{createError}</span>
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-3 border-t border-[#EDEDED]">
              <button
                type="button"
                onClick={closeNewModal}
                disabled={isCreating}
                className="px-4 py-2 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-xs text-[#262626] font-semibold transition disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreating || !name.trim() || !role.trim()}
                className="px-5 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs text-[#262626] font-bold shadow-sm transition disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer"
              >
                {isCreating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isCreating ? "Registering..." : "Register Agent"}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
