"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  BookOpen,
  CornerDownLeft,
  Loader2,
  X,
  AlertCircle,
  Search,
  Users,
  FolderKanban,
  Ticket,
  Video,
  HardDrive,
  ArrowRight,
  Layers,
} from "lucide-react";
import { api } from "../../services/api";
import type { SearchResult, SecondBrainResponse } from "../../types";

interface SecondBrainModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = "ask" | "search";
type Scope = "all" | "employees" | "knowledge" | "projects" | "tickets" | "meetings" | "files";

const SCOPES: { value: Scope; label: string }[] = [
  { value: "all", label: "All" },
  { value: "employees", label: "Employees" },
  { value: "knowledge", label: "Knowledge" },
  { value: "projects", label: "Projects" },
  { value: "tickets", label: "Tickets" },
  { value: "meetings", label: "Meetings" },
  { value: "files", label: "Files" },
];

function ResultIcon({ type }: { type: SearchResult["type"] }) {
  switch (type) {
    case "employee":
      return <Users className="w-4 h-4 text-green-600 shrink-0" />;
    case "knowledge":
      return <BookOpen className="w-4 h-4 text-blue-500 shrink-0" />;
    case "project":
      return <FolderKanban className="w-4 h-4 text-purple-500 shrink-0" />;
    case "ticket":
      return <Ticket className="w-4 h-4 text-orange-500 shrink-0" />;
    case "meeting":
      return <Video className="w-4 h-4 text-teal-500 shrink-0" />;
    case "file":
      return <HardDrive className="w-4 h-4 text-slate-500 shrink-0" />;
    default:
      return <Layers className="w-4 h-4 text-gray-400 shrink-0" />;
  }
}

function TypeBadge({ type }: { type: SearchResult["type"] }) {
  const colors: Record<string, string> = {
    employee: "bg-green-50 text-green-700 border-green-200",
    knowledge: "bg-blue-50 text-blue-700 border-blue-200",
    project: "bg-purple-50 text-purple-700 border-purple-200",
    ticket: "bg-orange-50 text-orange-700 border-orange-200",
    meeting: "bg-teal-50 text-teal-700 border-teal-200",
    file: "bg-slate-50 text-slate-600 border-slate-200",
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-semibold capitalize shrink-0 ${
        colors[type] ?? "bg-gray-50 text-gray-600 border-gray-200"
      }`}
    >
      {type}
    </span>
  );
}

export const SecondBrainModal: React.FC<SecondBrainModalProps> = ({ isOpen, onClose }) => {
  const router = useRouter();

  // ── Ask AI state ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>("ask");
  const [askQuery, setAskQuery] = useState("");
  const [isAskLoading, setIsAskLoading] = useState(false);
  const [askResult, setAskResult] = useState<SecondBrainResponse | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  // ── Search state ───────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [activeScope, setActiveScope] = useState<Scope>("all");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Input refs ─────────────────────────────────────────────────
  const askInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus when modal opens or tab changes
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (activeTab === "ask") {
        askInputRef.current?.focus();
      } else {
        searchInputRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [isOpen, activeTab]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Debounced search
  const runSearch = useCallback(
    (q: string, scope: Scope) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!q.trim()) {
        setSearchResults([]);
        setSearchTotal(0);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        setIsSearchLoading(true);
        try {
          const res = await api.searchGlobal(q.trim(), scope);
          setSearchResults(res.results);
          setSearchTotal(res.totalCount);
        } catch {
          setSearchResults([]);
          setSearchTotal(0);
        } finally {
          setIsSearchLoading(false);
        }
      }, 300);
    },
    []
  );

  useEffect(() => {
    runSearch(searchQuery, activeScope);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, activeScope, runSearch]);

  if (!isOpen) return null;

  // ── Ask AI submit ──────────────────────────────────────────────
  const handleAskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!askQuery.trim() || isAskLoading) return;
    setIsAskLoading(true);
    setAskError(null);
    try {
      const res = await api.askSecondBrain(askQuery.trim());
      setAskResult(res);
    } catch (err) {
      setAskResult(null);
      setAskError(err instanceof Error ? err.message : "The AI engine did not respond.");
    } finally {
      setIsAskLoading(false);
    }
  };

  const handleResultClick = (url: string) => {
    router.push(url);
    onClose();
  };

  const handleSuggestedAction = (payload: string) => {
    router.push(payload);
    onClose();
  };

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 bg-black/40 backdrop-blur-sm p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="BizContext Second Brain"
    >
      <div className="w-full max-w-2xl rounded-3xl border border-[#DEDEDE] bg-white shadow-2xl text-[#262626] flex flex-col max-h-[82vh] overflow-hidden">
        {/* ── Tab bar ── */}
        <div className="flex items-center gap-1 px-4 pt-4 pb-3 border-b border-[#EDEDED] shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("ask")}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer ${
              activeTab === "ask"
                ? "bg-[#74D96F]/20 text-[#2C8A28]"
                : "text-[#666666] hover:bg-[#F5F5F5]"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Ask AI
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("search")}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer ${
              activeTab === "search"
                ? "bg-[#74D96F]/20 text-[#2C8A28]"
                : "text-[#666666] hover:bg-[#F5F5F5]"
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            Search
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-full text-[#666666] hover:bg-[#EDEDED] flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* ══════════ ASK AI TAB ══════════ */}
        {activeTab === "ask" && (
          <div className="flex flex-col overflow-hidden px-5 pb-5 pt-4">
            <form onSubmit={handleAskSubmit} className="relative flex items-center shrink-0">
              <Sparkles className="w-4 h-4 text-[#56BE51] absolute left-4" />
              <input
                ref={askInputRef}
                type="text"
                value={askQuery}
                onChange={(e) => setAskQuery(e.target.value)}
                placeholder="Ask anything about your organisation..."
                aria-label="Question"
                className="w-full rounded-full border border-[#BEBEBE] bg-[#F8F9FA] pl-11 pr-28 py-3 text-sm placeholder-[#9E9E9E] focus:border-[#74D96F] focus:bg-white focus:outline-none transition"
              />
              <div className="absolute right-1.5 flex items-center space-x-1">
                <button
                  type="submit"
                  disabled={isAskLoading || !askQuery.trim()}
                  className="inline-flex items-center px-4 py-1.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] text-xs font-bold transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isAskLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      Ask <CornerDownLeft className="w-3 h-3 ml-1" />
                    </>
                  )}
                </button>
              </div>
            </form>

            {isAskLoading && (
              <p className="mt-5 text-xs text-[#666666] flex items-center space-x-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#56BE51]" />
                <span>Thinking...</span>
              </p>
            )}

            {askError && !isAskLoading && (
              <div
                role="alert"
                className="mt-4 flex items-start space-x-2 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{askError}</span>
              </div>
            )}

            {askResult && !isAskLoading && (
              <div className="mt-4 overflow-y-auto space-y-4 pr-1">
                <div className="text-sm leading-relaxed whitespace-pre-wrap">{askResult.answer}</div>

                {askResult.sources.length > 0 && (
                  <div className="pt-3 border-t border-[#EDEDED]">
                    <div className="text-[11px] font-bold text-[#666666] uppercase tracking-wider mb-2">
                      Sources
                    </div>
                    <ul className="space-y-1.5">
                      {askResult.sources.map((s, i) => (
                        <li key={i} className="flex items-center space-x-2 text-xs">
                          <BookOpen className="w-3.5 h-3.5 text-[#56BE51] shrink-0" />
                          <span className="font-semibold">{s.title}</span>
                          <span className="text-[#9E9E9E]">{s.category}</span>
                          {s.matchConfidence !== undefined && (
                            <span className="text-[#9E9E9E]">
                              {s.matchConfidence.toFixed(1)}% match
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {askResult.suggestedActions && askResult.suggestedActions.length > 0 && (
                  <div className="pt-3 border-t border-[#EDEDED]">
                    <div className="text-[11px] font-bold text-[#666666] uppercase tracking-wider mb-2">
                      Suggested Actions
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {askResult.suggestedActions.map((action, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => handleSuggestedAction(action.payload)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#EDEDED] bg-[#F8F9FA] hover:bg-[#74D96F]/10 hover:border-[#74D96F] text-xs font-medium text-[#262626] transition cursor-pointer"
                        >
                          {action.label}
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══════════ SEARCH TAB ══════════ */}
        {activeTab === "search" && (
          <div className="flex flex-col overflow-hidden px-5 pb-5 pt-4 gap-3">
            {/* Search input */}
            <div className="relative flex items-center shrink-0">
              <Search className="w-4 h-4 text-[#9E9E9E] absolute left-4" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                }}
                placeholder="Search employees, knowledge, projects..."
                aria-label="Global search"
                className="w-full rounded-full border border-[#BEBEBE] bg-[#F8F9FA] pl-11 pr-4 py-3 text-sm placeholder-[#9E9E9E] focus:border-[#74D96F] focus:bg-white focus:outline-none transition"
              />
              {isSearchLoading && (
                <Loader2 className="w-4 h-4 animate-spin text-[#56BE51] absolute right-4" />
              )}
            </div>

            {/* Scope pills */}
            <div className="flex flex-wrap gap-1.5 shrink-0">
              {SCOPES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setActiveScope(s.value)}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition cursor-pointer ${
                    activeScope === s.value
                      ? "bg-[#74D96F] border-[#56BE51] text-[#1A5C18]"
                      : "border-[#EDEDED] bg-white text-[#666666] hover:bg-[#F5F5F5]"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Results area */}
            <div className="overflow-y-auto flex-1 min-h-0">
              {!isSearchLoading && searchQuery.trim() && searchResults.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                  <Layers className="w-8 h-8 text-[#DEDEDE]" />
                  <p className="text-sm text-[#9E9E9E]">
                    No results for &ldquo;{searchQuery}&rdquo;
                  </p>
                </div>
              )}

              {!searchQuery.trim() && (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                  <Search className="w-8 h-8 text-[#DEDEDE]" />
                  <p className="text-sm text-[#9E9E9E]">
                    Type to search across your organisation
                  </p>
                </div>
              )}

              {searchResults.length > 0 && (
                <ul className="space-y-1">
                  {searchResults.map((result) => (
                    <li key={result.id}>
                      <button
                        type="button"
                        onClick={() => handleResultClick(result.url)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#F5F5F5] text-left transition cursor-pointer group"
                      >
                        <ResultIcon type={result.type} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[#262626] truncate flex items-center gap-2">
                            <span>{result.title}</span>
                          </div>
                          {result.snippet ? (
                            <div className="text-xs text-[#444444] line-clamp-2 mt-1 bg-white/80 p-2 rounded-lg border border-[#EDEDED] text-[11px] leading-relaxed">
                              {result.snippet}
                            </div>
                          ) : result.subtitle ? (
                            <div className="text-xs text-[#9E9E9E] truncate mt-0.5">
                              {result.subtitle}
                            </div>
                          ) : null}
                        </div>
                        <TypeBadge type={result.type} />
                        <ArrowRight className="w-3.5 h-3.5 text-[#BEBEBE] opacity-0 group-hover:opacity-100 transition shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Result count */}
            {searchQuery.trim() && !isSearchLoading && searchResults.length > 0 && (
              <div className="shrink-0 pt-2 border-t border-[#EDEDED]">
                <p className="text-[11px] text-[#9E9E9E]">
                  {searchTotal} result{searchTotal !== 1 ? "s" : ""}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
