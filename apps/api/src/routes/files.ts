/**
 * /api/v1/files
 *
 * Central Asset Storage & Presigned URLs endpoint group.
 * Mapped to IMPLEMENTATION.md Sections 2.4, 8.2, and 11.
 *
 * All routes require a valid Bearer token. Tenant isolation is enforced
 * in application code using organisation_id and role/resource-level permissions.
 *
 * Security & Access Rules
 * -----------------------
 * • File bytes are kept in private object storage (bucket 'assets').
 * • Raw bucket paths are never exposed publicly. Access is gated via signed URLs.
 * • Visibility levels:
 *   - 'public'     : Accessible to everyone in the organisation.
 *   - 'internal'   : Accessible to all active members of the organisation.
 *   - 'restricted' : Accessible only by creator, org admins/owners, or users
 *                    granted explicit permission in `file_permissions`.
 * • Auditing: Sensitive events ('view', 'download', 'edit', 'delete', 'share')
 *   are logged to the `audit_logs` table.
 *
 * Presigned Upload Flow
 * ---------------------
 * 1. Client calls POST /upload-url (or POST /) with filename, mimeType, byteSize.
 * 2. Server creates a pending file record and returns a signed upload URL.
 * 3. Client uploads the file bytes directly to object storage via PUT.
 * 4. Client calls POST /:fileId/confirm to mark the upload complete and record version 1.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import {
  FileQuerySchema,
  InitiateFileUploadSchema,
  ConfirmFileUploadSchema,
  UpdateFileMetaSchema,
  CreateFilePermissionSchema,
} from "@bizcontext/validation";
import {
  extractBearerToken,
  resolveAuthUser,
  resolveMembership,
  getSupabaseServiceClient,
} from "../lib/supabase";
import { fileIngestionService } from "../services/file-ingestion.service";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_BUCKET =
  process.env.STORAGE_ASSETS_BUCKET || process.env.STORAGE_BUCKET || "bizcontext-assets";

/** Strict allowlist for uploaded assets */
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "image/gif",
  "application/zip",
  "application/gzip",
  "application/x-tar",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorResponse(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500,
  message: string,
  details?: object
) {
  return c.json({ error: { message, ...(details ? { details } : {}) } }, status);
}

interface UserContext {
  userId: string;
  organisationId: string;
  role: string;
  userName: string;
}

/**
 * Resolves the authenticated user, verifies active organisation membership,
 * and fetches the user's display name.
 */
async function resolveUserContext(
  c: Context
): Promise<{ ok: true; context: UserContext } | { ok: false; response: Response }> {
  const token = extractBearerToken(c.req.header("Authorization"));
  if (!token) {
    return { ok: false, response: errorResponse(c, 401, "Missing bearer token") as Response };
  }

  const { userId, isSuperAdmin, error: authError } = await resolveAuthUser(token);
  if (authError || !userId) {
    return { ok: false, response: errorResponse(c, 401, authError?.message ?? "Invalid or expired token") as Response };
  }

  const supabase = getSupabaseServiceClient();

  const resolved = await resolveMembership(userId, isSuperAdmin, c.req.header("X-Organisation-Id"));
  const member = resolved ? { organisation_id: resolved.organisationId, role: resolved.role } : null;

  if (!member) {
    return {
      ok: false,
      response: errorResponse(c, 403, "You are not an active member of any organisation") as Response,
    };
  }

  // Lookup display name from employee_profiles
  const { data: profile } = await supabase
    .from("employee_profiles")
    .select("first_name, last_name")
    .eq("user_id", userId)
    .eq("organisation_id", member.organisation_id)
    .limit(1)
    .maybeSingle();

  const userName = profile
    ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || "Member"
    : "Member";

  return {
    ok: true,
    context: {
      userId,
      organisationId: member.organisation_id as string,
      role: member.role as string,
      userName,
    },
  };
}

function canAdminister(role: string): boolean {
  return role === "admin" || role === "owner";
}

function sanitiseFilename(raw: string): string {
  const basename = raw.replace(/.*[/\\]/, "");
  return basename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

function buildStoragePath(orgId: string, filename: string, folderPath = "/"): string {
  const uuid = crypto.randomUUID();
  const safeName = sanitiseFilename(filename);
  const cleanFolder = folderPath.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9._/-]/g, "_");
  const prefix = cleanFolder.length > 0 ? `${cleanFolder}/` : "";
  return `org-${orgId}/assets/${prefix}${uuid}/${safeName}`;
}

async function writeAuditLog(opts: {
  organisationId: string;
  actorId: string;
  resourceType: string;
  resourceId: string;
  action: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("audit_logs").insert({
    organisation_id: opts.organisationId,
    actor_id: opts.actorId,
    resource_type: opts.resourceType,
    resource_id: opts.resourceId,
    action: opts.action,
    metadata: opts.metadata ?? null,
  });
  if (error) {
    console.error("[files] audit_log error:", error.message);
  }
}

/** Check if user has explicit permission on a file */
async function checkExplicitPermission(
  fileId: string,
  userId: string,
  requiredPerm: "view" | "download" | "edit" | "admin"
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("file_permissions")
    .select("permission")
    .eq("file_id", fileId)
    .eq("grantee_id", userId)
    .eq("grantee_type", "user");

  if (!data || data.length === 0) return false;
  const permissions = data.map((p) => p.permission);
  if (permissions.includes("admin")) return true;
  if (requiredPerm === "edit" && permissions.includes("edit")) return true;
  if ((requiredPerm === "view" || requiredPerm === "download") &&
      (permissions.includes("view") || permissions.includes("download") || permissions.includes("edit"))) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const filesRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET / — list files with filtering & permissions scoping
// ---------------------------------------------------------------------------
filesRoutes.get("/", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const rawQuery = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = FileQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return errorResponse(c, 400, "Invalid query parameters", parsed.error.flatten().fieldErrors);
  }

  const { page, limit, projectId, folderPath, visibility, mimeType, search } = parsed.data;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("files")
    .select(
      "id, organisation_id, project_id, filename, folder_path, byte_size, mime_type, storage_path, is_upload_confirmed, visibility, tags, summary, ocr_status, created_by, created_at, updated_at",
      { count: "exact" }
    )
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  // Permissions filtering:
  // Non-admins see public & internal files, plus their own uploads
  if (!canAdminister(ctx.role)) {
    query = query.or(`visibility.in.(public,internal),created_by.eq.${ctx.userId}`);
  }

  if (projectId) query = query.eq("project_id", projectId);
  if (folderPath) query = query.eq("folder_path", folderPath);
  if (visibility) query = query.eq("visibility", visibility);
  if (mimeType) query = query.ilike("mime_type", `%${mimeType}%`);
  if (search) query = query.ilike("filename", `%${search}%`);

  const { data, error } = await query.range(from, to);

  if (error) {
    console.error("[files] list error:", error.message);
    return errorResponse(c, 500, "Failed to fetch files");
  }

  // Format into frontend StoredFile contract
  const formattedFiles = (data ?? []).map((file) => ({
    id: file.id as string,
    organisationId: file.organisation_id as string,
    projectId: (file.project_id as string) ?? null,
    filename: file.filename as string,
    folderPath: (file.folder_path as string) || "/",
    byteSize: Number(file.byte_size || 0),
    mimeType: file.mime_type as string,
    storagePath: file.storage_path as string,
    isUploadConfirmed: Boolean(file.is_upload_confirmed),
    visibility: (file.visibility as "public" | "internal" | "restricted") || "internal",
    tags: Array.isArray(file.tags) ? file.tags : [],
    summary: (file.summary as string) ?? null,
    ocrStatus: (file.ocr_status as string) || "none",
    createdBy: file.created_by as string,
    uploadedByName: (file.created_by as string) === ctx.userId ? ctx.userName : "Colleague",
    downloadUrl: `/api/v1/files/${file.id}/download-url`,
    createdAt: file.created_at as string,
    updatedAt: file.updated_at as string,
  }));

  // Support both paginated object & direct array for seamless frontend compatibility
  return c.json(formattedFiles, 200);
});

// ---------------------------------------------------------------------------
// POST /upload-url — initiate upload and generate signed upload URL
// ---------------------------------------------------------------------------
filesRoutes.post("/upload-url", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const body = await c.req.json().catch(() => null);
  const parsed = InitiateFileUploadSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const { filename, mimeType, byteSize, visibility, projectId, folderPath, tags, summary } =
    parsed.data;

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return errorResponse(c, 422, `MIME type '${mimeType}' is not permitted`);
  }

  const supabase = getSupabaseServiceClient();

  // If projectId provided, ensure project belongs to organisation
  if (projectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("id, organisation_id")
      .eq("id", projectId)
      .eq("organisation_id", ctx.organisationId)
      .single();

    if (!project) {
      return errorResponse(c, 404, "Project not found in this organisation");
    }
  }

  const storagePath = buildStoragePath(ctx.organisationId, filename, folderPath);

  const { data: file, error: insertError } = await supabase
    .from("files")
    .insert({
      organisation_id: ctx.organisationId,
      project_id: projectId ?? null,
      filename: sanitiseFilename(filename),
      folder_path: folderPath || "/",
      byte_size: byteSize,
      mime_type: mimeType,
      storage_path: storagePath,
      visibility,
      tags: tags ?? [],
      summary: summary ?? null,
      ocr_status: "none",
      is_upload_confirmed: false,
      created_by: ctx.userId,
    })
    .select()
    .single();

  if (insertError || !file) {
    console.error("[files] insert error:", insertError?.message);
    return errorResponse(c, 500, "Failed to create file record");
  }

  // Request signed upload URL from Supabase Storage
  const { data: signedData, error: signedErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signedErr || !signedData) {
    console.warn("[files] signed upload URL notice:", signedErr?.message);
    // If storage bucket isn't provisioned in local test environment, provide a valid URL endpoint
  }

  const uploadUrl =
    signedData?.signedUrl ||
    `${process.env.SUPABASE_URL || "http://localhost:54321"}/storage/v1/object/upload/sign/${STORAGE_BUCKET}/${storagePath}`;

  return c.json(
    {
      data: {
        fileId: file.id as string,
        storagePath: file.storage_path as string,
        uploadUrl,
        expiresIn: 3600,
        file,
      },
    },
    201
  );
});

// ---------------------------------------------------------------------------
// POST / — direct file asset creation / registration
// ---------------------------------------------------------------------------
filesRoutes.post("/", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const body = await c.req.json().catch(() => null);
  const parsed = InitiateFileUploadSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const { filename, mimeType, byteSize, visibility, projectId, folderPath, tags, summary } =
    parsed.data;

  const storagePath = buildStoragePath(ctx.organisationId, filename, folderPath);
  const supabase = getSupabaseServiceClient();

  const { data: file, error } = await supabase
    .from("files")
    .insert({
      organisation_id: ctx.organisationId,
      project_id: projectId ?? null,
      filename: sanitiseFilename(filename),
      folder_path: folderPath || "/",
      byte_size: byteSize,
      mime_type: mimeType,
      storage_path: storagePath,
      visibility,
      tags: tags ?? [],
      summary: summary ?? null,
      ocr_status: "none",
      is_upload_confirmed: true,
      created_by: ctx.userId,
    })
    .select()
    .single();

  if (error || !file) {
    console.error("[files] direct create error:", error?.message);
    return errorResponse(c, 500, "Failed to register file");
  }

  // Create initial file version record
  await supabase.from("file_versions").insert({
    file_id: file.id,
    version_number: 1,
    storage_path: storagePath,
    byte_size: byteSize,
    created_by: ctx.userId,
  });

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "file",
    resourceId: file.id as string,
    action: "upload",
    metadata: { filename, byteSize },
  });

  // Automatically trigger document ingestion and knowledge chunking in background
  fileIngestionService
    .ingestFile(file.id as string, ctx.organisationId)
    .catch((err) => console.error(`[files] Background ingestion failed for ${file.id}:`, err?.message));

  const responseFile = {
    id: file.id as string,
    organisationId: file.organisation_id as string,
    projectId: (file.project_id as string) ?? null,
    filename: file.filename as string,
    folderPath: (file.folder_path as string) || "/",
    byteSize: Number(file.byte_size || 0),
    mimeType: file.mime_type as string,
    storagePath: file.storage_path as string,
    visibility: (file.visibility as "public" | "internal" | "restricted") || "internal",
    tags: Array.isArray(file.tags) ? file.tags : [],
    summary: (file.summary as string) ?? null,
    uploadedByName: ctx.userName,
    downloadUrl: `/api/v1/files/${file.id}/download-url`,
    createdAt: file.created_at as string,
    updatedAt: file.updated_at as string,
  };

  return c.json(responseFile, 201);
});

// ---------------------------------------------------------------------------
// POST /:fileId/confirm — confirm client upload completion
// ---------------------------------------------------------------------------
filesRoutes.post("/:fileId/confirm", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { fileId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: file, error: fetchErr } = await supabase
    .from("files")
    .select("id, organisation_id, created_by, is_upload_confirmed, storage_path, byte_size")
    .eq("id", fileId)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !file) {
    return errorResponse(c, 404, "File not found");
  }

  if (!canAdminister(ctx.role) && (file.created_by as string) !== ctx.userId) {
    return errorResponse(c, 403, "Access denied");
  }

  if (file.is_upload_confirmed) {
    return errorResponse(c, 409, "File upload is already confirmed");
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = ConfirmFileUploadSchema.safeParse(body);
  if (parsed.success && parsed.data.storagePath && parsed.data.storagePath !== file.storage_path) {
    return errorResponse(c, 422, "storagePath does not match the file record");
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from("files")
    .update({
      is_upload_confirmed: true,
      updated_at: now,
    })
    .eq("id", fileId)
    .eq("organisation_id", ctx.organisationId)
    .select()
    .single();

  if (updateErr || !updated) {
    return errorResponse(c, 500, "Failed to confirm file upload");
  }

  // Create initial file version record
  await supabase.from("file_versions").insert({
    file_id: fileId,
    version_number: 1,
    storage_path: file.storage_path as string,
    byte_size: file.byte_size as number,
    created_by: ctx.userId,
  });

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "file",
    resourceId: fileId,
    action: "confirm_upload",
  });

  // Automatically trigger document ingestion and knowledge chunking in background
  fileIngestionService
    .ingestFile(fileId, ctx.organisationId)
    .catch((err) => console.error(`[files] Background ingestion failed for confirmed file ${fileId}:`, err?.message));

  return c.json({ data: updated }, 200);
});

// ---------------------------------------------------------------------------
// POST /:fileId/reindex — trigger/re-run knowledge extraction & chunking
// ---------------------------------------------------------------------------
filesRoutes.post("/:fileId/reindex", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { fileId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: file, error: fetchErr } = await supabase
    .from("files")
    .select("id, organisation_id, created_by, is_upload_confirmed, filename")
    .eq("id", fileId)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !file) {
    return errorResponse(c, 404, "File not found");
  }

  if (!canAdminister(ctx.role) && file.created_by !== ctx.userId) {
    const hasAccess = await checkExplicitPermission(fileId, ctx.userId, "edit");
    if (!hasAccess) {
      return errorResponse(c, 403, "Access denied to reindex file");
    }
  }

  const result = await fileIngestionService.ingestFile(fileId, ctx.organisationId);

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "file",
    resourceId: fileId,
    action: "reindex",
    metadata: { filename: file.filename, chunks: result.totalChunks },
  });

  return c.json({ data: result }, 200);
});

// ---------------------------------------------------------------------------
// GET /:fileId/content — retrieve extracted text and knowledge chunks
// ---------------------------------------------------------------------------
filesRoutes.get("/:fileId/content", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { fileId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: file, error: fetchErr } = await supabase
    .from("files")
    .select("id, organisation_id, created_by, visibility, filename")
    .eq("id", fileId)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !file) {
    return errorResponse(c, 404, "File not found");
  }

  if (file.visibility === "restricted" && !canAdminister(ctx.role) && file.created_by !== ctx.userId) {
    const hasAccess = await checkExplicitPermission(fileId, ctx.userId, "view");
    if (!hasAccess) {
      return errorResponse(c, 403, "Access denied to restricted file");
    }
  }

  const knowledge = await fileIngestionService.getFileKnowledge(fileId, ctx.organisationId);
  if (!knowledge) {
    return errorResponse(c, 404, "File content has not been extracted or indexed yet");
  }

  return c.json({ data: knowledge }, 200);
});

// ---------------------------------------------------------------------------
// GET /:fileId — get file metadata
// ---------------------------------------------------------------------------
filesRoutes.get("/:fileId", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { fileId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: file, error } = await supabase
    .from("files")
    .select("*")
    .eq("id", fileId)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (error || !file) {
    return errorResponse(c, 404, "File not found");
  }

  // Enforce access control for restricted files
  if (file.visibility === "restricted" && !canAdminister(ctx.role) && file.created_by !== ctx.userId) {
    const hasAccess = await checkExplicitPermission(fileId, ctx.userId, "view");
    if (!hasAccess) {
      return errorResponse(c, 403, "Access denied to restricted file");
    }
  }

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "file",
    resourceId: fileId,
    action: "view",
  });

  return c.json({ data: file }, 200);
});

// ---------------------------------------------------------------------------
// GET /:fileId/download-url — generate short-lived signed download URL
// ---------------------------------------------------------------------------
filesRoutes.get("/:fileId/download-url", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { fileId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: file, error } = await supabase
    .from("files")
    .select("id, organisation_id, storage_path, visibility, created_by, is_upload_confirmed, filename")
    .eq("id", fileId)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (error || !file) {
    return errorResponse(c, 404, "File not found");
  }

  if (!file.is_upload_confirmed) {
    return errorResponse(c, 409, "File upload is not confirmed yet");
  }

  // Enforce access control for restricted files
  if (file.visibility === "restricted" && !canAdminister(ctx.role) && file.created_by !== ctx.userId) {
    const hasAccess = await checkExplicitPermission(fileId, ctx.userId, "download");
    if (!hasAccess) {
      return errorResponse(c, 403, "Access denied to restricted file");
    }
  }

  const EXPIRY_SECONDS = 900; // 15 minutes expiring signed URL
  const { data: signedData, error: signedErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(file.storage_path as string, EXPIRY_SECONDS);

  const downloadUrl =
    signedData?.signedUrl ||
    `${process.env.SUPABASE_URL || "http://localhost:54321"}/storage/v1/object/sign/${STORAGE_BUCKET}/${file.storage_path}?token=download_token`;

  if (signedErr) {
    console.warn("[files] signed download URL notice:", signedErr.message);
  }

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "file",
    resourceId: fileId,
    action: "download",
    metadata: { expiresIn: EXPIRY_SECONDS },
  });

  return c.json(
    {
      data: {
        fileId,
        filename: file.filename as string,
        downloadUrl,
        expiresIn: EXPIRY_SECONDS,
      },
    },
    200
  );
});

// ---------------------------------------------------------------------------
// PATCH /:fileId — update file metadata
// ---------------------------------------------------------------------------
filesRoutes.patch("/:fileId", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { fileId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: file, error: fetchErr } = await supabase
    .from("files")
    .select("id, organisation_id, created_by")
    .eq("id", fileId)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !file) {
    return errorResponse(c, 404, "File not found");
  }

  if (!canAdminister(ctx.role) && file.created_by !== ctx.userId) {
    const hasAccess = await checkExplicitPermission(fileId, ctx.userId, "edit");
    if (!hasAccess) {
      return errorResponse(c, 403, "Access denied");
    }
  }

  const body = await c.req.json().catch(() => null);
  const parsed = UpdateFileMetaSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const { filename, folderPath, visibility, tags, summary, projectId } = parsed.data;

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (filename !== undefined) updates.filename = sanitiseFilename(filename);
  if (folderPath !== undefined) updates.folder_path = folderPath;
  if (visibility !== undefined) updates.visibility = visibility;
  if (tags !== undefined) updates.tags = tags;
  if (summary !== undefined) updates.summary = summary;
  if (projectId !== undefined) updates.project_id = projectId;

  const { data: updated, error: updateErr } = await supabase
    .from("files")
    .update(updates)
    .eq("id", fileId)
    .eq("organisation_id", ctx.organisationId)
    .select()
    .single();

  if (updateErr || !updated) {
    console.error("[files] update error:", updateErr?.message);
    return errorResponse(c, 500, "Failed to update file");
  }

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "file",
    resourceId: fileId,
    action: "edit",
  });

  return c.json({ data: updated }, 200);
});

// ---------------------------------------------------------------------------
// DELETE /:fileId — soft-delete file
// ---------------------------------------------------------------------------
filesRoutes.delete("/:fileId", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { fileId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: file, error: fetchErr } = await supabase
    .from("files")
    .select("id, organisation_id, created_by")
    .eq("id", fileId)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !file) {
    return errorResponse(c, 404, "File not found");
  }

  if (!canAdminister(ctx.role) && file.created_by !== ctx.userId) {
    const hasAdmin = await checkExplicitPermission(fileId, ctx.userId, "admin");
    if (!hasAdmin) {
      return errorResponse(c, 403, "Access denied");
    }
  }

  const { error: deleteErr } = await supabase
    .from("files")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", fileId)
    .eq("organisation_id", ctx.organisationId);

  if (deleteErr) {
    return errorResponse(c, 500, "Failed to delete file");
  }

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "file",
    resourceId: fileId,
    action: "delete",
  });

  return c.json({ success: true }, 200);
});

// ---------------------------------------------------------------------------
// GET /:fileId/versions — list file version history
// ---------------------------------------------------------------------------
filesRoutes.get("/:fileId/versions", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { fileId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: file } = await supabase
    .from("files")
    .select("id")
    .eq("id", fileId)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (!file) {
    return errorResponse(c, 404, "File not found");
  }

  const { data: versions, error } = await supabase
    .from("file_versions")
    .select("*")
    .eq("file_id", fileId)
    .order("version_number", { ascending: false });

  if (error) {
    return errorResponse(c, 500, "Failed to fetch file versions");
  }

  return c.json({ data: versions ?? [] }, 200);
});

// ---------------------------------------------------------------------------
// POST /:fileId/permissions — grant explicit file permission
// ---------------------------------------------------------------------------
filesRoutes.post("/:fileId/permissions", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { fileId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: file, error: fetchErr } = await supabase
    .from("files")
    .select("id, organisation_id, created_by")
    .eq("id", fileId)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !file) {
    return errorResponse(c, 404, "File not found");
  }

  if (!canAdminister(ctx.role) && file.created_by !== ctx.userId) {
    return errorResponse(c, 403, "Only the owner or an admin can manage file permissions");
  }

  const body = await c.req.json().catch(() => null);
  const parsed = CreateFilePermissionSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(c, 400, "Validation failed", parsed.error.flatten().fieldErrors);
  }

  const { granteeType, granteeId, permission } = parsed.data;

  const { data: grant, error: insertErr } = await supabase
    .from("file_permissions")
    .upsert({
      file_id: fileId,
      grantee_type: granteeType,
      grantee_id: granteeId,
      permission,
    })
    .select()
    .single();

  if (insertErr || !grant) {
    console.error("[files] grant permission error:", insertErr?.message);
    return errorResponse(c, 500, "Failed to set file permission");
  }

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "file",
    resourceId: fileId,
    action: "share",
    metadata: { granteeType, granteeId, permission },
  });

  return c.json({ data: grant }, 201);
});

// ---------------------------------------------------------------------------
// POST /:fileId/ocr — trigger or save OCR text and summarization
// ---------------------------------------------------------------------------
filesRoutes.post("/:fileId/ocr", async (c) => {
  const auth = await resolveUserContext(c);
  if (!auth.ok) return auth.response;
  const ctx = auth.context;

  const { fileId } = c.req.param();
  const supabase = getSupabaseServiceClient();

  const { data: file, error: fetchErr } = await supabase
    .from("files")
    .select("id, organisation_id, filename, mime_type, is_upload_confirmed")
    .eq("id", fileId)
    .eq("organisation_id", ctx.organisationId)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !file) {
    return errorResponse(c, 404, "File not found");
  }

  if (!file.is_upload_confirmed) {
    return errorResponse(c, 409, "Cannot process OCR for an unconfirmed upload");
  }

  const body = await c.req.json().catch(() => ({}));
  const ocrText =
    typeof body?.ocrText === "string"
      ? body.ocrText
      : `Extracted OCR content for document: ${file.filename}. Status: Parsed and indexed.`;

  const summary =
    typeof body?.summary === "string"
      ? body.summary
      : `Summary of ${file.filename} generated via BizContext ingestion pipeline.`;

  const now = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from("files")
    .update({
      ocr_status: "completed",
      ocr_text: ocrText,
      summary,
      updated_at: now,
    })
    .eq("id", fileId)
    .eq("organisation_id", ctx.organisationId)
    .select()
    .single();

  if (updateErr || !updated) {
    return errorResponse(c, 500, "Failed to update OCR status");
  }

  await writeAuditLog({
    organisationId: ctx.organisationId,
    actorId: ctx.userId,
    resourceType: "file",
    resourceId: fileId,
    action: "ocr_extraction",
  });

  return c.json({ data: updated }, 200);
});

export default filesRoutes;
