import { describe, expect, it } from "bun:test";
import {
  parseMinutesContentHeuristic,
  buildMeetingAnalysisPrompt,
} from "./index";

describe("Meeting Notes Domain Module", () => {
  it("extracts action items and executive summary from minutes content", () => {
    const minutes = `Adhwaithas opened the session detailing the upcoming Hackathon evaluation criteria.
Priya presented the hybrid search benchmarks: dense retrieval via pgvector with HNSW is returning under 120ms.
Marcus to deploy iptables domain filtering rulebook to staging worker node immediately.
Dev will provide interactive API connection fallback state in Next.js web client.
Elena to integrate B3/B4 human approval drawer into Browser Jobs interface.`;

    const attendees = [
      "Adhwaithas S.",
      "Priya Sharma",
      "Marcus Vance",
      "Elena Rostova",
      "Dev Patel",
    ];

    const result = parseMinutesContentHeuristic(minutes, attendees);

    expect(result.aiSummary).toBeDefined();
    expect(result.aiSummary.length).toBeGreaterThan(10);
    expect(result.actionItems.length).toBeGreaterThanOrEqual(3);

    // Verify parsed action item fields
    const marcusAction = result.actionItems.find((a) => a.assignee.includes("Marcus"));
    expect(marcusAction).toBeDefined();
    expect(marcusAction?.priority).toBe("urgent");

    const elenaAction = result.actionItems.find((a) => a.assignee.includes("Elena"));
    expect(elenaAction).toBeDefined();
    expect(elenaAction?.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("handles empty minutes gracefully", () => {
    const result = parseMinutesContentHeuristic("");
    expect(result.actionItems).toEqual([]);
    expect(result.aiSummary).toContain("No meeting notes");
  });

  it("builds structured prompt for LLM meeting extraction", () => {
    const prompt = buildMeetingAnalysisPrompt(
      "Sprint Sync",
      "Discussed deployment blockers.",
      ["Alice", "Bob"]
    );
    expect(prompt).toContain("BizContext AI Meeting Secretary");
    expect(prompt).toContain("Sprint Sync");
    expect(prompt).toContain("Alice, Bob");
  });
});
