import type {
  Organisation,
  Department,
  EmployeeProfile,
  KnowledgePage,
  Project,
  Task,
  Ticket,
  Meeting,
  ChatMessage,
  ChatChannel,
  AgentRecord,
  StoredFile,
  AppNotification,
  NotificationPreferences,
  GlobalSearchResponse,
  SecondBrainResponse,
} from "../types";
import { http, ApiError, sessionStore, toStoredSession } from "./http";
import type { AuthResponse, StoredSession } from "./http";

/**
 * API client. Every method talks to the real backend and THROWS on failure (ApiError, with
 * `status === 0` when the server can't be reached). There is no offline/mock data: callers are
 * responsible for showing an error state.
 */

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  lastSignInAt: string | null;
  isSuperAdmin: boolean;
  blocked: boolean;
  blockReason: string | null;
  blockedAt: string | null;
  memberships: Array<{ organisationId: string; organisationName: string; role: string }>;
}

export interface AdminOrganisation {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberCount: number;
}

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface Invitation {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  designation: string | null;
  departmentId: string | null;
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  /** true when the invitation created a fresh (inactive) account */
  accountIsNew: boolean;
}

export interface CreatedInvitation {
  invitation: Invitation;
  /** One-time link for this person. Shown once; it is not retrievable later. */
  link: string;
  /** Organisation-chosen (or generated) password. Null if the person already had an account. */
  initialPassword: string | null;
  note?: string;
}

export interface InvitationPreview {
  organisationName: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  designation: string | null;
  accountIsNew: boolean;
  expiresAt: string;
}

export interface ApiStatus {
  isLive: boolean;
  endpoint: string;
  lastChecked: string;
}

// ─── Backend row shapes that need mapping ─────────────────────────────────────

interface EmployeeRow {
  id: string;
  organisationId: string | null;
  userId: string | null;
  firstName: string;
  lastName: string;
  workEmail: string;
  departmentId: string | null;
  designation: string | null;
  skills: EmployeeProfile["skills"];
  employmentStatus: EmployeeProfile["employmentStatus"];
  createdAt: string;
  updatedAt: string;
}

interface ProjectRow {
  id: string;
  organisationId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  name: string;
  description: string | null;
  status: Project["status"];
  ownerId: string | null;
  ownerName: string | null;
  departmentName: string | null;
  dueDate: string | null;
}

interface TaskRow {
  id: string;
  organisationId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  title: string;
  description: string | null;
  projectId: string | null;
  primaryAssigneeId: string | null;
  collaboratorIds?: string[];
  priority: Task["priority"];
  status: Task["status"];
  dueDate: string | null;
  subtasks?: Task["subtasks"];
}

const summarise = (content: string) =>
  content
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

// ─── Client ───────────────────────────────────────────────────────────────────

class ApiService {
  private baseUrl: string;
  private isLiveApi = false;
  private listeners: Array<(status: ApiStatus) => void> = [];

  constructor() {
    this.baseUrl =
      typeof window !== "undefined" && localStorage.getItem("bizcontext_api_url")
        ? localStorage.getItem("bizcontext_api_url")!
        : process.env.NEXT_PUBLIC_API_URL || "/api/v1";
  }

  // --- Connection status ---------------------------------------------------------

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url;
    if (typeof window !== "undefined") localStorage.setItem("bizcontext_api_url", url);
    void this.checkApiHealth();
  }

  public subscribeStatus(listener: (status: ApiStatus) => void): () => void {
    this.listeners.push(listener);
    listener(this.status());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private status(): ApiStatus {
    return { isLive: this.isLiveApi, endpoint: this.baseUrl, lastChecked: new Date().toLocaleTimeString() };
  }

  private setLive(live: boolean) {
    const changed = this.isLiveApi !== live;
    this.isLiveApi = live;
    if (changed) for (const l of this.listeners) l(this.status());
  }

  public async checkApiHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      // /health lives at the server root, outside the /api/v1 prefix.
      const root = this.baseUrl.replace(/\/api\/v\d+\/?$/, "").replace(/\/$/, "");
      const res = await fetch(`${root}/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      this.isLiveApi = res.ok;
    } catch {
      this.isLiveApi = false;
    }
    for (const l of this.listeners) l(this.status());
    return this.isLiveApi;
  }

  /** Authenticated JSON call. Throws ApiError; tracks reachability for the status pill. */
  private async call<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
    try {
      const result = await http<T>(this.baseUrl, path, init);
      this.setLive(true);
      return result;
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) this.setLive(false);
      throw err;
    }
  }

  /** Escape hatch for read-only endpoints without a typed wrapper (e.g. analytics). */
  public getJson<T>(path: string): Promise<T> {
    return this.call<T>(path);
  }

  // --- Auth ----------------------------------------------------------------------

  public getSession(): StoredSession | null {
    return sessionStore.get();
  }

  public async login(email: string, password: string, remember = true): Promise<StoredSession> {
    const res = await this.call<AuthResponse>("/auth/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email, password }),
    });
    return this.establishSession(res, remember);
  }

  public async signup(input: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
  }): Promise<StoredSession> {
    const res = await this.call<AuthResponse>("/auth/signup", {
      method: "POST",
      auth: false,
      body: JSON.stringify(input),
    });
    return this.establishSession(res, true);
  }

  private async establishSession(res: AuthResponse, remember: boolean): Promise<StoredSession> {
    let session = toStoredSession(res);
    sessionStore.set(session, remember);
    try {
      const me = await this.call<{ organisationId: string | null; role: string | null; isSuperAdmin?: boolean }>("/auth/me");
      session = { ...session, organisationId: me.organisationId, role: me.role, isSuperAdmin: me.isSuperAdmin === true };
      if (!session.organisationId) {
        const orgs = await this.getOrganisations();
        session.organisationId = orgs[0]?.id ?? null;
      }
      sessionStore.set(session, remember);
    } catch {
      // The session itself is valid; pages surface their own errors if the org lookup failed.
    }
    return session;
  }

  public async logout(): Promise<void> {
    try {
      await this.call("/auth/logout", { method: "POST" });
    } catch {
      // Token may already be expired; clear locally regardless.
    }
    sessionStore.clear();
  }

  // --- Organisations & departments -------------------------------------------------

  public async getOrganisations(): Promise<Organisation[]> {
    const res = await this.call<{ organisations: Organisation[] }>("/organisations");
    return res.organisations ?? [];
  }

  public async createOrganisation(name: string, slug: string): Promise<Organisation> {
    // The backend enrols the creator as owner and returns { ...org, role: 'owner' }.
    const org = await this.call<Organisation & { role?: string }>("/organisations", {
      method: "POST",
      body: JSON.stringify({ name, slug }),
    });
    const session = sessionStore.get();
    if (session) {
      sessionStore.set({
        ...session,
        organisationId: session.organisationId ?? org.id,
        role: session.role ?? org.role ?? "owner",
      });
    }
    return org;
  }

  public async getDepartments(): Promise<Department[]> {
    const res = await this.call<{
      data: Array<{ id: string; name: string; description?: string | null; head_id?: string | null }>;
    }>("/departments?limit=100");
    return res.data.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description ?? undefined,
      leadId: d.head_id ?? undefined,
    }));
  }

  public async createDepartment(name: string, description?: string): Promise<Department> {
    const res = await this.call<{ data: { id: string; name: string; description?: string | null } }>("/departments", {
      method: "POST",
      body: JSON.stringify({ name, description: description || undefined }),
    });
    return { id: res.data.id, name: res.data.name, description: res.data.description ?? undefined };
  }

  // --- Super admin console -----------------------------------------------------------

  public async adminListUsers(search = ""): Promise<AdminUser[]> {
    const res = await this.call<{ users: AdminUser[] }>(`/admin/users?search=${encodeURIComponent(search)}`);
    return res.users;
  }

  public adminCreateUser(input: {
    email: string;
    password: string;
    firstName: string;
    lastName?: string;
    organisationId?: string;
    role?: string;
    designation?: string;
  }): Promise<{ id: string; email: string; warnings: string[] }> {
    return this.call("/admin/users", { method: "POST", body: JSON.stringify(input) });
  }

  public async adminSetBlocked(userId: string, blocked: boolean, reason?: string): Promise<void> {
    await this.call(`/admin/users/${userId}/${blocked ? "block" : "unblock"}`, {
      method: "POST",
      body: JSON.stringify(blocked ? { reason } : {}),
    });
  }

  public async adminListOrganisations(): Promise<AdminOrganisation[]> {
    const res = await this.call<{ organisations: AdminOrganisation[] }>("/admin/organisations");
    return res.organisations;
  }

  public adminCreateOrganisation(input: { name: string; slug?: string; ownerUserId?: string }): Promise<AdminOrganisation> {
    return this.call("/admin/organisations", { method: "POST", body: JSON.stringify(input) });
  }

  public async adminSetMemberRole(orgId: string, userId: string, role: string): Promise<void> {
    await this.call(`/admin/organisations/${orgId}/members/${userId}`, { method: "PUT", body: JSON.stringify({ role }) });
  }

  public async adminRemoveMember(orgId: string, userId: string): Promise<void> {
    await this.call(`/admin/organisations/${orgId}/members/${userId}`, { method: "DELETE" });
  }

  // --- Employees & invitations --------------------------------------------------------

  private toEmployee(row: EmployeeRow, departments: Department[]): EmployeeProfile {
    return {
      id: row.id,
      organisationId: row.organisationId ?? "",
      userId: row.userId ?? "",
      createdBy: row.userId ?? "",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      firstName: row.firstName,
      lastName: row.lastName,
      workEmail: row.workEmail,
      designation: row.designation ?? undefined,
      departmentId: row.departmentId ?? undefined,
      departmentName: departments.find((d) => d.id === row.departmentId)?.name,
      skills: row.skills ?? [],
      employmentStatus: row.employmentStatus,
    };
  }

  public async getEmployees(): Promise<EmployeeProfile[]> {
    const [res, departments] = await Promise.all([
      this.call<{ employees: EmployeeRow[] }>("/employees"),
      this.getDepartments().catch(() => [] as Department[]),
    ]);
    return res.employees.map((e) => this.toEmployee(e, departments));
  }

  /** Creates the signed-in admin's own directory profile. (To bring in other people, use invitations.) */
  public async addEmployee(data: {
    firstName: string;
    lastName: string;
    workEmail: string;
    designation?: string;
    departmentId?: string;
  }): Promise<EmployeeProfile> {
    const session = sessionStore.get();
    if (!session?.organisationId) throw new ApiError("Your account isn't linked to an organisation yet.", 400);
    const row = await this.call<EmployeeRow>("/employees", {
      method: "POST",
      body: JSON.stringify({
        organisationId: session.organisationId,
        userId: session.user.id,
        firstName: data.firstName,
        lastName: data.lastName,
        workEmail: data.workEmail,
        designation: data.designation || undefined,
        departmentId: data.departmentId || undefined,
        employmentStatus: "active",
      }),
    });
    const departments = await this.getDepartments().catch(() => [] as Department[]);
    return this.toEmployee(row, departments);
  }

  public createInvitation(input: {
    email: string;
    firstName: string;
    lastName?: string;
    role?: string;
    designation?: string;
    departmentId?: string;
    password?: string;
  }): Promise<CreatedInvitation> {
    return this.call("/invitations", { method: "POST", body: JSON.stringify(input) });
  }

  public async listInvitations(): Promise<Invitation[]> {
    const res = await this.call<{ invitations: Invitation[] }>("/invitations");
    return res.invitations;
  }

  public regenerateInvitation(
    id: string,
    opts: { resetPassword?: boolean; password?: string } = {}
  ): Promise<{ invitation: Invitation; link: string; initialPassword: string | null }> {
    return this.call(`/invitations/${id}/regenerate`, { method: "POST", body: JSON.stringify(opts) });
  }

  public async revokeInvitation(id: string): Promise<void> {
    await this.call(`/invitations/${id}`, { method: "DELETE" });
  }

  /** Public (the invited person isn't signed in yet). */
  public previewInvitation(token: string): Promise<InvitationPreview> {
    return this.call("/invitations/preview", { method: "POST", auth: false, body: JSON.stringify({ token }) });
  }

  /** Public. Activates the account; the person then signs in with the organisation-set password. */
  public acceptInvitation(
    token: string,
    newPassword?: string
  ): Promise<{ success: boolean; email: string; organisationName: string; usedOwnPassword: boolean; accountIsNew: boolean }> {
    return this.call("/invitations/accept", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ token, newPassword: newPassword || undefined }),
    });
  }

  // --- Knowledge workspace -----------------------------------------------------------

  private toPage(p: Partial<KnowledgePage> & { id: string }): KnowledgePage {
    const content = p.content ?? "";
    return {
      organisationId: "",
      createdBy: "",
      createdAt: "",
      updatedAt: "",
      title: "Untitled",
      slug: "",
      visibility: "internal",
      ...p,
      content,
      tags: Array.isArray(p.tags) ? p.tags : [],
      authorName: p.authorName || "Unknown",
      summary: p.summary ?? summarise(content),
    } as KnowledgePage;
  }

  public async getKnowledgePages(): Promise<KnowledgePage[]> {
    const res = await this.call<{ pages: KnowledgePage[] }>("/knowledge/pages");
    return (res.pages ?? []).map((p) => this.toPage(p));
  }

  public async getKnowledgePage(id: string): Promise<KnowledgePage> {
    return this.toPage(await this.call<KnowledgePage>(`/knowledge/pages/${id}`));
  }

  public async createKnowledgePage(data: Partial<KnowledgePage>): Promise<KnowledgePage> {
    const page = await this.call<KnowledgePage>("/knowledge/pages", {
      method: "POST",
      body: JSON.stringify({
        title: data.title || "Untitled document",
        content: data.content ?? "",
        visibility: data.visibility ?? "internal",
      }),
    });
    return this.toPage(page);
  }

  public async updateKnowledgePage(id: string, updates: Partial<KnowledgePage>): Promise<KnowledgePage> {
    const body: Record<string, unknown> = {};
    if (updates.title !== undefined) body.title = updates.title;
    if (updates.content !== undefined) body.content = updates.content;
    if (updates.visibility !== undefined) body.visibility = updates.visibility;
    return this.toPage(await this.call<KnowledgePage>(`/knowledge/pages/${id}`, { method: "PATCH", body: JSON.stringify(body) }));
  }

  // --- Projects & tasks ----------------------------------------------------------------

  private async lookups() {
    const [projectRows, employees] = await Promise.all([
      this.call<{ data: ProjectRow[] }>("/projects").then((r) => r.data),
      this.getEmployees().catch(() => [] as EmployeeProfile[]),
    ]);
    return { projectRows, employees };
  }

  private personName(employees: EmployeeProfile[], id?: string | null): string | undefined {
    if (!id) return undefined;
    const e = employees.find((x) => x.userId === id || x.id === id);
    return e ? `${e.firstName} ${e.lastName}`.trim() : undefined;
  }

  private toTask(row: TaskRow, projects: Array<{ id: string; name: string }>, employees: EmployeeProfile[]): Task {
    return {
      id: row.id,
      organisationId: row.organisationId ?? "",
      createdBy: row.createdBy ?? "",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      title: row.title,
      description: row.description ?? undefined,
      projectId: row.projectId ?? undefined,
      projectName: projects.find((p) => p.id === row.projectId)?.name,
      primaryAssigneeId: row.primaryAssigneeId ?? undefined,
      assigneeName: this.personName(employees, row.primaryAssigneeId),
      collaboratorIds: row.collaboratorIds ?? [],
      priority: row.priority,
      status: row.status,
      dueDate: row.dueDate ?? undefined,
      subtasks: row.subtasks ?? [],
    };
  }

  public async getProjects(): Promise<Project[]> {
    const [{ projectRows, employees }, taskRows] = await Promise.all([
      this.lookups(),
      this.call<{ data: TaskRow[] }>("/tasks").then((r) => r.data),
    ]);
    return projectRows.map((p) => {
      const tasks = taskRows.filter((t) => t.projectId === p.id);
      const done = tasks.filter((t) => t.status === "done").length;
      return {
        id: p.id,
        organisationId: p.organisationId ?? "",
        createdBy: p.createdBy ?? "",
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        name: p.name,
        description: p.description ?? undefined,
        status: p.status,
        ownerId: p.createdBy ?? "",
        ownerName: this.personName(employees, p.createdBy) ?? "Unknown",
        progressPercent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
        departmentName: p.departmentName ?? "",
        tasksCount: { total: tasks.length, done },
        dueDate: p.dueDate ?? "",
      };
    });
  }

  public async createProject(data: Partial<Project>): Promise<Project> {
    const res = await this.call<{ data: ProjectRow }>("/projects", {
      method: "POST",
      body: JSON.stringify({ name: data.name, description: data.description, status: data.status ?? "active" }),
    });
    const employees = await this.getEmployees().catch(() => [] as EmployeeProfile[]);
    const p = res.data;
    return {
      id: p.id,
      organisationId: p.organisationId ?? "",
      createdBy: p.createdBy ?? "",
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      name: p.name,
      description: p.description ?? undefined,
      status: p.status,
      ownerId: p.createdBy ?? "",
      ownerName: this.personName(employees, p.createdBy) ?? "Unknown",
      progressPercent: 0,
      departmentName: p.departmentName ?? "",
      tasksCount: { total: 0, done: 0 },
      dueDate: p.dueDate ?? "",
    };
  }

  public async getTasks(projectId?: string): Promise<Task[]> {
    const [{ projectRows, employees }, rows] = await Promise.all([
      this.lookups(),
      this.call<{ data: TaskRow[] }>(projectId ? `/tasks?projectId=${encodeURIComponent(projectId)}` : "/tasks").then((r) => r.data),
    ]);
    return rows.map((t) => this.toTask(t, projectRows, employees));
  }

  public async createTask(data: Partial<Task>): Promise<Task> {
    const res = await this.call<{ data: TaskRow }>("/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: data.title,
        description: data.description,
        projectId: data.projectId,
        primaryAssigneeId: data.primaryAssigneeId,
        priority: data.priority ?? "medium",
        status: data.status ?? "open",
        dueDate: data.dueDate,
      }),
    });
    const { projectRows, employees } = await this.lookups();
    return this.toTask(res.data, projectRows, employees);
  }

  public async updateTaskStatus(taskId: string, status: Task["status"]): Promise<Task> {
    const res = await this.call<{ data: TaskRow }>(`/tasks/${taskId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    const { projectRows, employees } = await this.lookups();
    return this.toTask(res.data, projectRows, employees);
  }

  // --- Tickets -----------------------------------------------------------------------------

  public getTickets(): Promise<Ticket[]> {
    return this.call<Ticket[]>("/tickets");
  }

  public createTicket(data: Partial<Ticket>): Promise<Ticket> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return this.call<Ticket>("/tickets", {
      method: "POST",
      body: JSON.stringify({
        title: data.title,
        description: data.description,
        category: data.category ?? "general",
        priority: data.priority ?? "medium",
        assigneeId: data.assigneeId && uuid.test(data.assigneeId) ? data.assigneeId : undefined,
      }),
    });
  }

  public updateTicketStatus(ticketId: string, status: Ticket["status"]): Promise<Ticket> {
    return this.call<Ticket>(`/tickets/${ticketId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
  }

  public addTicketComment(ticketId: string, text: string): Promise<Ticket> {
    return this.call<Ticket>(`/tickets/${ticketId}/comments`, { method: "POST", body: JSON.stringify({ text }) });
  }

  // --- Meetings ----------------------------------------------------------------------------

  public getMeetings(): Promise<Meeting[]> {
    return this.call<Meeting[]>("/meetings");
  }

  public getMeeting(meetingId: string): Promise<Meeting> {
    return this.call<Meeting>(`/meetings/${meetingId}`);
  }

  public createMeeting(data: Partial<Meeting>): Promise<Meeting> {
    return this.call<Meeting>("/meetings", {
      method: "POST",
      body: JSON.stringify({
        title: data.title,
        agenda: data.agenda || undefined,
        meetingDate: data.meetingDate,
        durationMinutes: data.durationMinutes ?? 30,
        projectId: data.projectId || undefined,
        participantIds: data.participantIds ?? [],
        participantNames: data.participantNames ?? [],
        minutesContent: data.minutesContent || undefined,
      }),
    });
  }

  public updateMeeting(meetingId: string, updates: Partial<Meeting>): Promise<Meeting> {
    return this.call<Meeting>(`/meetings/${meetingId}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: updates.title,
        agenda: updates.agenda,
        meetingDate: updates.meetingDate,
        durationMinutes: updates.durationMinutes,
        projectId: updates.projectId,
        participantIds: updates.participantIds,
        participantNames: updates.participantNames,
        minutesContent: updates.minutesContent,
        aiSummary: updates.aiSummary,
      }),
    });
  }

  public async deleteMeeting(meetingId: string): Promise<void> {
    await this.call(`/meetings/${meetingId}`, { method: "DELETE" });
  }

  public extractActionItems(meetingId: string, minutesContent?: string): Promise<Meeting> {
    return this.call<Meeting>(`/meetings/${meetingId}/extract-action-items`, {
      method: "POST",
      body: JSON.stringify(minutesContent ? { minutesContent } : {}),
    });
  }

  public async convertActionItemToTask(meetingId: string, actionId: string): Promise<Task> {
    const res = await this.call<{ task: Record<string, any> }>(
      `/meetings/${meetingId}/action-items/${actionId}/convert-to-task`,
      { method: "POST", body: JSON.stringify({}) }
    );
    // This endpoint returns the raw database row.
    const r = res.task;
    const { projectRows, employees } = await this.lookups();
    return this.toTask(
      {
        id: r.id,
        organisationId: r.organisation_id ?? r.organisationId ?? null,
        createdBy: r.created_by ?? r.createdBy ?? null,
        createdAt: r.created_at ?? r.createdAt,
        updatedAt: r.updated_at ?? r.updatedAt,
        title: r.title,
        description: r.description ?? null,
        projectId: r.project_id ?? r.projectId ?? null,
        primaryAssigneeId: r.primary_assignee_id ?? r.primaryAssigneeId ?? null,
        priority: r.priority,
        status: r.status,
        dueDate: r.due_date ?? r.dueDate ?? null,
      },
      projectRows,
      employees
    );
  }

  // --- Team chat -----------------------------------------------------------------------------

  public getChannels(): Promise<ChatChannel[]> {
    return this.call<ChatChannel[]>("/channels");
  }

  public createChannel(input: {
    name: string;
    description?: string;
    isPrivate?: boolean;
    memberIds?: string[];
  }): Promise<ChatChannel> {
    return this.call<ChatChannel>("/channels", { method: "POST", body: JSON.stringify(input) });
  }

  /** Latest messages, or only those newer than `after` (the `createdAt` of the last one you have). */
  public getMessages(channelId: string, after?: string): Promise<ChatMessage[]> {
    const q = after ? `?after=${encodeURIComponent(after)}` : "";
    return this.call<ChatMessage[]>(`/channels/${channelId}/messages${q}`);
  }

  /** Mentioning @BizContext makes the server post the copilot's answer as a follow-up message. */
  public sendMessage(channelId: string, content: string): Promise<{ message: ChatMessage; copilotQueued: boolean }> {
    return this.call(`/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
  }

  // --- Agents & browser jobs -------------------------------------------------------------------

  public getAgents(): Promise<AgentRecord[]> {
    return this.call<AgentRecord[]>("/agents");
  }

  public createAgent(data: Partial<AgentRecord>): Promise<AgentRecord> {
    return this.call<AgentRecord>("/agents", {
      method: "POST",
      body: JSON.stringify({
        name: data.name,
        role: data.role ?? "",
        description: data.description ?? "",
        instructions: data.instructions || "Follow least-privilege security guidelines.",
        model: data.model || "gemini-2.5-flash",
        browserPermission: data.browserPermission ?? "B1",
        allowedDomains: data.allowedDomains ?? [],
      }),
    });
  }

  public updateAgentStatus(agentId: string, status: AgentRecord["status"]): Promise<AgentRecord> {
    return this.call<AgentRecord>(`/agents/${agentId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
  }

  // --- Files ---------------------------------------------------------------------------------------

  public getFiles(): Promise<StoredFile[]> {
    return this.call<StoredFile[]>("/files");
  }

  /** Presigned upload: reserve -> PUT bytes -> confirm. Throws if any step fails. */
  public async uploadRealFile(file: File, folderPath = "/"): Promise<StoredFile> {
    const init = await this.call<{ data: { fileId: string; storagePath: string; uploadUrl: string; file: StoredFile } }>(
      "/files/upload-url",
      {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          byteSize: file.size,
          visibility: "internal",
          folderPath,
        }),
      }
    );

    let put: Response;
    try {
      put = await fetch(init.data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
    } catch {
      throw new ApiError("The file could not be uploaded to storage. Check your connection and try again.", 0);
    }
    if (!put.ok) throw new ApiError(`Storage rejected the upload (${put.status}).`, put.status);

    await this.call(`/files/${init.data.fileId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ storagePath: init.data.storagePath }),
    });
    return { ...init.data.file, isUploadConfirmed: true, ocrStatus: "processing" };
  }

  public async getFileDownloadUrl(fileId: string): Promise<string> {
    const res = await this.call<{ data: { downloadUrl: string } }>(`/files/${fileId}/download-url`);
    return res.data.downloadUrl;
  }

  public async getFileKnowledge(fileId: string): Promise<{
    file: StoredFile;
    totalChunks: number;
    chunks: Array<{ id: string; content: string; created_at: string }>;
    fullText: string;
  }> {
    const res = await this.call<{
      data: {
        file: StoredFile;
        totalChunks: number;
        chunks: Array<{ id: string; content: string; created_at: string }>;
        fullText: string;
      };
    }>(`/files/${fileId}/content`);
    return res.data;
  }

  public async reindexFile(fileId: string): Promise<{ status: string; totalChunks: number; summaryPreview: string }> {
    const res = await this.call<{ data: { status: string; totalChunks: number; summaryPreview: string } }>(
      `/files/${fileId}/reindex`,
      { method: "POST" }
    );
    return res.data;
  }

  // --- Second brain ----------------------------------------------------------------------------------

  public searchGlobal(query: string, scope = "all"): Promise<GlobalSearchResponse> {
    return this.call<GlobalSearchResponse>(`/search?q=${encodeURIComponent(query)}&scope=${encodeURIComponent(scope)}`);
  }

  public async askSecondBrain(
    prompt: string,
    chatHistory: Array<{ role: "user" | "assistant"; content: string }> = []
  ): Promise<SecondBrainResponse> {
    const res = await this.call<{
      response: string;
      citations?: Array<{ title: string; source_type: string; snippet?: string; url?: string }>;
    }>("/ai/query", {
      method: "POST",
      body: JSON.stringify({ prompt, chatHistory: chatHistory.length ? chatHistory : undefined }),
    });
    return {
      answer: res.response,
      sources: (res.citations ?? []).map((c) => ({
        title: c.title,
        category: c.source_type,
        snippet: c.snippet,
        link: c.url,
      })),
    };
  }

  // --- Notifications -----------------------------------------------------------------------------------

  public getNotifications(page = 1, limit = 20): Promise<{ data: AppNotification[]; unreadCount: number }> {
    return this.call(`/notifications?page=${page}&limit=${limit}`);
  }

  public async getUnreadNotificationsCount(): Promise<number> {
    const res = await this.call<{ unreadCount: number }>("/notifications/unread-count");
    return res.unreadCount ?? 0;
  }

  public async markNotificationAsRead(id: string): Promise<void> {
    await this.call(`/notifications/${id}/read`, { method: "PATCH" });
  }

  public async markAllNotificationsAsRead(): Promise<void> {
    await this.call("/notifications/read-all", { method: "PATCH" });
  }

  public async dismissNotification(id: string): Promise<void> {
    await this.call(`/notifications/${id}`, { method: "DELETE" });
  }

  public async getNotificationPreferences(): Promise<NotificationPreferences> {
    const res = await this.call<{ data: NotificationPreferences }>("/notifications/preferences");
    return res.data;
  }

  public async updateNotificationPreferences(prefs: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const res = await this.call<{ data: NotificationPreferences }>("/notifications/preferences", {
      method: "PUT",
      body: JSON.stringify(prefs),
    });
    return res.data;
  }
}

export const api = new ApiService();
