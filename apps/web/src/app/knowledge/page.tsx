"use client";

import React, { useState, useEffect } from "react";
import {
  BookOpen,
  Plus,
  Search,
  Sparkles,
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
} from "lucide-react";
import { api } from "../../services/api";
import { KnowledgePage } from "../../types";
import { MarkdownPreview } from "../../components/knowledge/MarkdownPreview";

export default function KnowledgeBasePage() {
  const [pages, setPages] = useState<KnowledgePage[]>([]);
  const [selectedPage, setSelectedPage] = useState<KnowledgePage | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [newVisibility, setNewVisibility] = useState<"public" | "internal" | "restricted">("internal");
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [editorView, setEditorView] = useState<"split" | "preview" | "editor">("split");

  const handleCancelEdit = () => {
    if (selectedPage) {
      setEditTitle(selectedPage.title);
      setEditContent(selectedPage.content);
    }
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

  useEffect(() => {
    async function fetchPages() {
      const data = await api.getKnowledgePages();
      setPages(data);
      if (data.length > 0) {
        setSelectedPage(data[0]);
        setEditTitle(data[0].title);
        setEditContent(data[0].content);
      }
    }
    fetchPages();
  }, []);

  const handleSelectPage = (page: KnowledgePage) => {
    setSelectedPage(page);
    setEditTitle(page.title);
    setEditContent(page.content);
    setIsEditing(false);
    setAiInsight(null);
  };

  const handleSaveEdit = async () => {
    if (!selectedPage) return;
    const updated = await api.updateKnowledgePage(selectedPage.id, {
      title: editTitle,
      content: editContent,
    });
    setSelectedPage(updated);
    setPages(pages.map((p) => (p.id === updated.id ? updated : p)));
    setIsEditing(false);
  };

  const handleCreatePage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const created = await api.createKnowledgePage({
      title: newTitle,
      summary: newSummary,
      visibility: newVisibility,
      content: `# ${newTitle}\n\n${newSummary || "Enter page documentation here..."}\n\n## Overview\n- Key points\n- Details and specifications`,
      tags: ["wiki", "documentation"],
    });

    setPages([created, ...pages]);
    setSelectedPage(created);
    setEditTitle(created.title);
    setEditContent(created.content);
    setIsCreateModalOpen(false);
    setNewTitle("");
    setNewSummary("");
  };

  const handleGenerateSummary = () => {
    if (!selectedPage) return;
    setIsSummarizing(true);
    setTimeout(() => {
      setAiInsight(
        `🤖 **Second Brain Key Insights for "${selectedPage.title}"**:\n` +
          `• **Core Domain**: Defines organizational conventions, security boundary isolation, and least-privilege policies.\n` +
          `• **Enforcement**: Row-Level Security (RLS) ensures users only retrieve context matching their permission level.\n` +
          `• **Action Item**: Verify sandbox container egress whitelists before upgrading to B4 operations.`
      );
      setIsSummarizing(false);
    }, 800);
  };

  const filteredPages = pages.filter(
    (p) =>
      p.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.tags || []).some((t) => t?.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="flex h-[calc(100vh-6.5rem)] flex-col md:flex-row gap-6">
      {/* Sidebar: Page Directory */}
      <div className="w-full md:w-80 flex flex-col shrink-0 rounded-3xl border border-[#BEBEBE]/40 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
          <div className="flex items-center space-x-2">
            <BookOpen className="w-4 h-4 text-[#74D96F]" />
            <span className="font-bold text-sm text-[#262626]">Knowledge Hub</span>
          </div>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-3 py-1.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition shadow-xs flex items-center space-x-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
        </div>

        {/* Search */}
        <div className="mt-3 relative">
          <Search className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search documents or tags..."
            className="w-full rounded-full border border-[#BEBEBE]/60 bg-[#F8F9FA] pl-9 pr-3 py-1.5 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
          />
        </div>

        {/* Document List */}
        <div className="mt-3 flex-1 overflow-y-auto space-y-1.5 pr-1">
          {filteredPages.map((page) => {
            const isSelected = selectedPage?.id === page.id;
            return (
              <button
                key={page.id}
                onClick={() => handleSelectPage(page)}
                className={`w-full text-left p-3 rounded-2xl text-xs transition flex flex-col space-y-1 border ${
                  isSelected
                    ? "bg-[#EDEDED]/90 border-[#74D96F] text-[#262626] shadow-xs font-semibold"
                    : "border-transparent hover:bg-[#EDEDED]/40 text-[#666666] hover:text-[#262626]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 truncate">
                    <FileText className={`w-3.5 h-3.5 shrink-0 ${isSelected ? "text-[#74D96F]" : "text-[#666666]"}`} />
                    <span className="font-bold truncate text-[#262626]">{page.title}</span>
                  </div>
                  {page.visibility === "restricted" ? (
                    <Lock className="w-3 h-3 text-amber-500 shrink-0 ml-1" />
                  ) : page.visibility === "public" ? (
                    <Globe2 className="w-3 h-3 text-[#74D96F] shrink-0 ml-1" />
                  ) : null}
                </div>
                <div className="flex items-center justify-between text-[10px] text-[#666666]">
                  <span>{page.authorName}</span>
                  <span>{page.viewsCount || 1} views</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Document Reader / Editor Area */}
      <div className="flex-1 flex flex-col rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 shadow-sm overflow-hidden">
        {selectedPage ? (
          <div className="flex-1 flex flex-col overflow-y-auto pr-2 space-y-6">
            {/* Top Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#EDEDED]">
              <div className="flex items-center space-x-2">
                <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase ${
                  selectedPage.visibility === "restricted"
                    ? "bg-amber-100 text-amber-900 border border-amber-200"
                    : "bg-[#74D96F]/20 text-[#1F541D] border border-[#74D96F]/40"
                }`}>
                  {selectedPage.visibility}
                </span>
                <span className="text-xs text-[#666666] flex items-center space-x-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Last modified {selectedPage.updatedAt.slice(0, 10)}</span>
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleGenerateSummary}
                  disabled={isSummarizing}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full bg-[#74D96F]/20 hover:bg-[#74D96F]/30 text-[#1F541D] text-xs font-bold border border-[#74D96F]/40 transition disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#1F541D]" />
                  <span>{isSummarizing ? "Synthesizing..." : "AI Key Insights"}</span>
                </button>
                {isEditing ? (
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-[#262626] text-xs font-semibold transition cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Cancel</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      className="inline-flex items-center space-x-1.5 px-4 py-1.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] text-xs font-bold transition shadow-xs cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Save Changes</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
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
            </div>

            {/* AI Generated Insight Card */}
            {aiInsight && (
              <div className="rounded-2xl border border-[#74D96F]/50 bg-[#74D96F]/10 p-4 text-xs text-[#1F541D] whitespace-pre-wrap leading-relaxed shadow-xs">
                {aiInsight}
              </div>
            )}

            {/* Document Title */}
            {isEditing ? (
              <div className="space-y-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#666666]">
                  Document Title
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full text-xl sm:text-2xl font-bold bg-[#F8F9FA] border border-[#BEBEBE]/60 rounded-2xl px-4 py-2.5 text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white transition"
                  placeholder="Document Title"
                />
              </div>
            ) : (
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#262626] tracking-tight">
                {selectedPage.title}
              </h1>
            )}

            {/* Tags */}
            {selectedPage.tags && selectedPage.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedPage.tags.map((tag, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-2.5 py-0.5 rounded-full bg-[#EDEDED] text-[#262626] font-mono border border-[#BEBEBE]/40"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
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
                        <span className="font-mono text-[10px] text-[#999999]">{editContent.length} chars</span>
                      </div>
                      <textarea
                        id="markdown-textarea"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={18}
                        className="w-full flex-1 min-h-[460px] font-mono text-xs leading-relaxed bg-[#F8F9FA] border border-[#BEBEBE]/60 rounded-2xl p-4 text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white transition resize-none"
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
            ) : (
              <div className="max-w-none text-[#262626] bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl border border-[#EDEDED] shadow-xs">
                <MarkdownPreview content={selectedPage.content} />
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[#666666]">
            <BookOpen className="w-10 h-10 mb-2 opacity-40 text-[#74D96F]" />
            <p className="text-xs">Select or create a document to begin.</p>
          </div>
        )}
      </div>

      {/* Create New Knowledge Page Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <form
            onSubmit={handleCreatePage}
            className="w-full max-w-lg rounded-3xl border border-[#BEBEBE]/40 bg-white p-6 shadow-2xl text-[#262626] space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#EDEDED]">
              <h3 className="font-bold text-sm text-[#262626]">Create Knowledge Page</h3>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-[#666666] hover:text-[#262626]"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Page Title</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Incident Post-Mortem Guidelines"
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Executive Summary</label>
              <textarea
                value={newSummary}
                onChange={(e) => setNewSummary(e.target.value)}
                placeholder="Brief summary for Second Brain hybrid vector indexing..."
                rows={3}
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] placeholder-[#999999] focus:outline-none focus:border-[#74D96F] focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#262626] mb-1">Visibility Scope</label>
              <select
                value={newVisibility}
                onChange={(e) => setNewVisibility(e.target.value as "public" | "internal" | "restricted")}
                className="w-full rounded-xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#262626] focus:outline-none focus:border-[#74D96F] focus:bg-white"
              >
                <option value="internal">Internal (All authenticated employees)</option>
                <option value="public">Public (All workspace users)</option>
                <option value="restricted">Restricted (Designated roles only)</option>
              </select>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-[#EDEDED]">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="px-4 py-2 rounded-full bg-[#EDEDED] hover:bg-[#E2E2E2] text-xs text-[#262626] font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs text-[#262626] font-bold shadow-sm transition"
              >
                Publish to Knowledge Base
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
