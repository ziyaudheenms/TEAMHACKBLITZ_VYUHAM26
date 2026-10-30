"use client";

import React, { useState, useEffect } from "react";
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
  Briefcase,
  AlertCircle,
  Copy,
  Check,
} from "lucide-react";
import { api } from "../../services/api";
import { Meeting, Project } from "../../types";

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [editedNotes, setEditedNotes] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // New Meeting Form State
  const [newTitle, setNewTitle] = useState("");
  const [newProjectId, setNewProjectId] = useState("");
  const [newDate, setNewDate] = useState(() => {
    const now = new Date();
    return now.toISOString().slice(0, 16);
  });
  const [newDuration, setNewDuration] = useState(45);
  const [newAttendees, setNewAttendees] = useState("Adhwaithas S., Priya Sharma, Marcus Vance");
  const [newAgenda, setNewAgenda] = useState("");
  const [newMinutes, setNewMinutes] = useState("");
  const [isSubmittingNew, setIsSubmittingNew] = useState(false);

  // Load initial data
  useEffect(() => {
    async function loadData() {
      try {
        const [meetingData, projectData] = await Promise.all([
          api.getMeetings(),
          api.getProjects().catch(() => [] as Project[]),
        ]);
        setMeetings(meetingData);
        setProjects(projectData);
        if (meetingData.length > 0) {
          setSelectedMeeting(meetingData[0]);
          setEditedNotes(meetingData[0].minutesContent || "");
        }
      } catch (err) {
        console.error("Failed to load meetings:", err);
      }
    }
    loadData();
  }, []);

  const handleSelectMeeting = (m: Meeting) => {
    setSelectedMeeting(m);
    setEditedNotes(m.minutesContent || "");
    setIsEditingNotes(false);
  };

  const showFeedback = (msg: string) => {
    setFeedbackMessage(msg);
    setTimeout(() => setFeedbackMessage(null), 3500);
  };

  const handleExtractActionItems = async () => {
    if (!selectedMeeting) return;
    setIsExtracting(true);
    try {
      const updated = await api.extractActionItems(
        selectedMeeting.id,
        isEditingNotes ? editedNotes : selectedMeeting.minutesContent
      );
      setSelectedMeeting(updated);
      setEditedNotes(updated.minutesContent || "");
      setIsEditingNotes(false);
      setMeetings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      showFeedback(`Extracted ${updated.extractedActionItems.length} action items with AI Summary!`);
    } catch (err: any) {
      alert(`Extraction error: ${err?.message || "Unknown error"}`);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedMeeting) return;
    setIsSavingNotes(true);
    try {
      const updated = await api.updateMeeting(selectedMeeting.id, {
        minutesContent: editedNotes,
      });
      setSelectedMeeting(updated);
      setIsEditingNotes(false);
      setMeetings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      showFeedback("Meeting notes updated successfully.");
    } catch (err: any) {
      alert(`Save error: ${err?.message || "Failed to update notes"}`);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleConvertToTask = async (actionId: string) => {
    if (!selectedMeeting) return;
    setConvertingId(actionId);
    try {
      await api.convertActionItemToTask(selectedMeeting.id, actionId);
      const data = await api.getMeetings();
      setMeetings(data);
      const curr = data.find((m) => m.id === selectedMeeting.id);
      if (curr) setSelectedMeeting(curr);
      showFeedback("Action item converted and synchronized to Kanban tasks!");
    } catch (err: any) {
      alert(`Conversion error: ${err?.message || "Failed to convert task"}`);
    } finally {
      setConvertingId(null);
    }
  };

  const handleDeleteMeeting = async (meetingId: string) => {
    if (!confirm("Are you sure you want to delete this meeting record?")) return;
    try {
      await api.deleteMeeting(meetingId);
      const remaining = meetings.filter((m) => m.id !== meetingId);
      setMeetings(remaining);
      setSelectedMeeting(remaining.length > 0 ? remaining[0] : null);
      showFeedback("Meeting deleted successfully.");
    } catch (err: any) {
      alert(`Delete error: ${err?.message || "Failed to delete"}`);
    }
  };

  const handleCreateMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setIsSubmittingNew(true);
    try {
      const attendeeList = newAttendees
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a.length > 0);

      const matchedProj = projects.find((p) => p.id === newProjectId);

      const created = await api.createMeeting({
        title: newTitle.trim(),
        agenda: newAgenda.trim() || undefined,
        meetingDate: newDate.replace("T", " "),
        durationMinutes: Number(newDuration) || 30,
        projectId: newProjectId || undefined,
        projectName: matchedProj?.name,
        participantNames: attendeeList.length > 0 ? attendeeList : ["Team Lead"],
        minutesContent: newMinutes.trim(),
      });

      setMeetings([created, ...meetings]);
      setSelectedMeeting(created);
      setEditedNotes(created.minutesContent || "");
      setIsNewModalOpen(false);

      // Reset form
      setNewTitle("");
      setNewProjectId("");
      setNewAgenda("");
      setNewMinutes("");
      showFeedback("Meeting notes recorded successfully!");
    } catch (err: any) {
      alert(`Create error: ${err?.message || "Failed to create meeting"}`);
    } finally {
      setIsSubmittingNew(false);
    }
  };

  const copyTranscriptToClipboard = () => {
    if (!selectedMeeting?.minutesContent) return;
    navigator.clipboard.writeText(selectedMeeting.minutesContent);
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2000);
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

  return (
    <div className="flex h-[calc(100vh-6.5rem)] flex-col md:flex-row gap-6 relative">
      {/* Toast Feedback Notification */}
      {feedbackMessage && (
        <div className="absolute top-2 right-6 z-50 flex items-center space-x-2 bg-[#262626] text-white px-4 py-2.5 rounded-2xl shadow-lg text-xs font-semibold animate-fade-in border border-[#BEBEBE]/30">
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
            onClick={() => setIsNewModalOpen(true)}
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
          {filteredMeetings.length === 0 ? (
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
                      <span>{m.meetingDate.slice(0, 10)}</span>
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
                    {selectedMeeting.projectName || "General Initiative"}
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
                    <span>{selectedMeeting.meetingDate}</span>
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
                  onClick={() => handleDeleteMeeting(selectedMeeting.id)}
                  className="p-2 rounded-full text-[#666666] hover:text-rose-600 hover:bg-rose-50 transition"
                  title="Delete Meeting"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <button
                  onClick={handleExtractActionItems}
                  disabled={isExtracting}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {isExtracting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Parsing Transcript...</span>
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

            {/* Participants */}
            <div className="flex items-center space-x-2 text-xs text-[#666666] bg-[#F8F9FA] p-3 rounded-2xl border border-[#EDEDED]">
              <Users className="w-4 h-4 text-[#74D96F] shrink-0" />
              <span className="font-bold text-[#262626]">Attendees:</span>
              <span className="text-[#262626]">
                {selectedMeeting.participantNames && selectedMeeting.participantNames.length > 0
                  ? selectedMeeting.participantNames.join(", ")
                  : "All Team Members"}
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
                      {selectedMeeting.extractedActionItems ? selectedMeeting.extractedActionItems.length : 0}
                    </span>
                  </h3>
                  <p className="text-[11px] text-[#666666]">
                    Automatically identified from discussion; convert to Kanban tasks with one click.
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                {(!selectedMeeting.extractedActionItems || selectedMeeting.extractedActionItems.length === 0) ? (
                  <div className="rounded-2xl border border-dashed border-[#BEBEBE] p-6 text-center text-xs text-[#666666] space-y-2">
                    <p>No action items extracted yet.</p>
                    <button
                      onClick={handleExtractActionItems}
                      disabled={isExtracting}
                      className="inline-flex items-center space-x-1 text-xs text-[#1F541D] font-bold hover:underline"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Run AI Action Item Extractor</span>
                    </button>
                  </div>
                ) : (
                  selectedMeeting.extractedActionItems.map((act) => (
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
                            Assignee: <strong className="text-[#262626] font-semibold">{act.assignee}</strong>
                          </span>
                          {act.dueDate && (
                            <span>
                              Due: <strong className="text-[#262626] font-semibold">{act.dueDate}</strong>
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
                            onClick={() => handleConvertToTask(act.id)}
                            disabled={convertingId === act.id}
                            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
                          >
                            {convertingId === act.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
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
                  ))
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
                    onClick={copyTranscriptToClipboard}
                    className="p-1.5 rounded-lg text-[#666666] hover:bg-[#EDEDED] text-[11px] font-semibold flex items-center space-x-1 transition"
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
                    onClick={() => setIsEditingNotes(!isEditingNotes)}
                    className="p-1.5 rounded-lg text-[#666666] hover:bg-[#EDEDED] text-[11px] font-semibold flex items-center space-x-1 transition"
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
                      onClick={() => setIsEditingNotes(false)}
                      className="px-4 py-1.5 rounded-full border border-[#EDEDED] text-xs font-semibold text-[#666666] hover:bg-[#EDEDED]/50 transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveNotes}
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
            <p className="text-xs">Select a meeting to view minutes and action items.</p>
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
                className="p-1 rounded-full text-[#666666] hover:bg-[#EDEDED] transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateMeeting} className="space-y-4">
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
                  placeholder="Adhwaithas S., Priya Sharma, Marcus Vance"
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
                  className="px-4 py-2 rounded-full border border-[#EDEDED] text-xs font-semibold text-[#666666] hover:bg-[#EDEDED]/50 transition"
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
