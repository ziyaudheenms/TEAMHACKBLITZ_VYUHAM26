export type ChatMode = "assistant" | "council";
export type AgentKey = "knowledge" | "researcher" | "browser" | "ceo";
export type AgentStatus = "waiting" | "running" | "done" | "error";

export interface Source {
  title: string;
  type: string;
  url?: string;
  snippet?: string;
}

export interface CouncilAgentState {
  id: AgentKey;
  name: string;
  title: string;
  status: AgentStatus;
  text: string;
  tools: string[];
  toolCalls: number;
  error?: string;
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  mode?: ChatMode;
  status?: "streaming" | "done" | "error" | "stopped";
  error?: string;
  sources?: Source[];
  council?: CouncilAgentState[];
}

export interface Conversation {
  id: string;
  title: string;
  mode: ChatMode;
  updatedAt: string;
  messages: ChatTurn[];
}

export const COUNCIL_DEFAULTS: Array<Pick<CouncilAgentState, "id" | "name" | "title">> = [
  { id: "knowledge", name: "Knowledge Agent", title: "Internal knowledge" },
  { id: "researcher", name: "Research Agent", title: "External research" },
  { id: "browser", name: "Browser Agent", title: "Live page scraping" },
  { id: "ceo", name: "CEO Agent", title: "Decision" },
];

export function initialCouncil(): CouncilAgentState[] {
  return COUNCIL_DEFAULTS.map((a) => ({ ...a, status: "waiting", text: "", tools: [], toolCalls: 0 }));
}
