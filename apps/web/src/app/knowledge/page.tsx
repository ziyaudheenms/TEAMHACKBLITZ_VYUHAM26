"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  BookOpen,
  Plus,
  Search,
  Lock,
  Globe2,
  FileText,
  Clock,
  Check,
  Edit3,
  X,
  Eye,
  Columns,
  Code,
  Bold,
  Italic,
  List,
  Quote,
  ArrowLeft,
  AlertTriangle,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { api } from "../../services/api";
import { ApiError, sessionStore } from "../../services/http";
import { useRBAC } from "../../lib/useRBAC";
import { KnowledgePage } from "../../types";
import { MarkdownPreview } from "../../components/knowledge/MarkdownPreview";

type Visibility = KnowledgePage["visibility"];

const errorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof ApiError || err instanceof Error) return err.message || fallback;
  return fallback;
};

const formatDate = (value: string | undefined | null): string => {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

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

export default function KnowledgeBasePage() {
  const { isMember, isAdmin } = useRBAC();
  // The role comes from localStorage, so only trust it after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const canCreate = mounted && isMember;
  const canSetRestricted = mounted && isAdmin;
  const currentUserId = mounted ? sessionStore.get()?.user.id ?? null : null;

  const [pages, setPages] = useState<KnowledgePage[]>([]);
  const [selectedPage, setSelectedPage] = useState<KnowledgePage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editVisibility, setEditVisibility] = useState<Visibility>("internal");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newVisibility, setNewVisibility] = useState<Visibility>("internal");
  const [editorView, setEditorView] = useState<"split" | "preview" | "editor">("split");
  const [mobileView, setMobileView] = useState<"directory" | "document">("document");

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedPage?.id ?? null;

  const loadBuffers = (page: KnowledgePage | null) => {
    setEditTitle(page?.title ?? "");
    setEditContent(page?.content ?? "");
    setEditVisibility(page?.visibility ?? "internal");
  };

  const handleCancelEdit = () => {
    loadBuffers(selectedPage);
    setSaveError(null);
    setIsEditing(false);
  };

  const insertFormatting = (prefix: string, suffix: string = "") => {
    const textarea = document.getElementById("markdown-textarea") as HTMLTextAreaElement | null;
    if (!textarea) {
      setEditContent((prev) => prev + prefix + suffix);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end) || "text";
    const nextContent =
      textarea.value.substring(0, start) +
      prefix +
      selected +
      suffix +
      textarea.value.substring(end);
    setEditContent(nextContent);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + prefix.length,
        start + prefix.length + selected.length
      );
    }, 10);
  };

  const loadPages = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await api.getKnowledgePages();
      setPages(data);
      const next = data.find((p) => p.id === selectedIdRef.current) ?? data[0] ?? null;
      setSelectedPage(next);
      setEditTitle(next?.title ?? "");
      setEditContent(next?.content ?? "");
      setEditVisibility(next?.visibility ?? "internal");
    } catch (err) {
      setLoadError(errorMessage(err, "Could not load knowledge pages."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  const handleSelectPage = (page: KnowledgePage) => {
    setSelectedPage(page);
    loadBuffers(page);
    setIsEditing(false);
    setSaveError(null);
  };

  const handleSaveEdit = async () => {
    if (!selectedPage || isSaving) return;
    const title = editTitle.trim();
    if (!title) {
      setSaveError("A page needs a title.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const updates: Partial<KnowledgePage> = { title, content: editContent };
      if (editVisibility !== selectedPage.visibility) updates.visibility = editVisibility;
      const updated = await api.updateKnowledgePage(selectedPage.id, updates);
      setSelectedPage(updated);
      setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      loadBuffers(updated);
      setIsEditing(false);
    } catch (err) {
      setSaveError(errorMessage(err, "Could not save your changes."));
    } finally {
      setIsSaving(false);
    }
  };

  const openCreateModal = () => {
    setCreateError(null);
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    if (isCreating) return;
    setIsCreateModalOpen(false);
    setCreateError(null);
  };

  const handleCreatePage = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || isCreating) return;

    setIsCreating(true);
    setCreateError(null);
    try {
      const created = await api.createKnowledgePage({
        title,
        content: newContent,
        visibility: newVisibility,
      });
      setPages((prev) => [created, ...prev]);
      setSelectedPage(created);
      loadBuffers(created);
      setIsEditing(false);
      setSaveError(null);
      setMobileView("document");
      setIsCreateModalOpen(false);
      setNewTitle("");
      setNewContent("");
      setNewVisibility("internal");
    } catch (err) {
      setCreateError(errorMessage(err, "Could not create the page."));
    } finally {
      setIsCreating(false);
    }
  };

  const query = searchQuery.trim().toLowerCase();
  const filteredPages = pages.filter(
    (p) =>
      !query ||
      p.title?.toLowerCase().includes(query) ||
      p.authorName?.toLowerCase().includes(query)
  );

  // The server lets members edit only their own pages; admins can edit any page.
  const canEditSelected =
    !!selectedPage &&
    canCreate &&
    (canSetRestricted || (!!currentUserId && selectedPage.createdBy === currentUserId));

  return (
    <div className="flex h-[calc(100vh-5.5rem)] sm:h-[calc(100vh-6.5rem)] flex-col gap-3">
      {loadError && (
        <ErrorBanner message={loadError} onRetry={loadPages} retrying={isLoading} />
      )}

      <div className="flex flex-1 min-h-0 flex-col md:flex-row gap-4 sm:gap-6">
        {/* Sidebar: Page Directory (full width on mobile if mobileView === 'directory', w-80 on desktop) */}
        <div
          className={`${
            mobileView === "directory" ? "flex" : "hidden"
          } md:flex w-full md:w-80 flex-col shrink-0 rounded-3xl border border-[#BEBEBE]/40 bg-white p-3 sm:p-4 shadow-sm`}
        >
          <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
            <div className="flex items-center space-x-2">
              <BookOpen className="w-4 h-4 text-[#74D96F]" />
              <span className="font-bold text-sm text-[#262626]">Knowledge Hub</span>
            </div>
            {canCreate && (
              <button
                onClick={openCreateModal}
                className="px-3 py-1.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition shadow-xs flex items-center space-x-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New</span>
              </button>
            )}
          </div>

          {/* Search */}
          <div className="mt-3 relative">
            <Search className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documents..."
              aria-label="Search documents"
              className="w-full rounded-full border border-[#BEBEBE]/60 bg-[#F8F9FA] pl-9 pr-3 py-1.5 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
            />
          </div>

          {/* Document List */}
          <div className="mt-3 flex-1 overflow-y-auto space-y-1.5 pr-1">
            {isLoading && pages.length === 0 ? (
              <div className="space-y-1.5" aria-busy="true" aria-label="Loading documents">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="rounded-2xl p-3 space-y-2">
                    <div className="skeleton h-3 w-3/4 rounded-full" />
                    <div className="skeleton h-2.5 w-1/2 rounded-full" />
                  </div>
                ))}
              </div>
            ) : filteredPages.length === 0 ? (
              !loadError && (
                <div className="flex flex-col items-center justify-center text-center py-10 px-3 text-[#666666]">
                  <FileText className="w-8 h-8 mb-2 opacity-40 text-[#74D96F]" />
                  <p className="text-xs font-semibold text-[#262626]">
                    {pages.length === 0 ? "No documents yet" : "No matching documents"}
                  </p>
                  <p className="text-[11px] mt-1">
                    {pages.length === 0
                      ? canCreate
                        ? "Create the first page with the New button."
                        : "Pages shared with you will show up here."
                      : "Try a different search."}
                  </p>
                </div>
              )
            ) : (
              filteredPages.map((page) => {
                const isSelected = selectedPage?.id === page.id;
                return (
                  <button
                    key={page.id}
                    onClick={() => {
                      handleSelectPage(page);
                      setMobileView("document");
                    }}
                    disabled={isSaving}
                    className={`w-full text-left p-3 rounded-2xl text-xs transition flex flex-col space-y-1 border cursor-pointer disabled:cursor-not-allowed ${
                      isSelected
                        ? "bg-[#EDEDED]/90 border-[#74D96F] text-[#262626] shadow-xs font-semibold"
                        : "border-transparent hover:bg-[#EDEDED]/40 text-[#666666] hover:text-[#262626]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5 truncate">
                        <FileText
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isSelected ? "text-[#74D96F]" : "text-[#666666]"
                          }`}
                        />
                        <span className="font-bold truncate text-[#262626]">{page.title}</span>
                      </div>
                      {page.visibility === "restricted" ? (
                        <Lock className="w-3 h-3 text-amber-500 shrink-0 ml-1" />
                      ) : page.visibility === "public" ? (
                        <Globe2 className="w-3 h-3 text-[#74D96F] shrink-0 ml-1" />
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-[#666666]">
                      <span className="truncate">{page.authorName}</span>
                      <span className="shrink-0 ml-2">{formatDate(page.updatedAt)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Main Document Reader / Editor Area */}
        <div
          className={`${
            mobileView === "document" ? "flex" : "hidden"
          } md:flex flex-1 flex-col rounded-3xl border border-[#BEBEBE]/40 bg-white p-4 sm:p-6 shadow-sm overflow-hidden`}
        >
          {selectedPage ? (
            <div className="flex-1 flex flex-col overflow-y-auto pr-1 sm:pr-2 space-y-5 sm:space-y-6">
              {/* Top Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pb-4 border-b border-[#EDEDED]">
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setMobileView("directory")}
                    className="md:hidden inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-xs font-semibold text-[#262626] transition cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Directory</span>
                  </button>
                  <span
                    className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase ${
                      selectedPage.visibility === "restricted"
                        ? "bg-amber-100 text-amber-900 border border-amber-200"
                        : "bg-[#74D96F]/20 text-[#1F541D] border border-[#74D96F]/40"
                    }`}
                  >
                    {selectedPage.visibility}
                  </span>
                  <span className="text-xs text-[#666666] hidden sm:flex items-center space-x-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      {selectedPage.authorName ? `${selectedPage.authorName} · ` : ""}
                      Last modified {formatDate(selectedPage.updatedAt)}
                    </span>
                  </span>
                </div>

                {canEditSelected && (
                  <div className="flex items-center space-x-2">
                    {isEditing ? (
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          disabled={isSaving}
                          className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-[#262626] text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Cancel</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          disabled={isSaving || !editTitle.trim()}
                          className="inline-flex items-center space-x-1.5 px-4 py-1.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
                        >
                          {isSaving ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          <span>{isSaving ? "Saving..." : "Save Changes"}</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          loadBuffers(selectedPage);
                          setSaveError(null);
                          setIsEditing(true);
                          setEditorView("split");
                        }}
                        className="inline-flex items-center space-x-1.5 px-4 py-1.5 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-[#262626] text-xs font-semibold transition border border-[#BEBEBE]/40 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit Markdown</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {saveError && <ErrorBanner message={saveError} />}

              {/* Document Title */}
              {isEditing ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="page-title"
                      className="block text-[11px] font-bold uppercase tracking-wider text-[#666666]"
                    >
                      Document Title
                    </label>
                    <input
                      id="page-title"
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      maxLength={255}
                      disabled={isSaving}
                      className="w-full text-xl sm:text-2xl font-bold bg-[#F8F9FA] border border-[#BEBEBE]/60 rounded-2xl px-4 py-2.5 text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white transition disabled:opacity-60"
                      placeholder="Document Title"
                    />
                  </div>
                  <div className="space-y-1 max-w-xs">
                    <label
                      htmlFor="page-visibility"
                      className="block text-[11px] font-bold uppercase tracking-wider text-[#666666]"
                    >
                      Visibility
                    </label>
                    <select
                      id="page-visibility"
                      value={editVisibility}
                      onChange={(e) => setEditVisibility(e.target.value as Visibility)}
                      disabled={isSaving}
                      className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white disabled:opacity-60"
                    >
                      <option value="internal">Internal (organisation members)</option>
                      <option value="public">Public (everyone, including guests)</option>
                      {(canSetRestricted || selectedPage.visibility === "restricted") && (
                        <option value="restricted" disabled={!canSetRestricted}>
                          Restricted (admins and the author)
                        </option>
                      )}
                    </select>
                  </div>
                </div>
              ) : (
                <h1 className="text-2xl sm:text-3xl font-extrabold text-[#262626] tracking-tight">
                  {selectedPage.title}
                </h1>
              )}

              {/* Document Body / Markdown Editor with Always-Preview */}
              {isEditing ? (
                <div className="flex-1 flex flex-col space-y-3 min-h-0">
                  {/* Editor Sub-toolbar: View controls + Markdown tools */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-2xl bg-[#F8F9FA] border border-[#EDEDED]">
                    {/* View Modes */}
                    <div className="flex items-center space-x-1 bg-[#EDEDED] p-1 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setEditorView("split")}
                        className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                          editorView === "split"
                            ? "bg-white text-[#262626] shadow-xs"
                            : "text-[#666666] hover:text-[#262626]"
                        }`}
                      >
                        <Columns className="w-3.5 h-3.5" />
                        <span>Split (Live Preview)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditorView("preview")}
                        className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                          editorView === "preview"
                            ? "bg-white text-[#262626] shadow-xs"
                            : "text-[#666666] hover:text-[#262626]"
                        }`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Preview Only</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditorView("editor")}
                        className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                          editorView === "editor"
                            ? "bg-white text-[#262626] shadow-xs"
                            : "text-[#666666] hover:text-[#262626]"
                        }`}
                      >
                        <Code className="w-3.5 h-3.5" />
                        <span>Raw Editor</span>
                      </button>
                    </div>

                    {/* Formatting Tool Buttons */}
                    <div className="flex items-center space-x-1 text-[#666666]">
                      <button
                        type="button"
                        onClick={() => insertFormatting("**", "**")}
                        className="p-1.5 rounded-lg hover:bg-white hover:text-[#262626] transition font-bold text-xs cursor-pointer"
                        title="Bold (**text**)"
                      >
                        <Bold className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => insertFormatting("*", "*")}
                        className="p-1.5 rounded-lg hover:bg-white hover:text-[#262626] transition text-xs cursor-pointer"
                        title="Italic (*text*)"
                      >
                        <Italic className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => insertFormatting("\n## ", "\n")}
                        className="px-2 py-1 rounded-lg hover:bg-white hover:text-[#262626] transition font-bold text-xs font-mono cursor-pointer"
                        title="Heading 2 (## Title)"
                      >
                        H2
                      </button>
                      <button
                        type="button"
                        onClick={() => insertFormatting("\n- ", "")}
                        className="p-1.5 rounded-lg hover:bg-white hover:text-[#262626] transition text-xs cursor-pointer"
                        title="Bullet List (- item)"
                      >
                        <List className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => insertFormatting("\n> ", "\n")}
                        className="p-1.5 rounded-lg hover:bg-white hover:text-[#262626] transition text-xs cursor-pointer"
                        title="Blockquote (> quote)"
                      >
                        <Quote className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => insertFormatting("\n```text\n", "\n```\n")}
                        className="px-2 py-1 rounded-lg hover:bg-white hover:text-[#262626] transition font-mono text-[11px] font-bold cursor-pointer"
                        title="Code Block"
                      >
                        {"</>"}
                      </button>
                    </div>
                  </div>

                  {/* Split or Full View Grid */}
                  <div
                    className={`grid gap-4 flex-1 ${
                      editorView === "split" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
                    }`}
                  >
                    {(editorView === "split" || editorView === "editor") && (
                      <div className="flex flex-col">
                        <div className="text-[11px] font-bold text-[#666666] uppercase tracking-wider mb-1.5 flex items-center justify-between">
                          <span>Markdown Source</span>
                          <span className="font-mono text-[10px] text-[#999999]">
                            {editContent.length} / 100000 chars
                          </span>
                        </div>
                        <textarea
                          id="markdown-textarea"
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          maxLength={100000}
                          disabled={isSaving}
                          rows={18}
                          className="w-full flex-1 min-h-[460px] font-mono text-xs leading-relaxed bg-[#F8F9FA] border border-[#BEBEBE]/60 rounded-2xl p-4 text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white transition resize-none disabled:opacity-60"
                          placeholder="Type your markdown documentation here..."
                        />
                      </div>
                    )}

                    {(editorView === "split" || editorView === "preview") && (
                      <div className="flex flex-col">
                        <div className="text-[11px] font-bold text-[#666666] uppercase tracking-wider mb-1.5 flex items-center space-x-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#74D96F] animate-pulse" />
                          <span>Live Markdown Preview</span>
                        </div>
                        <div className="w-full flex-1 min-h-[460px] overflow-y-auto bg-white border border-[#EDEDED] rounded-2xl p-6 shadow-xs">
                          <MarkdownPreview content={editContent} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : selectedPage.content.trim() ? (
                <div className="max-w-none text-[#262626] bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl border border-[#EDEDED] shadow-xs">
                  <MarkdownPreview content={selectedPage.content} />
                </div>
              ) : (
                <div className="text-center py-10 text-xs text-[#666666] border border-dashed border-[#BEBEBE] rounded-2xl">
                  This page has no content yet.
                </div>
              )}
            </div>
          ) : isLoading ? (
            <div className="flex-1 space-y-4" aria-busy="true" aria-label="Loading document">
              <div className="skeleton h-4 w-1/4 rounded-full" />
              <div className="skeleton h-8 w-2/3 rounded-xl" />
              <div className="skeleton h-48 w-full rounded-3xl" />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[#666666]">
              <BookOpen className="w-10 h-10 mb-2 opacity-40 text-[#74D96F]" />
              <p className="text-xs">
                {loadError
                  ? "Documents could not be loaded."
                  : pages.length === 0
                  ? canCreate
                    ? "No documents yet. Create one to begin."
                    : "No documents have been shared with you yet."
                  : "Select a document to read."}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Create New Knowledge Page Modal */}
      {isCreateModalOpen && canCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <form
            onSubmit={handleCreatePage}
            className="w-full max-w-lg rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 shadow-2xl text-[#262626] space-y-4 animate-scale-in"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
              <h3 className="font-bold text-sm text-[#262626]">Create Knowledge Page</h3>
              <button
                type="button"
                onClick={closeCreateModal}
                aria-label="Close"
                className="text-[#666666] hover:text-[#262626] cursor-pointer"
              >
                ✕
              </button>
            </div>

            {createError && <ErrorBanner message={createError} />}

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Page Title</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                maxLength={255}
                placeholder="e.g. Incident Post-Mortem Guidelines"
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">
                Content (Markdown, optional)
              </label>
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                maxLength={100000}
                placeholder="You can also write the content after creating the page."
                rows={5}
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs font-mono text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Visibility Scope</label>
              <select
                value={newVisibility}
                onChange={(e) => setNewVisibility(e.target.value as Visibility)}
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white"
              >
                <option value="internal">Internal (organisation members)</option>
                <option value="public">Public (everyone, including guests)</option>
                {canSetRestricted && (
                  <option value="restricted">Restricted (admins and the author)</option>
                )}
              </select>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-[#EDEDED]">
              <button
                type="button"
                onClick={closeCreateModal}
                disabled={isCreating}
                className="px-4 py-2 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-xs text-[#262626] font-semibold transition disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreating || !newTitle.trim()}
                className="px-5 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs text-[#262626] font-bold shadow-sm transition disabled:opacity-50 inline-flex items-center space-x-1.5 cursor-pointer"
              >
                {isCreating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isCreating ? "Publishing..." : "Publish to Knowledge Base"}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
