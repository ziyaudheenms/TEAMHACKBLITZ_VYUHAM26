"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  FolderKanban,
  Hash,
  Loader2,
  Lock,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { api } from "../../services/api";
import { sessionStore } from "../../services/http";
import { useRBAC } from "../../lib/useRBAC";
import { Markdown } from "../../components/agents/Markdown";
import type { ChatChannel, ChatMessage, EmployeeProfile } from "../../types";

const POLL_MS = 3000;
const COPILOT_WAIT_MS = 100_000; // matches the server-side AI timeout plus a margin
const MENTION_RE = /@bizcontext\b/i;
const MAX_LEN = 4000;

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

const timeOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  return fresh.length ? [...existing, ...fresh] : existing;
}

export default function ChatPage() {
  const { isMember } = useRBAC();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const canPost = mounted && isMember;

  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [newOpen, setNewOpen] = useState(false);
  const [newBusy, setNewBusy] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);
  const [newForm, setNewForm] = useState({ name: "", description: "", isPrivate: false });
  const [people, setPeople] = useState<EmployeeProfile[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef<string | null>(null);
  const stickRef = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);
  const me = mounted ? sessionStore.get()?.user.id : undefined;

  const active = useMemo(() => channels.find((c) => c.id === activeId) ?? null, [channels, activeId]);

  /* channels */
  const loadChannels = useCallback(async () => {
    setChannelsLoading(true);
    setChannelsError(null);
    try {
      const list = await api.getChannels();
      setChannels(list);
      setActiveId((cur) => (cur && list.some((c) => c.id === cur) ? cur : (list[0]?.id ?? null)));
    } catch (e) {
      setChannelsError(errText(e, "Couldn't load channels"));
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  /* messages: initial load, then poll for newer ones */
  useEffect(() => {
    activeRef.current = activeId;
    setMessages([]);
    setMessagesError(null);
    setSendError(null);
    stickRef.current = true;
    if (!activeId) return;

    let cancelled = false;
    setMessagesLoading(true);
    api
      .getMessages(activeId)
      .then((list) => {
        if (!cancelled) setMessages(list);
      })
      .catch((e) => {
        if (!cancelled) setMessagesError(errText(e, "Couldn't load messages"));
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });

    const timer = setInterval(async () => {
      if (document.hidden) return;
      setNow(Date.now());
      try {
        let lastAt: string | undefined;
        setMessages((cur) => {
          lastAt = cur[cur.length - 1]?.createdAt;
          return cur;
        });
        // setMessages' updater runs synchronously enough for the read above in practice, but
        // fall back to a full reload if the list was empty.
        const incoming = await api.getMessages(activeId, lastAt);
        if (cancelled || activeRef.current !== activeId) return;
        setMessagesError(null);
        setMessages((cur) => mergeMessages(cur, incoming));
      } catch (e) {
        if (!cancelled) setMessagesError(errText(e, "Lost connection to chat. Retrying…"));
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeId]);

  /* autoscroll only while the reader is at the bottom */
  useEffect(() => {
    if (stickRef.current) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  /* Is the copilot working on a recent @mention? (derived, so every client sees it) */
  const thinking = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.isAi) return false;
      if (MENTION_RE.test(m.content)) return now - Date.parse(m.createdAt) < COPILOT_WAIT_MS;
    }
    return false;
  }, [messages, now]);

  useEffect(() => {
    if (!thinking) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [thinking]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const content = text.trim();
    if (!content || !activeId || sending || !canPost) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await api.sendMessage(activeId, content);
      if (activeRef.current === activeId) {
        stickRef.current = true;
        setMessages((cur) => mergeMessages(cur, [res.message]));
        setNow(Date.now());
      }
      setText("");
    } catch (err) {
      setSendError(errText(err, "Couldn't send your message"));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  /* new channel */
  const openNew = async () => {
    setNewError(null);
    setNewForm({ name: "", description: "", isPrivate: false });
    setPicked(new Set());
    setNewOpen(true);
    if (people.length === 0) {
      try {
        setPeople(await api.getEmployees());
      } catch {
        /* the member picker is optional; creating the channel still works */
      }
    }
  };

  const createChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewBusy(true);
    setNewError(null);
    try {
      const ch = await api.createChannel({
        name: newForm.name,
        description: newForm.description,
        isPrivate: newForm.isPrivate,
        memberIds: newForm.isPrivate ? [...picked] : [],
      });
      setChannels((cur) => [...cur, ch]);
      setActiveId(ch.id);
      setNewOpen(false);
    } catch (err) {
      setNewError(errText(err, "Couldn't create the channel"));
    } finally {
      setNewBusy(false);
    }
  };

  const invitable = people.filter((p) => p.userId && p.userId !== me && p.employmentStatus === "active");

  return (
    <div className="flex h-[calc(100vh-6.5rem)] overflow-hidden rounded-3xl border border-[#BEBEBE]/40 bg-white shadow-sm animate-scale-in">
      {/* Channels */}
      <div className="flex w-64 shrink-0 flex-col border-r border-[#EDEDED] bg-[#F8F9FA] p-4">
        <div className="mb-3 flex items-center justify-between border-b border-[#EDEDED] pb-3">
          <div className="flex items-center space-x-2">
            <MessageSquare className="h-4 w-4 text-[#74D96F]" />
            <span className="text-sm font-bold">Channels</span>
          </div>
          {canPost && (
            <button
              type="button"
              onClick={openNew}
              title="New channel"
              aria-label="New channel"
              className="cursor-pointer rounded-lg p-1 text-[#666666] transition hover:bg-[#EDEDED] hover:text-[#262626]"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto">
          {channelsLoading && (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-8 rounded-xl" />
              ))}
            </div>
          )}
          {channelsError && (
            <div role="alert" className="space-y-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              <p>{channelsError}</p>
              <button type="button" onClick={loadChannels} className="font-bold underline">
                Retry
              </button>
            </div>
          )}
          {!channelsLoading && !channelsError && channels.length === 0 && (
            <p className="px-2 py-4 text-center text-[11px] text-[#9E9E9E]">No channels yet.</p>
          )}
          {channels.map((ch, i) => (
            <button
              key={ch.id}
              type="button"
              onClick={() => setActiveId(ch.id)}
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              className={`flex w-full animate-slide-in-left cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${
                ch.id === activeId
                  ? "border border-[#BEBEBE]/40 bg-[#EDEDED] text-[#262626] shadow-xs"
                  : "text-[#666666] hover:bg-[#EDEDED]/50 hover:text-[#262626]"
              }`}
            >
              <span className="flex items-center space-x-2 truncate">
                {ch.isPrivate ? (
                  <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Private" />
                ) : (
                  <Hash className="h-3.5 w-3.5 shrink-0 text-[#666666]" aria-label="Public" />
                )}
                <span className="truncate">{ch.name}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-1 rounded-2xl border border-[#BEBEBE]/40 bg-[#EDEDED] p-3.5 text-[11px]">
          <div className="flex items-center space-x-1.5 font-bold text-[#1F541D]">
            <Sparkles className="h-3.5 w-3.5 text-[#74D96F]" />
            <span>AI Copilot</span>
          </div>
          <p className="text-[10px] leading-tight text-[#666666]">
            Mention <strong className="text-[#262626]">@BizContext</strong> in a message and the whole channel sees its answer.
          </p>
        </div>
      </div>

      {/* Conversation */}
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        {active ? (
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#EDEDED] px-6">
            <div className="flex min-w-0 items-center space-x-2">
              {active.isPrivate ? <Lock className="h-4 w-4 text-amber-500" /> : <Hash className="h-4 w-4 text-[#666666]" />}
              <span className="text-sm font-bold">{active.name}</span>
              {active.description && <span className="hidden truncate text-xs text-[#666666] sm:inline">— {active.description}</span>}
            </div>
            <div className="flex items-center space-x-1.5 text-xs text-[#666666]">
              <Users className="h-3.5 w-3.5" />
              <span>{active.memberCount} members</span>
            </div>
          </div>
        ) : (
          <div className="h-14 shrink-0 border-b border-[#EDEDED]" />
        )}

        <div ref={listRef} onScroll={onScroll} className="flex-1 space-y-4 overflow-y-auto p-6">
          {messagesError && (
            <div role="alert" className="flex items-start space-x-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{messagesError}</span>
            </div>
          )}
          {messagesLoading && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-[#56BE51]" />
            </div>
          )}
          {!messagesLoading && active && messages.length === 0 && !messagesError && (
            <div className="flex h-full flex-col items-center justify-center text-center text-[#666666]">
              <MessageSquare className="mb-2 h-8 w-8 text-[#74D96F]/60" />
              <p className="text-sm font-semibold text-[#262626]">This is the start of #{active.name}</p>
              <p className="text-xs">Say hello, or ask the copilot with @BizContext.</p>
            </div>
          )}
          {!channelsLoading && !active && !channelsError && (
            <p className="py-10 text-center text-xs text-[#666666]">Select or create a channel to start chatting.</p>
          )}

          {messages.map((m) => {
            const mine = !m.isAi && m.senderId === me;
            return (
              <div
                key={m.id}
                className={`flex animate-slide-up items-start space-x-3 text-xs ${
                  m.isAi ? "rounded-2xl border border-[#74D96F]/30 bg-[#74D96F]/10 p-4 shadow-xs" : ""
                }`}
              >
                {m.isAi ? (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#74D96F] shadow-xs">
                    <Bot className="h-4 w-4 text-[#262626]" />
                  </div>
                ) : (
                  <div
                    aria-hidden
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-[11px] font-bold ${
                      mine ? "border-[#74D96F]/40 bg-[#74D96F]/25 text-[#1F541D]" : "border-[#BEBEBE]/40 bg-[#EDEDED] text-[#262626]"
                    }`}
                  >
                    {initialsOf(m.senderName)}
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className={`font-bold ${m.isAi ? "text-[#1F541D]" : "text-[#262626]"}`}>{m.senderName}</span>
                    {m.isAi && (
                      <span className="rounded-full border border-[#74D96F]/40 bg-[#74D96F]/20 px-1.5 py-0.5 text-[9px] font-bold text-[#1F541D]">
                        AI
                      </span>
                    )}
                    <span className="text-[10px] text-[#666666]">{timeOf(m.createdAt)}</span>
                  </div>
                  {m.isAi ? (
                    <div className="text-[#262626]">
                      <Markdown text={m.content} />
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap break-words leading-relaxed text-[#262626]">{m.content}</div>
                  )}
                  {m.isAi && m.sources && m.sources.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1.5">
                      {m.sources.map((s, i) => {
                        const isTask = s.type === "task" || s.url?.includes("/projects");
                        if (s.url && /^(https?:\/\/|\/)/.test(s.url)) {
                          return (
                            <a
                              key={i}
                              href={s.url}
                              target={s.url.startsWith("/") ? undefined : "_blank"}
                              rel="noopener noreferrer nofollow"
                              className={`inline-flex items-center gap-1.5 max-w-[280px] truncate rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                                isTask
                                  ? "border border-[#74D96F]/50 bg-[#74D96F]/15 text-[#1F541D] hover:bg-[#74D96F]/25 shadow-2xs font-semibold"
                                  : "border border-[#EDEDED] bg-white text-[#262626] hover:border-[#74D96F]"
                              }`}
                            >
                              {isTask && <FolderKanban className="h-3 w-3 shrink-0 text-[#1F541D]" />}
                              <span className="truncate">{s.title}</span>
                              {isTask && <span className="text-[9px] font-normal opacity-80">→ Board</span>}
                            </a>
                          );
                        }
                        return (
                          <span
                            key={i}
                            className={`inline-flex items-center gap-1 max-w-[220px] truncate rounded-full border px-2.5 py-1 text-[11px] ${
                              isTask
                                ? "border-[#74D96F]/40 bg-[#74D96F]/10 text-[#1F541D]"
                                : "border-[#EDEDED] bg-white text-[#262626]"
                            }`}
                          >
                            {isTask && <FolderKanban className="h-3 w-3 shrink-0 text-[#1F541D]" />}
                            <span className="truncate">{s.title}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {thinking && (
            <div className="flex animate-slide-up items-center space-x-3 px-1" role="status" aria-label="BizContext Copilot is typing">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#74D96F] shadow-xs">
                <Bot className="h-4 w-4 text-[#262626]" />
              </div>
              <div className="flex items-center space-x-1 rounded-2xl border border-[#74D96F]/30 bg-[#74D96F]/10 px-4 py-3">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-[#EDEDED] bg-white p-4">
          {sendError && (
            <div role="alert" className="mb-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {sendError}
            </div>
          )}
          {mounted && !canPost ? (
            <p className="rounded-2xl bg-[#F8F9FA] px-4 py-3 text-center text-xs text-[#666666]">
              Guests can read channels but can't post.
            </p>
          ) : (
            <form onSubmit={send}>
              <div className="flex items-end space-x-2 rounded-2xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-4 py-2.5 transition focus-within:border-[#74D96F] focus-within:bg-white">
                <label htmlFor="chat-input" className="sr-only">
                  Message
                </label>
                <textarea
                  id="chat-input"
                  ref={inputRef}
                  rows={1}
                  maxLength={MAX_LEN}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={!active}
                  placeholder={active ? `Message #${active.name} · @BizContext to ask the AI` : "Select a channel…"}
                  className="max-h-32 flex-1 resize-none bg-transparent text-xs text-[#262626] outline-none placeholder:text-[#9E9E9E] disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => {
                    setText((t) => (MENTION_RE.test(t) ? t : `@BizContext ${t}`));
                    inputRef.current?.focus();
                  }}
                  disabled={!active}
                  title="Ask the AI copilot"
                  className="rounded-lg p-1.5 text-[#56BE51] transition hover:bg-[#74D96F]/15 disabled:opacity-40"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </button>
                <button
                  type="submit"
                  disabled={!text.trim() || !active || sending}
                  aria-label="Send message"
                  className="cursor-pointer rounded-xl bg-[#74D96F] p-1.5 text-[#262626] transition hover:bg-[#62CE5C] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="mt-1.5 px-1 text-[10px] text-[#9E9E9E]">Enter to send · Shift+Enter for a new line</p>
            </form>
          )}
        </div>
      </div>

      {newOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
          onMouseDown={(e) => e.target === e.currentTarget && !newBusy && setNewOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="New channel"
        >
          <form onSubmit={createChannel} className="max-h-[90vh] w-full max-w-md animate-scale-in space-y-4 overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">New channel</h3>
              <button type="button" onClick={() => setNewOpen(false)} aria-label="Close" className="cursor-pointer rounded-full p-1.5 text-[#666666] hover:bg-[#EDEDED]">
                <X className="h-4 w-4" />
              </button>
            </div>
            {newError && (
              <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                {newError}
              </div>
            )}
            <label className="block space-y-1 text-xs font-semibold">
              <span>Name</span>
              <input
                required
                maxLength={80}
                value={newForm.name}
                onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                placeholder="e.g. design-reviews"
                className="w-full rounded-2xl border border-[#BEBEBE] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#74D96F] focus:ring-2 focus:ring-[#74D96F]/20"
              />
            </label>
            <label className="block space-y-1 text-xs font-semibold">
              <span>Description (optional)</span>
              <input
                maxLength={300}
                value={newForm.description}
                onChange={(e) => setNewForm({ ...newForm, description: e.target.value })}
                className="w-full rounded-2xl border border-[#BEBEBE] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#74D96F] focus:ring-2 focus:ring-[#74D96F]/20"
              />
            </label>
            <label className="flex cursor-pointer select-none items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={newForm.isPrivate}
                onChange={(e) => setNewForm({ ...newForm, isPrivate: e.target.checked })}
                className="rounded border-[#BEBEBE] accent-[#56BE51]"
              />
              <Lock className="h-3.5 w-3.5 text-amber-500" /> Private (only people you add can see it)
            </label>
            {newForm.isPrivate && (
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#666666]">Add people</legend>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-2xl border border-[#EDEDED] p-2">
                  {invitable.length === 0 && <p className="p-2 text-xs text-[#666666]">No one else to add yet.</p>}
                  {invitable.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-xs hover:bg-[#F8F9FA]">
                      <input
                        type="checkbox"
                        checked={picked.has(p.userId)}
                        onChange={(e) =>
                          setPicked((cur) => {
                            const next = new Set(cur);
                            if (e.target.checked) next.add(p.userId);
                            else next.delete(p.userId);
                            return next;
                          })
                        }
                        className="rounded border-[#BEBEBE] accent-[#56BE51]"
                      />
                      <span className="truncate font-medium">
                        {p.firstName} {p.lastName}
                      </span>
                      <span className="truncate text-[#9E9E9E]">{p.designation}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="flex justify-end space-x-2 pt-1">
              <button type="button" onClick={() => setNewOpen(false)} className="cursor-pointer rounded-full bg-[#EDEDED] px-4 py-2 text-xs font-semibold hover:bg-[#E2E2E2]">
                Cancel
              </button>
              <button type="submit" disabled={newBusy} className="flex cursor-pointer items-center space-x-1.5 rounded-full bg-[#74D96F] px-5 py-2 text-xs font-bold hover:bg-[#62CE5C] disabled:opacity-60">
                {newBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{newBusy ? "Creating…" : "Create channel"}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
