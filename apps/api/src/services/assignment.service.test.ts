import { describe, it, expect } from "bun:test";

describe("Workload-Aware Assignment Scoring Formula", () => {
  const W_SIMILAR_WORK = 0.45;
  const W_RELIABILITY = 0.25;
  const W_SKILLS = 0.15;
  const W_CAPACITY = 0.15;

  const NORMAL_TASK_LIMIT = 8;
  const TOP_PERFORMER_THRESHOLD = 0.75; // 75%

  function computeCompositeScore(
    similarWorkScore: number,
    onTimeRate: number,
    verifiedSkillsScore: number,
    capacityScore: number
  ) {
    return (
      W_SIMILAR_WORK * similarWorkScore +
      W_RELIABILITY * onTimeRate +
      W_SKILLS * verifiedSkillsScore +
      W_CAPACITY * capacityScore
    );
  }

  function computeCapacityScore(activeTaskCount: number, isTopPerformer: boolean) {
    const effectiveLimit = isTopPerformer
      ? NORMAL_TASK_LIMIT * TOP_PERFORMER_THRESHOLD
      : NORMAL_TASK_LIMIT;
    const rawCapacity = Math.max(0, 1 - activeTaskCount / effectiveLimit);
    const overloadWarning = isTopPerformer && activeTaskCount >= effectiveLimit;
    return { capacityScore: rawCapacity, overloadWarning, effectiveLimit };
  }

  it("calculates exact weights matching spec: 45% similar work, 25% reliability, 15% skills, 15% capacity", () => {
    expect(W_SIMILAR_WORK + W_RELIABILITY + W_SKILLS + W_CAPACITY).toBeCloseTo(1.0, 5);

    // Candidate with 100% on everything
    const perfectScore = computeCompositeScore(1.0, 1.0, 1.0, 1.0);
    expect(perfectScore).toBeCloseTo(1.0, 5);

    // Candidate with only similar work (100%), rest 0
    const similarOnly = computeCompositeScore(1.0, 0, 0, 0);
    expect(similarOnly).toBeCloseTo(0.45, 5);

    // Candidate with only reliability (100%), rest 0
    const reliabilityOnly = computeCompositeScore(0, 1.0, 0, 0);
    expect(reliabilityOnly).toBeCloseTo(0.25, 5);

    // Candidate with only verified skills (100%), rest 0
    const skillsOnly = computeCompositeScore(0, 0, 1.0, 0);
    expect(skillsOnly).toBeCloseTo(0.15, 5);

    // Candidate with only capacity (100%), rest 0
    const capacityOnly = computeCompositeScore(0, 0, 0, 1.0);
    expect(capacityOnly).toBeCloseTo(0.15, 5);
  });

  it("reserves 25% capacity for top performers (effective limit: 6 tasks vs standard 8 tasks)", () => {
    // Normal performer with 6 active tasks
    const normal = computeCapacityScore(6, false);
    expect(normal.effectiveLimit).toBe(8);
    expect(normal.overloadWarning).toBe(false);
    expect(normal.capacityScore).toBeCloseTo(1 - 6 / 8, 3); // 0.25

    // Top performer with 6 active tasks (at 75% buffer limit = 6 tasks)
    const topPerformer = computeCapacityScore(6, true);
    expect(topPerformer.effectiveLimit).toBe(6);
    expect(topPerformer.overloadWarning).toBe(true);
    expect(topPerformer.capacityScore).toBe(0); // at protected capacity
  });

  it("breaks ties with available capacity", () => {
    // Candidate A and Candidate B have identical composite score
    const candidateA = {
      name: "Alice",
      composite: 0.72,
      capacityScore: 0.8,
    };
    const candidateB = {
      name: "Bob",
      composite: 0.72,
      capacityScore: 0.5,
    };

    const candidates = [candidateB, candidateA];
    candidates.sort((a, b) => {
      const diff = b.composite - a.composite;
      if (Math.abs(diff) > 0.001) return diff;
      return b.capacityScore - a.capacityScore;
    });

    expect(candidates[0].name).toBe("Alice"); // Alice wins tie-break due to higher capacity
  });

  it("applies confidence levels based on historical data richness", () => {
    function getConfidence(historyCount: number, composite: number) {
      if (historyCount >= 5 && composite >= 0.6) return "high";
      if (historyCount >= 2 || composite >= 0.4) return "medium";
      return "low";
    }

    expect(getConfidence(10, 0.85)).toBe("high");
    expect(getConfidence(3, 0.55)).toBe("medium");
    expect(getConfidence(0, 0.35)).toBe("low");
  });
});
