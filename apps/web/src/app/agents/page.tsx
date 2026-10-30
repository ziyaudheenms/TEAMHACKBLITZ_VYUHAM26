"use client";

import React, { useState } from "react";
import { Bot, MessageSquare } from "lucide-react";
import AgentChat from "../../components/agents/AgentChat";
import AgentRegistry from "../../components/agents/AgentRegistry";

type Tab = "chat" | "registry";

const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "registry", label: "Agent registry", icon: Bot },
];

export default function AgentsPage() {
  const [tab, setTab] = useState<Tab>("chat");

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Agents" className="flex w-fit gap-1 rounded-full bg-[#EDEDED] p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition ${
              tab === id ? "bg-white text-[#262626] shadow-xs" : "text-[#666666] hover:text-[#262626]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Chat stays mounted so switching tabs never drops an in-flight answer. */}
      <div role="tabpanel" hidden={tab !== "chat"}>
        <AgentChat />
      </div>
      {tab === "registry" && (
        <div role="tabpanel">
          <AgentRegistry />
        </div>
      )}
    </div>
  );
}
