"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Ticket as TicketIcon,
  Plus,
  Clock,
  CheckCircle,
  Send,
  AlertTriangle,
  RefreshCw,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { api } from "../../services/api";
import { ApiError } from "../../services/http";
import { useRBAC } from "../../lib/useRBAC";
import { Ticket } from "../../types";

const CATEGORY_LABELS: Record<Ticket["category"], string> = {
  it: "IT Support",
  access: "Access & Permissions",
  infrastructure: "Infrastructure",
  hr: "HR & Operations",
  design: "Design & UI",
  dev: "Software Engineering",
  finance: "Finance",
  general: "General",
};

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as Ticket["category"][];

const errorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof ApiError || err instanceof Error) return err.message || fallback;
  return fallback;
};

/** slaTarget is an ISO timestamp, or a human string such as "In 24 hours". */
const formatDateTime = (value: string | undefined | null): string => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }
  return value;
};

/** The list/status endpoints don't join the requester's name; keep one we already have. */
const mergeTicket = (previous: Ticket | undefined, next: Ticket): Ticket => ({
  ...next,
  requesterName:
    next.requesterName === "Colleague" && previous?.requesterName
      ? previous.requesterName
      : next.requesterName,
});

function ErrorBanner({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 animate-fade-in"
    >
      <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
      <span className="flex-1 leading-relaxed">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex items-center gap-1 rounded-full bg-white border border-rose-200 px-3 py-1 font-semibold text-rose-800 hover:bg-rose-100 transition disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3 h-3 ${retrying ? "animate-spin" : ""}`} />
          Retry
        </button>
      )}
    </div>
  );
}

const priorityBadge = (priority: Ticket["priority"]) =>
  priority === "urgent"
    ? "bg-rose-100 text-rose-800 border border-rose-200"
    : priority === "high"
    ? "bg-amber-100 text-amber-900 border border-amber-200"
    : "bg-[#EDEDED] text-[#666666] border border-[#BEBEBE]/50";

export default function TicketsPage() {
  const { isMember } = useRBAC();
  // The role comes from localStorage, so only trust it after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const canCreateTicket = mounted && isMember;
  const canWork = mounted && isMember;

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [commentText, setCommentText] = useState("");
  const [isNewTicketModalOpen, setIsNewTicketModalOpen] = useState(false);

  // Mutation states
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [isCommenting, setIsCommenting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Form states
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCategory, setNewCategory] = useState<Ticket["category"]>("general");
  const [newPriority, setNewPriority] = useState<Ticket["priority"]>("medium");

  const loadTickets = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await api.getTickets();
      setTickets(data);
      setSelectedId((prev) =>
        prev && data.some((t) => t.id === prev) ? prev : data[0]?.id ?? null
      );
    } catch (err) {
      setLoadError(errorMessage(err, "Could not load tickets."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const selectedTicket = tickets.find((t) => t.id === selectedId) ?? null;

  const handleSelectTicket = (ticket: Ticket) => {
    setSelectedId(ticket.id);
    setCommentText("");
    setActionError(null);
  };

  const replaceTicket = (updated: Ticket) => {
    setTickets((prev) =>
      prev.map((t) => (t.id === updated.id ? mergeTicket(t, updated) : t))
    );
  };

  const handleStatusChange = async (ticketId: string, status: Ticket["status"]) => {
    if (statusUpdatingId) return;
    setStatusUpdatingId(ticketId);
    setActionError(null);
    try {
      const updated = await api.updateTicketStatus(ticketId, status);
      replaceTicket(updated);
    } catch (err) {
      setActionError(errorMessage(err, "Could not update the ticket status."));
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = commentText.trim();
    if (!text || !selectedTicket || isCommenting) return;

    setIsCommenting(true);
    setActionError(null);
    try {
      const updated = await api.addTicketComment(selectedTicket.id, text);
      replaceTicket(updated);
      setCommentText("");
    } catch (err) {
      setActionError(errorMessage(err, "Could not post your comment."));
    } finally {
      setIsCommenting(false);
    }
  };

  const openNewTicketModal = () => {
    setCreateError(null);
    setIsNewTicketModalOpen(true);
  };

  const closeNewTicketModal = () => {
    if (isCreating) return;
    setIsNewTicketModalOpen(false);
    setCreateError(null);
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    const description = newDescription.trim();
    if (!title || !description || isCreating) return;

    setIsCreating(true);
    setCreateError(null);
    try {
      const created = await api.createTicket({
        title,
        description,
        category: newCategory,
        priority: newPriority,
      });
      setTickets((prev) => [created, ...prev]);
      setSelectedId(created.id);
      setFilterCategory("all");
      setIsNewTicketModalOpen(false);
      setNewTitle("");
      setNewDescription("");
      setActionError(null);
    } catch (err) {
      setCreateError(errorMessage(err, "Could not create the ticket."));
    } finally {
      setIsCreating(false);
    }
  };

  const presentCategories = CATEGORY_ORDER.filter((c) => tickets.some((t) => t.category === c));
  const filteredTickets = tickets.filter((t) => {
    if (filterCategory !== "all" && t.category !== filterCategory) return false;
    return true;
  });

  const slaClass = (t: Ticket) => (t.slaBreached ? "text-rose-600" : "text-[#666666]");
  const isResolvedLike = (t: Ticket) => t.status === "resolved" || t.status === "closed";

  return (
    <div className="flex h-[calc(100vh-6.5rem)] flex-col md:flex-row gap-6">
      {/* Left Column: Tickets Queue */}
      <div className="w-full md:w-96 flex flex-col shrink-0 rounded-3xl border border-[#BEBEBE]/40 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
          <div className="flex items-center space-x-2">
            <TicketIcon className="w-4 h-4 text-[#74D96F]" />
            <span className="font-bold text-sm text-[#262626]">Tickets & SLA Dispatch</span>
          </div>
          {canCreateTicket && (
            <button
              onClick={openNewTicketModal}
              className="px-3 py-1.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition shadow-xs flex items-center space-x-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New</span>
            </button>
          )}
        </div>

        {/* Filter Pills (only categories that actually exist) */}
        {tickets.length > 0 && (
          <div className="mt-3 flex items-center space-x-1.5 overflow-x-auto pb-1 text-[11px]">
            {["all", ...presentCategories].map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-3 py-1 rounded-full font-semibold transition whitespace-nowrap cursor-pointer ${
                  filterCategory === cat
                    ? "bg-[#74D96F] text-[#262626] font-bold shadow-xs border border-[#62CE5C]"
                    : "bg-[#EDEDED] text-[#666666] hover:text-[#262626]"
                }`}
              >
                {cat === "all" ? "All" : CATEGORY_LABELS[cat as Ticket["category"]]}
              </button>
            ))}
          </div>
        )}

        {loadError && (
          <div className="mt-3">
            <ErrorBanner message={loadError} onRetry={loadTickets} retrying={isLoading} />
          </div>
        )}

        {/* Ticket List */}
        <div className="mt-3 flex-1 overflow-y-auto space-y-2 pr-1">
          {isLoading && tickets.length === 0 ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading tickets">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rounded-2xl border border-[#EDEDED] p-3.5 space-y-2.5">
                  <div className="skeleton h-3 w-1/2 rounded-full" />
                  <div className="skeleton h-3 w-full rounded-full" />
                  <div className="skeleton h-2.5 w-2/3 rounded-full" />
                </div>
              ))}
            </div>
          ) : filteredTickets.length === 0 ? (
            !loadError && (
              <div className="flex flex-col items-center justify-center text-center py-10 px-4 text-[#666666] border border-dashed border-[#BEBEBE] rounded-2xl">
                <TicketIcon className="w-8 h-8 mb-2 opacity-40 text-[#74D96F]" />
                <p className="text-xs font-semibold text-[#262626]">
                  {tickets.length === 0 ? "No tickets yet" : "No tickets in this category"}
                </p>
                <p className="text-[11px] mt-1">
                  {tickets.length === 0
                    ? canCreateTicket
                      ? "Create the first request with the New button."
                      : "Requests submitted by your team will show up here."
                    : "Choose another category to see more."}
                </p>
              </div>
            )
          ) : (
            filteredTickets.map((t) => {
              const isSelected = selectedId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => handleSelectTicket(t)}
                  className={`w-full text-left p-3.5 rounded-2xl transition flex flex-col space-y-2 border cursor-pointer ${
                    isSelected
                      ? "bg-[#EDEDED]/90 border-[#74D96F] text-[#262626] shadow-sm"
                      : "bg-white border-[#EDEDED] hover:bg-[#EDEDED]/40 hover:border-[#BEBEBE] text-[#262626]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs font-bold text-[#262626]">{t.ticketNumber}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full uppercase font-medium bg-[#EDEDED] text-[#666666] border border-[#BEBEBE]/40">
                        {t.category}
                      </span>
                    </div>
                    <span
                      className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${priorityBadge(
                        t.priority
                      )}`}
                    >
                      {t.priority}
                    </span>
                  </div>

                  <div className="text-xs font-bold line-clamp-2 text-[#262626]">{t.title}</div>

                  <div className="flex items-center justify-between text-[10px] text-[#666666] pt-1.5 border-t border-[#EDEDED]">
                    <span className="capitalize font-medium">{t.status.replace(/_/g, " ")}</span>
                    <span className={`font-semibold flex items-center space-x-1 ${slaClass(t)}`}>
                      <Clock className="w-3 h-3" />
                      <span>{formatDateTime(t.slaTarget)}</span>
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column: Ticket Inspection & Comment Trail */}
      <div className="flex-1 flex flex-col rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 shadow-sm overflow-hidden">
        {selectedTicket ? (
          <div className="flex-1 flex flex-col overflow-y-auto pr-1 space-y-5 animate-fade-in">
            {/* Ticket Header & Status Toggles */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#EDEDED]">
              <div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-base font-extrabold text-[#262626]">
                    {selectedTicket.ticketNumber}
                  </span>
                  <span
                    className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase ${priorityBadge(
                      selectedTicket.priority
                    )}`}
                  >
                    {selectedTicket.priority} Priority
                  </span>
                  <span className="text-xs text-[#666666]">
                    Category: {CATEGORY_LABELS[selectedTicket.category] ?? selectedTicket.category}
                  </span>
                  <span className="text-xs text-[#666666] capitalize">
                    Status: {selectedTicket.status.replace(/_/g, " ")}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-[#262626] mt-1">{selectedTicket.title}</h2>
              </div>

              {/* Status Action Buttons */}
              {canWork && (
                <div className="flex items-center space-x-2">
                  {!isResolvedLike(selectedTicket) ? (
                    <button
                      onClick={() => handleStatusChange(selectedTicket.id, "resolved")}
                      disabled={statusUpdatingId !== null}
                      className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
                    >
                      {statusUpdatingId === selectedTicket.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {statusUpdatingId === selectedTicket.id ? "Updating..." : "Mark as Resolved"}
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStatusChange(selectedTicket.id, "reopened")}
                      disabled={statusUpdatingId !== null}
                      className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-[#262626] text-xs font-semibold border border-[#BEBEBE]/40 transition disabled:opacity-50 cursor-pointer"
                    >
                      {statusUpdatingId === selectedTicket.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {statusUpdatingId === selectedTicket.id ? "Updating..." : "Reopen Ticket"}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {actionError && <ErrorBanner message={actionError} />}

            {/* SLA Alert Box */}
            <div className="rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-[10px] uppercase font-semibold text-[#666666] block mb-0.5">
                  SLA Target
                </span>
                <span className={`font-semibold flex items-center space-x-1 ${slaClass(selectedTicket)}`}>
                  <Clock className="w-3.5 h-3.5" />
                  <span>{formatDateTime(selectedTicket.slaTarget)}</span>
                  {selectedTicket.slaBreached && <span>(breached)</span>}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-[#666666] block mb-0.5">
                  Requester
                </span>
                <span className="font-medium text-[#262626]">{selectedTicket.requesterName}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-[#666666] block mb-0.5">
                  Current Assignee
                </span>
                <span className="font-medium text-[#262626]">
                  {selectedTicket.assigneeId || selectedTicket.assigneeName
                    ? selectedTicket.assigneeName || "Assigned"
                    : "Unassigned"}
                </span>
              </div>
            </div>

            {/* Description */}
            <div className="rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] p-4">
              <h4 className="text-xs font-bold text-[#262626] uppercase tracking-wider mb-2">
                Problem Description
              </h4>
              <p className="text-xs text-[#262626] leading-relaxed whitespace-pre-wrap">
                {selectedTicket.description || "No description provided."}
              </p>
            </div>

            {/* Discussion & Resolution Trail */}
            <div className="flex-1 space-y-3">
              <h4 className="text-xs font-bold text-[#262626] uppercase tracking-wider">
                Resolution Notes & Discussion ({selectedTicket.comments?.length || 0})
              </h4>

              <div className="space-y-3">
                {selectedTicket.comments && selectedTicket.comments.length > 0 ? (
                  selectedTicket.comments.map((c) => (
                    <div
                      key={c.id}
                      className="p-4 rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center space-x-2">
                          {c.avatar ? (
                            <img
                              src={c.avatar}
                              alt={c.author}
                              className="w-5 h-5 rounded-full object-cover"
                            />
                          ) : (
                            <span
                              aria-hidden="true"
                              className="w-5 h-5 rounded-full bg-[#74D96F]/30 text-[#1F541D] text-[10px] font-bold flex items-center justify-center uppercase"
                            >
                              {c.author.charAt(0) || "?"}
                            </span>
                          )}
                          <span className="font-bold text-[#262626]">{c.author}</span>
                        </div>
                        <span className="text-[10px] text-[#666666] font-medium">
                          {formatDateTime(c.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-[#262626] leading-relaxed pl-7 whitespace-pre-wrap">
                        {c.text}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-6 text-xs text-[#666666] border border-dashed border-[#BEBEBE] rounded-2xl">
                    No resolution comments logged yet.
                  </div>
                )}
              </div>
            </div>

            {/* Add Comment Input */}
            {canWork ? (
              <form onSubmit={handleAddComment} className="pt-2">
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    disabled={isCommenting}
                    maxLength={5000}
                    placeholder="Post progress update or resolution note..."
                    className="flex-1 rounded-full border border-[#BEBEBE]/60 bg-[#F8F9FA] px-4 py-2 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={!commentText.trim() || isCommenting}
                    className="px-5 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition disabled:opacity-40 flex items-center space-x-1 cursor-pointer"
                  >
                    {isCommenting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>{isCommenting ? "Sending..." : "Send"}</span>
                  </button>
                </div>
              </form>
            ) : (
              mounted && (
                <p className="pt-2 text-[11px] text-[#666666]">
                  Guests have read-only access to tickets.
                </p>
              )
            )}
          </div>
        ) : isLoading ? (
          <div className="flex-1 space-y-4" aria-busy="true" aria-label="Loading ticket">
            <div className="skeleton h-5 w-1/3 rounded-full" />
            <div className="skeleton h-4 w-2/3 rounded-full" />
            <div className="skeleton h-20 w-full rounded-2xl" />
            <div className="skeleton h-28 w-full rounded-2xl" />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[#666666]">
            <TicketIcon className="w-10 h-10 mb-2 opacity-40 text-[#74D96F]" />
            <p className="text-xs">
              {loadError
                ? "Tickets could not be loaded."
                : tickets.length === 0
                ? "No tickets to show."
                : "Select a ticket to review SLA and comments."}
            </p>
          </div>
        )}
      </div>

      {/* Modal: New Ticket */}
      {isNewTicketModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <form
            onSubmit={handleCreateTicket}
            className="w-full max-w-lg rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 shadow-2xl text-[#262626] space-y-4 animate-scale-in"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
              <h3 className="font-bold text-sm text-[#262626]">Submit Internal Request / Ticket</h3>
              <button
                type="button"
                onClick={closeNewTicketModal}
                aria-label="Close"
                className="text-[#666666] hover:text-[#262626] cursor-pointer"
              >
                ✕
              </button>
            </div>

            {createError && <ErrorBanner message={createError} />}

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Issue Summary</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                maxLength={255}
                placeholder="Short summary of the issue"
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3 py-2 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Details & Context</label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Steps to reproduce, environment, error messages..."
                rows={3}
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3 py-2 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#262626] mb-1">Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as Ticket["category"])}
                  className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3 py-2 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                >
                  {CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#262626] mb-1">
                  Priority (SLA Tier)
                </label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value as Ticket["priority"])}
                  className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3 py-2 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                >
                  <option value="urgent">Urgent (4 hour SLA)</option>
                  <option value="high">High (12 hour SLA)</option>
                  <option value="medium">Medium (24 hour SLA)</option>
                  <option value="low">Low (72 hour SLA)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-[#EDEDED]">
              <button
                type="button"
                onClick={closeNewTicketModal}
                disabled={isCreating}
                className="px-4 py-2 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-xs text-[#262626] font-semibold transition disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreating || !newTitle.trim() || !newDescription.trim()}
                className="px-5 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs text-[#262626] font-bold shadow-sm transition disabled:opacity-50 inline-flex items-center space-x-1.5 cursor-pointer"
              >
                {isCreating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isCreating ? "Submitting..." : "Submit Ticket"}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
