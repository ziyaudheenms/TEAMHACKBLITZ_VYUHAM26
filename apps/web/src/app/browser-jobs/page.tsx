"use client";

import React, { useState, useEffect } from "react";
import {
  Globe,
  Plus,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Camera,
  Layers,
} from "lucide-react";
import { api } from "../../services/api";
import { BrowserJob, BrowserPermissionLevel } from "../../types";
import { useRBAC } from "../../lib/useRBAC";

export default function BrowserJobsPage() {
  const { canApproveBrowserJobs } = useRBAC();
  const [jobs, setJobs] = useState<BrowserJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<BrowserJob | null>(null);
  const [isLaunchModalOpen, setIsLaunchModalOpen] = useState(false);

  // Form states for launching a new job
  const [goal, setGoal] = useState("");
  const [targetUrl, setTargetUrl] = useState("https://portal.aws.amazon.com/billing");
  const [permissionLevel, setPermissionLevel] = useState<BrowserPermissionLevel>("B2");

  useEffect(() => {
    async function load() {
      const data = await api.getBrowserJobs();
      setJobs(data);
      if (data.length > 0) setSelectedJob(data[0]);
    }
    load();
  }, []);

  const handleSelectJob = (job: BrowserJob) => {
    setSelectedJob(job);
  };

  const handleDecision = async (jobId: string, decision: "approved" | "rejected") => {
    try {
      const updated = await api.approveBrowserJob(jobId, decision);
      setJobs(jobs.map((j) => (j.id === updated.id ? updated : j)));
      if (selectedJob?.id === jobId) setSelectedJob(updated);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not record the decision");
    }
  };

  const handleLaunchJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) return;

    const created = await api.createBrowserJob({
      goal,
      targetUrl,
      permissionLevel,
      agentName: "Autonomous Browser Worker",
    });

    setJobs([created, ...jobs]);
    setSelectedJob(created);
    setIsLaunchModalOpen(false);
    setGoal("");
  };

  return (
    <div className="flex h-[calc(100vh-6.5rem)] flex-col md:flex-row gap-6">
      {/* Left Column: Browser Job Queue */}
      <div className="w-full md:w-96 flex flex-col shrink-0 rounded-3xl border border-[#BEBEBE]/40 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
          <div className="flex items-center space-x-2">
            <Globe className="w-4 h-4 text-[#74D96F]" />
            <span className="font-bold text-sm text-[#262626]">Browser Automations</span>
          </div>
          <button
            onClick={() => setIsLaunchModalOpen(true)}
            className="px-3 py-1.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition shadow-xs flex items-center space-x-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Launch</span>
          </button>
        </div>

        {/* Job Queue List */}
        <div className="mt-3 flex-1 overflow-y-auto space-y-2.5 pr-1">
          {jobs.map((job) => {
            const isSelected = selectedJob?.id === job.id;
            return (
              <button
                key={job.id}
                onClick={() => handleSelectJob(job)}
                className={`w-full text-left p-3.5 rounded-2xl transition flex flex-col space-y-2 border ${
                  isSelected
                    ? "bg-[#EDEDED]/90 border-[#74D96F] text-[#262626] shadow-sm"
                    : "bg-white border-[#EDEDED] hover:bg-[#EDEDED]/40 hover:border-[#BEBEBE] text-[#262626]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-bold text-[#262626]">
                    {job.agentName}
                  </span>
                  <span
                    className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                      job.status === "awaiting_approval"
                        ? "bg-amber-100 text-amber-900 border border-amber-200 animate-pulse"
                        : job.status === "running"
                        ? "bg-[#74D96F]/20 text-[#1F541D] border border-[#74D96F]/40"
                        : job.status === "completed"
                        ? "bg-[#74D96F]/20 text-[#1F541D] border border-[#74D96F]/40"
                        : "bg-[#EDEDED] text-[#666666]"
                    }`}
                  >
                    {job.status.replace("_", " ")}
                  </span>
                </div>

                <div className="text-xs font-bold text-[#262626] line-clamp-2">
                  {job.goal}
                </div>

                <div className="text-[10px] text-[#666666] truncate font-mono">
                  Target: {job.targetUrl}
                </div>

                <div className="flex items-center justify-between text-[10px] text-[#666666] pt-1.5 border-t border-[#EDEDED]">
                  <span className="text-[#262626] font-bold">Tier {job.permissionLevel}</span>
                  <span>{job.steps.length} steps executed</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Column: Execution Viewport & Human-In-The-Loop Approval Drawer */}
      <div className="flex-1 flex flex-col rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 shadow-sm overflow-hidden">
        {selectedJob ? (
          <div className="flex-1 flex flex-col overflow-y-auto pr-1 space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#EDEDED]">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-xs font-bold text-[#262626]">{selectedJob.agentName}</span>
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full font-semibold uppercase bg-[#EDEDED] text-[#262626]">
                    Permission: {selectedJob.permissionLevel}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-[#262626] mt-1">{selectedJob.goal}</h2>
                <div className="flex items-center space-x-2 text-xs text-[#666666] mt-1">
                  <span className="font-mono text-[#262626]">{selectedJob.targetUrl}</span>
                </div>
              </div>

              <div>
                <span
                  className={`text-xs px-3 py-1.5 rounded-full font-bold uppercase ${
                    selectedJob.status === "awaiting_approval"
                      ? "bg-amber-100 text-amber-900 border border-amber-200"
                      : selectedJob.status === "completed"
                      ? "bg-[#74D96F]/20 text-[#1F541D] border border-[#74D96F]/40"
                      : "bg-[#EDEDED] text-[#262626]"
                  }`}
                >
                  {selectedJob.status.replace("_", " ")}
                </span>
              </div>
            </div>

            {/* Human In The Loop Approval Action Card */}
            {selectedJob.status === "awaiting_approval" && selectedJob.approvalRequest && (
              <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 space-y-4 shadow-sm">
                <div className="flex items-start space-x-3.5">
                  <div className="p-2.5 rounded-xl bg-amber-200 text-amber-800 shrink-0">
                    <ShieldAlert className="w-6 h-6 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-amber-950">
                      High-Risk Action Approval Required (Level {selectedJob.permissionLevel})
                    </h3>
                    <p className="text-xs text-[#262626] mt-1 leading-relaxed">
                      {selectedJob.approvalRequest.riskReason}
                    </p>
                    <div className="mt-2 text-xs font-mono bg-white p-2.5 rounded-xl border border-amber-200 text-amber-900">
                      Action: {selectedJob.approvalRequest.actionDescription}
                    </div>
                  </div>
                </div>

                {!canApproveBrowserJobs && (
                  <p className="text-[11px] font-semibold text-amber-800 pt-2 border-t border-amber-200">
                    Waiting for an admin or owner to review this action.
                  </p>
                )}
                {canApproveBrowserJobs && (
                <div className="flex justify-end space-x-3 pt-2 border-t border-amber-200">
                  <button
                    onClick={() => handleDecision(selectedJob.id, "rejected")}
                    className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-rose-700 text-xs font-semibold border border-[#BEBEBE]/40 transition"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Reject Action</span>
                  </button>
                  <button
                    onClick={() => handleDecision(selectedJob.id, "approved")}
                    className="inline-flex items-center space-x-1.5 px-5 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition shadow-xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Approve & Authorize Step</span>
                  </button>
                </div>
                )}
              </div>
            )}

            {/* Execution Trace Steps */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-[#262626] uppercase tracking-wider flex items-center space-x-1.5">
                <Layers className="w-3.5 h-3.5 text-[#74D96F]" />
                <span>Playwright Execution Trace ({selectedJob.steps.length} Steps)</span>
              </h3>

              <div className="space-y-2">
                {selectedJob.steps.map((st) => (
                  <div
                    key={st.stepNumber}
                    className="flex items-center justify-between p-3.5 rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] text-xs"
                  >
                    <div className="flex items-center space-x-3">
                      <span className="w-6 h-6 rounded-lg bg-white border border-[#BEBEBE]/60 flex items-center justify-center font-mono font-bold text-[10px] text-[#262626]">
                        {st.stepNumber}
                      </span>
                      <span className="font-mono text-[#262626] uppercase font-bold text-[11px]">
                        [{st.action}]
                      </span>
                      <span className="text-[#262626]">{st.details || st.target}</span>
                    </div>

                    <div className="flex items-center space-x-2 text-[10px] text-[#666666]">
                      <span>{st.timestamp}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full font-bold uppercase ${
                          st.status === "completed"
                            ? "text-[#1F541D] bg-[#74D96F]/20"
                            : st.status === "running"
                            ? "text-[#1F541D] bg-[#74D96F]/20 animate-pulse"
                            : "text-[#666666]"
                        }`}
                      >
                        {st.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Simulated Viewport Evidence Screenshots */}
            {selectedJob.evidenceUrls && selectedJob.evidenceUrls.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-[#262626] uppercase tracking-wider flex items-center space-x-1.5">
                  <Camera className="w-3.5 h-3.5 text-[#74D96F]" />
                  <span>Viewport Evidence Artifacts</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selectedJob.evidenceUrls.map((url, i) => (
                    <div
                      key={i}
                      className="rounded-2xl overflow-hidden border border-[#EDEDED] bg-[#F8F9FA] p-2.5 space-y-1.5"
                    >
                      <img
                        src={url}
                        alt="Evidence screenshot"
                        className="w-full h-44 object-cover rounded-xl"
                      />
                      <div className="text-[10px] text-[#666666] font-mono px-1">
                        Screenshot captured at checkpoint #{i + 1}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Output Summary */}
            {selectedJob.outputSummary && (
              <div className="p-4 rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] space-y-1">
                <h4 className="text-xs font-bold text-[#262626] uppercase tracking-wider">
                  Result Summary
                </h4>
                <p className="text-xs text-[#262626] leading-relaxed font-mono">
                  {selectedJob.outputSummary}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[#666666]">
            <Globe className="w-10 h-10 mb-2 opacity-40 text-[#74D96F]" />
            <p className="text-xs">Select a browser job to inspect trace.</p>
          </div>
        )}
      </div>

      {/* Modal: Launch New Browser Job */}
      {isLaunchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <form
            onSubmit={handleLaunchJob}
            className="w-full max-w-lg rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 shadow-2xl text-[#262626] space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
              <h3 className="font-bold text-sm text-[#262626]">Launch Autonomous Browser Job</h3>
              <button
                type="button"
                onClick={() => setIsLaunchModalOpen(false)}
                className="text-[#666666] hover:text-[#262626]"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">
                Automation Goal / Task Description
              </label>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. Scrape monthly cloud billing report and extract CSV summary..."
                rows={3}
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Target Initial URL</label>
              <input
                type="url"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Permission Level</label>
              <select
                value={permissionLevel}
                onChange={(e) => setPermissionLevel(e.target.value as BrowserPermissionLevel)}
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white"
              >
                <option value="B1">B1 (Read-Only Inspection)</option>
                <option value="B2">B2 (Form Staging)</option>
                <option value="B3">B3 (State Changes with Approval)</option>
                <option value="B4">B4 (High Risk Financial / Dual Approval)</option>
              </select>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-[#EDEDED]">
              <button
                type="button"
                onClick={() => setIsLaunchModalOpen(false)}
                className="px-4 py-2 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-xs text-[#262626] font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs text-[#262626] font-bold shadow-sm transition"
              >
                Dispatch to Sandbox Worker
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
