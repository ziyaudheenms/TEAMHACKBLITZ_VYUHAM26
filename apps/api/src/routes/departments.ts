/**
 * /api/v1/departments
 *
 * Department configuration endpoints.
 *
 * All routes require a valid Bearer token. The requesting user must belong
 * to the organisation they are querying or modifying. Write operations
 * (create, update, delete, manage members) require the "admin" or "owner"
 * role as stored in the organisation_members table.
 *
 * Database table: departments
 *   id                  UUID PK
 *   organisation_id     UUID FK → organisations.id
 *   name                VARCHAR(255) NOT NULL
 *   description         TEXT
 *   head_id             UUID FK → employee_profiles.id (nullable)
 *   parent_department_id UUID FK → departments.id (nullable, self-referencing)
 *   created_by          UUID (Supabase auth user id)
 *   created_at          TIMESTAMPTZ
 *   updated_at          TIMESTAMPTZ
 *
 * Database table: department_members
 *   id                   UUID PK
 *   department_id        UUID FK → departments.id
 *   employee_profile_id  UUID FK → employee_profiles.id
 *   role                 VARCHAR(50)  ("head" | "member")
 *   added_at             TIMESTAMPTZ
 *
 * Routes
 * ------
 * GET    /                             List departments in the user's org
 * POST   /                             Create a department (admin+)
 * GET    /:departmentId                Get a single department
 * PATCH  /:departmentId                Update a department (admin+)
 * DELETE /:departmentId                Soft-delete a department (admin+)
 * GET    /:departmentId/members        List members of a department
 * POST   /:departmentId/members        Add a member to a department (admin+)
 * DELETE /:departmentId/members/:memberId  Remove a member (admin+)
 */

import { Hono } from "hono";
import type { Context } from "hono";
import {
  CreateDepartmentSchema,
  UpdateDepartmentSchema,
  DepartmentQuerySchema,
  AddDepartmentMemberSchema,
} from "@bizcontext/validation";
import {
  extractBearerToken,
  resolveAuthUser,
  resolveMembership,
  getSupabaseServiceClient,
} from "../lib/supabase";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorResponse(c: Context, status: 400 | 401 | 403 | 404 | 409 | 500, message: string) {
  return c.json({ error: { message } }, status);
}

/**
 * Resolve the requesting user and look up their organisation membership.
 * Returns the userId, organisationId and their role.
 * Returns an error response (via `c`) when validation fails.
 */
async function resolveUserContext(c: Context): Promise<
  | {
      ok: true;
      userId: string;
      organisationId: string;
      role: string;
    }
  | { ok: false; response: Response }
> {
  const token = extractBearerToken(c.req.header("Authorization"));
  if (!token) {
    return { ok: false, response: errorResponse(c, 401, "Missing bearer token") as Response };
  }

  const { userId, isSuperAdmin, error: authError } = await resolveAuthUser(token);
  if (authError || !userId) {
    return {
      ok: false,
      response: errorResponse(c, 401, authError?.message ?? "Invalid or expired token") as Response,
    };
  }

  const resolved = await resolveMembership(userId, isSuperAdmin, c.req.header("X-Organisation-Id"));
  const member = resolved ? { organisation_id: resolved.organisationId, role: resolved.role } : null;

  if (!member) {
    return {
      ok: false,
      response: errorResponse(
        c,
        403,
        "You are not a member of any organisation"
      ) as Response,
    };
  }

  return {
    ok: true,
    userId,
    organisationId: member.organisation_id as string,
    role: member.role as string,
  };
}

/** Returns true when the role permits write operations. */
function canWrite(role: string): boolean {
  return role === "admin" || role === "owner";
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const departmentsRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET / — list departments
// ---------------------------------------------------------------------------
departmentsRoutes.get("/", async (c) => {
  const ctx = await resolveUserContext(c);
  if (!ctx.ok) return ctx.response;

  const rawQuery = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = DepartmentQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return errorResponse(c, 400, "Invalid query parameters");
  }

  const { page, limit, search } = parsed.data;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("departments")
    .select(
      "id, organisation_id, name, description, head_id, parent_department_id, created_by, created_at, updated_at",
      { count: "exact" }
    )
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .order("name", { ascending: true })
    .range(from, to);

  if (search) {
    query = query.ilike("name", `%${search}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("[departments] list error:", error.message);
    return errorResponse(c, 500, "Failed to fetch departments");
  }

  return c.json(
    {
      data: data ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    },
    200
  );
});

// ---------------------------------------------------------------------------
// POST / — create a department
// ---------------------------------------------------------------------------
departmentsRoutes.post("/", async (c) => {
  const ctx = await resolveUserContext(c);
  if (!ctx.ok) return ctx.response;

  if (!canWrite(ctx.role)) {
    return errorResponse(c, 403, "Only admins and owners can create departments");
  }

  const body = await c.req.json().catch(() => null);
  const parsed = CreateDepartmentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          message: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
      },
      400
    );
  }

  const { name, description, headId, parentDepartmentId } = parsed.data;
  const supabase = getSupabaseServiceClient();

  // Ensure parent department belongs to the same organisation (if provided).
  if (parentDepartmentId) {
    const { data: parentDept, error: parentErr } = await supabase
      .from("departments")
      .select("id, organisation_id")
      .eq("id", parentDepartmentId)
      .is("deleted_at", null)
      .single();

    if (parentErr || !parentDept) {
      return errorResponse(c, 404, "Parent department not found");
    }
    if ((parentDept.organisation_id as string) !== ctx.organisationId) {
      return errorResponse(
        c,
        403,
        "Parent department does not belong to your organisation"
      );
    }
  }

  // Ensure department name is unique within the organisation.
  const { count: duplicateCount } = await supabase
    .from("departments")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", ctx.organisationId)
    .ilike("name", name)
    .is("deleted_at", null);

  if (duplicateCount && duplicateCount > 0) {
    return errorResponse(c, 409, "A department with this name already exists in your organisation");
  }

  const { data: department, error: insertError } = await supabase
    .from("departments")
    .insert({
      organisation_id: ctx.organisationId,
      name,
      description: description ?? null,
      head_id: headId ?? null,
      parent_department_id: parentDepartmentId ?? null,
      created_by: ctx.userId,
    })
    .select(
      "id, organisation_id, name, description, head_id, parent_department_id, created_by, created_at, updated_at"
    )
    .single();

  if (insertError || !department) {
    console.error("[departments] create error:", insertError?.message);
    return errorResponse(c, 500, "Failed to create department");
  }

  return c.json({ data: department }, 201);
});

// ---------------------------------------------------------------------------
// GET /:departmentId — get a single department
// ---------------------------------------------------------------------------
departmentsRoutes.get("/:departmentId", async (c) => {
  const ctx = await resolveUserContext(c);
  if (!ctx.ok) return ctx.response;

  const { departmentId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: department, error } = await supabase
    .from("departments")
    .select(
      "id, organisation_id, name, description, head_id, parent_department_id, created_by, created_at, updated_at"
    )
    .eq("id", departmentId)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (error || !department) {
    return errorResponse(c, 404, "Department not found");
  }

  return c.json({ data: department }, 200);
});

// ---------------------------------------------------------------------------
// PATCH /:departmentId — update a department
// ---------------------------------------------------------------------------
departmentsRoutes.patch("/:departmentId", async (c) => {
  const ctx = await resolveUserContext(c);
  if (!ctx.ok) return ctx.response;

  if (!canWrite(ctx.role)) {
    return errorResponse(c, 403, "Only admins and owners can update departments");
  }

  const { departmentId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  // Verify department exists and belongs to this organisation.
  const { data: existing, error: fetchError } = await supabase
    .from("departments")
    .select("id")
    .eq("id", departmentId)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (fetchError || !existing) {
    return errorResponse(c, 404, "Department not found");
  }

  const body = await c.req.json().catch(() => null);
  const parsed = UpdateDepartmentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          message: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
      },
      400
    );
  }

  const { name, description, headId, parentDepartmentId } = parsed.data;

  // Guard: prevent a department from being its own parent.
  if (parentDepartmentId === departmentId) {
    return errorResponse(c, 400, "A department cannot be its own parent");
  }

  // Ensure new parent belongs to the same organisation (if provided).
  if (parentDepartmentId) {
    const { data: parentDept } = await supabase
      .from("departments")
      .select("id, organisation_id")
      .eq("id", parentDepartmentId)
      .is("deleted_at", null)
      .single();

    if (!parentDept || (parentDept.organisation_id as string) !== ctx.organisationId) {
      return errorResponse(c, 404, "Parent department not found");
    }
  }

  // Guard: name uniqueness within the organisation (when name is being changed).
  if (name) {
    const { count: duplicateCount } = await supabase
      .from("departments")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", ctx.organisationId)
      .ilike("name", name)
      .neq("id", departmentId)
      .is("deleted_at", null);

    if (duplicateCount && duplicateCount > 0) {
      return errorResponse(
        c,
        409,
        "A department with this name already exists in your organisation"
      );
    }
  }

  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (name !== undefined) updatePayload.name = name;
  if (description !== undefined) updatePayload.description = description;
  if (headId !== undefined) updatePayload.head_id = headId;
  if (parentDepartmentId !== undefined) updatePayload.parent_department_id = parentDepartmentId;

  const { data: updated, error: updateError } = await supabase
    .from("departments")
    .update(updatePayload)
    .eq("id", departmentId)
    .eq("organisation_id", ctx.organisationId)
    .select(
      "id, organisation_id, name, description, head_id, parent_department_id, created_by, created_at, updated_at"
    )
    .single();

  if (updateError || !updated) {
    console.error("[departments] update error:", updateError?.message);
    return errorResponse(c, 500, "Failed to update department");
  }

  return c.json({ data: updated }, 200);
});

// ---------------------------------------------------------------------------
// DELETE /:departmentId — soft-delete a department
// ---------------------------------------------------------------------------
departmentsRoutes.delete("/:departmentId", async (c) => {
  const ctx = await resolveUserContext(c);
  if (!ctx.ok) return ctx.response;

  if (!canWrite(ctx.role)) {
    return errorResponse(c, 403, "Only admins and owners can delete departments");
  }

  const { departmentId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: existing, error: fetchError } = await supabase
    .from("departments")
    .select("id")
    .eq("id", departmentId)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (fetchError || !existing) {
    return errorResponse(c, 404, "Department not found");
  }

  // Soft-delete: set deleted_at timestamp instead of removing the row.
  const { error: deleteError } = await supabase
    .from("departments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", departmentId)
    .eq("organisation_id", ctx.organisationId);

  if (deleteError) {
    console.error("[departments] delete error:", deleteError.message);
    return errorResponse(c, 500, "Failed to delete department");
  }

  return c.json({ success: true }, 200);
});

// ---------------------------------------------------------------------------
// GET /:departmentId/members — list members of a department
// ---------------------------------------------------------------------------
departmentsRoutes.get("/:departmentId/members", async (c) => {
  const ctx = await resolveUserContext(c);
  if (!ctx.ok) return ctx.response;

  const { departmentId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  // Verify department is in the caller's organisation.
  const { data: dept, error: deptErr } = await supabase
    .from("departments")
    .select("id")
    .eq("id", departmentId)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (deptErr || !dept) {
    return errorResponse(c, 404, "Department not found");
  }

  const { data: members, error: membersError } = await supabase
    .from("department_members")
    .select(
      "id, department_id, employee_profile_id, role, added_at, employee_profiles(id, first_name, last_name, work_email, designation)"
    )
    .eq("department_id", departmentId)
    .order("added_at", { ascending: true });

  if (membersError) {
    console.error("[departments] list members error:", membersError.message);
    return errorResponse(c, 500, "Failed to fetch department members");
  }

  return c.json({ data: members ?? [] }, 200);
});

// ---------------------------------------------------------------------------
// POST /:departmentId/members — add a member to a department
// ---------------------------------------------------------------------------
departmentsRoutes.post("/:departmentId/members", async (c) => {
  const ctx = await resolveUserContext(c);
  if (!ctx.ok) return ctx.response;

  if (!canWrite(ctx.role)) {
    return errorResponse(c, 403, "Only admins and owners can manage department members");
  }

  const { departmentId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  // Verify department exists and belongs to this organisation.
  const { data: dept, error: deptErr } = await supabase
    .from("departments")
    .select("id")
    .eq("id", departmentId)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (deptErr || !dept) {
    return errorResponse(c, 404, "Department not found");
  }

  const body = await c.req.json().catch(() => null);
  const parsed = AddDepartmentMemberSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          message: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
      },
      400
    );
  }

  const { employeeProfileId, role } = parsed.data;

  // Confirm the employee profile belongs to the same organisation.
  const { data: profile, error: profileErr } = await supabase
    .from("employee_profiles")
    .select("id, organisation_id")
    .eq("id", employeeProfileId)
    .single();

  if (profileErr || !profile) {
    return errorResponse(c, 404, "Employee profile not found");
  }

  if ((profile.organisation_id as string) !== ctx.organisationId) {
    return errorResponse(
      c,
      403,
      "Employee profile does not belong to your organisation"
    );
  }

  // Check for duplicate membership.
  const { count: existingCount } = await supabase
    .from("department_members")
    .select("id", { count: "exact", head: true })
    .eq("department_id", departmentId)
    .eq("employee_profile_id", employeeProfileId);

  if (existingCount && existingCount > 0) {
    return errorResponse(c, 409, "Employee is already a member of this department");
  }

  const { data: member, error: insertError } = await supabase
    .from("department_members")
    .insert({
      department_id: departmentId,
      employee_profile_id: employeeProfileId,
      role,
    })
    .select("id, department_id, employee_profile_id, role, added_at")
    .single();

  if (insertError || !member) {
    console.error("[departments] add member error:", insertError?.message);
    return errorResponse(c, 500, "Failed to add member to department");
  }

  return c.json({ data: member }, 201);
});

// ---------------------------------------------------------------------------
// DELETE /:departmentId/members/:memberId — remove a member from a department
// ---------------------------------------------------------------------------
departmentsRoutes.delete("/:departmentId/members/:memberId", async (c) => {
  const ctx = await resolveUserContext(c);
  if (!ctx.ok) return ctx.response;

  if (!canWrite(ctx.role)) {
    return errorResponse(c, 403, "Only admins and owners can manage department members");
  }

  const { departmentId, memberId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  // Verify the department membership record exists and is in this org.
  const { data: memberRecord, error: fetchErr } = await supabase
    .from("department_members")
    .select("id, departments!inner(organisation_id)")
    .eq("id", memberId)
    .eq("department_id", departmentId)
    .single();

  if (fetchErr || !memberRecord) {
    return errorResponse(c, 404, "Department member record not found");
  }

  const dept = memberRecord.departments as unknown;
  const deptOrgId = Array.isArray(dept)
    ? (dept[0] as { organisation_id: string } | undefined)?.organisation_id
    : (dept as { organisation_id: string } | null | undefined)?.organisation_id;

  if (deptOrgId !== ctx.organisationId) {
    return errorResponse(c, 403, "Access denied");
  }

  const { error: deleteError } = await supabase
    .from("department_members")
    .delete()
    .eq("id", memberId);

  if (deleteError) {
    console.error("[departments] remove member error:", deleteError.message);
    return errorResponse(c, 500, "Failed to remove member from department");
  }

  return c.json({ success: true }, 200);
});

export default departmentsRoutes;
