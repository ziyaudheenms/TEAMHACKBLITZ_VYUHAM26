"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Video,
  Sparkles,
  Calendar,
  Users,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Plus,
  Search,
  Trash2,
  Edit3,
  X,
  FileText,
  Clock,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
} from "lucide-react";
import { api } from "../../services/api";
import { ApiError } from "../../services/http";
import { Meeting, Project } from "../../types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return err.status === 0 ? "Cannot reach the server. Check that the API is running and try again." : err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Formats an ISO timestamp; falls back to the raw text (or a placeholder) rather than "Invalid Date". */
function formatDateTime(value?: string | null): string {
  if (!value) return "Date not set";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDate(value?: string | null): string {
  if (!value) return "No date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Action-item due dates are produced by the AI and may be free-form text; show them as-is when unparseable. */
function formatActionDue(value?: string | null): string | null {
  if (!value || !value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function toLocalInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [editedNotes, setEditedNotes] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // New Meeting Form State
  const [newTitle, setNewTitle] = useState("");
  const [newProjectId, setNewProjectId] = useState("");
  const [newDate, setNewDate] = useState(() => toLocalInputValue(new Date()));
  const [newDuration, setNewDuration] = useState(45);
  const [newAttendees, setNewAttendees] = useState("");
  const [newAgenda, setNewAgenda] = useState("");
  const [newMinutes, setNewMinutes] = useState("");
  const [isSubmittingNew, setIsSubmittingNew] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Tracks which meeting is on screen so late async results never overwrite another meeting's view.
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedMeeting?.id ?? null;
  }, [selectedMeeting]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const meetingData = await api.getMeetings();
      setMeetings(meetingData);
      const keep = meetingData.find((m) => m.id === selectedIdRef.current);
      if (keep) {
        setSelectedMeeting(keep);
      } else {
        const next = meetingData[0] ?? null;
        setSelectedMeeting(next);
        setEditedNotes(next?.minutesContent || "");
        setIsEditingNotes(false);
      }
    } catch (err) {
      setLoadError(errorMessage(err, "Failed to load meetings."));
    } finally {
      setIsLoading(false);
    }
    // Projects are only used for the optional project picker; don't block the page on them.
    try {
      setProjects(await api.getProjects());
      setProjectsError(null);
    } catch (err) {
      setProjects([]);
      setProjectsError(errorMessage(err, "Could not load projects."));
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSelectMeeting = (m: Meeting) => {
    setSelectedMeeting(m);
    setEditedNotes(m.minutesContent || "");
    setIsEditingNotes(false);
    setDetailError(null);
  };

  const showFeedback = (msg: string) => {
    setFeedbackMessage(msg);
    setTimeout(() => setFeedbackMessage(null), 3500);
  };

  /** Merge a server-returned meeting into list + detail state (only touching the detail if it is still on screen). */
  const applyServerMeeting = (updated: Meeting, resetNotes: boolean) => {
    setMeetings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    setSelectedMeeting((prev) => (prev && prev.id === updated.id ? updated : prev));
    if (resetNotes && selectedIdRef.current === updated.id) {
      setEditedNotes(updated.minutesContent || "");
      setIsEditingNotes(false);
    }
  };

  const handleExtractActionItems = async () => {
    if (!selectedMeeting || isExtracting) return;
    const meetingId = selectedMeeting.id;
    const minutes = (isEditingNotes ? editedNotes : selectedMeeting.minutesContent) ?? "";
    if (!minutes.trim()) {
      setDetailError("Add some meeting notes or a transcript first. There is nothing to extract action items from yet.");
      return;
    }

    setDetailError(null);
    setIsExtracting(true);
    try {
      const updated = await api.extractActionItems(meetingId, minutes);
      applyServerMeeting(updated, true);
      const count = updated.extractedActionItems?.length ?? 0;
      showFeedback(
        count > 0
          ? `Extracted ${count} action ${count === 1 ? "item" : "items"} with AI summary!`
          : "Analysis finished, but no action items were found in the notes."
      );
    } catch (err) {
      if (selectedIdRef.current === meetingId) {
        setDetailError(
          `Action item extraction failed: ${errorMessage(err, "The AI engine did not respond.")} Your notes were not changed; you can retry.`
        );
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedMeeting || isSavingNotes) return;
    setDetailError(null);
    setIsSavingNotes(true);
    try {
      const updated = await api.updateMeeting(selectedMeeting.id, {
        minutesContent: editedNotes,
      });
      applyServerMeeting(updated, true);
      showFeedback("Meeting notes updated successfully.");
    } catch (err) {
      setDetailError(`Could not save notes: ${errorMessage(err, "Failed to update notes.")}`);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleConvertToTask = async (actionId: string) => {
    if (!selectedMeeting || convertingId) return;
    const meetingId = selectedMeeting.id;
    setDetailError(null);
    setConvertingId(actionId);
    try {
      await api.convertActionItemToTask(meetingId, actionId);
    } catch (err) {
      if (selectedIdRef.current === meetingId) {
        setDetailError(`Could not convert to a task: ${errorMessage(err, "Failed to convert action item.")}`);
      }
      setConvertingId(null);
      return;
    }

    // The task exists now; refresh the meeting so the item shows as synced.
    try {
      const fresh = await api.getMeeting(meetingId);
      applyServerMeeting(fresh, false);
      showFeedback("Action item converted and synchronized to Kanban tasks!");
    } catch (err) {
      if (selectedIdRef.current === meetingId) {
        setDetailError(
          `The task was created, but the meeting could not be refreshed: ${errorMessage(err, "Refresh failed.")} Reload to see the latest state, and avoid converting this item again.`
        );
      }
    } finally {
      setConvertingId(null);
    }
  };

  const handleDeleteMeeting = async (meetingId: string) => {
    if (isDeleting) return;
    if (!confirm("Are you sure you want to delete this meeting record?")) return;
    setDetailError(null);
    setIsDeleting(true);
    try {
      await api.deleteMeeting(meetingId);
      const remaining = meetings.filter((m) => m.id !== meetingId);
      setMeetings(remaining);
      const next = remaining[0] ?? null;
      setSelectedMeeting(next);
      setEditedNotes(next?.minutesContent || "");
      setIsEditingNotes(false);
      showFeedback("Meeting deleted successfully.");
    } catch (err) {
      setDetailError(`Could not delete meeting: ${errorMessage(err, "Failed to delete.")}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const openNewModal = () => {
    setCreateError(null);
    setNewDate(toLocalInputValue(new Date()));
    setIsNewModalOpen(true);
  };

  const handleCreateMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingNew || !newTitle.trim()) return;

    const when = new Date(newDate);
    if (!newDate || Number.isNaN(when.getTime())) {
      setCreateError("Please choose a valid date and time.");
      return;
    }

    setIsSubmittingNew(true);
    setCreateError(null);
    try {
      const attendeeList = newAttendees
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a.length > 0);

      const created = await api.createMeeting({
        title: newTitle.trim(),
        agenda: newAgenda.trim() || undefined,
        meetingDate: when.toISOString(),
        durationMinutes: Number(newDuration) || 30,
        projectId: UUID_RE.test(newProjectId) ? newProjectId : undefined,
        participantIds: [],
        participantNames: attendeeList,
        minutesContent: newMinutes.trim() || undefined,
      });

      setMeetings((prev) => [created, ...prev]);
      setSelectedMeeting(created);
      setEditedNotes(created.minutesContent || "");
      setIsEditingNotes(false);
      setDetailError(null);
      setIsNewModalOpen(false);

      // Reset form
      setNewTitle("");
      setNewProjectId("");
      setNewAttendees("");
      setNewAgenda("");
      setNewMinutes("");
      showFeedback("Meeting notes recorded successfully!");
    } catch (err) {
      setCreateError(errorMessage(err, "Failed to create meeting."));
    } finally {
      setIsSubmittingNew(false);
    }
  };

  const copyTranscriptToClipboard = async () => {
    if (!selectedMeeting?.minutesContent) return;
    try {
      await navigator.clipboard.writeText(selectedMeeting.minutesContent);
      setCopiedTranscript(true);
      setTimeout(() => setCopiedTranscript(false), 2000);
    } catch {
      setDetailError("Could not copy to the clipboard. Select the text and copy it manually.");
    }
  };

  const filteredMeetings = meetings.filter((m) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.title.toLowerCase().includes(q) ||
      (m.projectName && m.projectName.toLowerCase().includes(q)) ||
      (m.minutesContent && m.minutesContent.toLowerCase().includes(q)) ||
      (m.agenda && m.agenda.toLowerCase().includes(q))
    );
  });

  const selectedItems = selectedMeeting?.extractedActionItems ?? [];

  return (
    <div className="flex h-[calc(100vh-6.5rem)] flex-col md:flex-row gap-6 relative">
      {/* Toast Feedback Notification */}
      {feedbackMessage && (
        <div
          role="status"
          className="absolute top-2 right-6 z-50 flex items-center space-x-2 bg-[#262626] text-white px-4 py-2.5 rounded-2xl shadow-lg text-xs font-semibold animate-fade-in border border-[#BEBEBE]/30"
        >
          <CheckCircle2 className="w-4 h-4 text-[#74D96F]" />
          <span>{feedbackMessage}</span>
        </div>
      )}

      {/* Left List of Meetings */}
      <div className="w-full md:w-80 flex flex-col shrink-0 rounded-3xl border border-[#BEBEBE]/40 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
          <div className="flex items-center space-x-2">
            <Video className="w-4 h-4 text-[#74D96F]" />
            <span className="font-bold text-sm text-[#262626]">Meeting Hub & OCR</span>
          </div>
          <button
            onClick={openNewModal}
            className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-[#74D96F]/15 hover:bg-[#74D96F]/30 text-[#1F541D] text-xs font-bold transition"
            title="Record New Meeting"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="mt-3 relative">
          <Search className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search meetings & notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#F8F9FA] border border-[#EDEDED] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#262626] focus:outline-hidden focus:border-[#74D96F] transition"
          />
        </div>

        <div className="mt-3 flex-1 overflow-y-auto space-y-2 pr-1">
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
                onClick={() => void loadData()}
                disabled={isLoading}
                className="inline-flex items-center space-x-1 px-3 py-1 rounded-full bg-white border border-rose-200 font-semibold hover:bg-rose-100 transition disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
                <span>Retry</span>
              </button>
            </div>
          ) : isLoading ? (
            <div role="status" className="flex items-center justify-center space-x-2 py-8 text-xs text-[#666666]">
              <Loader2 className="w-4 h-4 animate-spin text-[#74D96F]" />
              <span>Loading meetings...</span>
            </div>
          ) : filteredMeetings.length === 0 ? (
            <div className="text-center py-8 text-xs text-[#666666]">
              {searchQuery ? "No matching meetings found" : "No meetings recorded yet"}
            </div>
          ) : (
            filteredMeetings.map((m) => {
              const isSelected = selectedMeeting?.id === m.id;
              const actionItemCount = m.extractedActionItems ? m.extractedActionItems.length : 0;
              const convertedCount = m.extractedActionItems
                ? m.extractedActionItems.filter((a) => a.convertedToTask).length
                : 0;

              return (
                <button
                  key={m.id}
                  onClick={() => handleSelectMeeting(m)}
                  className={`w-full text-left p-3.5 rounded-2xl transition flex flex-col space-y-1.5 border ${
                    isSelected
                      ? "bg-[#EDEDED]/90 border-[#74D96F] text-[#262626] shadow-xs"
                      : "bg-white border-[#EDEDED] hover:bg-[#EDEDED]/40 text-[#666666] hover:text-[#262626]"
                  }`}
                >
                  <div className="text-xs font-bold text-[#262626] line-clamp-1">{m.title}</div>
                  <div className="flex items-center justify-between text-[10px] text-[#666666]">
                    <span className="flex items-center space-x-1">
                      <Calendar className="w-3 h-3 text-[#74D96F]" />
                      <span>{formatShortDate(m.meetingDate)}</span>
                    </span>
                    <span>{m.durationMinutes} mins</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-[#262626] font-semibold pt-0.5">
                    <span>
                      {actionItemCount} {actionItemCount === 1 ? "action item" : "action items"}
                    </span>
                    {convertedCount > 0 && (
                      <span className="text-[#1F541D] flex items-center space-x-0.5">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        <span>{convertedCount} synced</span>
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column: Minutes & AI Action Items Extractor */}
      <div className="flex-1 flex flex-col rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 shadow-sm overflow-hidden">
        {selectedMeeting ? (
          <div className="flex-1 flex flex-col overflow-y-auto pr-1 space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#EDEDED]">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="text-[10px] font-bold text-[#666666] uppercase tracking-wider bg-[#EDEDED] px-2 py-0.5 rounded-md">
                    {selectedMeeting.projectName || "General"}
                  </span>
                  <span className="text-[10px] text-[#666666] flex items-center space-x-1">
                    <Clock className="w-3 h-3 text-[#74D96F]" />
                    <span>{selectedMeeting.durationMinutes} mins</span>
                  </span>
                </div>
                <h1 className="text-xl font-extrabold text-[#262626]">{selectedMeeting.title}</h1>
                <div className="flex items-center space-x-3 text-xs text-[#666666]">
                  <span className="flex items-center space-x-1">
                    <Calendar className="w-3.5 h-3.5 text-[#74D96F]" />
                    <span>{formatDateTime(selectedMeeting.meetingDate)}</span>
                  </span>
                  {selectedMeeting.agenda && (
                    <>
                      <span>•</span>
                      <span className="line-clamp-1 italic text-[#666666]">
                        Agenda: {selectedMeeting.agenda}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => void handleDeleteMeeting(selectedMeeting.id)}
                  disabled={isDeleting || isExtracting}
                  className="p-2 rounded-full text-[#666666] hover:text-rose-600 hover:bg-rose-50 transition disabled:opacity-50"
                  title="Delete Meeting"
                  aria-label="Delete meeting"
                >
                  {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>

                <button
                  onClick={() => void handleExtractActionItems()}
                  disabled={isExtracting}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {isExtracting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Analyzing with AI...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>AI Action Item Extractor</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Extraction progress */}
            {isExtracting && (
              <div
                role="status"
                className="flex items-start space-x-3 rounded-2xl border border-[#74D96F]/40 bg-[#74D96F]/10 p-4 text-xs text-[#1F541D]"
              >
                <Loader2 className="w-4 h-4 mt-0.5 animate-spin shrink-0" />
                <div className="space-y-0.5">
                  <p className="font-bold">The AI engine is reading your notes</p>
                  <p className="text-[#262626]">
                    Extracting a summary and action items can take up to a minute. Keep this page open.
                  </p>
                </div>
              </div>
            )}

            {/* Action error */}
            {detailError && (
              <div
                role="alert"
                className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800"
              >
                <div className="flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{detailError}</span>
                </div>
                <button
                  onClick={() => setDetailError(null)}
                  aria-label="Dismiss error"
                  className="shrink-0 p-0.5 rounded-full hover:bg-rose-100 transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Participants */}
            <div className="flex items-center space-x-2 text-xs text-[#666666] bg-[#F8F9FA] p-3 rounded-2xl border border-[#EDEDED]">
              <Users className="w-4 h-4 text-[#74D96F] shrink-0" />
              <span className="font-bold text-[#262626]">Attendees:</span>
              <span className="text-[#262626]">
                {selectedMeeting.participantNames && selectedMeeting.participantNames.length > 0
                  ? selectedMeeting.participantNames.join(", ")
                  : "No attendees recorded"}
              </span>
            </div>

            {/* AI Executive Summary Card */}
            {selectedMeeting.aiSummary && (
              <div className="rounded-2xl border border-[#74D96F]/40 bg-[#74D96F]/10 p-4 space-y-1.5 shadow-xs">
                <div className="flex items-center space-x-2 text-[#1F541D] text-xs font-bold">
                  <Sparkles className="w-4 h-4 text-[#1F541D]" />
                  <span>AI Executive Summary</span>
                </div>
                <p className="text-xs text-[#262626] leading-relaxed">
                  {selectedMeeting.aiSummary}
                </p>
              </div>
            )}

            {/* Extracted Action Items Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-[#262626] uppercase tracking-wider flex items-center space-x-1.5">
                    <span>Extracted Action Items</span>
                    <span className="bg-[#74D96F]/20 text-[#1F541D] text-[10px] px-2 py-0.5 rounded-full font-bold">
                      {selectedItems.length}
                    </span>
                  </h3>
                  <p className="text-[11px] text-[#666666]">
                    Identified from the discussion; convert to Kanban tasks with one click.
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                {selectedItems.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#BEBEBE] p-6 text-center text-xs text-[#666666] space-y-2">
                    <p>No action items extracted yet.</p>
                    <button
                      onClick={() => void handleExtractActionItems()}
                      disabled={isExtracting}
                      className="inline-flex items-center space-x-1 text-xs text-[#1F541D] font-bold hover:underline disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Run AI Action Item Extractor</span>
                    </button>
                  </div>
                ) : (
                  selectedItems.map((act) => {
                    const due = formatActionDue(act.dueDate);
                    return (
                      <div
                        key={act.id}
                        className="rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:border-[#BEBEBE] transition shadow-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span
                              className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                act.priority === "urgent"
                                  ? "bg-rose-100 text-rose-800 border border-rose-200"
                                  : act.priority === "high"
                                  ? "bg-amber-100 text-amber-900 border border-amber-200"
                                  : "bg-[#EDEDED] text-[#262626]"
                              }`}
                            >
                              {act.priority}
                            </span>
                            <h4 className="text-xs font-bold text-[#262626]">{act.title}</h4>
                          </div>
                          <div className="flex items-center space-x-3 text-[11px] text-[#666666]">
                            <span>
                              Assignee:{" "}
                              <strong className="text-[#262626] font-semibold">
                                {act.assignee && act.assignee !== "null" ? act.assignee : "Unassigned"}
                              </strong>
                            </span>
                            {due && (
                              <span>
                                Due: <strong className="text-[#262626] font-semibold">{due}</strong>
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Convert Button */}
                        <div className="shrink-0">
                          {act.convertedToTask ? (
                            <span className="inline-flex items-center space-x-1 text-xs text-[#1F541D] font-bold px-3 py-1.5 rounded-full bg-[#74D96F]/20 border border-[#74D96F]/40">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Synced to Kanban</span>
                            </span>
                          ) : (
                            <button
                              onClick={() => void handleConvertToTask(act.id)}
                              disabled={convertingId !== null}
                              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
                            >
                              {convertingId === act.id ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  <span>Converting...</span>
                                </>
                              ) : (
                                <>
                                  <span>Convert to Task</span>
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Raw Minutes Transcript & OCR Notes */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[#262626] uppercase tracking-wider flex items-center space-x-1.5">
                  <FileText className="w-3.5 h-3.5 text-[#74D96F]" />
                  <span>Full Notes & OCR Transcript</span>
                </h3>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => void copyTranscriptToClipboard()}
                    disabled={!selectedMeeting.minutesContent}
                    className="p-1.5 rounded-lg text-[#666666] hover:bg-[#EDEDED] text-[11px] font-semibold flex items-center space-x-1 transition disabled:opacity-40"
                    title="Copy notes"
                  >
                    {copiedTranscript ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span className="text-emerald-600">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      if (isEditingNotes) setEditedNotes(selectedMeeting.minutesContent || "");
                      setIsEditingNotes(!isEditingNotes);
                    }}
                    disabled={isSavingNotes}
                    className="p-1.5 rounded-lg text-[#666666] hover:bg-[#EDEDED] text-[11px] font-semibold flex items-center space-x-1 transition disabled:opacity-50"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>{isEditingNotes ? "Cancel" : "Edit Notes"}</span>
                  </button>
                </div>
              </div>

              {isEditingNotes ? (
                <div className="space-y-3">
                  <textarea
                    rows={8}
                    value={editedNotes}
                    onChange={(e) => setEditedNotes(e.target.value)}
                    placeholder="Enter or paste meeting minutes, OCR transcript, or audio notes..."
                    className="w-full p-4 rounded-2xl border border-[#74D96F] bg-white text-xs text-[#262626] font-mono leading-relaxed focus:outline-hidden"
                  />
                  <div className="flex items-center justify-end space-x-2">
                    <button
                      onClick={() => {
                        setEditedNotes(selectedMeeting.minutesContent || "");
                        setIsEditingNotes(false);
                      }}
                      disabled={isSavingNotes}
                      className="px-4 py-1.5 rounded-full border border-[#EDEDED] text-xs font-semibold text-[#666666] hover:bg-[#EDEDED]/50 transition disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void handleSaveNotes()}
                      disabled={isSavingNotes}
                      className="px-4 py-1.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs font-bold text-[#262626] transition disabled:opacity-50"
                    >
                      {isSavingNotes ? "Saving..." : "Save Notes"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] text-xs text-[#262626] leading-relaxed font-mono whitespace-pre-wrap">
                  {selectedMeeting.minutesContent || "No raw minutes recorded."}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[#666666]">
            <Video className="w-10 h-10 mb-2 opacity-40 text-[#74D96F]" />
            <p className="text-xs">
              {isLoading
                ? "Loading..."
                : loadError
                ? "Meetings could not be loaded."
                : meetings.length === 0
                ? "No meetings yet. Record your first meeting to extract action items."
                : "Select a meeting to view minutes and action items."}
            </p>
          </div>
        )}
      </div>

      {/* New Meeting Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl border border-[#BEBEBE]/40 shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
              <div className="flex items-center space-x-2">
                <Video className="w-5 h-5 text-[#74D96F]" />
                <h2 className="font-extrabold text-base text-[#262626]">Record Meeting Notes</h2>
              </div>
              <button
                onClick={() => setIsNewModalOpen(false)}
                aria-label="Close"
                className="p-1 rounded-full text-[#666666] hover:bg-[#EDEDED] transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateMeeting} className="space-y-4">
              {createError && (
                <div
                  role="alert"
                  className="flex items-start space-x-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
                >
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-[#262626] mb-1">
                  Meeting Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sprint Architecture Sync & Vector RAG Review"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#EDEDED] focus:border-[#74D96F] focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#262626] mb-1">Project</label>
                  <select
                    value={newProjectId}
                    onChange={(e) => setNewProjectId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#EDEDED] focus:border-[#74D96F] focus:outline-hidden bg-white"
                  >
                    <option value="">General (No project)</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {projectsError && (
                    <p className="mt-1 text-[10px] text-amber-800">Projects unavailable: {projectsError}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#262626] mb-1">
                    Duration (Minutes)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={480}
                    value={newDuration}
                    onChange={(e) => setNewDuration(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#EDEDED] focus:border-[#74D96F] focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#262626] mb-1">Date & Time</label>
                <input
                  type="datetime-local"
                  required
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#EDEDED] focus:border-[#74D96F] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#262626] mb-1">
                  Attendees (comma-separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Jane Doe, John Smith"
                  value={newAttendees}
                  onChange={(e) => setNewAttendees(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#EDEDED] focus:border-[#74D96F] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#262626] mb-1">Agenda</label>
                <input
                  type="text"
                  placeholder="Brief meeting goals & discussion points"
                  value={newAgenda}
                  onChange={(e) => setNewAgenda(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#EDEDED] focus:border-[#74D96F] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#262626] mb-1">
                  Minutes Notes / Raw OCR Transcript
                </label>
                <textarea
                  rows={6}
                  placeholder="Paste meeting discussion, speech-to-text transcript, or OCR text..."
                  value={newMinutes}
                  onChange={(e) => setNewMinutes(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#EDEDED] focus:border-[#74D96F] focus:outline-hidden font-mono"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#EDEDED]">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  disabled={isSubmittingNew}
                  className="px-4 py-2 rounded-full border border-[#EDEDED] text-xs font-semibold text-[#666666] hover:bg-[#EDEDED]/50 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingNew}
                  className="inline-flex items-center space-x-1 px-5 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs font-bold text-[#262626] transition disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingNew ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Meeting Note</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
