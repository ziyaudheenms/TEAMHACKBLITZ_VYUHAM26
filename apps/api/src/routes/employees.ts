import { Hono } from "hono";
import { CreateEmployeeSchema } from "@bizcontext/validation";
import { getSupabaseServiceClient } from "../lib/supabase";
import { enforceRole, getFullAuthContext, writeAuditLog } from "../lib/auth";

const employeesRoutes = new Hono();

export interface EmployeeResponse {
  id: string;
  organisationId: string | null;
  userId: string | null;
  firstName: string;
  lastName: string;
  workEmail: string;
  departmentId: string | null;
  designation: string | null;
  skills: Array<{
    name: string;
    proficiency: "beginner" | "intermediate" | "expert";
    verified: boolean;
  }>;
  employmentStatus: "active" | "invited" | "suspended" | "offboarded";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function toEmployeeResponse(row: Record<string, unknown>): EmployeeResponse {
  const skills = Array.isArray(row.skills) ? (row.skills as EmployeeResponse["skills"]) : [];

  return {
    id: String(row.id ?? ""),
    organisationId: (row.organisation_id as string) ?? null,
    userId: (row.user_id as string) ?? null,
    firstName: String(row.first_name ?? ""),
    lastName: String(row.last_name ?? ""),
    workEmail: String(row.work_email ?? ""),
    departmentId: (row.department_id as string) ?? null,
    designation: (row.designation as string) ?? null,
    skills,
    employmentStatus: (row.employment_status as EmployeeResponse["employmentStatus"]) ?? "active",
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    deletedAt: (row.deleted_at as string) ?? null,
  };
}

// POST /api/v1/employees
employeesRoutes.post("/", async (c) => {
  // Managing the people directory is an admin-level action.
  const { context: auth, response: denied } = await enforceRole(c, "admin");
  if (denied) return denied;
  if (!auth.organisationId) {
    return c.json({ error: { message: "Not a member of an organisation" } }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = CreateEmployeeSchema.safeParse({ ...(body ?? {}), organisationId: auth.organisationId });
  if (!parsed.success) {
    return c.json({ error: { message: "Validation failed" } }, 400);
  }

  const {
    organisationId,
    userId,
    firstName,
    lastName,
    workEmail,
    departmentId,
    designation,
    employmentStatus,
  } = parsed.data;
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("employee_profiles")
    .insert({
      organisation_id: organisationId,
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      work_email: workEmail,
      department_id: departmentId ?? null,
      designation: designation ?? null,
      employment_status: employmentStatus,
    })
    .select()
    .single();

  if (error) {
    return c.json({ error: { message: error.message } }, 400);
  }

  await writeAuditLog({
    organisationId,
    actorId: auth.userId,
    action: "employee.create",
    resourceType: "employee_profile",
    resourceId: (data as Record<string, unknown>).id as string,
  });

  const employee = toEmployeeResponse((data ?? {}) as Record<string, unknown>);
  return c.json(employee, 201);
});

// GET /api/v1/employees
employeesRoutes.get("/", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) {
    return c.json({ error: { message: "Unauthorized" } }, 401);
  }
  if (!auth.organisationId) {
    return c.json({ error: { message: "Not a member of an organisation" } }, 403);
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("employee_profiles")
    .select("*")
    .eq("organisation_id", auth.organisationId)
    .is("deleted_at", null);

  if (error) {
    return c.json({ error: { message: error.message } }, 500);
  }

  let employees = (data ?? []).map((row) => toEmployeeResponse(row as Record<string, unknown>));

  // Optional filters used by the AI engine's directory tool: ?q=name/title&skills=a,b
  const q = c.req.query("q")?.toLowerCase().trim();
  const skills = c.req
    .query("skills")
    ?.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (q) {
    employees = employees.filter((e) =>
      `${e.firstName} ${e.lastName} ${e.designation ?? ""}`.toLowerCase().includes(q)
    );
  }
  if (skills?.length) {
    employees = employees.filter((e) =>
      skills.some((s) => e.skills.some((k) => k.name.toLowerCase().includes(s)))
    );
  }

  return c.json({ employees }, 200);
});

// GET /api/v1/employees/:id
employeesRoutes.get("/:id", async (c) => {
  const auth = await getFullAuthContext(c);
  if (!auth) {
    return c.json({ error: { message: "Unauthorized" } }, 401);
  }
  if (!auth.organisationId) {
    return c.json({ error: { message: "Not a member of an organisation" } }, 403);
  }

  const id = c.req.param("id");
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("employee_profiles")
    .select("*")
    .eq("id", id)
    .eq("organisation_id", auth.organisationId)
    .single();

  if (error) {
    return c.json({ error: { message: "Employee not found" } }, 404);
  }

  const employee = toEmployeeResponse((data ?? {}) as Record<string, unknown>);
  return c.json(employee, 200);
});

export default employeesRoutes;
