import { Hono } from "hono";
import type { Context } from "hono";
import { getSupabaseServiceClient } from "../lib/supabase";
import { getFullAuthContext, requireRole, writeAuditLog } from "../lib/auth";
import { computeRecommendation, refreshEmployeeMetrics } from "../services/assignment.service";

const assignmentRoutes = new Hono();

function err(c: Context, status: 400 | 401 | 403 | 404 | 500, message: string) {
  return c.json({ error: { message } }, status);
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /assignment/tasks/:taskId/recommendation
// Returns (or creates) the recommendation for a given task.
// Accessible to: member+ (raw score breakdown restricted to admin/owner)
// ──────────────────────────────────────────────────────────────────────────────
assignmentRoutes.get("/tasks/:taskId/recommendation", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");
  if (!auth.organisationId || !requireRole(auth, "member")) return err(c, 403, "Requires 'member' role");

  const { taskId } = c.req.param();
  const db = getSupabaseServiceClient();

  // Check for an existing non-dismissed recommendation
  const { data: existing } = await db
    .from("assignment_recommendations")
    .select("*")
    .eq("task_id", taskId)
    .eq("organisation_id", auth.organisationId)
    .in("status", ["pending", "approved", "overridden"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let recommendation = existing as Record<string, unknown> | null;

  // If no live recommendation, compute one now
  if (!recommendation) {
    const result = await computeRecommendation(auth.organisationId, taskId);

    const insertPayload = {
      organisation_id: auth.organisationId,
      task_id: taskId,
      recommended_employee_id: result.recommended?.employeeId ?? null,
      score_breakdown: result.recommended
        ? {
            similar_work: result.recommended.similarWorkScore,
            reliability: result.recommended.onTimeRate,
            skills: result.recommended.verifiedSkillsScore,
            capacity: result.recommended.capacityScore,
            composite: result.recommended.composite,
          }
        : {},
      explanation: result.recommended?.explanation ?? result.noMatchReason ?? null,
      alternatives: result.alternatives.map((a) => ({
        employeeId: a.employeeId,
        name: a.name,
        compositeScore: a.composite,
        overloadWarning: a.overloadWarning,
        explanation: a.explanation,
      })),
      status: result.recommended ? "pending" : "no_match",
      confidence: result.confidence,
    };

    const { data: inserted, error: insertErr } = await db
      .from("assignment_recommendations")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertErr || !inserted) {
      console.error("[assignment] insert error:", insertErr?.message);
      return err(c, 500, "Failed to create recommendation");
    }

    recommendation = inserted as Record<string, unknown>;

    // Also attach recommended employee display name to the response
    if (result.recommended) {
      (recommendation as Record<string, unknown>)["_candidate"] = result.recommended;
      (recommendation as Record<string, unknown>)["_alternatives"] = result.alternatives;
    }
  } else {
    // Enrich existing recommendation with employee info
    if (recommendation.recommended_employee_id) {
      const { data: emp } = await db
        .from("employee_profiles")
        .select("id, first_name, last_name, designation")
        .eq("id", String(recommendation.recommended_employee_id))
        .maybeSingle();
      if (emp) {
        const e = emp as Record<string, unknown>;
        (recommendation as Record<string, unknown>)["_candidate"] = {
          employeeId: e.id,
          name: `${e.first_name} ${e.last_name}`.trim(),
          designation: e.designation ?? null,
        };
      }
    }
  }

  // Role-gate: strip score_breakdown for non-admin/owner
  const isPrivileged = auth.role === "admin" || auth.role === "owner";
  const payload = toRecommendationResponse(recommendation as Record<string, unknown>, isPrivileged);

  return c.json({ data: payload }, 200);
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /assignment/tasks/:taskId/approve
// Manager/task-giver approves or overrides the recommendation.
// Body: { action: "approve" | "override", finalAssigneeId: string, overrideReason?: string }
// ──────────────────────────────────────────────────────────────────────────────
assignmentRoutes.post("/tasks/:taskId/approve", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");
  if (!auth.organisationId || !requireRole(auth, "member")) return err(c, 403, "Requires 'member' role");

  const { taskId } = c.req.param();
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !body.action || !body.finalAssigneeId) {
    return err(c, 400, "action and finalAssigneeId are required");
  }
  if (!["approve", "override"].includes(String(body.action))) {
    return err(c, 400, "action must be 'approve' or 'override'");
  }

  const db = getSupabaseServiceClient();

  // Fetch the pending recommendation
  const { data: rec } = await db
    .from("assignment_recommendations")
    .select("*")
    .eq("task_id", taskId)
    .eq("organisation_id", auth.organisationId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!rec) return err(c, 404, "No pending recommendation found for this task");

  const r = rec as Record<string, unknown>;
  const finalAssigneeId = String(body.finalAssigneeId);
  const action = String(body.action) as "approve" | "override";
  const newStatus = action === "approve" ? "approved" : "overridden";

  // Update recommendation
  const { error: updErr } = await db
    .from("assignment_recommendations")
    .update({
      status: newStatus,
      approved_by: auth.userId,
      final_assignee_id: finalAssigneeId,
      override_reason: action === "override" ? (body.overrideReason ? String(body.overrideReason) : null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(r.id));

  if (updErr) return err(c, 500, "Failed to update recommendation");

  // Write the assignee to the task
  const { error: taskUpdErr } = await db
    .from("tasks")
    .update({
      primary_assignee_id: finalAssigneeId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .eq("organisation_id", auth.organisationId);

  if (taskUpdErr) return err(c, 500, "Recommendation approved but task update failed");

  await writeAuditLog({
    organisationId: auth.organisationId,
    actorId: auth.userId,
    action: `assignment.${newStatus}`,
    resourceType: "assignment_recommendation",
    resourceId: String(r.id),
    metadata: {
      taskId,
      finalAssigneeId,
      recommendedEmployeeId: r.recommended_employee_id,
      overrideReason: body.overrideReason ?? null,
    },
  });

  // Trigger async metric refresh for the new assignee (fire-and-forget)
  void refreshEmployeeMetrics(auth.organisationId, finalAssigneeId);

  return c.json({ data: { status: newStatus, finalAssigneeId, taskId } }, 200);
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /assignment/tasks/:taskId/dismiss
// Dismiss recommendation without assigning.
// ──────────────────────────────────────────────────────────────────────────────
assignmentRoutes.post("/tasks/:taskId/dismiss", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");
  if (!auth.organisationId || !requireRole(auth, "member")) return err(c, 403, "Requires 'member' role");

  const { taskId } = c.req.param();
  const db = getSupabaseServiceClient();

  const { error } = await db
    .from("assignment_recommendations")
    .update({ status: "dismissed", updated_at: new Date().toISOString() })
    .eq("task_id", taskId)
    .eq("organisation_id", auth.organisationId)
    .eq("status", "pending");

  if (error) return err(c, 500, "Failed to dismiss recommendation");
  return c.json({ data: { dismissed: true } }, 200);
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /assignment/employees/:employeeId/skills
// List skills for an employee. Unverified source CV is accessible to admin/owner only.
// ──────────────────────────────────────────────────────────────────────────────
assignmentRoutes.get("/employees/:employeeId/skills", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");
  if (!auth.organisationId || !requireRole(auth, "member")) return err(c, 403, "Requires 'member' role");

  const isPrivileged = auth.role === "admin" || auth.role === "owner";
  const db = getSupabaseServiceClient();

  let query = db
    .from("employee_skills")
    .select("id, skill_name, proficiency, verification_state, source, verified_at, created_at")
    .eq("employee_id", c.req.param("employeeId"))
    .eq("organisation_id", auth.organisationId)
    .neq("verification_state", "rejected");

  // Non-privileged users only see verified skills
  if (!isPrivileged) {
    query = query.eq("verification_state", "verified") as typeof query;
  }

  const { data, error } = await query.order("skill_name");
  if (error) return err(c, 500, "Failed to fetch skills");
  return c.json({ data: data ?? [] }, 200);
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /assignment/employees/:employeeId/skills
// Add / upsert a skill. Admin/owner can set verification state.
// ──────────────────────────────────────────────────────────────────────────────
assignmentRoutes.post("/employees/:employeeId/skills", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");
  if (!auth.organisationId || !requireRole(auth, "member")) return err(c, 403, "Requires 'member' role");

  const isPrivileged = auth.role === "admin" || auth.role === "owner";
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !body.skillName) return err(c, 400, "skillName is required");

  const db = getSupabaseServiceClient();

  const verificationState = isPrivileged
    ? (String(body.verificationState ?? "verified"))
    : "unverified";

  const { data, error } = await db
    .from("employee_skills")
    .upsert(
      {
        organisation_id: auth.organisationId,
        employee_id: c.req.param("employeeId"),
        skill_name: String(body.skillName).toLowerCase().trim(),
        proficiency: String(body.proficiency ?? "intermediate"),
        verification_state: verificationState,
        source: String(body.source ?? (isPrivileged ? "manager_review" : "manual")),
        verified_by: isPrivileged ? auth.userId : null,
        verified_at: isPrivileged ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_id, skill_name" }
    )
    .select("*")
    .single();

  if (error || !data) return err(c, 500, "Failed to upsert skill");
  return c.json({ data }, 201);
});

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /assignment/employees/:employeeId/skills/:skillId/verify
// Verify or reject a pending skill (admin/owner only).
// ──────────────────────────────────────────────────────────────────────────────
assignmentRoutes.patch("/employees/:employeeId/skills/:skillId/verify", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");
  if (!auth.organisationId || !requireRole(auth, "admin")) return err(c, 403, "Requires 'admin' role");

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !["verified", "rejected"].includes(String(body.state ?? ""))) {
    return err(c, 400, "state must be 'verified' or 'rejected'");
  }

  const db = getSupabaseServiceClient();
  const { data, error } = await db
    .from("employee_skills")
    .update({
      verification_state: String(body.state),
      verified_by: auth.userId,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", c.req.param("skillId"))
    .eq("employee_id", c.req.param("employeeId"))
    .eq("organisation_id", auth.organisationId)
    .select("*")
    .maybeSingle();

  if (error) return err(c, 500, "Failed to update skill verification");
  if (!data) return err(c, 404, "Skill not found");

  // Refresh metrics after verification change
  void refreshEmployeeMetrics(auth.organisationId, c.req.param("employeeId"));

  return c.json({ data }, 200);
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /assignment/employees/:employeeId/metrics
// Performance metrics — raw scores visible to admin/owner only.
// ──────────────────────────────────────────────────────────────────────────────
assignmentRoutes.get("/employees/:employeeId/metrics", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) return err(c, 401, "Unauthorized");
  if (!auth.organisationId || !requireRole(auth, "admin")) {
    return err(c, 403, "Requires 'admin' role or higher");
  }

  const db = getSupabaseServiceClient();
  const { data, error } = await db
    .from("employee_performance_metrics")
    .select("*")
    .eq("employee_id", c.req.param("employeeId"))
    .eq("organisation_id", auth.organisationId)
    .maybeSingle();

  if (error) return err(c, 500, "Failed to fetch metrics");
  return c.json({ data: data ?? null }, 200);
});

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function toRecommendationResponse(row: Record<string, unknown>, includeScores: boolean) {
  const base = {
    id: row.id,
    taskId: row.task_id,
    status: row.status,
    confidence: row.confidence,
    explanation: row.explanation,
    alternatives: row.alternatives,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recommended: row._candidate
      ? {
          ...(row._candidate as object),
          // Strip raw scores unless privileged
          ...(includeScores
            ? (typeof row.score_breakdown === "object" && row.score_breakdown !== null
                ? { scoreBreakdown: row.score_breakdown }
                : {})
            : {}),
        }
      : null,
    finalAssigneeId: row.final_assignee_id ?? null,
    approvedBy: row.approved_by ?? null,
  };
  return base;
}

export default assignmentRoutes;
