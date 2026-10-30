"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageSquare,
  Hash,
  Lock,
  Send,
  Sparkles,
  Bot,
  Users,
  Plus,
  Loader2,
  ArrowLeft,
} from "lucide-react";
import { api } from "../../services/api";
import { sessionStore } from "../../services/http";
import type { ChatChannel, ChatMessage } from "../../types";

/* ── AI streaming helpers ────────────────────────────────────────── */

async function streamAIReply(
  prompt: string,
  chatHistory: Array<{ role: "user" | "assistant"; content: string }>,
  organisationId: string,
  userId: string,
  authToken: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (msg: string) => void
) {
  const baseUrl = api.getBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/ai/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
        "X-Organisation-Id": organisationId,
        "X-User-Id": userId,
      },
      body: JSON.stringify({
        prompt,
        agentRole: "chat_assistant",
        chatHistory,
        metadata: { channel: "chat" },
      }),
    });

    if (!res.ok || !res.body) {
      onError(`AI engine responded with ${res.status}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawToken = false;
    let finalResponse = "";

    // AI engine emits: token {delta} | tools | citations | done {response} | error {error}
    const handleBlock = (block: string): string | null => {
      let eventName = "message";
      let dataStr = "";
      for (const raw of block.split(/\r?\n/)) {
        if (raw.startsWith("event:")) eventName = raw.slice(6).trim();
        else if (raw.startsWith("data:")) dataStr += raw.slice(5).trim();
      }
      if (!dataStr) return null;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(dataStr);
      } catch {
        return null;
      }
      if (eventName === "token" && typeof payload.delta === "string") {
        sawToken = true;
        onChunk(payload.delta);
      } else if (eventName === "done" && typeof payload.response === "string") {
        finalResponse = payload.response;
      } else if (eventName === "error") {
        return String(payload.error ?? "AI engine error");
      }
      return null;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const err = handleBlock(block);
        if (err) {
          onError(err);
          return;
        }
      }
    }
    if (buffer.trim()) {
      const err = handleBlock(buffer);
      if (err) {
        onError(err);
        return;
      }
    }
    // If the model produced no incremental tokens, surface the final response instead.
    if (!sawToken && finalResponse) onChunk(finalResponse);
    onDone();
  } catch (err) {
    onError(err instanceof Error ? err.message : "Stream failed");
  }
}

/* ── Typing dots component ───────────────────────────────────────── */

function TypingIndicator() {
  return (
    <div className="flex items-center space-x-3 px-1">
      <div className="w-8 h-8 rounded-xl bg-[#74D96F] flex items-center justify-center shrink-0 shadow-xs">
        <Bot className="w-4 h-4 text-[#262626]" />
      </div>
      <div className="flex items-center space-x-1 bg-[#74D96F]/10 px-4 py-3 rounded-2xl border border-[#74D96F]/30">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────── */

export default function ChatPage() {
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [activeChannel, setActiveChannel] = useState<ChatChannel | null>(null);
  const [mobileTab, setMobileTab] = useState<"channels" | "chat">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isAiStreaming, setIsAiStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getChannels().then((chs) => {
      setChannels(chs);
      if (chs.length > 0) setActiveChannel(chs[0]);
    });
  }, []);

  useEffect(() => {
    if (!activeChannel) return;
    const load = () =>
      api.getMessages(activeChannel.id).then(setMessages).catch(() => {});
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [activeChannel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAiStreaming, streamingText]);

  const handleSendMessage = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = inputText.trim();
      if (!text || !activeChannel || isSending) return;

      setInputText("");
      setIsSending(true);

      // Optimistically add user message
      const session = sessionStore.get();
      const userId = session?.user?.id ?? "me";
      const organisationId = session?.organisationId ?? "default-org";
      const authToken = session?.accessToken ?? "";
      const senderName =
        session?.user
          ? `${session.user.firstName} ${session.user.lastName}`.trim() || session.user.email
          : "You";

      const userMsg: ChatMessage = {
        id: `msg-opt-${Date.now()}`,
        channelId: activeChannel.id,
        senderId: userId,
        senderName,
        content: text,
        createdAt: new Date().toISOString(),
        reactions: [],
      };
      setMessages((prev) => [...prev, userMsg]);

      // Persist via API
      try {
        await api.sendMessage(activeChannel.id, text);
      } catch {
        /* best-effort */
      }

      // Always check for @BizContext mention OR question mark for AI context
      const mentionsAI = text.toLowerCase().includes("@bizcontext");
      const looksLikeQuestion = text.trim().endsWith("?") || mentionsAI;

      if (looksLikeQuestion) {
        const prompt = text.replace(/@bizcontext/gi, "").trim() || text;
        const history = messages
          .slice(-10)
          .map((m) => ({
            role: (m.isAi ? "assistant" : "user") as "user" | "assistant",
            content: m.content,
          }));

        setIsAiStreaming(true);
        setStreamingText("");

        let fullReply = "";
        await streamAIReply(
          prompt,
          history,
          organisationId,
          userId,
          authToken,
          (chunk) => {
            fullReply += chunk;
            setStreamingText(fullReply);
          },
          () => {
            // Done streaming — commit the AI message
            const aiMsg: ChatMessage = {
              id: `msg-ai-${Date.now()}`,
              channelId: activeChannel.id,
              senderId: "ai-bot",
              senderName: "BizContext Copilot",
              isAi: true,
              content: fullReply || "I couldn't reach the AI engine right now.",
              createdAt: new Date().toISOString(),
              reactions: [],
            };
            setMessages((prev) => [...prev, aiMsg]);
            setIsAiStreaming(false);
            setStreamingText("");
          },
          async (errMsg) => {
            // Fallback: ask via standard API
            try {
              const ans = await api.askSecondBrain(prompt, history);
              const aiMsg: ChatMessage = {
                id: `msg-ai-${Date.now()}`,
                channelId: activeChannel.id,
                senderId: "ai-bot",
                senderName: "BizContext Copilot",
                isAi: true,
                content: ans.answer,
                createdAt: new Date().toISOString(),
                reactions: [],
              };
              setMessages((prev) => [...prev, aiMsg]);
            } catch {
              const errFallback: ChatMessage = {
                id: `msg-ai-err-${Date.now()}`,
                channelId: activeChannel.id,
                senderId: "ai-bot",
                senderName: "BizContext Copilot",
                isAi: true,
                content: `⚠️ Couldn't reach the AI engine: ${errMsg}`,
                createdAt: new Date().toISOString(),
                reactions: [],
              };
              setMessages((prev) => [...prev, errFallback]);
            }
            setIsAiStreaming(false);
            setStreamingText("");
          }
        );
      }

      setIsSending(false);
      inputRef.current?.focus();
    },
    [activeChannel, inputText, isSending, messages]
  );

  return (
    <div className="flex h-[calc(100vh-5.5rem)] sm:h-[calc(100vh-6.5rem)] rounded-3xl border border-[#BEBEBE]/40 bg-white shadow-sm overflow-hidden animate-scale-in">
      {/* Channels sidebar (full width on mobile when mobileTab === 'channels', w-64 on desktop) */}
      <div
        className={`${
          mobileTab === "channels" ? "flex" : "hidden"
        } md:flex w-full md:w-64 border-r border-[#EDEDED] bg-[#F8F9FA] p-3 sm:p-4 flex-col shrink-0`}
      >
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#EDEDED]">
          <div className="flex items-center space-x-2">
            <MessageSquare className="w-4 h-4 text-[#74D96F]" />
            <span className="font-bold text-sm text-[#262626]">Channels</span>
          </div>
          <button
            className="p-1 rounded-lg hover:bg-[#EDEDED] text-[#666666] hover:text-[#262626] transition cursor-pointer"
            title="New channel"
            aria-label="New channel"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1">
          {channels.map((ch, i) => {
            const isActive = activeChannel?.id === ch.id;
            return (
              <button
                key={ch.id}
                onClick={() => {
                  setActiveChannel(ch);
                  setMobileTab("chat");
                }}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-between animate-slide-in-left stagger-${Math.min(i + 1, 8)} ${
                  isActive
                    ? "bg-[#EDEDED] text-[#262626] border border-[#BEBEBE]/40 shadow-xs"
                    : "text-[#666666] hover:text-[#262626] hover:bg-[#EDEDED]/50"
                }`}
              >
                <div className="flex items-center space-x-2 truncate">
                  {ch.isPrivate ? (
                    <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <Hash className="w-3.5 h-3.5 text-[#666666] shrink-0" />
                  )}
                  <span className="truncate">{ch.name}</span>
                </div>
                {ch.unreadCount ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#74D96F] text-[#262626] font-bold animate-notif-pop">
                    {ch.unreadCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* AI hint */}
        <div className="p-3 rounded-2xl bg-[#EDEDED] border border-[#BEBEBE]/40 text-[11px] text-[#262626] space-y-1 mt-3">
          <div className="flex items-center space-x-1.5 font-bold text-[#1F541D]">
            <Sparkles className="w-3.5 h-3.5 text-[#74D96F]" />
            <span>AI Copilot Active</span>
          </div>
          <p className="text-[10px] text-[#666666] leading-tight">
            Tag <strong className="text-[#262626]">@BizContext</strong> or ask any question to tap into organisational memory.
          </p>
        </div>
      </div>

      {/* Main chat area (full width on mobile when mobileTab === 'chat', flex-1 on desktop) */}
      <div
        className={`${
          mobileTab === "chat" ? "flex" : "hidden"
        } md:flex flex-1 flex-col bg-white min-w-0`}
      >
        {/* Channel header */}
        {activeChannel && (
          <div className="h-14 px-3 sm:px-6 border-b border-[#EDEDED] flex items-center justify-between shrink-0 bg-white">
            <div className="flex items-center space-x-2 min-w-0">
              <button
                type="button"
                onClick={() => setMobileTab("channels")}
                className="md:hidden p-1.5 -ml-1 rounded-xl text-[#666666] hover:text-[#262626] hover:bg-[#EDEDED] transition flex items-center space-x-1 shrink-0 cursor-pointer"
                aria-label="Back to channels"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-xs font-bold">Channels</span>
              </button>
              {activeChannel.isPrivate ? (
                <Lock className="w-4 h-4 text-amber-500 shrink-0" />
              ) : (
                <Hash className="w-4 h-4 text-[#666666] shrink-0" />
              )}
              <span className="font-bold text-sm text-[#262626] truncate">{activeChannel.name}</span>
              <span className="text-xs text-[#666666] hidden sm:inline truncate">— {activeChannel.description}</span>
            </div>
            <div className="flex items-center space-x-1.5 text-xs text-[#666666] shrink-0 ml-2">
              <Users className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">{activeChannel.memberCount} members</span>
              <span className="xs:hidden">{activeChannel.memberCount}</span>
            </div>
          </div>
        )}

        {/* Messages stream */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4">
          {messages.map((m, idx) => (
            <div
              key={m.id}
              className={`flex items-start space-x-3 text-xs animate-slide-up stagger-${Math.min(idx + 1, 8)} ${
                m.isAi
                  ? "bg-[#74D96F]/10 p-4 rounded-2xl border border-[#74D96F]/30 shadow-xs"
                  : ""
              }`}
            >
              {m.isAi ? (
                <div className="w-8 h-8 rounded-xl bg-[#74D96F] flex items-center justify-center shrink-0 shadow-xs">
                  <Bot className="w-4 h-4 text-[#262626]" />
                </div>
              ) : (
                <div
                  aria-hidden
                  className="w-8 h-8 rounded-xl bg-[#EDEDED] text-[#262626] text-[11px] font-bold flex items-center justify-center shrink-0 border border-[#BEBEBE]/40"
                >
                  {m.senderName
                    .split(/\s+/)
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </div>
              )}

              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center space-x-2">
                  <span className={`font-bold ${m.isAi ? "text-[#1F541D]" : "text-[#262626]"}`}>
                    {m.senderName}
                  </span>
                  {m.isAi && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#74D96F]/20 text-[#1F541D] font-bold border border-[#74D96F]/40">
                      AI
                    </span>
                  )}
                  <span className="text-[10px] text-[#666666]">
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div className="text-[#262626] leading-relaxed whitespace-pre-wrap">{m.content}</div>
                {m.reactions && m.reactions.length > 0 && (
                  <div className="flex items-center space-x-1.5 pt-1">
                    {m.reactions.map((r, ri) => (
                      <span
                        key={ri}
                        className="inline-flex items-center space-x-1 text-[10px] px-2 py-0.5 rounded-full bg-[#EDEDED] border border-[#BEBEBE]/40 text-[#262626] font-medium"
                      >
                        <span>{r.emoji}</span>
                        <span>{r.count}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Live streaming AI response */}
          {isAiStreaming && (
            <div className="flex items-start space-x-3 text-xs bg-[#74D96F]/10 p-4 rounded-2xl border border-[#74D96F]/30 shadow-xs animate-slide-up">
              <div className="w-8 h-8 rounded-xl bg-[#74D96F] flex items-center justify-center shrink-0 shadow-xs">
                <Bot className="w-4 h-4 text-[#262626]" />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-[#1F541D]">BizContext Copilot</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#74D96F]/20 text-[#1F541D] font-bold border border-[#74D96F]/40">AI</span>
                </div>
                {streamingText ? (
                  <div className="text-[#262626] leading-relaxed whitespace-pre-wrap">
                    {streamingText}
                    <span className="inline-block w-0.5 h-3.5 bg-[#56BE51] ml-0.5 animate-pulse" />
                  </div>
                ) : (
                  <TypingIndicator />
                )}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <form onSubmit={handleSendMessage} className="p-3 sm:p-4 border-t border-[#EDEDED] bg-white">
          <div className="flex items-center space-x-2 rounded-2xl border border-[#BEBEBE]/60 bg-[#F8F9FA] px-4 py-2.5 focus-within:border-[#74D96F] focus-within:bg-white transition">
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                activeChannel
                  ? `Message #${activeChannel.name} · @BizContext to ask AI`
                  : "Select a channel…"
              }
              disabled={!activeChannel || isSending || isAiStreaming}
              className="flex-1 text-xs text-[#262626] bg-transparent placeholder:text-[#9E9E9E] focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || !activeChannel || isSending || isAiStreaming}
              className="p-1.5 rounded-xl bg-[#74D96F] hover:bg-[#62CE5C] text-[#262626] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              aria-label="Send message"
            >
              {isSending || isAiStreaming ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <p className="text-[10px] text-[#9E9E9E] mt-1.5 px-1">
            Press <kbd className="font-mono text-[9px] px-1 py-0.5 rounded bg-[#EDEDED] border border-[#BEBEBE]">Enter</kbd> to send · @BizContext triggers the AI engine
          </p>
        </form>
      </div>
    </div>
  );
}
