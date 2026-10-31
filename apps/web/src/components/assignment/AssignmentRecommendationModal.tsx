"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  User,
  X,
  Loader2,
  Award,
  ArrowRight,
  TrendingUp,
  Clock,
  Briefcase,
  HelpCircle,
} from "lucide-react";
import type { Task, EmployeeProfile, AssignmentRecommendation } from "../../types";
import { api } from "../../services/api";

interface AssignmentModalProps {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  onAssigned: (taskId: string, assigneeId: string, assigneeName: string) => void;
  employees: EmployeeProfile[];
}

export function AssignmentRecommendationModal({
  task,
  isOpen,
  onClose,
  onAssigned,
  employees,
}: AssignmentModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<AssignmentRecommendation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showScoreDetails, setShowScoreDetails] = useState(false);
  const [isOverrideMode, setIsOverrideMode] = useState(false);
  const [selectedOverrideId, setSelectedOverrideId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const loadRecommendation = async () => {
    setLoading(true);
    setError(null);
    try {
      const rec = await api.getTaskAssignmentRecommendation(task.id);
      setRecommendation(rec);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load assignment recommendation.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && task.id) {
      void loadRecommendation();
      setIsOverrideMode(false);
      setSelectedOverrideId("");
      setOverrideReason("");
      setShowScoreDetails(false);
    }
  }, [isOpen, task.id]);

  if (!isOpen) return null;

  const handleApprove = async () => {
    if (!recommendation?.recommended?.employeeId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const empId = recommendation.recommended.employeeId;
      await api.approveTaskAssignment(task.id, {
        action: "approve",
        finalAssigneeId: empId,
      });
      const resolvedName =
        recommendation.recommended.name ||
        employees.find((e) => e.id === empId || e.userId === empId)
          ? `${employees.find((e) => e.id === empId || e.userId === empId)?.firstName} ${
              employees.find((e) => e.id === empId || e.userId === empId)?.lastName
            }`.trim()
          : "Assigned";
      onAssigned(task.id, empId, resolvedName);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to approve assignment.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectAlternative = async (altEmployeeId: string, altName: string) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await api.approveTaskAssignment(task.id, {
        action: "override",
        finalAssigneeId: altEmployeeId,
        overrideReason: `Selected ranked alternative: ${altName}`,
      });
      onAssigned(task.id, altEmployeeId, altName);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to assign alternative.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOverrideId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.approveTaskAssignment(task.id, {
        action: "override",
        finalAssigneeId: selectedOverrideId,
        overrideReason: overrideReason.trim() || "Manual manager assignment",
      });
      const emp = employees.find((e) => e.id === selectedOverrideId || e.userId === selectedOverrideId);
      const name = emp ? `${emp.firstName} ${emp.lastName}`.trim() : "Assigned";
      onAssigned(task.id, selectedOverrideId, name);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to override assignment.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDismiss = async () => {
    setIsSubmitting(true);
    try {
      await api.dismissTaskAssignment(task.id);
      onClose();
    } catch {
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const candidate = recommendation?.recommended;
  const breakdown = candidate?.scoreBreakdown;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Workload-Aware Task Assignment"
      onMouseDown={(e) => e.target === e.currentTarget && !isSubmitting && onClose()}
    >
      <div className="w-full max-w-2xl rounded-3xl bg-white border border-[#EDEDED] shadow-2xl text-[#262626] overflow-hidden my-6 animate-scale-in">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-[#0D382E] to-[#124B3E] px-6 py-5 text-white flex items-start justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 rounded-full bg-[#74D96F]/10 blur-2xl pointer-events-none" />
          <div className="flex items-start space-x-3.5 relative z-10">
            <div className="w-10 h-10 rounded-2xl bg-[#74D96F]/20 border border-[#74D96F]/40 flex items-center justify-center text-[#74D96F] shrink-0 mt-0.5">
              <Sparkles className="w-5 h-5 text-[#74D96F]" />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-[#74D96F] mb-0.5">
                Workload-Aware Assignment Engine
              </div>
              <h2 className="text-lg font-black tracking-tight text-white">Smart Assignee Recommendation</h2>
              <p className="text-xs text-white/75 mt-0.5">
                Balanced deterministic matching: demonstrated delivery (45%), reliability (25%), verified skills (15%), & capacity buffer (15%)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
            className="text-white/60 hover:text-white p-1 rounded-full hover:bg-white/10 transition cursor-pointer relative z-10 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Task Summary Banner */}
        <div className="bg-[#F8F9FA] px-6 py-3 border-b border-[#EDEDED] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-[#262626] line-clamp-1 max-w-[280px]">{task.title}</span>
            <span
              className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                task.priority === "urgent"
                  ? "bg-rose-100 text-rose-800 border border-rose-200"
                  : task.priority === "high"
                  ? "bg-amber-100 text-amber-900 border border-amber-200"
                  : "bg-white text-[#262626] border border-[#EDEDED]"
              }`}
            >
              {task.priority}
            </span>
          </div>

          <div className="flex items-center space-x-2 text-[11px] text-[#666666]">
            {task.requiredSkills && task.requiredSkills.length > 0 && (
              <div className="flex items-center space-x-1">
                <span className="font-semibold text-[#262626]">Required skills:</span>
                <div className="flex flex-wrap gap-1">
                  {task.requiredSkills.map((sk) => (
                    <span
                      key={sk}
                      className="px-2 py-0.5 rounded-md bg-[#EDEDED] text-[10px] font-medium text-[#262626]"
                    >
                      {sk}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {error && (
            <div
              role="alert"
              className="flex items-start space-x-2.5 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-[#74D96F]" />
              <p className="text-xs font-semibold text-[#666666]">
                Evaluating workload capacity, verified CV skills, & past delivery history...
              </p>
            </div>
          ) : recommendation?.status === "no_match" || !candidate ? (
            /* No Match State */
            <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5 space-y-3 text-center">
              <div className="w-12 h-12 rounded-full bg-amber-100 border border-amber-300 text-amber-800 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-amber-950">Skill & Capacity Gap Detected</h3>
              <p className="text-xs text-amber-900 max-w-md mx-auto leading-relaxed">
                {recommendation?.explanation ||
                  "No active employee with matching skills is currently within safe workload capacity limits."}
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setIsOverrideMode(true)}
                  className="px-4 py-2 rounded-full bg-[#0D382E] text-white text-xs font-bold hover:bg-[#124B3E] transition shadow-xs cursor-pointer"
                >
                  Manually Assign Eligible Employee
                </button>
              </div>
            </div>
          ) : (
            /* Primary Recommendation Card */
            <div className="space-y-4">
              <div className="rounded-3xl border-2 border-[#74D96F] bg-gradient-to-b from-[#74D96F]/8 to-transparent p-5 space-y-4 shadow-sm relative">
                {/* Confidence & Badges */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[#0D382E] text-white">
                      ★ TOP RECOMMENDED
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                        recommendation.confidence === "high"
                          ? "bg-[#74D96F]/25 text-[#1F541D] border border-[#74D96F]/40"
                          : recommendation.confidence === "medium"
                          ? "bg-amber-100 text-amber-800 border border-amber-300"
                          : "bg-[#EDEDED] text-[#666666] border border-[#BEBEBE]"
                      }`}
                    >
                      {recommendation.confidence === "high"
                        ? "High Confidence"
                        : recommendation.confidence === "medium"
                        ? "Medium Confidence"
                        : "Low Confidence (Sparse Data)"}
                    </span>
                  </div>

                  {candidate.overloadWarning && (
                    <span className="text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2.5 py-0.5 rounded-full flex items-center space-x-1">
                      <AlertTriangle className="w-3 h-3 text-amber-700" />
                      <span>75% Capacity Buffer Reached</span>
                    </span>
                  )}
                </div>

                {/* Candidate Info */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center space-x-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-[#0D382E] text-[#74D96F] font-black text-base flex items-center justify-center border border-[#74D96F]/40 shadow-xs shrink-0">
                      {candidate.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2) || "U"}
                    </div>
                    <div>
                      <h3 className="text-base font-extrabold text-[#262626] tracking-tight">{candidate.name}</h3>
                      <p className="text-xs text-[#666666] font-medium">{candidate.designation || "Team Member"}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={isSubmitting}
                    className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] active:scale-95 text-[#13381B] text-xs font-black shadow-md shadow-[#74D96F]/30 transition disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-[#13381B]" />
                    )}
                    <span>Approve Assignment</span>
                  </button>
                </div>

                {/* Explainable Rationale */}
                <div className="rounded-2xl bg-white border border-[#EDEDED] p-3.5 text-xs text-[#262626] space-y-1.5 shadow-2xs">
                  <div className="text-[10px] font-bold text-[#666666] uppercase tracking-wider flex items-center space-x-1">
                    <TrendingUp className="w-3 h-3 text-[#56BE51]" />
                    <span>Decision Rationale</span>
                  </div>
                  <p className="leading-relaxed font-medium">
                    {candidate.explanation || recommendation.explanation || "Best overall match based on historical performance."}
                  </p>
                </div>

                {/* Score Breakdown (Admin / Owners privileged details) */}
                {breakdown && (
                  <div className="border-t border-[#74D96F]/30 pt-3">
                    <button
                      type="button"
                      onClick={() => setShowScoreDetails((v) => !v)}
                      className="text-[11px] font-bold text-[#0D382E] hover:text-[#124B3E] flex items-center space-x-1 cursor-pointer"
                    >
                      <span>{showScoreDetails ? "Hide Score Breakdown" : "View Signal Breakdown (Privileged)"}</span>
                      {showScoreDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    {showScoreDetails && (
                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 animate-fade-in text-xs">
                        <div className="rounded-2xl border border-[#EDEDED] bg-white p-2.5">
                          <span className="text-[10px] text-[#666666] block font-medium">Similar Work (45%)</span>
                          <span className="text-sm font-black text-[#262626]">
                            {Math.round(breakdown.similar_work * 100)}%
                          </span>
                        </div>
                        <div className="rounded-2xl border border-[#EDEDED] bg-white p-2.5">
                          <span className="text-[10px] text-[#666666] block font-medium">Reliability (25%)</span>
                          <span className="text-sm font-black text-[#262626]">
                            {Math.round(breakdown.reliability * 100)}%
                          </span>
                        </div>
                        <div className="rounded-2xl border border-[#EDEDED] bg-white p-2.5">
                          <span className="text-[10px] text-[#666666] block font-medium">Verified Skills (15%)</span>
                          <span className="text-sm font-black text-[#262626]">
                            {Math.round(breakdown.skills * 100)}%
                          </span>
                        </div>
                        <div className="rounded-2xl border border-[#EDEDED] bg-white p-2.5">
                          <span className="text-[10px] text-[#666666] block font-medium">Capacity Buffer (15%)</span>
                          <span className="text-sm font-black text-[#262626]">
                            {Math.round(breakdown.capacity * 100)}%
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Up to 3 Alternatives */}
              {recommendation.alternatives && recommendation.alternatives.length > 0 && (
                <div className="space-y-2 pt-2">
                  <div className="text-xs font-bold text-[#262626] uppercase tracking-wider flex items-center justify-between">
                    <span>Ranked Alternatives</span>
                    <span className="text-[10px] text-[#666666] font-normal">
                      Up to 3 qualified alternatives available
                    </span>
                  </div>

                  <div className="space-y-2">
                    {recommendation.alternatives.map((alt) => (
                      <div
                        key={alt.employeeId}
                        className="rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] p-3 flex items-center justify-between gap-3 hover:bg-white hover:border-[#BEBEBE] transition shadow-2xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-bold text-[#262626] truncate">{alt.name}</span>
                            {alt.overloadWarning && (
                              <span className="text-[9px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                                Protected Capacity
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[#666666] line-clamp-1 mt-0.5">{alt.explanation}</p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleSelectAlternative(alt.employeeId, alt.name)}
                          disabled={isSubmitting}
                          className="px-3 py-1.5 rounded-full bg-white border border-[#DCE4E0] hover:border-[#74D96F] text-[#262626] text-[11px] font-bold shadow-2xs transition disabled:opacity-50 cursor-pointer shrink-0"
                        >
                          Select Alternative
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Manual Override Accordion */}
          <div className="border-t border-[#EDEDED] pt-4">
            {!isOverrideMode ? (
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#666666]">Need to assign someone else?</span>
                <button
                  type="button"
                  onClick={() => setIsOverrideMode(true)}
                  className="font-bold text-[#0D382E] hover:underline cursor-pointer"
                >
                  Manual Assign & Override
                </button>
              </div>
            ) : (
              <form onSubmit={handleManualOverride} className="rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#262626]">Manual Assign & Override</span>
                  <button
                    type="button"
                    onClick={() => setIsOverrideMode(false)}
                    className="text-[11px] text-[#666666] hover:text-[#262626] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#262626] mb-1">Select Employee</label>
                  <select
                    value={selectedOverrideId}
                    onChange={(e) => setSelectedOverrideId(e.target.value)}
                    className="w-full rounded-xl border border-[#BEBEBE]/60 bg-white px-3 py-2 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F]"
                    required
                  >
                    <option value="">Choose an eligible employee...</option>
                    {employees
                      .filter((e) => e.employmentStatus === "active")
                      .map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {`${emp.firstName} ${emp.lastName}`.trim() || emp.workEmail}
                          {emp.designation ? ` (${emp.designation})` : ""}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#262626] mb-1">
                    Override Reason (Audit Logged)
                  </label>
                  <input
                    type="text"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="e.g. Employee requested this initiative for domain upskilling"
                    className="w-full rounded-xl border border-[#BEBEBE]/60 bg-white px-3 py-2 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F]"
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={isSubmitting || !selectedOverrideId}
                    className="px-4 py-2 rounded-full bg-[#0D382E] hover:bg-[#124B3E] text-white text-xs font-bold shadow-xs transition disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting ? "Assigning..." : "Confirm Override"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-[#F8F9FA] px-6 py-4 border-t border-[#EDEDED] flex items-center justify-between text-xs">
          <div className="flex items-center space-x-1.5 text-[11px] text-[#666666]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#56BE51]" />
            <span>Human-in-the-loop: Final assignment is only committed upon your approval.</span>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-full border border-[#DCE4E0] bg-white hover:bg-[#EDEDED] text-[#262626] font-semibold transition cursor-pointer"
          >
            Leave Unassigned
          </button>
        </div>
      </div>
    </div>
  );
}
