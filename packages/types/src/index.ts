/**
 * Core Domain Types for BizContext AI
 * Mapped directly to Section 8 of IMPLEMENTATION.md
 */

export type EntityId = string;

export interface BaseEntity {
  id: EntityId;
  organisationId: EntityId;
  createdBy: EntityId;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

// 8.1 Core Organisation and People
export interface Organisation {
  id: EntityId;
  name: string;
  slug: string;
  parentId?: EntityId | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Department — belongs to one Organisation, optionally nested under a parent department.
 * Mapped to the `departments` table (Section 8.1).
 */
export interface Department {
  id: EntityId;
  organisationId: EntityId;
  name: string;
  description?: string | null;
  /** The employee profile that leads / heads this department */
  headId?: EntityId | null;
  /** Enables sub-department nesting */
  parentDepartmentId?: EntityId | null;
  createdBy?: EntityId | null;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight member record linking an employee profile to a department */
export interface DepartmentMember {
  id: EntityId;
  departmentId: EntityId;
  employeeProfileId: EntityId;
  role: "head" | "member";
  addedAt: string;
}

export interface EmployeeProfile extends BaseEntity {
  userId: EntityId;
  firstName: string;
  lastName: string;
  workEmail: string;
  departmentId?: EntityId;
  designation?: string;
  skills: Array<{
    name: string;
    proficiency: "beginner" | "intermediate" | "expert";
    verified: boolean;
  }>;
  employmentStatus: "active" | "invited" | "suspended" | "offboarded";
}

// 8.2 Knowledge and Asset
export interface KnowledgePage extends BaseEntity {
  title: string;
  slug: string;
  content: string; // Markdown or block structure
  parentId?: EntityId | null;
  visibility: "public" | "internal" | "restricted";
}

export interface StoredFile extends BaseEntity {
  filename: string;
  byteSize: number;
  mimeType: string;
  storagePath: string;
  visibility: "public" | "internal" | "restricted";
  projectId?: EntityId | null;
  folderPath?: string;
  isUploadConfirmed?: boolean;
  tags?: string[];
  summary?: string | null;
  ocrStatus?: "none" | "pending" | "processing" | "completed" | "failed";
  ocrText?: string | null;
  uploadedByName?: string;
  downloadUrl?: string;
}

export interface FileVersion {
  id: EntityId;
  fileId: EntityId;
  versionNumber: number;
  storagePath: string;
  byteSize: number;
  createdBy: EntityId;
  createdAt: string;
}

export interface FilePermission {
  id: EntityId;
  fileId: EntityId;
  granteeType: "user" | "role" | "department";
  granteeId: EntityId;
  permission: "view" | "download" | "edit" | "admin";
  createdAt: string;
}

// 8.3 Work & Collaboration
export interface Project extends BaseEntity {
  name: string;
  description?: string;
  status: "planning" | "active" | "paused" | "completed";
  ownerId: EntityId;
}

export interface Task extends BaseEntity {
  title: string;
  description?: string;
  projectId?: EntityId;
  primaryAssigneeId?: EntityId;
  collaboratorIds: EntityId[];
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "blocked" | "in_review" | "done" | "cancelled";
  dueDate?: string;
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
  requesterName?: string;
  assigneeId?: EntityId;
  assigneeName?: string;
  departmentId?: EntityId | null;
  slaTarget?: string;
  slaBreached?: boolean;
  resolutionNotes?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  comments?: TicketComment[];
}

export interface TicketComment {
  id: EntityId;
  ticketId: EntityId;
  authorId: EntityId;
  authorName: string;
  avatar?: string | null;
  text: string;
  isInternal: boolean;
  createdAt: string;
}

export interface TicketActivity {
  id: EntityId;
  ticketId: EntityId;
  actorId: EntityId;
  action: string;
  details?: Record<string, unknown> | null;
  createdAt: string;
}

export interface Meeting extends BaseEntity {
  title: string;
  agenda?: string;
  meetingDate: string;
  participantIds: EntityId[];
  projectId?: EntityId;
  minutesContent?: string;
}

// 8.4 AI, Agent & Browser
export type BrowserPermissionLevel = "B0" | "B1" | "B2" | "B3" | "B4";

export interface AgentRecord extends BaseEntity {
  name: string;
  description: string;
  instructions: string;
  model: string;
  browserPermission: BrowserPermissionLevel;
  status: "draft" | "submitted" | "reviewed" | "approved" | "active" | "suspended" | "retired";
  allowedDomains: string[];
}

// ---------------------------------------------------------------------------
// 8.5 Employee Documents
// ---------------------------------------------------------------------------

/**
 * Represents a document attached to an employee profile.
 * Actual file bytes live in Supabase Storage; this record holds metadata only.
 * The storagePath must NEVER be exposed publicly — always use signed URLs.
 */
export interface EmployeeDocument extends BaseEntity {
  employeeProfileId: EntityId;

  /** Broad classification of the document's purpose */
  documentType: "cv" | "certificate" | "portfolio" | "other";

  title: string;
  description?: string | null;

  /** Supabase Storage object key — server-side only */
  storagePath: string;

  filename: string;
  mimeType: string;

  /** File size in bytes */
  byteSize: number;

  /** True once the client has finished uploading bytes to the signed URL */
  isUploadConfirmed: boolean;

  /** Reviewer-set status; starts as 'unverified' */
  verificationStatus: "unverified" | "verified" | "rejected";

  /** Auth user id of the person who verified/rejected the document */
  verifiedBy?: EntityId | null;
  verifiedAt?: string | null;

  /** Lifecycle of the AI extraction pipeline */
  extractionStatus: "pending" | "processing" | "completed" | "failed" | "skipped";

  /**
   * AI-extracted fields (e.g. parsed CV data).
   * Always treated as unverified until an authorised reviewer confirms.
   */
  extractedData?: Record<string, unknown> | null;

  /** Controls who inside the organisation can see this document */
  visibility: "restricted" | "internal";
}

/**
 * Immutable audit trail entry for sensitive document access events.
 * Append-only — rows must never be updated or deleted.
 */
export interface AuditLog {
  id: EntityId;
  organisationId: EntityId;

  /** Auth user id of the person performing the action */
  actorId: EntityId;

  /** Domain object being acted on, e.g. 'employee_document' */
  resourceType: string;

  /** Primary key of the affected resource */
  resourceId: EntityId;

  /** Action performed, e.g. 'view' | 'download' | 'verify' | 'delete' */
  action: string;

  /** Arbitrary extra context captured at the time of the event */
  metadata?: Record<string, unknown> | null;

  createdAt: string;
}

// ---------------------------------------------------------------------------
// 8.6 Notifications & Preferences
// ---------------------------------------------------------------------------

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
  id: EntityId;
  organisationId: EntityId;
  recipientId: EntityId;
  actorId?: EntityId | null;
  actorName?: string | null;
  category: NotificationCategory;
  title: string;
  body: string;
  linkUrl?: string | null;
  resourceType?: string | null;
  resourceId?: EntityId | null;
  priority: NotificationPriority;
  isRead: boolean;
  readAt?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface NotificationPreferences {
  id: EntityId;
  organisationId: EntityId;
  userId: EntityId;
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
