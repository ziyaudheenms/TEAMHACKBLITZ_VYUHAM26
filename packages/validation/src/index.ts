import { z } from "zod";

// ---------------------------------------------------------------------------
// Departments (Section 9: /api/v1/departments)
// ---------------------------------------------------------------------------

export const CreateDepartmentSchema = z.object({
  name: z.string().min(1, "Name is required").max(255, "Name must be 255 characters or fewer"),
  description: z.string().max(1000).optional(),
  headId: z.string().uuid("headId must be a valid UUID").optional(),
  parentDepartmentId: z.string().uuid("parentDepartmentId must be a valid UUID").optional(),
});

export const UpdateDepartmentSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name must be 255 characters or fewer")
    .optional(),
  description: z.string().max(1000).nullable().optional(),
  headId: z.string().uuid("headId must be a valid UUID").nullable().optional(),
  parentDepartmentId: z
    .string()
    .uuid("parentDepartmentId must be a valid UUID")
    .nullable()
    .optional(),
});

export const DepartmentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(255).optional(),
});

export const AddDepartmentMemberSchema = z.object({
  employeeProfileId: z.string().uuid("employeeProfileId must be a valid UUID"),
  role: z.enum(["head", "member"]).default("member"),
});

// ---------------------------------------------------------------------------
// Organisations & Projects
// ---------------------------------------------------------------------------

export const CreateOrganisationSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  parentId: z.string().uuid().optional(),
});

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  projectId: z.string().uuid().optional(),
  primaryAssigneeId: z.string().uuid().optional(),
  collaboratorIds: z.array(z.string().uuid()).default([]),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  dueDate: z.string().datetime().optional(),
});

export const CreateTicketSchema = z.object({
  title: z.string().min(1, "Title is required").max(255),
  description: z.string().min(1, "Description is required"),
  category: z.enum([
    "it",
    "access",
    "infrastructure",
    "hr",
    "design",
    "dev",
    "finance",
    "general",
  ]).default("general"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  assigneeId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  slaTarget: z.string().optional(),
});

export const UpdateTicketSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().min(1).optional(),
  category: z
    .enum(["it", "access", "infrastructure", "hr", "design", "dev", "finance", "general"])
    .optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  status: z
    .enum([
      "open",
      "assigned",
      "acknowledged",
      "in_progress",
      "waiting",
      "resolved",
      "closed",
      "reopened",
    ])
    .optional(),
  resolutionNotes: z.string().max(2000).nullable().optional(),
});

export const UpdateTicketStatusSchema = z.object({
  status: z.enum([
    "open",
    "assigned",
    "acknowledged",
    "in_progress",
    "waiting",
    "resolved",
    "closed",
    "reopened",
  ]),
  resolutionNotes: z.string().max(2000).optional(),
});

export const AddTicketCommentSchema = z.object({
  text: z.string().min(1, "Comment text is required").max(5000),
  isInternal: z.boolean().default(false),
});

export const TicketQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  category: z
    .enum(["it", "access", "infrastructure", "hr", "design", "dev", "finance", "general"])
    .optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  status: z
    .enum([
      "open",
      "assigned",
      "acknowledged",
      "in_progress",
      "waiting",
      "resolved",
      "closed",
      "reopened",
    ])
    .optional(),
  assigneeId: z.string().uuid().optional(),
  requesterId: z.string().uuid().optional(),
  search: z.string().max(255).optional(),
});

// ---------------------------------------------------------------------------
// Auth (Section 9: /api/v1/auth)
// ---------------------------------------------------------------------------

export const SignUpSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().max(100).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1).max(2048),
});

// ---------------------------------------------------------------------------
// Employee Documents (Section 9: /api/v1/employee-documents)
// ---------------------------------------------------------------------------

export const EmployeeDocumentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  employeeProfileId: z.string().uuid().optional(),
  documentType: z.enum(["cv", "certificate", "portfolio", "other"]).optional(),
  verificationStatus: z.enum(["unverified", "verified", "rejected"]).optional(),
});

export const InitiateUploadSchema = z.object({
  employeeProfileId: z.string().uuid(),
  documentType: z.enum(["cv", "certificate", "portfolio", "other"]),
  title: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  filename: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(100),
  byteSize: z.number().int().min(1).max(52428800), // 50 MB max
  visibility: z.enum(["restricted", "internal"]).default("restricted"),
});

export const ConfirmUploadSchema = z.object({
  storagePath: z.string().min(1),
});

export const VerifyDocumentSchema = z.object({
  status: z.enum(["verified", "rejected"]),
  notes: z.string().max(1000).optional(),
});

export const UpdateDocumentMetaSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  visibility: z.enum(["restricted", "internal"]).optional(),
});

// ---------------------------------------------------------------------------
// Employees (Section 8.1, 2.2, MVP)
// ---------------------------------------------------------------------------

export const CreateEmployeeSchema = z.object({
  organisationId: z.string().uuid(),
  userId: z.string().uuid(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100),
  workEmail: z.string().email().max(254),
  departmentId: z.string().uuid().optional(),
  designation: z.string().max(150).optional(),
  employmentStatus: z.enum(["active", "invited", "suspended", "offboarded"]).default("active"),
});

// ---------------------------------------------------------------------------
// Knowledge pages (Section 2.3, 8.2, MVP)
// ---------------------------------------------------------------------------

export const CreateKnowledgePageSchema = z.object({
  organisationId: z.string().uuid(),
  title: z.string().min(1).max(255),
  content: z.string().max(100000).optional(),
  parentId: z.string().uuid().optional(),
  visibility: z.enum(["public", "internal", "restricted"]).default("internal"),
});

// ---------------------------------------------------------------------------
// Asset Storage Files (Section 2.4, 8.2, 9: /api/v1/files)
// ---------------------------------------------------------------------------

export const FileQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  projectId: z.string().uuid().optional(),
  folderPath: z.string().optional(),
  visibility: z.enum(["public", "internal", "restricted"]).optional(),
  mimeType: z.string().optional(),
  search: z.string().max(255).optional(),
});

export const InitiateFileUploadSchema = z.object({
  filename: z.string().min(1, "Filename is required").max(500),
  mimeType: z.string().min(1, "MIME type is required").max(100),
  byteSize: z.number().int().min(0).max(104857600), // 100 MB max
  visibility: z.enum(["public", "internal", "restricted"]).default("internal"),
  projectId: z.string().uuid().optional(),
  folderPath: z.string().default("/"),
  tags: z.array(z.string().max(50)).default([]),
  summary: z.string().max(2000).optional(),
});

export const ConfirmFileUploadSchema = z.object({
  storagePath: z.string().min(1).optional(),
});

export const UpdateFileMetaSchema = z.object({
  filename: z.string().min(1).max(500).optional(),
  folderPath: z.string().optional(),
  visibility: z.enum(["public", "internal", "restricted"]).optional(),
  tags: z.array(z.string().max(50)).optional(),
  summary: z.string().max(2000).nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
});

export const CreateFilePermissionSchema = z.object({
  granteeType: z.enum(["user", "role", "department"]),
  granteeId: z.string().uuid(),
  permission: z.enum(["view", "download", "edit", "admin"]),
});

// ---------------------------------------------------------------------------
// Notifications & Preferences (Section 2.9, 8.3, 9: /api/v1/notifications)
// ---------------------------------------------------------------------------

export const NotificationCategoryEnum = z.enum([
  "task",
  "ticket",
  "mention",
  "meeting",
  "approval",
  "system",
  "project",
  "document",
  "agent",
]);

export const NotificationPriorityEnum = z.enum(["low", "normal", "high", "urgent"]);

export const NotificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  isRead: z
    .enum(["true", "false"])
    .transform((val) => val === "true")
    .optional(),
  category: NotificationCategoryEnum.optional(),
});

export const CreateNotificationSchema = z.object({
  recipientId: z.string().uuid("recipientId must be a valid UUID"),
  category: NotificationCategoryEnum,
  title: z.string().min(1, "Title is required").max(255),
  body: z.string().min(1, "Body is required").max(5000),
  linkUrl: z.string().max(1000).optional(),
  resourceType: z.string().max(50).optional(),
  resourceId: z.string().uuid().optional(),
  priority: NotificationPriorityEnum.default("normal"),
  metadata: z.record(z.unknown()).optional(),
});

export const UpdateNotificationPreferencesSchema = z.object({
  emailNotifications: z.boolean().optional(),
  inAppNotifications: z.boolean().optional(),
  taskAssigned: z.boolean().optional(),
  ticketUpdates: z.boolean().optional(),
  mentions: z.boolean().optional(),
  approvalRequests: z.boolean().optional(),
  systemAnnouncements: z.boolean().optional(),
  dailyDigest: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Meetings & Minutes (Section 2.7, 8.3, 9: /api/v1/meetings)
// ---------------------------------------------------------------------------

export const MeetingActionItemPriorityEnum = z.enum(["low", "medium", "high", "urgent"]);

export const CreateMeetingActionItemSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  assignee: z.string().min(1, "Assignee is required").max(255),
  assigneeId: z.string().uuid().optional(),
  dueDate: z.string().optional(),
  priority: MeetingActionItemPriorityEnum.default("medium"),
});

export const UpdateMeetingActionItemSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  assignee: z.string().min(1).max(255).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  priority: MeetingActionItemPriorityEnum.optional(),
  convertedToTask: z.boolean().optional(),
});

export const CreateMeetingSchema = z.object({
  title: z.string().min(1, "Title is required").max(255),
  agenda: z.string().max(2000).optional(),
  meetingDate: z.string().min(1, "Meeting date is required"),
  durationMinutes: z.coerce.number().int().min(1).max(1440).default(30),
  projectId: z.string().uuid().optional(),
  participantIds: z.array(z.string()).default([]),
  participantNames: z.array(z.string()).default([]),
  minutesContent: z.string().max(100000).optional(),
  aiSummary: z.string().max(5000).optional(),
  actionItems: z.array(CreateMeetingActionItemSchema).optional(),
});

export const UpdateMeetingSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  agenda: z.string().max(2000).nullable().optional(),
  meetingDate: z.string().optional(),
  durationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  projectId: z.string().uuid().nullable().optional(),
  participantIds: z.array(z.string()).optional(),
  participantNames: z.array(z.string()).optional(),
  minutesContent: z.string().max(100000).nullable().optional(),
  aiSummary: z.string().max(5000).nullable().optional(),
});

export const MeetingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  projectId: z.string().uuid().optional(),
  search: z.string().max(255).optional(),
});

export const ExtractActionItemsSchema = z.object({
  minutesContent: z.string().max(100000).optional(),
  forceRegenerate: z.boolean().default(false),
});

export const ConvertActionItemToTaskSchema = z.object({
  projectId: z.string().uuid().optional(),
  primaryAssigneeId: z.string().uuid().optional(),
  status: z.enum(["open", "in_progress", "in_review", "blocked", "done", "cancelled"]).default("open"),
});
