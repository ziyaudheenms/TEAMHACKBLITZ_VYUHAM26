"use client";

import React, { useState, useEffect } from "react";
import {
  Bot,
  Plus,
  Shield,
  Cpu,
  Globe,
  Terminal,
  Activity,
} from "lucide-react";
import { api } from "../../services/api";
import { AgentRecord, BrowserPermissionLevel } from "../../types";
import { useRBAC } from "../../lib/useRBAC";

export default function AgentRegistry() {
  const { canManageAgents } = useRBAC();
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentRecord | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  // Form states
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [model, setModel] = useState("claude-3-5-sonnet");
  const [permissionLevel, setPermissionLevel] = useState<BrowserPermissionLevel>("B1");
  const [allowedDomains, setAllowedDomains] = useState("github.com, docs.vyuham.ai");

  useEffect(() => {
    async function load() {
      const data = await api.getAgents();
      setAgents(data);
      if (data.length > 0) setSelectedAgent(data[0]);
    }
    load();
  }, []);

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const domains = allowedDomains.split(",").map((d) => d.trim()).filter(Boolean);
    const created = await api.createAgent({
      name,
      role,
      description,
      instructions,
      model,
      browserPermission: permissionLevel,
      allowedDomains: domains,
    });

    setAgents([created, ...agents]);
    setSelectedAgent(created);
    setIsNewModalOpen(false);
    setName("");
    setDescription("");
  };

  return (
    <div className="flex h-[calc(100vh-11rem)] flex-col md:flex-row gap-6 animate-fade-in">
      {/* Left List of Agents */}
      <div className="w-full md:w-80 flex flex-col shrink-0 rounded-3xl border border-[#BEBEBE]/40 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
          <div className="flex items-center space-x-2">
            <Bot className="w-4 h-4 text-[#74D96F]" />
            <span className="font-bold text-sm text-[#262626]">Agent Registry</span>
          </div>
          {canManageAgents && (
          <button
            onClick={() => setIsNewModalOpen(true)}
            className="px-3 py-1.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition shadow-xs flex items-center space-x-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
        )}
        </div>

        <div className="mt-3 flex-1 overflow-y-auto space-y-2 pr-1">
          {agents.map((ag) => {
            const isSelected = selectedAgent?.id === ag.id;
            return (
              <button
                key={ag.id}
                onClick={() => setSelectedAgent(ag)}
                className={`w-full text-left p-3.5 rounded-2xl transition flex flex-col space-y-2 border ${
                  isSelected
                    ? "bg-[#EDEDED]/90 border-[#74D96F] text-[#262626] shadow-xs"
                    : "bg-white border-[#EDEDED] hover:bg-[#EDEDED]/40 text-[#666666] hover:text-[#262626]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#262626]">{ag.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase bg-[#EDEDED] text-[#262626] border border-[#BEBEBE]/40">
                    {ag.browserPermission}
                  </span>
                </div>
                <p className="text-[11px] text-[#666666] line-clamp-1">{ag.role}</p>
                <div className="flex items-center justify-between text-[10px] text-[#666666] pt-1.5 border-t border-[#EDEDED]">
                  <span>{ag.model}</span>
                  <span className="text-[#1F541D] font-bold">{ag.successRate}% pass</span>
                </div>
              </button>
            );
          })}
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
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase bg-[#74D96F]/20 text-[#1F541D] border border-[#74D96F]/40">
                      {selectedAgent.status}
                    </span>
                  </div>
                  <p className="text-xs text-[#666666]">{selectedAgent.role}</p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-xs text-[#666666] font-mono">
                  {selectedAgent.totalExecutions} total runs
                </span>
                {canManageAgents && selectedAgent.status !== "active" && (
                  <button
                    disabled={isUpdating}
                    onClick={async () => {
                      setIsUpdating(true);
                      const updated = await api.updateAgentStatus(selectedAgent.id, "active");
                      if (updated) {
                        setSelectedAgent(updated);
                        setAgents((prev) => prev.map((a) => a.id === updated.id ? updated : a));
                      }
                      setIsUpdating(false);
                    }}
                    className="px-3 py-1 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-[10px] font-bold transition disabled:opacity-40"
                  >
                    Activate
                  </button>
                )}
                {canManageAgents && selectedAgent.status === "active" && (
                  <button
                    disabled={isUpdating}
                    onClick={async () => {
                      setIsUpdating(true);
                      const updated = await api.updateAgentStatus(selectedAgent.id, "suspended");
                      if (updated) {
                        setSelectedAgent(updated);
                        setAgents((prev) => prev.map((a) => a.id === updated.id ? updated : a));
                      }
                      setIsUpdating(false);
                    }}
                    className="px-3 py-1 rounded-full bg-rose-100 hover:bg-rose-200 text-rose-700 text-[10px] font-bold transition disabled:opacity-40"
                  >
                    Suspend
                  </button>
                )}
              </div>
            </div>

            {/* Spec Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] p-3.5 space-y-1">
                <span className="text-[10px] uppercase font-semibold text-[#666666] block">AI Foundation Model</span>
                <span className="font-bold text-[#262626] flex items-center space-x-1.5">
                  <Cpu className="w-3.5 h-3.5 text-[#74D96F]" />
                  <span>{selectedAgent.model}</span>
                </span>
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
                  <span>{selectedAgent.successRate}% reliability</span>
                </span>
              </div>
            </div>

            {/* Description */}
            <div className="rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] p-4 space-y-1">
              <h4 className="text-xs font-bold text-[#262626] uppercase tracking-wider">Description</h4>
              <p className="text-xs text-[#262626] leading-relaxed">{selectedAgent.description}</p>
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
                  <span className="text-xs text-[#666666] italic">No external web egress allowed (B0 level).</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[#666666] space-y-2">
            <Bot className="w-10 h-10 opacity-40 text-[#74D96F]" />
            <p className="text-xs">Select an agent to inspect details.</p>
            {!canManageAgents && (
              <p className="text-[10px] text-[#9E9E9E] bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1.5 rounded-full">
                Admin role required to create or modify agents.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Modal: New Agent */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <form
            onSubmit={handleCreateAgent}
            className="w-full max-w-lg rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 shadow-2xl text-[#262626] space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
              <h3 className="font-bold text-sm text-[#262626]">Register Autonomous Agent</h3>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="text-[#666666] hover:text-[#262626]"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Agent Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Procurement Form Agent"
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
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">System Instructions</label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Security policies and instructions..."
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
                  <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                  <option value="llama-3.3-70b">Llama 3.3 70B (Local)</option>
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

            <div className="flex justify-end space-x-2 pt-3 border-t border-[#EDEDED]">
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="px-4 py-2 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-xs text-[#262626] font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs text-[#262626] font-bold shadow-sm transition"
              >
                Register Agent
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
