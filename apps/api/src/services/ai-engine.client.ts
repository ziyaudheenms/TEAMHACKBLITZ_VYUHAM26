export interface AIChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIRunPayload {
  prompt: string;
  userId: string;
  organisationId: string;
  conversationId?: string;
  agentRole?: string;
  allowedTools?: string[];
  chatHistory?: AIChatMessage[];
  metadata?: Record<string, unknown>;
  systemPrompt?: string;
  authToken?: string;
}

export interface AICitation {
  source_id: string;
  title: string;
  source_type: string;
  url?: string;
  snippet?: string;
}

export interface AIToolCall {
  tool_name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status: string;
}

export interface AIRunResponse {
  response: string;
  citations: AICitation[];
  tool_calls: AIToolCall[];
  conversation_id: string;
  agent_id?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    requests: number;
  };
  created_at: string;
}

export class AIEngineClient {
  private baseUrl: string;

  constructor() {
    // AI_ENGINE_URL is injected by Vercel via the service binding on the "api"
    // service. In local dev it falls back to the port set in apps/api/.env.
    this.baseUrl = process.env.AI_ENGINE_URL || "http://localhost:8000";
  }

  async runAgent(payload: AIRunPayload): Promise<AIRunResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (payload.authToken) {
      headers["Authorization"] = `Bearer ${payload.authToken}`;
    }

    // Propagate multi-tenancy headers for downstream enforcement
    headers["X-Organisation-Id"] = payload.organisationId;
    headers["X-User-Id"] = payload.userId;
    headers["X-Client-Source"] = "bizcontext-backend";

    const res = await fetch(`${this.baseUrl}/api/v1/agent/run`, {
      method: "POST",
      headers,
      // Never let a hung engine hold a request (or a background reply) open forever.
      signal: AbortSignal.timeout(Number(process.env.AI_ENGINE_TIMEOUT_MS) || 90_000),
      body: JSON.stringify({
        prompt: payload.prompt,
        user_id: payload.userId,
        organisation_id: payload.organisationId,
        conversation_id: payload.conversationId,
        agent_role: payload.agentRole || "general_assistant",
        allowed_tools: payload.allowedTools,
        chat_history: payload.chatHistory,
        system_prompt: payload.systemPrompt,
        metadata: payload.metadata,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`AI Engine error (${res.status}): ${errorText}`);
    }

    return (await res.json()) as AIRunResponse;
  }

  /** Agent Council: Knowledge | Researcher | Browser in parallel, then the CEO decision (SSE). */
  async streamCouncil(payload: AIRunPayload): Promise<ReadableStream<Uint8Array>> {
    return this.openStream("/api/v1/agent/council/stream", payload);
  }

  async streamAgent(payload: AIRunPayload): Promise<ReadableStream<Uint8Array>> {
    return this.openStream("/api/v1/agent/stream", payload);
  }

  private async openStream(path: string, payload: AIRunPayload): Promise<ReadableStream<Uint8Array>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (payload.authToken) {
      headers["Authorization"] = `Bearer ${payload.authToken}`;
    }

    // Propagate multi-tenancy headers for downstream enforcement
    headers["X-Organisation-Id"] = payload.organisationId;
    headers["X-User-Id"] = payload.userId;
    headers["X-Client-Source"] = "bizcontext-backend";

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: payload.prompt,
        user_id: payload.userId,
        organisation_id: payload.organisationId,
        conversation_id: payload.conversationId,
        agent_role: payload.agentRole || "general_assistant",
        allowed_tools: payload.allowedTools,
        chat_history: payload.chatHistory,
        system_prompt: payload.systemPrompt,
        metadata: payload.metadata,
      }),
    });

    if (!res.ok || !res.body) {
      const errorText = await res.text();
      throw new Error(`AI Engine stream error (${res.status}): ${errorText}`);
    }

    return res.body;
  }

  async respondFromOrb(payload: Pick<AIRunPayload, "prompt" | "userId" | "organisationId" | "conversationId" | "authToken">): Promise<AIRunResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/orb/respond`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(payload.authToken ? { Authorization: `Bearer ${payload.authToken}` } : {}),
      },
      body: JSON.stringify({
        prompt: payload.prompt,
        user_id: payload.userId,
        organisation_id: payload.organisationId,
        conversation_id: payload.conversationId,
      }),
    });
    if (!res.ok) throw new Error(`AI Engine error (${res.status}): ${await res.text()}`);
    return (await res.json()) as AIRunResponse;
  }
}

export const aiEngineClient = new AIEngineClient();
