"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  Copy,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Scale,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { api } from "../../services/api";
import { ApiError, sessionStore, streamRequest } from "../../services/http";
import { readSSE } from "../../services/sse";
import { Markdown } from "./Markdown";
import { CouncilPanel } from "./CouncilPanel";
import {
  initialCouncil,
  type AgentKey,
  type ChatMode,
  type ChatTurn,
  type Conversation,
  type CouncilAgentState,
  type Source,
} from "./chatTypes";

const MAX_CONVERSATIONS = 30;
const HISTORY_TURNS = 10;

const SUGGESTIONS: Array<{ mode: ChatMode; title: string; prompt: string }> = [
  { mode: "assistant", title: "Summarise decisions", prompt: "Summarise the latest decisions from our meetings." },
  { mode: "assistant", title: "Find expertise", prompt: "Who in the organisation has verified experience in FastAPI?" },
  {
    mode: "council",
    title: "Should we enter a new market?",
    prompt: "Should we expand our product into the EU market this year?",
  },
  {
    mode: "council",
    title: "Evaluate a vendor",
    prompt: "Should we switch our cloud provider? Compare the leading options and recommend one.",
  },
];

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const storageKey = (userId: string) => `bizcontext_agent_chats_${userId}`;

function loadConversations(userId: string): Conversation[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const parsed = raw ? (JSON.parse(raw) as Conversation[]) : [];
    // A reload mid-stream leaves turns stuck as "streaming"; mark them stopped.
    return parsed.map((c) => ({
      ...c,
      messages: c.messages.map((m) => (m.status === "streaming" ? { ...m, status: "stopped" as const } : m)),
    }));
  } catch {
    return [];
  }
}

function toSources(raw: unknown): Source[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c: Record<string, unknown>) => ({
    title: String(c.title ?? c.url ?? "Source"),
    type: String(c.source_type ?? "source"),
    url: typeof c.url === "string" ? c.url : undefined,
    snippet: typeof c.snippet === "string" ? c.snippet : undefined,
  }));
}

function isSafeHref(url?: string): url is string {
  return !!url && /^(https?:\/\/|\/)/.test(url);
}

/* ── Sub-components ──────────────────────────────────────────────── */

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-2" aria-label="The assistant is thinking">
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </div>
  );
}

function SourceChips({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {sources.slice(0, 8).map((s, i) => {
        const inner = (
          <>
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#74D96F]/25 text-[9px] font-bold text-[#1F541D]">
              {i + 1}
            </span>
            <span className="max-w-[180px] truncate">{s.title}</span>
          </>
        );
        const cls =
          "inline-flex items-center gap-1.5 rounded-full border border-[#EDEDED] bg-white px-2.5 py-1 text-[11px] font-medium text-[#444] transition";
        return isSafeHref(s.url) ? (
          <a
            key={`${s.url}-${i}`}
            href={s.url}
            target={s.url.startsWith("/") ? undefined : "_blank"}
            rel="noopener noreferrer nofollow"
            title={s.snippet ?? s.title}
            className={`${cls} hover:border-[#74D96F] hover:text-[#1F541D]`}
          >
            {inner}
          </a>
        ) : (
          <span key={i} title={s.snippet ?? s.title} className={cls}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable (insecure context) */
        }
      }}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[#666666] transition hover:bg-[#EDEDED] hover:text-[#262626]"
      aria-label="Copy answer"
    >
      {done ? <Check className="h-3 w-3 text-[#56BE51]" /> : <Copy className="h-3 w-3" />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/* ── Main component ──────────────────────────────────────────────── */

export default function AgentChat() {
  const [userId, setUserId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<ChatMode>("assistant");
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showJump, setShowJump] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const active = useMemo(() => conversations.find((c) => c.id === activeId) ?? null, [conversations, activeId]);

  /* load + persist */
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, []);

  useEffect(() => {
    const uid = sessionStore.get()?.user.id ?? "anonymous";
    setUserId(uid);
    const loaded = loadConversations(uid);
    setConversations(loaded);
    if (typeof window !== "undefined" && window.innerWidth < 1024) setSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (!userId || isStreaming) return;
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)));
    } catch {
      /* storage full or disabled */
    }
  }, [conversations, userId, isStreaming]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* scrolling */
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    if (stickRef.current) scrollToBottom();
  }, [active?.messages, scrollToBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickRef.current = nearBottom;
    setShowJump(!nearBottom);
  };

  /* textarea autosize */
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  /* state helpers */
  const patchTurn = useCallback((convId: string, turnId: string, fn: (t: ChatTurn) => ChatTurn) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, messages: c.messages.map((m) => (m.id === turnId ? fn(m) : m)) } : c))
    );
  }, []);

  const patchAgent = useCallback(
    (convId: string, turnId: string, agent: AgentKey, fn: (a: CouncilAgentState) => CouncilAgentState) => {
      patchTurn(convId, turnId, (t) => {
        const council = (t.council ?? initialCouncil()).map((a) => (a.id === agent ? fn(a) : a));
        const ceo = council.find((a) => a.id === "ceo");
        return { ...t, council, content: ceo?.text ?? t.content };
      });
    },
    [patchTurn]
  );

  /* streaming */
  const run = useCallback(
    async (convId: string, question: string, runMode: ChatMode, history: ChatTurn[], turnId: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      stickRef.current = true;

      const body = {
        prompt: question,
        conversationId: convId,
        agentRole: runMode === "council" ? "council" : "chat_assistant",
        chatHistory: history
          .filter((t) => t.status !== "error" && t.content.trim())
          .slice(-HISTORY_TURNS)
          .map((t) => ({ role: t.role, content: t.content })),
      };
      const path = runMode === "council" ? "/ai/council/stream" : "/ai/stream";

      try {
        const res = await streamRequest(api.getBaseUrl(), path, body, controller.signal);
        await readSSE(res.body!, ({ event, data }) => {
          const d = data as Record<string, any>;
          switch (event) {
            case "token":
              patchTurn(convId, turnId, (t) => ({ ...t, content: t.content + String(d.delta ?? "") }));
              break;
            case "citations":
              patchTurn(convId, turnId, (t) => ({ ...t, sources: toSources(d.citations) }));
              break;
            case "done":
              patchTurn(convId, turnId, (t) => ({
                ...t,
                content: t.content || String(d.response ?? ""),
                sources: d.citations ? toSources(d.citations) : t.sources,
                status: "done",
              }));
              break;
            case "council_start":
              patchTurn(convId, turnId, (t) => ({
                ...t,
                council: initialCouncil().map((a) => ({ ...a, status: a.id === "ceo" ? "waiting" : "running" })),
              }));
              break;
            case "agent_start":
              patchAgent(convId, turnId, d.agent, (a) => ({ ...a, status: "running", tools: d.tools ?? [] }));
              break;
            case "agent_token":
              patchAgent(convId, turnId, d.agent, (a) => ({ ...a, text: a.text + String(d.delta ?? "") }));
              break;
            case "agent_done":
              patchAgent(convId, turnId, d.agent, (a) => ({
                ...a,
                status: d.status === "error" ? "error" : "done",
                error: d.error ?? undefined,
                text: d.response || a.text,
                toolCalls: Array.isArray(d.tool_calls) ? d.tool_calls.length : a.toolCalls,
              }));
              break;
            case "council_done":
              patchTurn(convId, turnId, (t) => ({
                ...t,
                content: String(d.decision || t.content),
                sources: toSources(d.citations),
                status: d.decision ? "done" : "error",
                error: d.decision ? undefined : "The council could not reach a decision.",
              }));
              break;
            case "error":
              patchTurn(convId, turnId, (t) => ({
                ...t,
                status: "error",
                error: String(d.error ?? "The AI engine reported an error."),
              }));
              break;
          }
        });
        // The stream closed without a terminal event: surface that instead of hanging.
        patchTurn(convId, turnId, (t) =>
          t.status === "streaming"
            ? t.content.trim()
              ? { ...t, status: "done" }
              : { ...t, status: "error", error: "The connection closed before an answer arrived." }
            : t
        );
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        patchTurn(convId, turnId, (t) =>
          aborted
            ? { ...t, status: "stopped" }
            : {
                ...t,
                status: "error",
                error:
                  err instanceof ApiError && err.status === 403
                    ? "Your role doesn't allow this action."
                    : err instanceof Error
                      ? err.message
                      : "Something went wrong.",
              }
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setIsStreaming(false);
        // Stopped/failed turns may leave agents spinning; settle them.
        patchTurn(convId, turnId, (t) =>
          t.council
            ? {
                ...t,
                council: t.council.map((a) =>
                  a.status === "running" || a.status === "waiting"
                    ? { ...a, status: t.status === "error" ? "error" : "done", error: a.error }
                    : a
                ),
              }
            : t
        );
      }
    },
    [patchAgent, patchTurn]
  );

  const send = useCallback(
    (text: string, sendMode: ChatMode = mode) => {
      const question = text.trim();
      if (!question || isStreaming) return;

      const now = new Date().toISOString();
      const userTurn: ChatTurn = { id: newId(), role: "user", content: question, createdAt: now };
      const aiTurn: ChatTurn = {
        id: newId(),
        role: "assistant",
        content: "",
        createdAt: now,
        mode: sendMode,
        status: "streaming",
        council: sendMode === "council" ? initialCouncil() : undefined,
      };

      let convId = activeId;
      let history: ChatTurn[] = [];
      if (convId && active) {
        history = active.messages;
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId ? { ...c, mode: sendMode, updatedAt: now, messages: [...c.messages, userTurn, aiTurn] } : c
          )
        );
      } else {
        convId = newId();
        const conv: Conversation = {
          id: convId,
          title: question.slice(0, 48),
          mode: sendMode,
          updatedAt: now,
          messages: [userTurn, aiTurn],
        };
        setConversations((prev) => [conv, ...prev].slice(0, MAX_CONVERSATIONS));
        setActiveId(convId);
      }
      setInput("");
      void run(convId, question, sendMode, history, aiTurn.id);
    },
    [active, activeId, isStreaming, mode, run]
  );

  const regenerate = useCallback(() => {
    if (!active || isStreaming) return;
    const msgs = active.messages;
    const lastUserIdx = [...msgs].map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx < 0) return;
    const question = msgs[lastUserIdx].content;
    const aiMode = msgs[lastUserIdx + 1]?.mode ?? active.mode;
    const history = msgs.slice(0, lastUserIdx);
    const aiTurn: ChatTurn = {
      id: newId(),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      mode: aiMode,
      status: "streaming",
      council: aiMode === "council" ? initialCouncil() : undefined,
    };
    setConversations((prev) =>
      prev.map((c) =>
        c.id === active.id ? { ...c, messages: [...msgs.slice(0, lastUserIdx + 1), aiTurn] } : c
      )
    );
    void run(active.id, question, aiMode, history, aiTurn.id);
  }, [active, isStreaming, run]);

  const stop = () => abortRef.current?.abort();

  const newChat = () => {
    if (isStreaming) return;
    setActiveId(null);
    setInput("");
    textareaRef.current?.focus();
  };

  const deleteConversation = (id: string) => {
    if (isStreaming && id === activeId) return;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (id === activeId) setActiveId(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  const messages = active?.messages ?? [];
  const lastIdx = messages.length - 1;
  const canSend = input.trim().length > 0 && !isStreaming;

  return (
    <div className="flex h-[calc(100vh-11rem)] overflow-hidden rounded-3xl border border-[#BEBEBE]/40 bg-white shadow-sm animate-fade-in">
      {/* Conversations */}
      <aside
        className={`${sidebarOpen ? "w-64" : "w-0"} shrink-0 overflow-hidden border-r border-[#EDEDED] bg-[#F8F9FA] transition-all duration-300`}
        aria-hidden={!sidebarOpen}
      >
        <div className="flex h-full w-64 flex-col p-3">
          <button
            type="button"
            onClick={newChat}
            disabled={isStreaming}
            className="flex items-center gap-2 rounded-xl border border-[#EDEDED] bg-white px-3 py-2.5 text-xs font-bold text-[#262626] transition hover:border-[#74D96F] disabled:opacity-50"
          >
            <MessageSquarePlus className="h-4 w-4 text-[#56BE51]" />
            New chat
          </button>

          <div className="mt-3 flex-1 space-y-0.5 overflow-y-auto">
            {conversations.length === 0 && (
              <p className="px-2 py-6 text-center text-[11px] text-[#9E9E9E]">Your conversations will appear here.</p>
            )}
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 rounded-xl pr-1 transition ${
                  c.id === activeId ? "bg-[#EDEDED]" : "hover:bg-[#EDEDED]/60"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!isStreaming) {
                      setActiveId(c.id);
                      if (typeof window !== "undefined" && window.innerWidth < 768) {
                        setSidebarOpen(false);
                      }
                    }
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-xs text-[#262626]"
                >
                  {c.mode === "council" ? (
                    <Scale className="h-3.5 w-3.5 shrink-0 text-[#F09363]" aria-label="Council" />
                  ) : (
                    <Bot className="h-3.5 w-3.5 shrink-0 text-[#56BE51]" aria-label="Assistant" />
                  )}
                  <span className="truncate font-medium">{c.title || "New chat"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteConversation(c.id)}
                  className="rounded-lg p-1.5 text-[#9E9E9E] opacity-0 transition hover:bg-white hover:text-rose-600 focus:opacity-100 group-hover:opacity-100"
                  aria-label={`Delete conversation ${c.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Chat column */}
      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#EDEDED] px-3">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded-lg p-1.5 text-[#666666] transition hover:bg-[#EDEDED] hover:text-[#262626]"
            aria-label={sidebarOpen ? "Hide conversations" : "Show conversations"}
          >
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>

          <div role="radiogroup" aria-label="Chat mode" className="flex rounded-full bg-[#EDEDED] p-0.5 text-[11px] font-bold">
            {(
              [
                ["assistant", "Assistant", Sparkles],
                ["council", "Council", Scale],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                disabled={isStreaming}
                onClick={() => setMode(value)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition disabled:cursor-not-allowed ${
                  mode === value ? "bg-white text-[#262626] shadow-xs" : "text-[#666666] hover:text-[#262626]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
          <div className="w-8" />
        </header>

        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 py-10 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#74D96F] shadow-[0_4px_16px_rgba(116,217,111,0.4)] animate-scale-bounce">
                <Bot className="h-6 w-6 text-[#262626]" />
              </div>
              <h2 className="text-xl font-extrabold tracking-tight text-[#262626] animate-slide-up">
                {mode === "council" ? "Put a decision to the council" : "How can I help?"}
              </h2>
              <p className="mt-1.5 max-w-md text-sm text-[#666666] animate-slide-up stagger-1">
                {mode === "council"
                  ? "Knowledge, Research and Browser agents work in parallel, then the CEO agent decides."
                  : "Ask about your organisation's projects, people, meetings and documents."}
              </p>
              <div className="mt-6 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
                {SUGGESTIONS.filter((s) => s.mode === mode).concat(SUGGESTIONS.filter((s) => s.mode !== mode)).map(
                  (s, i) => (
                    <button
                      key={s.title}
                      type="button"
                      onClick={() => {
                        setMode(s.mode);
                        send(s.prompt, s.mode);
                      }}
                      style={{ animationDelay: `${120 + i * 60}ms` }}
                      className="card-hover animate-slide-up rounded-2xl border border-[#EDEDED] bg-white p-3.5 text-left"
                    >
                      <span className="flex items-center gap-1.5 text-xs font-bold text-[#262626]">
                        {s.mode === "council" ? (
                          <Scale className="h-3.5 w-3.5 text-[#F09363]" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5 text-[#56BE51]" />
                        )}
                        {s.title}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-[11px] text-[#666666]">{s.prompt}</span>
                    </button>
                  )
                )}
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
              {messages.map((m, idx) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end animate-slide-up">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-[#EDEDED] px-4 py-2.5 text-sm text-[#262626]">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex gap-3 animate-slide-up">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#74D96F]">
                      <Bot className="h-4 w-4 text-[#262626]" />
                    </div>
                    <div className="min-w-0 flex-1 text-sm text-[#262626]">
                      {m.council && <CouncilPanel agents={m.council} />}

                      {m.content ? (
                        <>
                          {m.mode === "council" && (
                            <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-[#56BE51]">
                              CEO decision
                            </div>
                          )}
                          <Markdown text={m.content} />
                          {m.status === "streaming" && (
                            <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-[#56BE51]" />
                          )}
                        </>
                      ) : (
                        m.status === "streaming" && !m.council && <ThinkingDots />
                      )}

                      {m.status === "stopped" && (
                        <p className="mt-1 text-[11px] italic text-[#9E9E9E]">Stopped.</p>
                      )}
                      {m.status === "error" && (
                        <div role="alert" className="mt-2 rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
                          {m.error ?? "Something went wrong."}
                        </div>
                      )}

                      <SourceChips sources={m.sources ?? []} />

                      {m.status !== "streaming" && (
                        <div className="mt-2 flex items-center gap-1">
                          {m.content && <CopyButton text={m.content} />}
                          {idx === lastIdx && (
                            <button
                              type="button"
                              onClick={regenerate}
                              disabled={isStreaming}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[#666666] transition hover:bg-[#EDEDED] hover:text-[#262626] disabled:opacity-40"
                            >
                              <RefreshCw className="h-3 w-3" />
                              Regenerate
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>

        {showJump && messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              stickRef.current = true;
              scrollToBottom(true);
            }}
            className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full border border-[#EDEDED] bg-white p-2 shadow-md transition hover:bg-[#F8F9FA] animate-scale-in"
            aria-label="Scroll to latest message"
          >
            <ArrowDown className="h-4 w-4 text-[#262626]" />
          </button>
        )}

        {/* Composer */}
        <div className="shrink-0 px-4 pb-4 pt-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="mx-auto flex max-w-3xl items-end gap-2 rounded-3xl border border-[#BEBEBE]/70 bg-white p-2 pl-4 shadow-sm transition focus-within:border-[#74D96F] focus-within:shadow-[0_0_0_3px_rgba(116,217,111,0.18)]"
          >
            <label htmlFor="agent-chat-input" className="sr-only">
              Message
            </label>
            <textarea
              id="agent-chat-input"
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              maxLength={8000}
              placeholder={mode === "council" ? "Describe the decision you need made…" : "Message BizContext AI…"}
              className="max-h-[200px] flex-1 resize-none bg-transparent py-2 text-sm text-[#262626] placeholder:text-[#9E9E9E] focus:outline-none"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={stop}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#262626] text-white transition hover:bg-black"
                aria-label="Stop generating"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#74D96F] text-[#262626] transition hover:bg-[#62CE5C] disabled:cursor-not-allowed disabled:bg-[#EDEDED] disabled:text-[#BEBEBE]"
                aria-label="Send message"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </form>
          <p className="mt-2 text-center text-[10px] text-[#9E9E9E]">
            AI can make mistakes. Check sources before acting. Enter to send · Shift+Enter for a new line
          </p>
        </div>
      </section>
    </div>
  );
}
