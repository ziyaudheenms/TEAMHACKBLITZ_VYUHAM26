import { Hono } from "hono";
import { z } from "zod";
import { aiEngineClient } from "../services/ai-engine.client";

export const searchRoutes = new Hono();

// ─── Types ───────────────────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  url: string;
  matchScore?: number;
  createdAt?: string;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const mockEmployees: SearchResult[] = [
  {
    id: "emp-1",
    type: "employee",
    title: "Priya Sharma",
    subtitle: "AI Research Lead",
    url: "/directory",
    matchScore: 0.95,
    createdAt: "2026-10-01T10:00:00Z",
  },
  {
    id: "emp-2",
    type: "employee",
    title: "Elena Rostova",
    subtitle: "Senior Backend Engineer",
    url: "/directory",
    matchScore: 0.92,
    createdAt: "2026-10-02T09:30:00Z",
  },
  {
    id: "emp-3",
    type: "employee",
    title: "Marcus Vance",
    subtitle: "DevOps & Infrastructure Lead",
    url: "/directory",
    matchScore: 0.88,
    createdAt: "2026-10-03T08:00:00Z",
  },
  {
    id: "emp-4",
    type: "employee",
    title: "Adhwaithas Sundar",
    subtitle: "Full-Stack Engineer",
    url: "/directory",
    matchScore: 0.85,
    createdAt: "2026-10-04T11:00:00Z",
  },
  {
    id: "emp-5",
    type: "employee",
    title: "Layla Hassan",
    subtitle: "Product Manager",
    url: "/directory",
    matchScore: 0.82,
    createdAt: "2026-10-05T10:00:00Z",
  },
];

const mockKnowledge: SearchResult[] = [
  {
    id: "page-1",
    type: "knowledge",
    title: "Browser Agent Security Guidelines",
    subtitle: "Security Policy – B0 to B4 permission levels explained",
    url: "/knowledge",
    matchScore: 0.97,
    createdAt: "2026-09-15T08:00:00Z",
  },
  {
    id: "page-2",
    type: "knowledge",
    title: "pgvector & BM25 Hybrid Search Architecture",
    subtitle: "Technical deep-dive into the AI engine retrieval pipeline",
    url: "/knowledge",
    matchScore: 0.93,
    createdAt: "2026-09-20T09:00:00Z",
  },
  {
    id: "page-3",
    type: "knowledge",
    title: "Employee Onboarding Handbook",
    subtitle: "Step-by-step guide for new hires",
    url: "/knowledge",
    matchScore: 0.89,
    createdAt: "2026-09-10T10:00:00Z",
  },
  {
    id: "page-4",
    type: "knowledge",
    title: "API Rate Limiting & Throttling Policy",
    subtitle: "Internal engineering policy for API consumers",
    url: "/knowledge",
    matchScore: 0.84,
    createdAt: "2026-09-25T11:00:00Z",
  },
  {
    id: "page-5",
    type: "knowledge",
    title: "Data Retention & Privacy Standards",
    subtitle: "Compliance documentation for GDPR and SOC 2",
    url: "/knowledge",
    matchScore: 0.80,
    createdAt: "2026-09-28T12:00:00Z",
  },
];

const mockMeetings: SearchResult[] = [
  {
    id: "meet-1",
    type: "meeting",
    title: "AI Engine Architecture Review",
    subtitle: "2026-10-15 · 60 min · Priya Sharma, Marcus Vance",
    url: "/meetings",
    matchScore: 0.91,
    createdAt: "2026-10-15T14:00:00Z",
  },
  {
    id: "meet-2",
    type: "meeting",
    title: "Q4 OKR Planning Session",
    subtitle: "2026-10-20 · 90 min · Leadership Team",
    url: "/meetings",
    matchScore: 0.87,
    createdAt: "2026-10-20T10:00:00Z",
  },
  {
    id: "meet-3",
    type: "meeting",
    title: "Browser Automation Security Sync",
    subtitle: "2026-10-22 · 45 min · Marcus Vance, Elena Rostova",
    url: "/meetings",
    matchScore: 0.83,
    createdAt: "2026-10-22T15:00:00Z",
  },
  {
    id: "meet-4",
    type: "meeting",
    title: "Frontend Sprint Retrospective",
    subtitle: "2026-10-25 · 60 min · Engineering Team",
    url: "/meetings",
    matchScore: 0.79,
    createdAt: "2026-10-25T11:00:00Z",
  },
  {
    id: "meet-5",
    type: "meeting",
    title: "Investor Demo Dry Run",
    subtitle: "2026-10-28 · 30 min · All Hands",
    url: "/meetings",
    matchScore: 0.76,
    createdAt: "2026-10-28T09:00:00Z",
  },
];

const mockTickets: SearchResult[] = [
  {
    id: "tick-1",
    type: "ticket",
    title: "CI/CD pipeline fails on Bun 1.1.x upgrade",
    subtitle: "TICK-1045 · open",
    url: "/tickets",
    matchScore: 0.90,
    createdAt: "2026-10-18T13:00:00Z",
  },
  {
    id: "tick-2",
    type: "ticket",
    title: "Supabase RLS policy blocking knowledge page reads",
    subtitle: "TICK-1046 · in_progress",
    url: "/tickets",
    matchScore: 0.86,
    createdAt: "2026-10-19T14:00:00Z",
  },
  {
    id: "tick-3",
    type: "ticket",
    title: "Request access to internal analytics dashboard",
    subtitle: "TICK-1047 · open",
    url: "/tickets",
    matchScore: 0.81,
    createdAt: "2026-10-20T09:00:00Z",
  },
  {
    id: "tick-4",
    type: "ticket",
    title: "Employee CSV import breaks on special characters",
    subtitle: "TICK-1048 · resolved",
    url: "/tickets",
    matchScore: 0.77,
    createdAt: "2026-10-21T10:00:00Z",
  },
  {
    id: "tick-5",
    type: "ticket",
    title: "Increase pgvector index size limit for knowledge base",
    subtitle: "TICK-1049 · acknowledged",
    url: "/tickets",
    matchScore: 0.74,
    createdAt: "2026-10-22T11:00:00Z",
  },
];

const mockProjects: SearchResult[] = [
  {
    id: "proj-1",
    type: "project",
    title: "BizContext Web Core V1",
    subtitle: "AI Engineering & Research · active",
    url: "/projects",
    matchScore: 0.94,
    createdAt: "2026-09-01T00:00:00Z",
  },
  {
    id: "proj-2",
    type: "project",
    title: "AI Engine v2 – HyDE & pgvector Upgrade",
    subtitle: "AI Research · active",
    url: "/projects",
    matchScore: 0.90,
    createdAt: "2026-09-10T00:00:00Z",
  },
  {
    id: "proj-3",
    type: "project",
    title: "Browser Automation Sandbox",
    subtitle: "Infrastructure · planning",
    url: "/projects",
    matchScore: 0.85,
    createdAt: "2026-09-15T00:00:00Z",
  },
  {
    id: "proj-4",
    type: "project",
    title: "Employee Self-Service Portal",
    subtitle: "HR · active",
    url: "/projects",
    matchScore: 0.80,
    createdAt: "2026-09-20T00:00:00Z",
  },
  {
    id: "proj-5",
    type: "project",
    title: "Compliance & Audit Trail System",
    subtitle: "Legal & Security · completed",
    url: "/projects",
    matchScore: 0.75,
    createdAt: "2026-09-25T00:00:00Z",
  },
];

const mockFiles: SearchResult[] = [
  {
    id: "file-1",
    type: "file",
    title: "bizcontext_architecture_overview.pdf",
    subtitle: "application/pdf",
    url: "/storage",
    matchScore: 0.88,
    createdAt: "2026-10-05T10:00:00Z",
  },
  {
    id: "file-2",
    type: "file",
    title: "priya_sharma_cv.pdf",
    subtitle: "application/pdf",
    url: "/storage",
    matchScore: 0.84,
    createdAt: "2026-10-06T11:00:00Z",
  },
  {
    id: "file-3",
    type: "file",
    title: "Q4_okr_planning_deck.pptx",
    subtitle: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    url: "/storage",
    matchScore: 0.79,
    createdAt: "2026-10-07T09:00:00Z",
  },
  {
    id: "file-4",
    type: "file",
    title: "security_policy_v3.docx",
    subtitle: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    url: "/storage",
    matchScore: 0.75,
    createdAt: "2026-10-08T14:00:00Z",
  },
  {
    id: "file-5",
    type: "file",
    title: "employee_onboarding_checklist.xlsx",
    subtitle: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    url: "/storage",
    matchScore: 0.70,
    createdAt: "2026-10-09T12:00:00Z",
  },
];

// All mock data grouped by type
const ALL_MOCK: Record<string, SearchResult[]> = {
  employees: mockEmployees,
  knowledge: mockKnowledge,
  meetings: mockMeetings,
  tickets: mockTickets,
  projects: mockProjects,
  files: mockFiles,
};

const VALID_SCOPES = ["all", "employees", "knowledge", "projects", "tickets", "meetings", "files"] as const;

// ─── Validation Schemas ───────────────────────────────────────────────────────

const askSchema = z.object({
  query: z.string().min(1, "query must not be empty"),
});

const searchQuerySchema = z.object({
  q: z.string().min(1, "q must not be empty"),
  scope: z.enum(VALID_SCOPES).optional().default("all"),
});

// ─── POST /search/ask-second-brain ───────────────────────────────────────────

searchRoutes.post("/ask-second-brain", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = askSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid payload", details: parsed.error.issues }, 400);
  }

  const { query } = parsed.data;

  // Extract auth & multi-tenancy context from request headers
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  const organisationId = c.req.header("X-Organisation-Id") || "default-org";
  const userId = c.req.header("X-User-Id") || "anonymous-user";

  try {
    const result = await aiEngineClient.runAgent({
      prompt: query,
      userId,
      organisationId,
      agentRole: "knowledge_search",
      authToken: token,
    });

    const sources = (result.citations ?? []).map((c) => ({
      title: c.title,
      category: c.source_type,
      matchConfidence: undefined as number | undefined,
      link: c.url,
      snippet: c.snippet,
    }));

    return c.json({
      answer: result.response,
      sources,
      suggestedActions: [],
    });
  } catch (error: any) {
    console.error("[Search /ask-second-brain] AI engine unavailable:", error?.message);

    // Fallback mock response
    return c.json({
      answer:
        "Based on organisational knowledge, BizContext enforces a four-tier browser permission model (B0–B4). B3 and B4 actions require explicit human-in-the-loop supervisor approval before execution. Policies are documented in the Browser Agent Security Guidelines page.",
      sources: [
        {
          title: "Browser Agent Security Guidelines",
          category: "Security Policy",
          matchConfidence: 96.4,
          link: "/knowledge",
          snippet:
            "B3 actions require supervisor sign-off. The approval queue is monitored by the DevOps & Infrastructure Lead.",
        },
        {
          title: "Employee Onboarding Handbook",
          category: "HR Policy",
          matchConfidence: 72.1,
          link: "/knowledge",
          snippet: "New hires are granted B0 browser permissions by default during their probation period.",
        },
      ],
      suggestedActions: [
        {
          label: "View Browser Approval Queue",
          actionType: "navigate",
          payload: "/browser-jobs",
        },
        {
          label: "Open Security Policy",
          actionType: "navigate",
          payload: "/knowledge",
        },
      ],
    });
  }
});

// ─── GET /search ──────────────────────────────────────────────────────────────

searchRoutes.get("/", async (c) => {
  const rawQuery = { q: c.req.query("q"), scope: c.req.query("scope") };
  const parsed = searchQuerySchema.safeParse(rawQuery);

  if (!parsed.success) {
    return c.json({ error: "Invalid query parameters", details: parsed.error.issues }, 400);
  }

  const { q, scope } = parsed.data;
  const lq = q.toLowerCase();

  const scoredMatch = (item: SearchResult): boolean => {
    const hay = `${item.title} ${item.subtitle ?? ""}`.toLowerCase();
    return hay.includes(lq);
  };

  let results: SearchResult[] = [];

  if (scope === "all") {
    for (const group of Object.values(ALL_MOCK)) {
      results.push(...group.filter(scoredMatch));
    }
  } else {
    results = (ALL_MOCK[scope] ?? []).filter(scoredMatch);
  }

  return c.json({
    results,
    totalCount: results.length,
    query: q,
    scope,
  });
});

export default searchRoutes;
