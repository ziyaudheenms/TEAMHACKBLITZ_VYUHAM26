import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "../lib/supabase";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface CandidateScore {
  employeeId: string;
  name: string;
  designation: string | null;
  /** 0-1 — proportion of similar (same skill-tag) tasks completed */
  similarWorkScore: number;
  /** 0-1 — on-time delivery rate from stored metrics */
  onTimeRate: number;
  /** 0-1 — ratio of verified skills matching required skills */
  verifiedSkillsScore: number;
  /** 0-1 — inverse workload (1=free, 0=at capacity) */
  capacityScore: number;
  /** Weighted composite: 0.45·S + 0.25·R + 0.15·V + 0.15·C */
  composite: number;
  /** Flag: this employee is at the 75% top-performer capacity buffer */
  overloadWarning: boolean;
  /** Qualitative explanation sentence */
  explanation: string;
}

export interface AssignmentRecommendation {
  taskId: string;
  recommended: CandidateScore | null;
  alternatives: CandidateScore[];
  confidence: "high" | "medium" | "low";
  /** Set when no employee is eligible */
  noMatchReason?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants (spec §"Recommendation model")
// ──────────────────────────────────────────────────────────────────────────────

const W_SIMILAR_WORK = 0.45;
const W_RELIABILITY = 0.25;
const W_SKILLS = 0.15;
const W_CAPACITY = 0.15;

/** Top performers are considered full at 75% of normal active-task limit. */
const TOP_PERFORMER_THRESHOLD = 0.75;
/** "Normal" max concurrent tasks before the capacity score collapses. */
const NORMAL_TASK_LIMIT = 8;

// ──────────────────────────────────────────────────────────────────────────────
// Deterministic scoring engine
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Compute an assignment recommendation for a task.
 * Does NOT write to the DB — returns the recommendation object to the caller.
 */
export async function computeRecommendation(
  organisationId: string,
  taskId: string
): Promise<AssignmentRecommendation> {
  const db = getSupabaseServiceClient();

  // 1. Fetch the task (need required_skills / skill_tags)
  const { data: task, error: taskErr } = await db
    .from("tasks")
    .select("id, title, required_skills, skill_tags, priority, primary_assignee_id")
    .eq("id", taskId)
    .eq("organisation_id", organisationId)
    .maybeSingle();

  if (taskErr || !task) {
    return {
      taskId,
      recommended: null,
      alternatives: [],
      confidence: "low",
      noMatchReason: "Task not found.",
    };
  }

  const requiredSkills: string[] = [
    ...(Array.isArray((task as Record<string, unknown>).required_skills)
      ? ((task as Record<string, unknown>).required_skills as string[])
      : []),
    ...(Array.isArray((task as Record<string, unknown>).skill_tags)
      ? ((task as Record<string, unknown>).skill_tags as string[])
      : []),
  ].map((s: string) => s.toLowerCase());

  // 2. Fetch all active employees in the org
  const { data: employees, error: empErr } = await db
    .from("employee_profiles")
    .select("id, user_id, first_name, last_name, designation, employment_status")
    .eq("organisation_id", organisationId)
    .eq("employment_status", "active")
    .is("deleted_at", null);

  if (empErr || !employees || employees.length === 0) {
    return {
      taskId,
      recommended: null,
      alternatives: [],
      confidence: "low",
      noMatchReason: "No active employees found in the organisation.",
    };
  }

  const employeeIds = employees.map((e: Record<string, unknown>) => String(e.id));
  const userOrEmpToEmpId = new Map<string, string>();
  for (const emp of employees) {
    const e = emp as Record<string, unknown>;
    const empId = String(e.id);
    userOrEmpToEmpId.set(empId, empId);
    if (e.user_id) userOrEmpToEmpId.set(String(e.user_id), empId);
  }

  // 3. Fetch performance metrics (batch)
  const { data: metrics } = await db
    .from("employee_performance_metrics")
    .select("*")
    .in("employee_id", employeeIds);

  const metricsByEmployee = new Map<string, Record<string, unknown>>();
  for (const m of metrics ?? []) {
    metricsByEmployee.set(String((m as Record<string, unknown>).employee_id), m as Record<string, unknown>);
  }

  // 4. Fetch verified skills (batch) for skill-match calculation
  const { data: skills } = await db
    .from("employee_skills")
    .select("employee_id, skill_name, proficiency")
    .in("employee_id", employeeIds)
    .eq("organisation_id", organisationId)
    .eq("verification_state", "verified");

  const skillsByEmployee = new Map<string, string[]>();
  for (const s of skills ?? []) {
    const sk = s as Record<string, unknown>;
    const empId = String(sk.employee_id);
    if (!skillsByEmployee.has(empId)) skillsByEmployee.set(empId, []);
    skillsByEmployee.get(empId)!.push(String(sk.skill_name).toLowerCase());
  }

  // 5. Fetch completed similar-work tasks per employee
  // "Similar" = tasks in the same org that share at least one skill_tag with the current task.
  let similarWorkCounts: Record<string, number> = {};
  if (requiredSkills.length > 0) {
    const { data: similarTasks } = await db
      .from("tasks")
      .select("primary_assignee_id, skill_tags")
      .eq("organisation_id", organisationId)
      .eq("status", "done")
      .not("primary_assignee_id", "is", null);

    for (const t of similarTasks ?? []) {
      const st = t as Record<string, unknown>;
      const rawAssignee = String(st.primary_assignee_id);
      const empId = userOrEmpToEmpId.get(rawAssignee);
      if (!empId) continue;
      const tags: string[] = (Array.isArray(st.skill_tags) ? (st.skill_tags as string[]) : []).map((x: string) =>
        x.toLowerCase()
      );
      const hasOverlap = tags.some((tag) => requiredSkills.includes(tag));
      if (hasOverlap) {
        similarWorkCounts[empId] = (similarWorkCounts[empId] ?? 0) + 1;
      }
    }
  }

  // Find max similar-work count to normalise
  const maxSimilar = Math.max(1, ...Object.values(similarWorkCounts));

  // 6. Score every candidate
  const candidates: CandidateScore[] = [];

  for (const emp of employees) {
    const e = emp as Record<string, unknown>;
    const empId = String(e.id);
    const m = metricsByEmployee.get(empId);

    // --- capacity (15%) ---
    const activeCount = m ? Number((m as Record<string, unknown>).active_task_count ?? 0) : 0;
    const isTopPerformer = m ? Boolean((m as Record<string, unknown>).is_top_performer) : false;
    const effectiveLimit = isTopPerformer
      ? NORMAL_TASK_LIMIT * TOP_PERFORMER_THRESHOLD
      : NORMAL_TASK_LIMIT;
    const rawCapacity = Math.max(0, 1 - activeCount / effectiveLimit);
    const overloadWarning = isTopPerformer && activeCount >= effectiveLimit;

    // If at capacity and NOT the only qualified person, skip (will be included later if no-match)
    // We still compute score; caller prunes if capacity=0 and non-unique.

    // --- reliability (25%) ---
    const onTimeRate = m ? Math.min(1, Math.max(0, Number((m as Record<string, unknown>).on_time_rate ?? 0))) : 0.5; // default 50% when no history

    // --- similar work (45%) ---
    const similarCount = similarWorkCounts[empId] ?? 0;
    const similarWorkScore = similarCount / maxSimilar;

    // --- verified skills (15%) ---
    let verifiedSkillsScore = 0;
    if (requiredSkills.length > 0) {
      const empSkills = skillsByEmployee.get(empId) ?? [];
      const matched = requiredSkills.filter((rs) => empSkills.some((es) => es.includes(rs) || rs.includes(es)));
      verifiedSkillsScore = matched.length / requiredSkills.length;
    }

    // --- composite ---
    const composite =
      W_SIMILAR_WORK * similarWorkScore +
      W_RELIABILITY * onTimeRate +
      W_SKILLS * verifiedSkillsScore +
      W_CAPACITY * rawCapacity;

    // --- explanation ---
    const parts: string[] = [];
    if (similarCount > 0) parts.push(`completed ${similarCount} similar task${similarCount > 1 ? "s" : ""}`);
    if (onTimeRate >= 0.8) parts.push(`strong on-time delivery (${Math.round(onTimeRate * 100)}%)`);
    else if (onTimeRate < 0.5) parts.push(`on-time rate is low (${Math.round(onTimeRate * 100)}%)`);
    if (verifiedSkillsScore > 0) parts.push(`has ${Math.round(verifiedSkillsScore * 100)}% of required skills verified`);
    if (overloadWarning) parts.push("⚠️ near capacity");
    const explanation =
      parts.length > 0 ? parts.join(", ") + "." : "No prior history for this task type.";

    candidates.push({
      employeeId: empId,
      name: `${String(e.first_name ?? "")} ${String(e.last_name ?? "")}`.trim(),
      designation: (e.designation as string | null) ?? null,
      similarWorkScore,
      onTimeRate,
      verifiedSkillsScore,
      capacityScore: rawCapacity,
      composite,
      overloadWarning,
      explanation,
    });
  }

  // 7. Sort by composite descending, capacity tie-breaker
  candidates.sort((a, b) => {
    const diff = b.composite - a.composite;
    if (Math.abs(diff) > 0.001) return diff;
    return b.capacityScore - a.capacityScore;
  });

  // 8. If top candidate is at capacity and there's an alternative, prefer alternative
  // (spec: include overloaded unique specialist with warning, but don't silently put them first)
  let ranked = [...candidates];
  if (
    ranked.length > 1 &&
    ranked[0].overloadWarning &&
    !ranked[1].overloadWarning
  ) {
    // Swap top two so overloaded specialist becomes an "alternative with warning"
    [ranked[0], ranked[1]] = [ranked[1], ranked[0]];
  }

  const [primary, ...rest] = ranked;
  const alternatives = rest.slice(0, 3);

  // 9. Confidence: based on data richness
  const historyCount = (metricsByEmployee.get(primary?.employeeId ?? "")?.total_tasks_completed as number | undefined) ?? 0;
  const confidence: "high" | "medium" | "low" =
    primary && historyCount >= 5 && primary.composite >= 0.6
      ? "high"
      : primary && (historyCount >= 2 || primary.composite >= 0.4)
      ? "medium"
      : "low";

  if (!primary) {
    return {
      taskId,
      recommended: null,
      alternatives: [],
      confidence: "low",
      noMatchReason:
        requiredSkills.length > 0
          ? `No employee with matching skills (${requiredSkills.join(", ")}) found with available capacity.`
          : "No eligible employees are currently available.",
    };
  }

  return {
    taskId,
    recommended: primary,
    alternatives,
    confidence,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Async metric refresh (called after task completion)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Recompute and upsert performance metrics for a single employee.
 * Should be called asynchronously (fire-and-forget) after task status changes.
 */
export async function refreshEmployeeMetrics(
  organisationId: string,
  employeeIdOrUserId: string
): Promise<void> {
  const db = getSupabaseServiceClient();

  const { data: profile } = await db
    .from("employee_profiles")
    .select("id, user_id")
    .eq("organisation_id", organisationId)
    .or(`id.eq.${employeeIdOrUserId},user_id.eq.${employeeIdOrUserId}`)
    .maybeSingle();

  const realEmpId = profile?.id ? String(profile.id) : employeeIdOrUserId;
  const realUserId = profile?.user_id ? String(profile.user_id) : null;

  let query = db
    .from("tasks")
    .select("id, status, due_date, updated_at, skill_tags")
    .eq("organisation_id", organisationId);

  if (realUserId && realUserId !== realEmpId) {
    query = query.or(`primary_assignee_id.eq.${realEmpId},primary_assignee_id.eq.${realUserId}`);
  } else {
    query = query.eq("primary_assignee_id", realEmpId);
  }

  const { data: allTasks } = await query;

  const tasks = (allTasks ?? []) as Record<string, unknown>[];
  const completed = tasks.filter((t) => String(t.status) === "done");
  const active = tasks.filter((t) =>
    ["open", "in_progress", "in_review", "blocked"].includes(String(t.status))
  );

  // On-time: completed tasks where updated_at <= due_date (or no due_date = on-time by default)
  let onTime = 0;
  for (const t of completed) {
    const due = t.due_date ? new Date(String(t.due_date)) : null;
    const updated = t.updated_at ? new Date(String(t.updated_at)) : null;
    if (!due || (updated && updated <= due)) onTime++;
  }

  const totalCompleted = completed.length;
  const onTimeRate = totalCompleted > 0 ? onTime / totalCompleted : 0.5;

  // Active workload: weighted by priority
  const priorityWeights: Record<string, number> = {
    critical: 2,
    high: 1.5,
    medium: 1,
    low: 0.5,
  };
  const weightedActiveCount = active.reduce((sum, t) => {
    return sum + (priorityWeights[String(t.priority)] ?? 1);
  }, 0);

  const workloadScore = Math.max(0, 1 - weightedActiveCount / NORMAL_TASK_LIMIT);
  const isTopPerformer = totalCompleted >= 5 && onTimeRate >= 0.75;

  // Similar-work score: proportion of distinct skill_tags covered by the employee's done tasks
  const coveredTags = new Set<string>();
  for (const t of completed) {
    for (const tag of (Array.isArray(t.skill_tags) ? t.skill_tags as string[] : [])) {
      coveredTags.add(String(tag).toLowerCase());
    }
  }
  const similarWorkScore = Math.min(1, coveredTags.size / 10); // normalise against 10 distinct tags

  // Verified skills score (ratio of verified to total skills)
  const { data: skills } = await db
    .from("employee_skills")
    .select("verification_state")
    .eq("employee_id", realEmpId);
  const allSkills = (skills ?? []) as Record<string, unknown>[];
  const verifiedCount = allSkills.filter((s) => String(s.verification_state) === "verified").length;
  const verifiedSkillsScore = allSkills.length > 0 ? verifiedCount / allSkills.length : 0;

  const composite =
    W_SIMILAR_WORK * similarWorkScore +
    W_RELIABILITY * onTimeRate +
    W_SKILLS * verifiedSkillsScore +
    W_CAPACITY * workloadScore;

  await db.from("employee_performance_metrics").upsert(
    {
      organisation_id: organisationId,
      employee_id: realEmpId,
      total_tasks_completed: totalCompleted,
      tasks_on_time: onTime,
      on_time_rate: Math.round(onTimeRate * 10000) / 10000,
      similar_work_score: Math.round(similarWorkScore * 10000) / 10000,
      workload_score: Math.round(workloadScore * 10000) / 10000,
      verified_skills_score: Math.round(verifiedSkillsScore * 10000) / 10000,
      composite_score: Math.round(composite * 10000) / 10000,
      active_task_count: active.length,
      is_top_performer: isTopPerformer,
      refreshed_at: new Date().toISOString(),
    },
    { onConflict: "employee_id" }
  );
}
