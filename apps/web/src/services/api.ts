import {
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
  BrowserJob,
  StoredFile,
  AuditLogItem,
  AppNotification,
  NotificationPreferences,
  SearchResult,
  GlobalSearchResponse,
  SecondBrainResponse,
} from "../types";

import {
  initialOrganisations,
  initialDepartments,
  initialEmployees,
  initialKnowledgePages,
  initialProjects,
  initialTasks,
  initialTickets,
  initialMeetings,
  initialChannels,
  initialMessages,
  initialAgents,
  initialBrowserJobs,
  initialFiles,
  initialAuditLogs,
} from "./mockData";
import { http, ApiError, sessionStore, toStoredSession } from "./http";
import type { AuthResponse, StoredSession } from "./http";

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

export interface ApiStatus {
  isLive: boolean;
  endpoint: string;
  lastChecked: string;
}

class ApiService {
  private baseUrl: string;
  private isLiveApi: boolean = false;
  private listeners: Array<(status: ApiStatus) => void> = [];

  // Local state cache
  private organisations: Organisation[] = [];
  private departments: Department[] = [];
  private employees: EmployeeProfile[] = [];
  private knowledgePages: KnowledgePage[] = [];
  private projects: Project[] = [];
  private tasks: Task[] = [];
  private tickets: Ticket[] = [];
  private meetings: Meeting[] = [];
  private channels: ChatChannel[] = [];
  private messages: Record<string, ChatMessage[]> = {};
  private agents: AgentRecord[] = [];
  private browserJobs: BrowserJob[] = [];
  private files: StoredFile[] = [];
  private auditLogs: AuditLogItem[] = [];

  constructor() {
    this.baseUrl =
      typeof window !== "undefined" && localStorage.getItem("bizcontext_api_url")
        ? localStorage.getItem("bizcontext_api_url")!
        : process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

    this.initStore();
  }

  private initStore() {
    if (typeof window === "undefined") {
      this.organisations = [...initialOrganisations];
      this.departments = [...initialDepartments];
      this.employees = [...initialEmployees];
      this.knowledgePages = [...initialKnowledgePages];
      this.projects = [...initialProjects];
      this.tasks = [...initialTasks];
      this.tickets = [...initialTickets];
      this.meetings = [...initialMeetings];
      this.channels = [...initialChannels];
      this.messages = { ...initialMessages };
      this.agents = [...initialAgents];
      this.browserJobs = [...initialBrowserJobs];
      this.files = [...initialFiles];
      this.auditLogs = [...initialAuditLogs];
      return;
    }

    try {
      const load = <T>(key: string, initial: T): T => {
        const saved = localStorage.getItem(`bizcontext_${key}`);
        return saved ? JSON.parse(saved) : initial;
      };

      this.organisations = load("organisations", initialOrganisations);
      this.departments = load("departments", initialDepartments);
      this.employees = load("employees", initialEmployees);
      this.knowledgePages = load("knowledgePages", initialKnowledgePages);
      this.projects = load("projects", initialProjects);
      this.tasks = load("tasks", initialTasks);
      this.tickets = load("tickets", initialTickets);
      this.meetings = load("meetings", initialMeetings);
      this.channels = load("channels", initialChannels);
      this.messages = load("messages", initialMessages);
      this.agents = load("agents", initialAgents);
      this.browserJobs = load("browserJobs", initialBrowserJobs);
      this.files = load("files", initialFiles);
      this.auditLogs = load("auditLogs", initialAuditLogs);
    } catch {
      this.organisations = [...initialOrganisations];
      this.departments = [...initialDepartments];
      this.employees = [...initialEmployees];
      this.knowledgePages = [...initialKnowledgePages];
      this.projects = [...initialProjects];
      this.tasks = [...initialTasks];
      this.tickets = [...initialTickets];
      this.meetings = [...initialMeetings];
      this.channels = [...initialChannels];
      this.messages = { ...initialMessages };
      this.agents = [...initialAgents];
      this.browserJobs = [...initialBrowserJobs];
      this.files = [...initialFiles];
      this.auditLogs = [...initialAuditLogs];
    }
  }

  private saveStore(key: string, data: unknown) {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(`bizcontext_${key}`, JSON.stringify(data));
      } catch {
        // storage quota exceeded or disabled
      }
    }
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url;
    if (typeof window !== "undefined") {
      localStorage.setItem("bizcontext_api_url", url);
    }
    this.checkApiHealth();
  }

  public subscribeStatus(listener: (status: ApiStatus) => void): () => void {
    this.listeners.push(listener);
    listener({
      isLive: this.isLiveApi,
      endpoint: this.baseUrl,
      lastChecked: new Date().toLocaleTimeString(),
    });
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyStatus() {
    const status: ApiStatus = {
      isLive: this.isLiveApi,
      endpoint: this.baseUrl,
      lastChecked: new Date().toLocaleTimeString(),
    };
    for (const listener of this.listeners) {
      listener(status);
    }
  }

  public async checkApiHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      // /health lives at the server root, outside the /api/v1 prefix.
      const root = this.baseUrl.replace(/\/api\/v\d+\/?$/, "").replace(/\/$/, "");
      const res = await fetch(`${root}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      this.isLiveApi = res.ok;
    } catch {
      this.isLiveApi = false;
    }
    this.notifyStatus();
    return this.isLiveApi;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const session = sessionStore.get();
      const authHeaders: Record<string, string> = {};
      if (session) {
        authHeaders["Authorization"] = `Bearer ${session.accessToken}`;
        if (session.organisationId) authHeaders["X-Organisation-Id"] = session.organisationId;
        if (session.user?.id) authHeaders["X-User-Id"] = session.user.id;
      }
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
          ...options?.headers,
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        this.isLiveApi = true;
        this.notifyStatus();
        return (await res.json()) as T;
      }
      // Surface 4xx/5xx details without crashing
      console.warn(`[api] ${options?.method ?? "GET"} ${path} → ${res.status}`);
    } catch {
      // Backend not running yet or endpoint 404/500
      this.isLiveApi = false;
      this.notifyStatus();
    }
    return null;
  }

  private actorName(): string {
    const user = sessionStore.get()?.user;
    if (!user) return "You";
    return `${user.firstName} ${user.lastName}`.trim() || user.email;
  }

  // --- Auth ---
  public getSession(): StoredSession | null {
    return sessionStore.get();
  }

  public async login(email: string, password: string, remember = true): Promise<StoredSession> {
    const res = await http<AuthResponse>(this.baseUrl, "/auth/login", {
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
    const res = await http<AuthResponse>(this.baseUrl, "/auth/signup", {
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
      const me = await http<{ organisationId: string | null; role: string | null; isSuperAdmin?: boolean }>(
        this.baseUrl,
        "/auth/me"
      );
      session = { ...session, organisationId: me.organisationId, role: me.role, isSuperAdmin: me.isSuperAdmin === true };
      if (!session.organisationId) {
        const orgs = await this.getOrganisations();
        session.organisationId = orgs[0]?.id ?? null;
      }
      sessionStore.set(session, remember);
    } catch {
      // Session is valid even if the org lookup fails; pages surface their own errors.
    }
    return session;
  }

  public async logout(): Promise<void> {
    try {
      await http(this.baseUrl, "/auth/logout", { method: "POST" });
    } catch {
      // Token may already be expired; clear locally regardless.
    }
    sessionStore.clear();
  }

  /**
   * Like request<T> but for endpoints that return { data: T }.
   * Falls back to null on failure so callers can use local cache.
   */
  private async requestData<T>(path: string, options?: RequestInit): Promise<T | null> {
    const json = await this.request<{ data: T }>(path, options);
    if (json && "data" in json) return json.data;
    return null;
  }

  // --- Organisations & Departments ---
  public async getOrganisations(): Promise<Organisation[]> {
    try {
      const res = await http<{ organisations: Organisation[] }>(this.baseUrl, "/organisations");
      const orgs = res?.organisations ?? [];
      if (orgs.length > 0) {
        this.organisations = orgs;
        this.saveStore("organisations", orgs);
        this.isLiveApi = true;
        this.notifyStatus();
      }
      return orgs.length > 0 ? orgs : this.organisations;
    } catch {
      return this.organisations;
    }
  }

  // --- Super admin console ---
  public async adminListUsers(search = ""): Promise<AdminUser[]> {
    const res = await http<{ users: AdminUser[] }>(this.baseUrl, `/admin/users?search=${encodeURIComponent(search)}`);
    return res.users;
  }

  public async adminCreateUser(input: {
    email: string;
    password: string;
    firstName: string;
    lastName?: string;
    organisationId?: string;
    role?: string;
    designation?: string;
  }): Promise<{ id: string; email: string; warnings: string[] }> {
    return http(this.baseUrl, "/admin/users", { method: "POST", body: JSON.stringify(input) });
  }

  public async adminSetBlocked(userId: string, blocked: boolean, reason?: string): Promise<void> {
    await http(this.baseUrl, `/admin/users/${userId}/${blocked ? "block" : "unblock"}`, {
      method: "POST",
      body: JSON.stringify(blocked ? { reason } : {}),
    });
  }

  public async adminListOrganisations(): Promise<AdminOrganisation[]> {
    const res = await http<{ organisations: AdminOrganisation[] }>(this.baseUrl, "/admin/organisations");
    return res.organisations;
  }

  public async adminCreateOrganisation(input: { name: string; slug?: string; ownerUserId?: string }): Promise<AdminOrganisation> {
    return http(this.baseUrl, "/admin/organisations", { method: "POST", body: JSON.stringify(input) });
  }

  public async adminSetMemberRole(orgId: string, userId: string, role: string): Promise<void> {
    await http(this.baseUrl, `/admin/organisations/${orgId}/members/${userId}`, {
      method: "PUT",
      body: JSON.stringify({ role }),
    });
  }

  public async adminRemoveMember(orgId: string, userId: string): Promise<void> {
    await http(this.baseUrl, `/admin/organisations/${orgId}/members/${userId}`, { method: "DELETE" });
  }

  public async getDepartments(): Promise<Department[]> {
    const res = await http<{
      data: Array<{ id: string; name: string; description?: string | null; head_id?: string | null }>;
    }>(this.baseUrl, "/departments?limit=100");
    return res.data.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description ?? undefined,
      leadId: d.head_id ?? undefined,
    }));
  }

  public async createDepartment(name: string, description?: string): Promise<Department> {
    const res = await http<{ data: { id: string; name: string; description?: string | null } }>(
      this.baseUrl,
      "/departments",
      { method: "POST", body: JSON.stringify({ name, description: description || undefined }) }
    );
    return { id: res.data.id, name: res.data.name, description: res.data.description ?? undefined };
  }

  public async createOrganisation(name: string, slug: string): Promise<Organisation> {
    // The backend auto-enrolls creator as 'owner' and returns { ...org, role: 'owner' }
    const orgRes = await http<Organisation & { role?: string }>(this.baseUrl, "/organisations", {
      method: "POST",
      body: JSON.stringify({ name, slug }),
    });
    const session = sessionStore.get();
    if (session) {
      const updated = {
        ...session,
        organisationId: session.organisationId ?? orgRes.id,
        role: session.role ?? orgRes.role ?? "owner",
      };
      sessionStore.set(updated);
    }
    return orgRes;
  }

  // --- Employees ---
  private toEmployee(
    row: {
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
    },
    departments: Department[]
  ): EmployeeProfile {
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
      http<{ employees: Parameters<ApiService["toEmployee"]>[0][] }>(this.baseUrl, "/employees"),
      this.getDepartments().catch(() => [] as Department[]),
    ]);
    return res.employees.map((e) => this.toEmployee(e, departments));
  }

  public async addEmployee(data: {
    firstName: string;
    lastName: string;
    workEmail: string;
    designation?: string;
    departmentId?: string;
  }): Promise<EmployeeProfile> {
    const session = sessionStore.get();
    if (!session?.organisationId) {
      throw new ApiError("Your account isn't linked to an organisation yet.", 400);
    }
    const row = await http<Parameters<ApiService["toEmployee"]>[0]>(this.baseUrl, "/employees", {
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

  // --- Knowledge Workspace ---
  public async getKnowledgePages(): Promise<KnowledgePage[]> {
    const live = await this.request<{ pages?: KnowledgePage[] } | KnowledgePage[]>("/knowledge/pages");
    const rawPages = Array.isArray(live) ? live : live?.pages ?? this.knowledgePages;
    const pages = (rawPages || []).map((p: KnowledgePage) => ({
      ...p,
      tags: Array.isArray(p.tags) ? p.tags : ["documentation"],
      authorName: p.authorName || "Team Member",
      summary: p.summary || "",
      viewsCount: p.viewsCount ?? 1,
    }));
    if (pages.length > 0) {
      this.knowledgePages = pages;
    }
    return pages;
  }

  public async getKnowledgePage(id: string): Promise<KnowledgePage | undefined> {
    const live = await this.request<KnowledgePage>(`/knowledge/pages/${id}`);
    const page = live || this.knowledgePages.find((p) => p.id === id);
    if (!page) return undefined;
    return {
      ...page,
      tags: Array.isArray(page.tags) ? page.tags : ["documentation"],
      authorName: page.authorName || "Team Member",
    };
  }

  public async createKnowledgePage(data: Partial<KnowledgePage>): Promise<KnowledgePage> {
    const newPage: KnowledgePage = {
      id: `page-${Date.now()}`,
      organisationId: "org-1",
      createdBy: "emp-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: data.title || "Untitled Document",
      slug: (data.title || "untitled-document").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      content: data.content || "# New Document\n\nEnter organizational knowledge here...",
      summary: data.summary || "Newly created organizational knowledge document.",
      visibility: data.visibility || "internal",
      tags: data.tags || ["documentation"],
      authorName: this.actorName(),
      viewsCount: 1,
    };

    const live = await this.request<KnowledgePage>("/knowledge/pages", {
      method: "POST",
      body: JSON.stringify(newPage),
    });

    const res = live || newPage;
    this.knowledgePages = [res, ...this.knowledgePages];
    this.saveStore("knowledgePages", this.knowledgePages);
    this.addAuditLog(this.actorName(), "user", `Created knowledge page "${res.title}"`);
    return res;
  }

  public async updateKnowledgePage(id: string, updates: Partial<KnowledgePage>): Promise<KnowledgePage> {
    const idx = this.knowledgePages.findIndex((p) => p.id === id);
    if (idx !== -1) {
      this.knowledgePages[idx] = {
        ...this.knowledgePages[idx],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      this.saveStore("knowledgePages", this.knowledgePages);
      return this.knowledgePages[idx];
    }
    throw new Error("Page not found");
  }

  // --- Projects & Tasks ---
  public async getProjects(): Promise<Project[]> {
    const live = await this.requestData<Project[]>("/projects");
    return live || this.projects;
  }

  public async createProject(data: Partial<Project>): Promise<Project> {
    const newProject: Project = {
      id: `proj-${Date.now()}`,
      organisationId: "org-1",
      createdBy: "emp-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      name: data.name || "Untitled Project",
      description: data.description || "Project created in BizContext workspace.",
      status: data.status || "active",
      ownerId: "emp-1",
      ownerName: this.actorName(),
      progressPercent: 0,
      departmentName: data.departmentName || "AI Engineering & Research",
      tasksCount: { total: 0, done: 0 },
      dueDate: data.dueDate || "2026-11-30",
    };

    const live = await this.requestData<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(newProject),
    });

    const res = live || newProject;
    this.projects = [res, ...this.projects];
    this.saveStore("projects", this.projects);
    return res;
  }

  public async getTasks(projectId?: string): Promise<Task[]> {
    const live = await this.requestData<Task[]>(projectId ? `/tasks?projectId=${projectId}` : "/tasks");
    const tasks = live || this.tasks;
    if (projectId) {
      return tasks.filter((t) => t.projectId === projectId);
    }
    return tasks;
  }

  public async createTask(data: Partial<Task>): Promise<Task> {
    const newTask: Task = {
      id: `task-${Date.now()}`,
      organisationId: "org-1",
      createdBy: "emp-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: data.title || "Untitled Task",
      description: data.description || "",
      projectId: data.projectId || "proj-1",
      projectName: data.projectName || "BizContext Web Core V1",
      primaryAssigneeId: data.primaryAssigneeId || "emp-1",
      assigneeName: data.assigneeName || this.actorName(),
      assigneeAvatar: data.assigneeAvatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
      collaboratorIds: data.collaboratorIds || [],
      priority: data.priority || "medium",
      status: data.status || "open",
      dueDate: data.dueDate || "2026-11-10",
      subtasks: data.subtasks || [],
    };

    const live = await this.requestData<Task>("/tasks", {
      method: "POST",
      body: JSON.stringify(newTask),
    });

    const res = live || newTask;
    this.tasks = [res, ...this.tasks];
    this.saveStore("tasks", this.tasks);
    this.addAuditLog(this.actorName(), "user", `Created task "${res.title}" assigned to ${res.assigneeName}`);
    return res;
  }

  public async updateTaskStatus(taskId: string, status: Task["status"]): Promise<Task> {
    const idx = this.tasks.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      this.tasks[idx] = {
        ...this.tasks[idx],
        status,
        updatedAt: new Date().toISOString(),
      };
      this.saveStore("tasks", this.tasks);

      // Async live sync attempt
      this.requestData<Task>(`/tasks/${taskId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });

      return this.tasks[idx];
    }
    throw new Error("Task not found");
  }

  // --- Tickets & SLA ---
  public async getTickets(): Promise<Ticket[]> {
    const live = await this.request<Ticket[]>("/tickets");
    return live || this.tickets;
  }

  public async createTicket(data: Partial<Ticket>): Promise<Ticket> {
    const count = this.tickets.length + 1045;
    const newTicket: Ticket = {
      id: `tick-${Date.now()}`,
      organisationId: "org-1",
      createdBy: "emp-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ticketNumber: `TICK-${count}`,
      title: data.title || "Untitled Issue",
      description: data.description || "",
      category: data.category || "dev",
      priority: data.priority || "medium",
      status: "open",
      requesterId: "emp-1",
      requesterName: this.actorName(),
      assigneeId: data.assigneeId || "emp-3",
      assigneeName: data.assigneeName || "Marcus Vance",
      slaTarget: "In 24 hours",
      slaBreached: false,
      comments: [],
    };

    const live = await this.request<Ticket>("/tickets", {
      method: "POST",
      body: JSON.stringify(newTicket),
    });

    const res = live || newTicket;
    this.tickets = [res, ...this.tickets];
    this.saveStore("tickets", this.tickets);
    this.addAuditLog(this.actorName(), "user", `Logged ticket ${res.ticketNumber}: "${res.title}"`);
    return res;
  }

  public async updateTicketStatus(ticketId: string, status: Ticket["status"]): Promise<Ticket> {
    const live = await this.request<Ticket>(`/tickets/${ticketId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });

    if (live) {
      const idx = this.tickets.findIndex((t) => t.id === ticketId);
      if (idx !== -1) {
        this.tickets[idx] = live;
        this.saveStore("tickets", this.tickets);
      }
      return live;
    }

    const idx = this.tickets.findIndex((t) => t.id === ticketId);
    if (idx !== -1) {
      this.tickets[idx] = {
        ...this.tickets[idx],
        status,
        updatedAt: new Date().toISOString(),
      };
      this.saveStore("tickets", this.tickets);
      return this.tickets[idx];
    }
    throw new Error("Ticket not found");
  }

  public async addTicketComment(ticketId: string, text: string): Promise<Ticket> {
    const live = await this.request<Ticket>(`/tickets/${ticketId}/comments`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });

    if (live) {
      const idx = this.tickets.findIndex((t) => t.id === ticketId);
      if (idx !== -1) {
        this.tickets[idx] = live;
        this.saveStore("tickets", this.tickets);
      }
      return live;
    }

    const idx = this.tickets.findIndex((t) => t.id === ticketId);
    if (idx !== -1) {
      const comments = this.tickets[idx].comments || [];
      comments.push({
        id: `c-${Date.now()}`,
        author: this.actorName(),
        avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
        text,
        createdAt: new Date().toISOString(),
      });
      this.tickets[idx] = { ...this.tickets[idx], comments, updatedAt: new Date().toISOString() };
      this.saveStore("tickets", this.tickets);
      return this.tickets[idx];
    }
    throw new Error("Ticket not found");
  }

  // --- Meetings & Minutes (AI Action Items - Section 10.1) ---
  public async getMeetings(): Promise<Meeting[]> {
    const live = await this.request<Meeting[] | { data: Meeting[] }>("/meetings");
    const list = live ? (Array.isArray(live) ? live : (live as any).data) : null;
    if (list && Array.isArray(list)) {
      this.meetings = list;
      this.saveStore("meetings", this.meetings);
      return list;
    }
    return this.meetings;
  }

  public async getMeeting(meetingId: string): Promise<Meeting | undefined> {
    const live = await this.request<Meeting>(`/meetings/${meetingId}`);
    if (live) return live;
    return this.meetings.find((m) => m.id === meetingId);
  }

  public async createMeeting(data: Partial<Meeting>): Promise<Meeting> {
    const session = sessionStore.get();
    const newMeeting: Meeting = {
      id: `meet-${Date.now()}`,
      organisationId: session?.organisationId || "org-1",
      createdBy: session?.user?.id || "emp-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: data.title || "Untitled Meeting",
      agenda: data.agenda || "",
      meetingDate: data.meetingDate || new Date().toISOString().slice(0, 16).replace("T", " "),
      durationMinutes: data.durationMinutes || 30,
      participantIds: data.participantIds || [],
      participantNames:
        data.participantNames && data.participantNames.length > 0
          ? data.participantNames
          : [this.actorName()],
      projectId: data.projectId,
      projectName: data.projectName,
      minutesContent: data.minutesContent || "",
      aiSummary: data.aiSummary,
      extractedActionItems: data.extractedActionItems || [],
    };

    const live = await this.request<Meeting>("/meetings", {
      method: "POST",
      body: JSON.stringify({
        title: newMeeting.title,
        agenda: newMeeting.agenda,
        meetingDate: newMeeting.meetingDate,
        durationMinutes: newMeeting.durationMinutes,
        projectId: newMeeting.projectId,
        participantIds: newMeeting.participantIds,
        participantNames: newMeeting.participantNames,
        minutesContent: newMeeting.minutesContent,
      }),
    });

    const res = live || newMeeting;
    this.meetings = [res, ...this.meetings];
    this.saveStore("meetings", this.meetings);
    this.addAuditLog(this.actorName(), "user", `Created meeting notes for "${res.title}"`);
    return res;
  }

  public async updateMeeting(meetingId: string, updates: Partial<Meeting>): Promise<Meeting> {
    const live = await this.request<Meeting>(`/meetings/${meetingId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });

    if (live) {
      const idx = this.meetings.findIndex((m) => m.id === meetingId);
      if (idx !== -1) {
        this.meetings[idx] = live;
        this.saveStore("meetings", this.meetings);
      }
      return live;
    }

    const idx = this.meetings.findIndex((m) => m.id === meetingId);
    if (idx !== -1) {
      this.meetings[idx] = {
        ...this.meetings[idx],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      this.saveStore("meetings", this.meetings);
      return this.meetings[idx];
    }
    throw new Error("Meeting not found");
  }

  public async deleteMeeting(meetingId: string): Promise<void> {
    await this.request(`/meetings/${meetingId}`, { method: "DELETE" });
    this.meetings = this.meetings.filter((m) => m.id !== meetingId);
    this.saveStore("meetings", this.meetings);
    this.addAuditLog(this.actorName(), "user", `Deleted meeting #${meetingId}`);
  }

  public async extractActionItems(meetingId: string, minutesContent?: string): Promise<Meeting> {
    const live = await this.request<Meeting>(`/meetings/${meetingId}/extract-action-items`, {
      method: "POST",
      body: JSON.stringify(minutesContent ? { minutesContent } : {}),
    });
    if (live) {
      const idx = this.meetings.findIndex((m) => m.id === meetingId);
      if (idx !== -1) {
        this.meetings[idx] = live;
        this.saveStore("meetings", this.meetings);
      }
      return live;
    }

    const idx = this.meetings.findIndex((m) => m.id === meetingId);
    if (idx !== -1) {
      const meeting = this.meetings[idx];
      if (minutesContent) meeting.minutesContent = minutesContent;
      if (meeting.extractedActionItems.length === 0) {
        meeting.extractedActionItems = [
          {
            id: `act-${Date.now()}-1`,
            title: "Coordinate with DevOps on gVisor sandbox egress firewall rules",
            assignee: "Marcus Vance",
            dueDate: "2026-11-03",
            priority: "high",
            convertedToTask: false,
          },
          {
            id: `act-${Date.now()}-2`,
            title: "Validate HyDE query expansion prompt with pgvector top-k results",
            assignee: "Priya Sharma",
            dueDate: "2026-11-04",
            priority: "medium",
            convertedToTask: false,
          },
        ];
      }
      if (!meeting.aiSummary) {
        meeting.aiSummary =
          "Analyzed discussion items and identified immediate action points with targeted assignees.";
      }
      this.saveStore("meetings", this.meetings);
      this.addAuditLog("Meeting Secretary (AI)", "agent", `Extracted action items for meeting "${meeting.title}"`);
      return meeting;
    }
    throw new Error("Meeting not found");
  }

  public async convertActionItemToTask(meetingId: string, actionId: string): Promise<Task> {
    const meeting = this.meetings.find((m) => m.id === meetingId);
    if (!meeting) throw new Error("Meeting not found");

    const action = meeting.extractedActionItems.find((a) => a.id === actionId);
    if (!action) throw new Error("Action item not found");

    // Attempt live API conversion first
    const live = await this.request<{ success: boolean; task: Task }>(
      `/meetings/${meetingId}/action-items/${actionId}/convert-to-task`,
      { method: "POST" }
    );

    action.convertedToTask = true;
    this.saveStore("meetings", this.meetings);

    if (live && live.task) {
      this.tasks = [live.task, ...this.tasks];
      this.saveStore("tasks", this.tasks);
      return live.task;
    }

    const createdTask = await this.createTask({
      title: action.title,
      description: `Auto-generated from meeting: "${meeting.title}". Assigned during transcript action item extraction.`,
      projectId: meeting.projectId || "proj-1",
      projectName: meeting.projectName || "BizContext Web Core V1",
      assigneeName: action.assignee,
      priority: action.priority,
      status: "open",
      dueDate: action.dueDate,
    });

    return createdTask;
  }

  // --- Communication & Channels ---
  public async getChannels(): Promise<ChatChannel[]> {
    const live = await this.request<ChatChannel[]>("/channels");
    return live || this.channels;
  }

  public async getMessages(channelId: string): Promise<ChatMessage[]> {
    const live = await this.request<ChatMessage[]>(`/channels/${channelId}/messages`);
    return live || this.messages[channelId] || [];
  }

  public async sendMessage(channelId: string, content: string): Promise<ChatMessage> {
    const user = sessionStore.get()?.user;
    const senderName = user ? `${user.firstName} ${user.lastName}`.trim() || user.email : "You";
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      channelId,
      senderId: user?.id ?? "me",
      senderName,
      content,
      createdAt: new Date().toISOString(),
      reactions: [],
    };

    if (!this.messages[channelId]) {
      this.messages[channelId] = [];
    }
    this.messages[channelId].push(newMsg);
    this.saveStore("messages", this.messages);

    // Only messages that mention @BizContext are routed to the AI engine.
    if (content.toLowerCase().includes("@bizcontext")) {
      const prompt = content.replace(/@bizcontext/gi, "").trim() || content;
      const history = this.messages[channelId]
        .slice(-9, -1)
        .map((m) => ({ role: m.isAi ? ("assistant" as const) : ("user" as const), content: m.content }));
      let reply: string;
      try {
        reply = (await this.askSecondBrain(prompt, history)).answer;
      } catch (err) {
        reply = `I couldn't reach the AI engine: ${err instanceof Error ? err.message : "unknown error"}`;
      }
      this.messages[channelId].push({
        id: `msg-${Date.now() + 1}`,
        channelId,
        senderId: "ai-bot",
        senderName: "BizContext Copilot",
        isAi: true,
        content: reply,
        createdAt: new Date().toISOString(),
        reactions: [],
      });
      this.saveStore("messages", this.messages);
    }

    return newMsg;
  }

  // --- Agents & Browser Jobs (Section 4 & 5) ---
  public async getAgents(): Promise<AgentRecord[]> {
    const live = await this.request<AgentRecord[]>("/agents");
    if (live) {
      this.agents = live;
      this.saveStore("agents", live);
    }
    return live ?? this.agents;
  }

  public async createAgent(data: Partial<AgentRecord>): Promise<AgentRecord> {
    const payload = {
      name: data.name || "Custom Assistant",
      role: data.role || "",
      description: data.description || "",
      instructions: data.instructions || "Follow least-privilege security guidelines.",
      model: data.model || "gemini-2.5-flash",
      browserPermission: data.browserPermission || "B1",
      allowedDomains: data.allowedDomains || [],
    };

    const live = await this.request<AgentRecord>("/agents", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const newAgent: AgentRecord = live ?? {
      id: `ag-${Date.now()}`,
      organisationId: sessionStore.get()?.organisationId ?? "org-1",
      createdBy: sessionStore.get()?.user?.id ?? "emp-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...payload,
      status: "draft",
      totalExecutions: 0,
      successRate: 100,
    };

    this.agents = [newAgent, ...this.agents];
    this.saveStore("agents", this.agents);
    this.addAuditLog(this.actorName(), "user", `Registered new agent "${newAgent.name}" with level ${newAgent.browserPermission}`);
    return newAgent;
  }

  public async updateAgentStatus(agentId: string, status: AgentRecord["status"]): Promise<AgentRecord | null> {
    const live = await this.request<AgentRecord>(`/agents/${agentId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    if (live) {
      const idx = this.agents.findIndex((a) => a.id === agentId);
      if (idx !== -1) {
        this.agents[idx] = live;
        this.saveStore("agents", this.agents);
      }
    }
    return live;
  }

  public async getBrowserJobs(): Promise<BrowserJob[]> {
    const live = await this.request<BrowserJob[]>("/browser-jobs");
    if (live) {
      this.browserJobs = live;
      this.saveStore("browserJobs", live);
    }
    return live ?? this.browserJobs;
  }

  public async createBrowserJob(data: Partial<BrowserJob>): Promise<BrowserJob> {
    const payload = {
      agentId: data.agentId || "",
      goal: data.goal || "Extract web metrics",
      targetUrl: data.targetUrl || "https://example.com",
      permissionLevel: data.permissionLevel || "B1",
    };

    const live = await this.request<BrowserJob>("/browser-jobs", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const fallback: BrowserJob = {
      id: `bjob-${Date.now()}`,
      organisationId: sessionStore.get()?.organisationId ?? "org-1",
      createdBy: sessionStore.get()?.user?.id ?? "emp-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agentId: data.agentId || "ag-2",
      agentName: data.agentName || "Browser Worker",
      goal: data.goal || "Extract web metrics",
      targetUrl: data.targetUrl || "https://example.com",
      permissionLevel: data.permissionLevel || "B1",
      status: "queued",
      steps: [],
      evidenceUrls: [],
      outputSummary: "Job queued.",
    };

    const res = live || fallback;
    this.browserJobs = [res, ...this.browserJobs];
    this.saveStore("browserJobs", this.browserJobs);
    this.addAuditLog(this.actorName(), "user", `Launched browser job: "${res.goal}"`);
    return res;
  }

  public async approveBrowserJob(jobId: string, decision: "approved" | "rejected", note?: string): Promise<BrowserJob> {
    // Live API (requires admin). A real server rejection (403/404/...) must surface to the
    // caller; only a network failure (status 0) may fall back to the offline demo path.
    try {
      const live = await http<BrowserJob>(this.baseUrl, `/browser-jobs/${jobId}/approve`, {
        method: "POST",
        body: JSON.stringify({ approved: decision === "approved", note }),
      });
      const liveIdx = this.browserJobs.findIndex((j) => j.id === jobId);
      if (liveIdx !== -1) this.browserJobs[liveIdx] = live;
      else this.browserJobs.unshift(live);
      this.saveStore("browserJobs", this.browserJobs);
      return live;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 0) throw err;
    }

    // Offline fallback
    const idx = this.browserJobs.findIndex((j) => j.id === jobId);
    if (idx !== -1) {
      if (decision === "approved") {
        this.browserJobs[idx].status = "completed";
        this.browserJobs[idx].outputSummary = "Approved by supervisor.";
        this.addAuditLog(this.actorName(), "user", `APPROVED browser job #${jobId}`);
      } else {
        this.browserJobs[idx].status = "cancelled";
        this.browserJobs[idx].outputSummary = "Rejected by supervisor.";
        this.addAuditLog(this.actorName(), "user", `REJECTED browser job #${jobId}`);
      }
      this.saveStore("browserJobs", this.browserJobs);
      return this.browserJobs[idx];
    }
    throw new Error("Job not found");
  }

  // --- Asset Storage ---
  public async getFiles(): Promise<StoredFile[]> {
    const live = await this.request<StoredFile[]>("/files");
    return live || this.files;
  }

  public async uploadFile(filename: string, mimeType: string, byteSize: number): Promise<StoredFile> {
    const live = await this.request<StoredFile>("/files", {
      method: "POST",
      body: JSON.stringify({ filename, mimeType, byteSize, visibility: "internal" }),
    });

    if (live) {
      this.files = [live, ...this.files];
      this.saveStore("files", this.files);
      this.addAuditLog(this.actorName(), "user", `Uploaded document "${filename}"`);
      return live;
    }

    const newFile: StoredFile = {
      id: `file-${Date.now()}`,
      organisationId: "org-1",
      createdBy: "emp-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      filename,
      mimeType,
      byteSize,
      storagePath: `org-1/uploads/${filename}`,
      visibility: "internal",
      uploadedByName: this.actorName(),
      downloadUrl: "#",
      ocrStatus: "none",
    };

    this.files = [newFile, ...this.files];
    this.saveStore("files", this.files);
    this.addAuditLog(this.actorName(), "user", `Uploaded document "${filename}"`);
    return newFile;
  }

  public async uploadRealFile(file: File, folderPath = "/"): Promise<StoredFile> {
    try {
      // 1. Request presigned upload URL
      const initRes = await this.request<{
        data: {
          fileId: string;
          storagePath: string;
          uploadUrl: string;
          file: StoredFile;
        };
      }>("/files/upload-url", {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          byteSize: file.size,
          visibility: "internal",
          folderPath,
        }),
      });

      if (initRes?.data?.uploadUrl) {
        // 2. Upload file bytes to Supabase Storage via signed PUT URL
        await fetch(initRes.data.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });

        // 3. Confirm upload
        await this.request(`/files/${initRes.data.fileId}/confirm`, {
          method: "POST",
          body: JSON.stringify({ storagePath: initRes.data.storagePath }),
        });

        const createdFile: StoredFile = {
          ...initRes.data.file,
          isUploadConfirmed: true,
          ocrStatus: "processing",
        };
        this.files = [createdFile, ...this.files];
        this.saveStore("files", this.files);
        return createdFile;
      }
    } catch (err) {
      console.warn("[api] Presigned upload failed, falling back to direct register:", err);
    }

    // Direct fallback
    return this.uploadFile(file.name, file.type || "application/octet-stream", file.size);
  }

  public async getFileDownloadUrl(fileId: string): Promise<string | null> {
    try {
      const res = await this.request<{ data: { downloadUrl: string } }>(`/files/${fileId}/download-url`);
      return res?.data?.downloadUrl ?? null;
    } catch {
      return null;
    }
  }

  public async getFileKnowledge(fileId: string): Promise<{
    file: StoredFile;
    totalChunks: number;
    chunks: Array<{ id: string; content: string; created_at: string }>;
    fullText: string;
  } | null> {
    try {
      const res = await this.request<{
        data: {
          file: StoredFile;
          totalChunks: number;
          chunks: Array<{ id: string; content: string; created_at: string }>;
          fullText: string;
        };
      }>(`/files/${fileId}/content`);
      return res?.data ?? null;
    } catch {
      return null;
    }
  }

  public async reindexFile(fileId: string): Promise<{
    status: string;
    totalChunks: number;
    summaryPreview: string;
  } | null> {
    try {
      const res = await this.request<{
        data: {
          status: string;
          totalChunks: number;
          summaryPreview: string;
        };
      }>(`/files/${fileId}/reindex`, {
        method: "POST",
      });
      return res?.data ?? null;
    } catch {
      return null;
    }
  }

  // --- Audit Logs ---
  public async getAuditLogs(): Promise<AuditLogItem[]> {
    return this.auditLogs;
  }

  private addAuditLog(actorName: string, actorType: "user" | "agent" | "system", action: string, targetResource = "BizContext Workspace") {
    const item: AuditLogItem = {
      id: `aud-${Date.now()}`,
      actorName,
      actorType,
      action,
      targetResource,
      timestamp: new Date().toLocaleTimeString() + " " + new Date().toISOString().slice(0, 10),
      status: "success",
    };
    this.auditLogs = [item, ...this.auditLogs.slice(0, 49)];
    this.saveStore("auditLogs", this.auditLogs);
  }

  // --- Second Brain (AI engine via API gateway) ---
  public async searchGlobal(
    query: string,
    scope: string = "all"
  ): Promise<GlobalSearchResponse> {
    const encoded = encodeURIComponent(query);
    const live = await this.request<GlobalSearchResponse>(
      `/search?q=${encoded}&scope=${scope}`
    );
    if (live) return live;

    // Offline mock: search through local state
    const q = query.toLowerCase();
    const results: SearchResult[] = [];

    if (scope === "all" || scope === "employees") {
      this.employees
        .filter(
          (e) =>
            `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
            e.workEmail.toLowerCase().includes(q) ||
            e.designation?.toLowerCase().includes(q)
        )
        .slice(0, 5)
        .forEach((e) =>
          results.push({
            id: e.id,
            type: "employee",
            title: `${e.firstName} ${e.lastName}`,
            subtitle: e.designation || e.workEmail,
            url: "/directory",
            createdAt: e.createdAt,
          })
        );
    }

    if (scope === "all" || scope === "knowledge") {
      this.knowledgePages
        .filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.content.toLowerCase().includes(q) ||
            p.tags.some((t) => t.toLowerCase().includes(q))
        )
        .slice(0, 5)
        .forEach((p) =>
          results.push({
            id: p.id,
            type: "knowledge",
            title: p.title,
            subtitle: p.summary,
            url: "/knowledge",
            createdAt: p.createdAt,
          })
        );
    }

    if (scope === "all" || scope === "projects") {
      this.projects
        .filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.description?.toLowerCase().includes(q)
        )
        .slice(0, 5)
        .forEach((p) =>
          results.push({
            id: p.id,
            type: "project",
            title: p.name,
            subtitle: p.departmentName,
            url: "/projects",
            createdAt: p.createdAt,
          })
        );
    }

    if (scope === "all" || scope === "tickets") {
      this.tickets
        .filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.ticketNumber.toLowerCase().includes(q)
        )
        .slice(0, 5)
        .forEach((t) =>
          results.push({
            id: t.id,
            type: "ticket",
            title: t.title,
            subtitle: `${t.ticketNumber} · ${t.status}`,
            url: "/tickets",
            createdAt: t.createdAt,
          })
        );
    }

    if (scope === "all" || scope === "meetings") {
      this.meetings
        .filter(
          (m) =>
            m.title.toLowerCase().includes(q) ||
            m.agenda?.toLowerCase().includes(q)
        )
        .slice(0, 5)
        .forEach((m) =>
          results.push({
            id: m.id,
            type: "meeting",
            title: m.title,
            subtitle: m.meetingDate,
            url: "/meetings",
            createdAt: m.createdAt,
          })
        );
    }

    if (scope === "all" || scope === "files") {
      this.files
        .filter((f) => f.filename.toLowerCase().includes(q))
        .slice(0, 5)
        .forEach((f) =>
          results.push({
            id: f.id,
            type: "file",
            title: f.filename,
            subtitle: f.mimeType,
            url: "/storage",
            createdAt: f.createdAt,
          })
        );
    }

    return { results, totalCount: results.length, query, scope };
  }

  public async askSecondBrain(
    prompt: string,
    chatHistory: Array<{ role: "user" | "assistant"; content: string }> = []
  ): Promise<SecondBrainResponse> {
    const res = await http<{
      response: string;
      citations?: Array<{ title: string; source_type: string; snippet?: string; url?: string }>;
    }>(this.baseUrl, "/ai/query", {
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

  // --- Notifications & Preferences ---
  public async getNotifications(): Promise<{ data: AppNotification[]; unreadCount: number }> {
    const live = await this.request<{ data: AppNotification[]; unreadCount: number }>("/notifications");
    if (live) return live;
    return { data: [], unreadCount: 0 };
  }

  public async getUnreadNotificationsCount(): Promise<number> {
    const res = await this.request<{ unreadCount: number }>("/notifications/unread-count");
    return res?.unreadCount ?? 0;
  }

  public async markNotificationAsRead(id: string): Promise<void> {
    await this.request(`/notifications/${id}/read`, { method: "PATCH" });
  }

  public async markAllNotificationsAsRead(): Promise<void> {
    await this.request("/notifications/read-all", { method: "PATCH" });
  }

  public async getNotificationPreferences(): Promise<NotificationPreferences | null> {
    return this.requestData<NotificationPreferences>("/notifications/preferences");
  }

  public async updateNotificationPreferences(
    prefs: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences | null> {
    return this.requestData<NotificationPreferences>("/notifications/preferences", {
      method: "PUT",
      body: JSON.stringify(prefs),
    });
  }
}

export const api = new ApiService();
