/**
 * Module: Meetings & Minutes Hub
 * Meeting records, minute uploads, OCR, AI summary, and action item extraction.
 */

export const MODULE_NAME = "meetings";

export interface MeetingsModuleConfig {
  enabled: boolean;
}

export type MeetingPriority = "low" | "medium" | "high" | "urgent";

export interface ExtractedActionItemResult {
  id?: string;
  title: string;
  assignee: string;
  dueDate: string;
  priority: MeetingPriority;
  convertedToTask?: boolean;
}

export interface MeetingAnalysisResult {
  aiSummary: string;
  actionItems: ExtractedActionItemResult[];
}

/**
 * Intelligent heuristic fallback parser that extracts action items and executive summary
 * from raw meeting transcripts, OCR text, or notes.
 */
export function parseMinutesContentHeuristic(
  content: string,
  attendees: string[] = []
): MeetingAnalysisResult {
  if (!content || !content.trim()) {
    return {
      aiSummary: "No meeting notes or transcript content provided for analysis.",
      actionItems: [],
    };
  }

  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const actionItems: ExtractedActionItemResult[] = [];
  const keyPoints: string[] = [];

  const defaultAssignee = attendees.length > 0 ? attendees[0] : "Assigned Lead";

  // Action indicators
  const actionRegex =
    /(?:^|\s)(?:TODO|Action\s*(?:Item)?|Task|Follow-up|Assigned\s*to|Actionable)[\s:-]+(.+)/i;
  const nameActionRegex =
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:to|will|shall|should|needs\s+to|agreed\s+to)\s+(.+)/i;
  const bulletActionRegex = /^[-*•]\s*(.+)/;

  const priorityKeywords: Record<MeetingPriority, string[]> = {
    urgent: ["urgent", "immediately", "asap", "critical", "blocker", "high-risk"],
    high: ["high", "priority", "important", "target", "milestone", "security"],
    medium: ["medium", "standard", "review", "update", "coordinate", "validate"],
    low: ["low", "backlog", "future", "optional", "nice to have"],
  };

  const getPriorityFromText = (text: string): MeetingPriority => {
    const lower = text.toLowerCase();
    for (const [prio, words] of Object.entries(priorityKeywords)) {
      if (words.some((w) => lower.includes(w))) {
        return prio as MeetingPriority;
      }
    }
    return "medium";
  };

  const extractAssigneeFromText = (text: string): string => {
    // Check if any known attendee is mentioned in the text
    for (const att of attendees) {
      if (text.toLowerCase().includes(att.toLowerCase())) {
        return att;
      }
    }
    // Match patterns like "Assignee: John" or "assigned to John"
    const match = text.match(/(?:assignee|assigned to|owner)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    if (match?.[1]) {
      return match[1].trim();
    }
    return defaultAssignee;
  };

  const formatDueDate = (daysOffset: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    return d.toISOString().slice(0, 10);
  };

  let actionCounter = 1;

  for (const line of lines) {
    let matchedTitle: string | null = null;
    let matchedAssignee: string | null = null;

    const directActionMatch = line.match(actionRegex);
    const nameActionMatch = line.match(nameActionRegex);
    const bulletMatch = line.match(bulletActionRegex);

    if (directActionMatch) {
      matchedTitle = directActionMatch[1].trim();
      matchedAssignee = extractAssigneeFromText(line);
    } else if (nameActionMatch) {
      const candidateName = nameActionMatch[1].trim();
      // Check if candidate name is an attendee or matches title-case name
      matchedAssignee =
        attendees.find((a) => a.toLowerCase().includes(candidateName.toLowerCase())) ||
        candidateName;
      matchedTitle = nameActionMatch[2].trim();
    } else if (
      bulletMatch &&
      (line.toLowerCase().includes("will") ||
        line.toLowerCase().includes("to ") ||
        line.toLowerCase().includes("deploy") ||
        line.toLowerCase().includes("integrate") ||
        line.toLowerCase().includes("coordinate") ||
        line.toLowerCase().includes("validate") ||
        line.toLowerCase().includes("benchmark") ||
        line.toLowerCase().includes("build") ||
        line.toLowerCase().includes("review"))
    ) {
      matchedTitle = bulletMatch[1].trim();
      matchedAssignee = extractAssigneeFromText(line);
    }

    if (matchedTitle && matchedTitle.length >= 8) {
      // Capitalize first character
      const cleanTitle = matchedTitle.charAt(0).toUpperCase() + matchedTitle.slice(1);
      const prio = getPriorityFromText(line);
      const daysOffset = prio === "urgent" ? 2 : prio === "high" ? 4 : 7;

      actionItems.push({
        id: `act-${Date.now()}-${actionCounter++}`,
        title: cleanTitle.replace(/^[-*•\s]+/, ""),
        assignee: matchedAssignee || defaultAssignee,
        dueDate: formatDueDate(daysOffset),
        priority: prio,
        convertedToTask: false,
      });
    } else {
      keyPoints.push(line);
    }
  }

  // If no explicit actions matched but text exists, synthesize action items from key sentences
  if (actionItems.length === 0 && lines.length > 0) {
    const sentenceCandidates = lines
      .flatMap((l) => l.split(/(?<=[.?!])\s+/))
      .filter((s) => s.length > 20);

    sentenceCandidates.slice(0, 3).forEach((sentence, idx) => {
      const assignee = attendees[idx % attendees.length] || defaultAssignee;
      const prio: MeetingPriority = idx === 0 ? "high" : "medium";
      actionItems.push({
        id: `act-${Date.now()}-${idx + 1}`,
        title: `Execute follow-up: ${sentence.replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 120)}`,
        assignee,
        dueDate: formatDueDate(3 + idx * 2),
        priority: prio,
        convertedToTask: false,
      });
    });
  }

  // Generate executive summary
  const summaryPrefix = "The discussion focused on key architectural decisions and deliverables.";
  const topPoints = keyPoints.slice(0, 3).join(" ");
  const aiSummary = topPoints
    ? `${summaryPrefix} Key highlights: ${topPoints.slice(0, 320)}${topPoints.length > 320 ? "..." : ""}`
    : `${summaryPrefix} Extracted ${actionItems.length} actionable assignments with targeted delivery dates.`;

  return {
    aiSummary,
    actionItems,
  };
}

/**
 * Builds the AI prompt for LLM-based action item extraction.
 */
export function buildMeetingAnalysisPrompt(
  title: string,
  minutesContent: string,
  attendees: string[] = []
): string {
  return `You are BizContext AI Meeting Secretary.
Analyze the following meeting minutes/transcript and extract:
1. A concise, professional executive summary (2-3 sentences max).
2. All actionable follow-up items with assignee names, estimated due dates (format: YYYY-MM-DD), and priority ("low" | "medium" | "high" | "urgent").

Meeting Title: "${title}"
Attendees: ${attendees.length > 0 ? attendees.join(", ") : "Not specified"}

Transcript / Meeting Notes:
"""
${minutesContent}
"""

Return your response in STRICT JSON format with this exact schema:
{
  "aiSummary": "Executive summary text here...",
  "actionItems": [
    {
      "title": "Clear actionable task title",
      "assignee": "Full Name",
      "dueDate": "YYYY-MM-DD",
      "priority": "urgent" | "high" | "medium" | "low"
    }
  ]
}
Do not include markdown fences outside the JSON.`;
}
