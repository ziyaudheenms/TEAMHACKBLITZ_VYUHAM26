export type EntityId = string;

export interface BaseEntity {
  id: EntityId;
  organisationId: EntityId;
  createdBy: EntityId;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface Organisation {
  id: EntityId;
  name: string;
  slug: string;
  parentId?: EntityId | null;
  subsidiariesCount?: number;
  departmentsCount?: number;
  membersCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Department {
  id: EntityId;
  name: string;
  leadId?: EntityId;
  leadName?: string;
  description?: string;
  memberCount?: number;
}

export interface SkillItem {
  name: string;
  proficiency: "beginner" | "intermediate" | "expert";
  verified: boolean;
}

export interface EmployeeProfile extends BaseEntity {
  userId: EntityId;
  firstName: string;
  lastName: string;
  workEmail: string;
  avatarUrl?: string;
  departmentId?: EntityId;
  departmentName?: string;
  designation?: string;
  bio?: string;
  skills: SkillItem[];
  employmentStatus: "active" | "invited" | "suspended" | "offboarded";
  currentProjects?: string[];
  education?: string[];
  extractedFromCv?: boolean;
}

export interface KnowledgePage extends BaseEntity {
  title: string;
  slug: string;
  content: string;
  summary?: string;
  parentId?: EntityId | null;
  visibility: "public" | "internal" | "restricted";
  tags: string[];
  authorName: string;
  viewsCount?: number;
}

export interface StoredFile extends BaseEntity {
  filename: string;
  byteSize: number;
  mimeType: string;
  storagePath: string;
  visibility: "public" | "internal" | "restricted";
  uploadedByName: string;
  downloadUrl?: string;
  ocrStatus?: "none" | "pending" | "processing" | "completed" | "failed";
  summary?: string | null;
  tags?: string[];
  isUploadConfirmed?: boolean;
  chunkCount?: number;
}

export interface Project extends BaseEntity {
  name: string;
  description?: string;
  status: "planning" | "active" | "paused" | "completed";
  ownerId: EntityId;
  ownerName: string;
  progressPercent: number;
  departmentName: string;
  tasksCount: { total: number; done: number };
  dueDate: string;
}

export interface Task extends BaseEntity {
  title: string;
  description?: string;
  projectId?: EntityId;
  projectName?: string;
  primaryAssigneeId?: EntityId;
  assigneeName?: string;
  assigneeAvatar?: string;
  collaboratorIds: EntityId[];
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "blocked" | "in_review" | "done" | "cancelled";
  dueDate?: string;
  subtasks?: { id: string; title: string; completed: boolean }[];
}

export interface Ticket extends BaseEntity {
  ticketNumber: string;
  title: string;
  description: string;
  category: "it" | "access" | "infrastructure" | "hr" | "design" | "dev" | "finance" | "general";
  priority: "low" | "medium" | "high" | "urgent";
  status:
    | "open"
    | "assigned"
    | "acknowledged"
    | "in_progress"
    | "waiting"
    | "resolved"
    | "closed"
    | "reopened";
  requesterId: EntityId;
  requesterName: string;
  assigneeId?: EntityId;
  assigneeName?: string;
  slaTarget: string; // ISO string or human string
  slaBreached: boolean;
  comments?: Array<{
    id: string;
    author: string;
    avatar?: string;
    text: string;
    createdAt: string;
  }>;
}

export interface MeetingActionItem {
  id: string;
  title: string;
  assignee: string;
  dueDate: string;
  priority: "low" | "medium" | "high" | "urgent";
  convertedToTask?: boolean;
}

export interface Meeting extends BaseEntity {
  title: string;
  agenda?: string;
  meetingDate: string;
  durationMinutes: number;
  participantIds: EntityId[];
  participantNames: string[];
  projectId?: EntityId;
  projectName?: string;
  minutesContent?: string;
  aiSummary?: string;
  extractedActionItems: MeetingActionItem[];
}

export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  isAi?: boolean;
  content: string;
  createdAt: string;
  /** Sources the copilot used (AI replies only). */
  sources?: Array<{ title: string; url?: string; type: string }>;
  reactions?: { emoji: string; count: number; users: string[] }[];
}

export interface ChatChannel {
  id: string;
  name: string;
  description: string;
  isPrivate: boolean;
  memberCount: number;
  unreadCount?: number;
}

export type BrowserPermissionLevel = "B0" | "B1" | "B2" | "B3" | "B4";

export interface AgentRecord extends BaseEntity {
  name: string;
  role: string;
  description: string;
  instructions: string;
  model: string;
  browserPermission: BrowserPermissionLevel;
  status: "draft" | "submitted" | "reviewed" | "approved" | "active" | "suspended" | "retired";
  allowedDomains: string[];
  totalExecutions: number;
  successRate: number;
}

export interface AuditLogItem {
  id: string;
  actorName: string;
  actorType: "user" | "agent" | "system";
  action: string;
  targetResource: string;
  timestamp: string;
  status: "success" | "denied" | "warning";
}

export type NotificationCategory =
  | "task"
  | "ticket"
  | "mention"
  | "meeting"
  | "approval"
  | "system"
  | "project"
  | "document"
  | "agent";

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export interface AppNotification {
  id: string;
  organisationId: string;
  recipientId: string;
  actorId?: string | null;
  actorName?: string | null;
  category: NotificationCategory;
  title: string;
  body: string;
  linkUrl?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  priority: NotificationPriority;
  isRead: boolean;
  readAt?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface NotificationPreferences {
  id: string;
  organisationId: string;
  userId: string;
  emailNotifications: boolean;
  inAppNotifications: boolean;
  taskAssigned: boolean;
  ticketUpdates: boolean;
  mentions: boolean;
  approvalRequests: boolean;
  systemAnnouncements: boolean;
  dailyDigest: boolean;
  updatedAt: string;
}

export interface SearchResult {
  id: string;
  type: "employee" | "knowledge" | "project" | "ticket" | "meeting" | "file";
  title: string;
  subtitle?: string;
  snippet?: string;
  url: string;
  matchScore?: number;
  createdAt?: string;
}

export interface GlobalSearchResponse {
  results: SearchResult[];
  totalCount: number;
  query: string;
  scope: string;
}

export interface SecondBrainResponse {
  answer: string;
  sources: Array<{
    title: string;
    category: string;
    matchConfidence?: number;
    link?: string;
    snippet?: string;
  }>;
  suggestedActions?: Array<{
    label: string;
    actionType: string;
    payload: string;
  }>;
}
