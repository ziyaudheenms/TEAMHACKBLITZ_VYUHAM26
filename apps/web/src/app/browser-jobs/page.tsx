"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Globe,
  Plus,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Camera,
  Layers,
  AlertCircle,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { api } from "../../services/api";
import { ApiError } from "../../services/http";
import { AgentRecord, BrowserJob, BrowserPermissionLevel } from "../../types";
import { useRBAC } from "../../lib/useRBAC";

type JobStatus = BrowserJob["status"];

const STATUS_STYLES: Record<JobStatus, string> = {
  queued: "bg-[#EDEDED] text-[#262626] border border-[#BEBEBE]/60",
  policy_check: "bg-[#75A0C9]/20 text-[#1F456E] border border-[#75A0C9]/40 animate-pulse",
  running: "bg-[#74D96F]/20 text-[#1F541D] border border-[#74D96F]/40 animate-pulse",
  awaiting_approval: "bg-amber-100 text-amber-900 border border-amber-200 animate-pulse",
  completed: "bg-[#74D96F]/20 text-[#1F541D] border border-[#74D96F]/40",
  failed: "bg-rose-100 text-rose-800 border border-rose-200",
  cancelled: "bg-[#EDEDED] text-[#666666] border border-[#BEBEBE]/60 line-through decoration-[#999999]/60",
};

const STATUS_HINTS: Record<JobStatus, string> = {
  queued: "Queued. Waiting for a sandbox worker to pick this job up.",
  policy_check: "Checking the agent's permissions and allowed domains before starting.",
  running: "Running in the sandbox. Use refresh to see new steps.",
  awaiting_approval: "Paused until an admin approves or rejects the requested action.",
  completed: "Finished successfully.",
  failed: "The job failed. Check the trace and result summary below.",
  cancelled: "This job was cancelled or rejected and will not run.",
};

const PERMISSION_LABELS: Record<BrowserPermissionLevel, string> = {
  B0: "B0 (Navigation Only)",
  B1: "B1 (Read-Only Inspection)",
  B2: "B2 (Form Staging)",
  B3: "B3 (State Changes with Approval)",
  B4: "B4 (High Risk Financial / Dual Approval)",
};

const PERMISSION_LEVELS = Object.keys(PERMISSION_LABELS) as BrowserPermissionLevel[];

const statusLabel = (status: string) => status.replace(/_/g, " ");
const statusStyle = (status: string) =>
  STATUS_STYLES[status as JobStatus] ?? "bg-[#EDEDED] text-[#262626] border border-[#BEBEBE]/60";

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return err.status === 0 ? "Cannot reach the server. Check that the API is running and try again." : err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function formatTimestamp(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const stepsOf = (job: BrowserJob) => (Array.isArray(job.steps) ? job.steps : []);

export default function BrowserJobsPage() {
  const { canApproveBrowserJobs } = useRBAC();
  const [jobs, setJobs] = useState<BrowserJob[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isLaunchModalOpen, setIsLaunchModalOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [decidingJobId, setDecidingJobId] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // Form states for launching a new job
  const [goal, setGoal] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [permissionLevel, setPermissionLevel] = useState<BrowserPermissionLevel>("B1");
  const [agentId, setAgentId] = useState("");

  const activeAgents = useMemo(() => agents.filter((a) => a.status === "active"), [agents]);
  const selectedAgent = activeAgents.find((a) => a.id === agentId);
  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await api.getBrowserJobs();
      setJobs(data);
      setSelectedJobId((prev) => (prev && data.some((j) => j.id === prev) ? prev : data[0]?.id ?? null));
    } catch (err) {
      setLoadError(errorMessage(err, "Failed to load browser jobs."));
    } finally {
      setIsLoading(false);
    }
    // The agent list only feeds the launch picker; a failure must not hide the job queue.
    try {
      setAgents(await api.getAgents());
      setAgentsError(null);
    } catch (err) {
      setAgents([]);
      setAgentsError(errorMessage(err, "Could not load agents."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSelectJob = (job: BrowserJob) => {
    setSelectedJobId(job.id);
    setActionError(null);
  };

  const handleDecision = async (jobId: string, decision: "approved" | "rejected") => {
    if (decidingJobId) return;
    setActionError(null);
    setDecidingJobId(jobId);
    try {
      const updated = await api.approveBrowserJob(jobId, decision);
      setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
    } catch (err) {
      setActionError(
        `Could not ${decision === "approved" ? "approve" : "reject"} this job: ${errorMessage(err, "Could not record the decision.")}`
      );
    } finally {
      setDecidingJobId(null);
    }
  };

  const openLaunchModal = () => {
    setLaunchError(null);
    setIsLaunchModalOpen(true);
  };

  const handleLaunchJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLaunching || !goal.trim()) return;

    const url = targetUrl.trim();
    let parsedUrl: URL | null = null;
    try {
      parsedUrl = new URL(url);
    } catch {
      parsedUrl = null;
    }
    if (!parsedUrl || parsedUrl.protocol !== "https:") {
      setLaunchError("Enter a valid https:// URL (for example https://example.com/page).");
      return;
    }

    setIsLaunching(true);
    setLaunchError(null);
    try {
      const created = await api.createBrowserJob({
        agentId: agentId || undefined,
        goal: goal.trim(),
        targetUrl: url,
        permissionLevel,
      });

      setJobs((prev) => [created, ...prev]);
      setSelectedJobId(created.id);
      setActionError(null);
      setIsLaunchModalOpen(false);
      setGoal("");
      setTargetUrl("");
    } catch (err) {
      setLaunchError(errorMessage(err, "Failed to launch the browser job."));
    } finally {
      setIsLaunching(false);
    }
  };

  const isDeciding = decidingJobId !== null;

  return (
    <div className="flex h-[calc(100vh-6.5rem)] flex-col md:flex-row gap-6">
      {/* Left Column: Browser Job Queue */}
      <div className="w-full md:w-96 flex flex-col shrink-0 rounded-3xl border border-[#BEBEBE]/40 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
          <div className="flex items-center space-x-2">
            <Globe className="w-4 h-4 text-[#74D96F]" />
            <span className="font-bold text-sm text-[#262626]">Browser Automations</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <button
              onClick={() => void load()}
              disabled={isLoading}
              title="Refresh jobs"
              aria-label="Refresh jobs"
              className="p-1.5 rounded-full text-[#666666] hover:bg-[#EDEDED] transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={openLaunchModal}
              className="px-3 py-1.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition shadow-xs flex items-center space-x-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Launch</span>
            </button>
          </div>
        </div>

        {/* Job Queue List */}
        <div className="mt-3 flex-1 overflow-y-auto space-y-2.5 pr-1">
          {loadError ? (
            <div
              role="alert"
              className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 space-y-2"
            >
              <div className="flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{loadError}</span>
              </div>
              <button
                onClick={() => void load()}
                disabled={isLoading}
                className="inline-flex items-center space-x-1 px-3 py-1 rounded-full bg-white border border-rose-200 font-semibold hover:bg-rose-100 transition disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
                <span>Retry</span>
              </button>
            </div>
          ) : isLoading && jobs.length === 0 ? (
            <div role="status" className="flex items-center justify-center space-x-2 py-8 text-xs text-[#666666]">
              <Loader2 className="w-4 h-4 animate-spin text-[#74D96F]" />
              <span>Loading browser jobs...</span>
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-8 text-xs text-[#666666] space-y-2">
              <p>No browser jobs yet.</p>
              <button
                onClick={openLaunchModal}
                className="text-xs text-[#1F541D] font-bold hover:underline"
              >
                Launch your first job
              </button>
            </div>
          ) : (
            jobs.map((job) => {
              const isSelected = selectedJobId === job.id;
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
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-[#262626] truncate">
                      {job.agentName || "No agent"}
                    </span>
                    <span
                      className={`shrink-0 text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${statusStyle(job.status)}`}
                    >
                      {statusLabel(job.status)}
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
                    <span>{stepsOf(job).length} steps executed</span>
                  </div>
                </button>
              );
            })
          )}
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
                  <span className="font-mono text-xs font-bold text-[#262626]">
                    {selectedJob.agentName || "No agent"}
                  </span>
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full font-semibold uppercase bg-[#EDEDED] text-[#262626]">
                    Permission: {selectedJob.permissionLevel}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-[#262626] mt-1">{selectedJob.goal}</h2>
                <div className="flex items-center space-x-2 text-xs text-[#666666] mt-1">
                  <span className="font-mono text-[#262626] break-all">{selectedJob.targetUrl}</span>
                </div>
              </div>

              <div>
                <span
                  className={`text-xs px-3 py-1.5 rounded-full font-bold uppercase ${statusStyle(selectedJob.status)}`}
                >
                  {statusLabel(selectedJob.status)}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-[#666666] -mt-3">
              {STATUS_HINTS[selectedJob.status as JobStatus] ?? `Status: ${statusLabel(selectedJob.status)}`}
            </p>

            {/* Action error (e.g. a failed approve/reject) */}
            {actionError && (
              <div
                role="alert"
                className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800"
              >
                <div className="flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{actionError}</span>
                </div>
                <button
                  onClick={() => setActionError(null)}
                  aria-label="Dismiss error"
                  className="shrink-0 p-0.5 rounded-full hover:bg-rose-100 transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Human In The Loop Approval Action Card */}
            {selectedJob.status === "awaiting_approval" && (
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
                      {selectedJob.approvalRequest?.riskReason ||
                        `Permission level ${selectedJob.permissionLevel} requires human approval before this job can run.`}
                    </p>
                    <div className="mt-2 text-xs font-mono bg-white p-2.5 rounded-xl border border-amber-200 text-amber-900">
                      Action: {selectedJob.approvalRequest?.actionDescription || selectedJob.goal}
                    </div>
                    {selectedJob.approvalRequest?.requestedAt && (
                      <p className="mt-1.5 text-[10px] text-amber-900/80">
                        Requested {formatTimestamp(selectedJob.approvalRequest.requestedAt)}
                      </p>
                    )}
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
                      onClick={() => void handleDecision(selectedJob.id, "rejected")}
                      disabled={isDeciding}
                      className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-rose-700 text-xs font-semibold border border-[#BEBEBE]/40 transition disabled:opacity-50"
                    >
                      {isDeciding && decidingJobId === selectedJob.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5" />
                      )}
                      <span>Reject Action</span>
                    </button>
                    <button
                      onClick={() => void handleDecision(selectedJob.id, "approved")}
                      disabled={isDeciding}
                      className="inline-flex items-center space-x-1.5 px-5 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition shadow-xs disabled:opacity-50"
                    >
                      {isDeciding && decidingJobId === selectedJob.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
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
                <span>Playwright Execution Trace ({stepsOf(selectedJob).length} Steps)</span>
              </h3>

              <div className="space-y-2">
                {stepsOf(selectedJob).length === 0 && (
                  <div className="rounded-2xl border border-dashed border-[#BEBEBE] p-5 text-center text-xs text-[#666666]">
                    No steps recorded yet.
                  </div>
                )}
                {stepsOf(selectedJob).map((st, i) => (
                  <div
                    key={`${st.stepNumber}-${i}`}
                    className="flex items-center justify-between gap-3 p-3.5 rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] text-xs"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <span className="w-6 h-6 shrink-0 rounded-lg bg-white border border-[#BEBEBE]/60 flex items-center justify-center font-mono font-bold text-[10px] text-[#262626]">
                        {st.stepNumber}
                      </span>
                      <span className="font-mono text-[#262626] uppercase font-bold text-[11px] shrink-0">
                        [{st.action}]
                      </span>
                      <span className="text-[#262626] truncate">{st.details || st.target}</span>
                    </div>

                    <div className="flex items-center space-x-2 text-[10px] text-[#666666] shrink-0">
                      <span>{formatTimestamp(st.timestamp)}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full font-bold uppercase ${
                          st.status === "completed"
                            ? "text-[#1F541D] bg-[#74D96F]/20"
                            : st.status === "running"
                            ? "text-[#1F541D] bg-[#74D96F]/20 animate-pulse"
                            : st.status === "failed"
                            ? "text-rose-800 bg-rose-100"
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

            {/* Evidence Screenshots */}
            {selectedJob.evidenceUrls && selectedJob.evidenceUrls.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-[#262626] uppercase tracking-wider flex items-center space-x-1.5">
                  <Camera className="w-3.5 h-3.5 text-[#74D96F]" />
                  <span>Viewport Evidence Artifacts</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selectedJob.evidenceUrls.map((url, i) => (
                    <div
                      key={`${url}-${i}`}
                      className="rounded-2xl overflow-hidden border border-[#EDEDED] bg-[#F8F9FA] p-2.5 space-y-1.5"
                    >
                      {/^https?:\/\//i.test(url) ? (
                        <img
                          src={url}
                          alt={`Evidence screenshot ${i + 1}`}
                          className="w-full h-44 object-cover rounded-xl"
                        />
                      ) : (
                        <div className="w-full h-44 rounded-xl bg-white border border-[#EDEDED] flex items-center justify-center text-[10px] text-[#666666] font-mono px-3 text-center break-all">
                          {url}
                        </div>
                      )}
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
                <p className="text-xs text-[#262626] leading-relaxed font-mono whitespace-pre-wrap">
                  {selectedJob.outputSummary}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[#666666]">
            <Globe className="w-10 h-10 mb-2 opacity-40 text-[#74D96F]" />
            <p className="text-xs">
              {isLoading
                ? "Loading..."
                : loadError
                ? "Browser jobs could not be loaded."
                : jobs.length === 0
                ? "Launch a job to see its execution trace here."
                : "Select a browser job to inspect trace."}
            </p>
          </div>
        )}
      </div>

      {/* Modal: Launch New Browser Job */}
      {isLaunchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <form
            onSubmit={handleLaunchJob}
            noValidate
            className="w-full max-w-lg rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 shadow-2xl text-[#262626] space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
              <h3 className="font-bold text-sm text-[#262626]">Launch Autonomous Browser Job</h3>
              <button
                type="button"
                onClick={() => setIsLaunchModalOpen(false)}
                aria-label="Close"
                className="text-[#666666] hover:text-[#262626]"
              >
                ✕
              </button>
            </div>

            {launchError && (
              <div
                role="alert"
                className="flex items-start space-x-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{launchError}</span>
              </div>
            )}

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
              <label className="block text-xs font-semibold text-[#262626] mb-1">Target Initial URL (https only)</label>
              <input
                type="url"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://example.com/dashboard"
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Agent</label>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white"
              >
                <option value="">No specific agent</option>
                {activeAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (max {a.browserPermission})
                  </option>
                ))}
              </select>
              {agentsError ? (
                <p className="mt-1 text-[10px] text-amber-800">Agents unavailable: {agentsError}</p>
              ) : activeAgents.length === 0 ? (
                <p className="mt-1 text-[10px] text-[#666666]">No active agents. The job will run without an agent.</p>
              ) : selectedAgent ? (
                <p className="mt-1 text-[10px] text-[#666666]">
                  This agent is capped at {selectedAgent.browserPermission}; higher levels will be rejected.
                </p>
              ) : null}
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Permission Level</label>
              <select
                value={permissionLevel}
                onChange={(e) => setPermissionLevel(e.target.value as BrowserPermissionLevel)}
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white"
              >
                {PERMISSION_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {PERMISSION_LABELS[level]}
                  </option>
                ))}
              </select>
              {(permissionLevel === "B3" || permissionLevel === "B4") && (
                <p className="mt-1 text-[10px] text-amber-800">
                  This level pauses the job until an admin approves it.
                </p>
              )}
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-[#EDEDED]">
              <button
                type="button"
                onClick={() => setIsLaunchModalOpen(false)}
                disabled={isLaunching}
                className="px-4 py-2 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-xs text-[#262626] font-semibold transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLaunching}
                className="inline-flex items-center space-x-1.5 px-5 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs text-[#262626] font-bold shadow-sm transition disabled:opacity-50"
              >
                {isLaunching ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Dispatching...</span>
                  </>
                ) : (
                  <span>Dispatch to Sandbox Worker</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
