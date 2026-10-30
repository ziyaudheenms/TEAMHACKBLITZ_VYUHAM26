"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  HardDrive,
  UploadCloud,
  FileText,
  FileSpreadsheet,
  FileCode,
  Image as ImageIcon,
  Download,
  Search,
  RefreshCw,
  Sparkles,
  Eye,
  CheckCircle2,
  Clock,
  AlertTriangle,
  AlertCircle,
  Layers,
  Lock,
  Loader2,
  X,
  ShieldCheck,
  Zap,
  LayoutGrid,
  List,
} from "lucide-react";
import { api } from "../../services/api";
import { ApiError } from "../../services/http";
import { useRBAC } from "../../lib/useRBAC";
import { StoredFile } from "../../types";

/** Largest file the API accepts (InitiateFileUploadSchema). */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const POLL_INTERVAL_MS = 5000;

type OcrStatus = NonNullable<StoredFile["ocrStatus"]>;
const OCR_STATUSES: OcrStatus[] = ["none", "pending", "processing", "completed", "failed"];

type KnowledgeData = {
  file: StoredFile;
  totalChunks: number;
  chunks: Array<{ id: string; content: string; created_at: string }>;
  fullText: string;
};

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return err.message;
    if (err.status === 403) return `Access denied: ${err.message}`;
    return err.message;
  }
  return err instanceof Error ? err.message : fallback;
}

function uploadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return `Your role isn't allowed to upload files (403): ${err.message}`;
    if (err.status === 0) return err.message;
    return err.message;
  }
  return err instanceof Error ? err.message : "Upload failed";
}

function StatusBadge({ file }: { file: StoredFile }) {
  const base = "inline-flex items-center space-x-1 px-2 py-0.5 rounded-full border text-[10px] font-bold shrink-0";
  if (file.isUploadConfirmed === false) {
    return (
      <span className={`${base} bg-slate-50 border-slate-200 text-slate-600`} title="The upload was never confirmed">
        <AlertTriangle className="w-3 h-3" />
        <span>Upload incomplete</span>
      </span>
    );
  }
  switch (file.ocrStatus) {
    case "completed":
      return (
        <span className={`${base} bg-emerald-50 border-emerald-200 text-emerald-700`}>
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          <span>Indexed</span>
        </span>
      );
    case "processing":
      return (
        <span className={`${base} bg-cyan-50 border-cyan-200 text-cyan-700`}>
          <Clock className="w-3 h-3 text-cyan-600 animate-spin" />
          <span>Indexing</span>
        </span>
      );
    case "pending":
      return (
        <span className={`${base} bg-amber-50 border-amber-200 text-amber-700`}>
          <Clock className="w-3 h-3 text-amber-600" />
          <span>Pending</span>
        </span>
      );
    case "failed":
      return (
        <span className={`${base} bg-rose-50 border-rose-200 text-rose-700`} title="Indexing failed. Try Re-Index.">
          <AlertCircle className="w-3 h-3 text-rose-600" />
          <span>Failed</span>
        </span>
      );
    default:
      return (
        <span className={`${base} bg-slate-50 border-slate-200 text-slate-600`} title="This file has not been indexed">
          <AlertTriangle className="w-3 h-3 text-slate-500" />
          <span>Not indexed</span>
        </span>
      );
  }
}

function VisibilityBadge({ visibility }: { visibility: StoredFile["visibility"] }) {
  if (visibility !== "restricted") return null;
  return (
    <span
      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-purple-50 border border-purple-200 text-purple-700 text-[10px] font-bold shrink-0"
      title="Restricted: visible to admins and the uploader"
    >
      <Lock className="w-3 h-3" />
      <span>Restricted</span>
    </span>
  );
}

export default function StoragePage() {
  const { isAdmin } = useRBAC();

  const [files, setFiles] = useState<StoredFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [uploadedCount, setUploadedCount] = useState<number | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"table" | "grid">("grid");

  const [actionError, setActionError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [reindexingId, setReindexingId] = useState<string | null>(null);

  // Knowledge Inspector Modal state
  const [inspectingFile, setInspectingFile] = useState<StoredFile | null>(null);
  const [knowledgeData, setKnowledgeData] = useState<KnowledgeData | null>(null);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [isKnowledgeLoading, setIsKnowledgeLoading] = useState(false);
  const knowledgeRequest = useRef(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Fetches the list. `silent` keeps the current list on screen (no skeleton). */
  const loadFiles = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const data = await api.getFiles();
      if (!mounted.current) return;
      setFiles(data);
      setLoadError(null);
    } catch (err) {
      if (!mounted.current) return;
      setLoadError(errorMessage(err, "Failed to load files"));
    } finally {
      if (mounted.current && !silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  // While anything is still being indexed, keep the list fresh.
  const hasInProgress = files.some((f) => f.ocrStatus === "pending" || f.ocrStatus === "processing");
  useEffect(() => {
    if (!hasInProgress) return;
    const timer = setInterval(() => void loadFiles(true), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasInProgress, loadFiles]);

  const handleFileUpload = async (selected: FileList | File[] | null) => {
    if (!selected || isUploading) return;
    const queue = Array.from(selected);
    if (queue.length === 0) return;

    setIsUploading(true);
    setUploadErrors([]);
    setUploadedCount(null);

    const failures: string[] = [];
    let succeeded = 0;

    for (let i = 0; i < queue.length; i++) {
      const file = queue[i];
      if (file.size > MAX_UPLOAD_BYTES) {
        failures.push(`${file.name}: larger than the 100 MB limit.`);
        continue;
      }
      setUploadProgress(`Uploading ${file.name} (${i + 1}/${queue.length})...`);
      try {
        const uploaded = await api.uploadRealFile(file);
        succeeded += 1;
        if (mounted.current) {
          setFiles((prev) => [uploaded, ...prev.filter((f) => f.id !== uploaded.id)]);
        }
      } catch (err) {
        failures.push(`${file.name}: ${uploadErrorMessage(err)}`);
      }
    }

    if (!mounted.current) return;
    setUploadErrors(failures);
    setUploadedCount(succeeded > 0 ? succeeded : null);
    setUploadProgress(null);
    setIsUploading(false);
    if (succeeded > 0) void loadFiles(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      void handleFileUpload(e.dataTransfer.files);
    }
  };

  const fetchKnowledge = async (file: StoredFile) => {
    const requestId = ++knowledgeRequest.current;
    setIsKnowledgeLoading(true);
    setKnowledgeError(null);
    try {
      const data = await api.getFileKnowledge(file.id);
      if (requestId !== knowledgeRequest.current || !mounted.current) return;
      setKnowledgeData(data);
    } catch (err) {
      if (requestId !== knowledgeRequest.current || !mounted.current) return;
      setKnowledgeData(null);
      setKnowledgeError(errorMessage(err, "Failed to load file knowledge"));
    } finally {
      if (requestId === knowledgeRequest.current && mounted.current) setIsKnowledgeLoading(false);
    }
  };

  const openInspector = (file: StoredFile) => {
    setInspectingFile(file);
    setKnowledgeData(null);
    void fetchKnowledge(file);
  };

  const closeInspector = () => {
    knowledgeRequest.current += 1;
    setInspectingFile(null);
    setKnowledgeData(null);
    setKnowledgeError(null);
    setIsKnowledgeLoading(false);
  };

  const handleReindex = async (file: StoredFile) => {
    if (reindexingId) return;
    setReindexingId(file.id);
    setActionError(null);
    try {
      const result = await api.reindexFile(file.id);
      if (!mounted.current) return;
      const status = OCR_STATUSES.find((s) => s === result.status);
      if (status) {
        setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, ocrStatus: status } : f)));
      }
      void loadFiles(true);
      if (inspectingFile?.id === file.id) await fetchKnowledge(file);
    } catch (err) {
      if (mounted.current) setActionError(`Re-index failed for ${file.filename}: ${errorMessage(err, "unknown error")}`);
    } finally {
      if (mounted.current) setReindexingId(null);
    }
  };

  const handleDownload = async (file: StoredFile) => {
    if (downloadingId) return;
    setDownloadingId(file.id);
    setActionError(null);
    try {
      // `downloadUrl` on list items is a relative API path; always request a signed URL.
      const url = await api.getFileDownloadUrl(file.id);
      if (!url) throw new Error("The server returned an empty download link.");
      const opened = window.open(url, "_blank", "noopener");
      if (!opened) window.location.assign(url);
    } catch (err) {
      if (mounted.current) setActionError(`Couldn't download ${file.filename}: ${errorMessage(err, "unknown error")}`);
    } finally {
      if (mounted.current) setDownloadingId(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const getFileIcon = (mime: string) => {
    const lower = (mime || "").toLowerCase();
    if (lower.includes("image")) return <ImageIcon className="w-5 h-5 text-emerald-500" />;
    if (lower.includes("pdf")) return <FileText className="w-5 h-5 text-rose-500" />;
    if (lower.includes("spreadsheet") || lower.includes("excel") || lower.includes("csv"))
      return <FileSpreadsheet className="w-5 h-5 text-emerald-600" />;
    if (lower.includes("word") || lower.includes("document"))
      return <FileText className="w-5 h-5 text-blue-500" />;
    return <FileCode className="w-5 h-5 text-purple-500" />;
  };

  const subtype = (mime: string, fallback: string) => (mime || "").split("/")[1] || fallback;

  const filteredFiles = files.filter((f) => {
    const q = searchQuery.toLowerCase();
    const mime = (f.mimeType || "").toLowerCase();
    const matchesSearch = f.filename.toLowerCase().includes(q) || (f.summary ? f.summary.toLowerCase().includes(q) : false);

    if (!matchesSearch) return false;
    if (filterType === "all") return true;
    if (filterType === "pdf") return mime.includes("pdf");
    if (filterType === "sheet") return mime.includes("sheet") || mime.includes("excel") || mime.includes("csv");
    if (filterType === "image") return mime.includes("image");
    if (filterType === "doc") return mime.includes("word") || mime.includes("document") || mime.includes("text");
    return true;
  });

  const totalBytes = files.reduce((acc, f) => acc + (f.byteSize || 0), 0);
  const indexedCount = files.filter((f) => f.ocrStatus === "completed").length;
  const showStats = !isLoading && !(loadError && files.length === 0);

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* Hidden native file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          const picked = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          void handleFileUpload(picked);
        }}
        multiple
        className="hidden"
      />

      {/* Header & Stats Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#EDEDED]">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[#74D96F]/20 flex items-center justify-center text-[#262626]">
              <HardDrive className="w-5 h-5 text-[#56BE51]" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black tracking-tight text-[#262626] flex items-center gap-2">
                Central Asset Storage & Second Brain Knowledge
              </h1>
              <p className="text-xs text-[#666666]">
                Encrypted Supabase Object Storage • pgvector Semantic Embeddings • Grounded Agent Context
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => void loadFiles()}
            disabled={isLoading || isUploading}
            aria-label="Refresh files"
            className="p-2.5 rounded-full border border-[#DCDCDC] bg-white hover:bg-[#EDEDED] text-[#666666] transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="px-5 py-2.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] active:scale-95 text-[#262626] text-xs font-bold shadow-md shadow-[#74D96F]/20 transition-all flex items-center space-x-2 disabled:opacity-50 cursor-pointer"
          >
            {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            <span>{isUploading ? "Uploading..." : "Upload & Ground Asset"}</span>
          </button>
        </div>
      </div>

      {/* Load error */}
      {loadError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700"
        >
          <span className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{files.length > 0 ? `Couldn't refresh files: ${loadError}` : `Couldn't load files: ${loadError}`}</span>
          </span>
          <button onClick={() => void loadFiles()} className="font-bold underline cursor-pointer shrink-0">
            Retry
          </button>
        </div>
      )}

      {/* Upload failures */}
      {uploadErrors.length > 0 && (
        <div role="alert" className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700 space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center space-x-2 font-bold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                {uploadErrors.length === 1 ? "1 file could not be uploaded" : `${uploadErrors.length} files could not be uploaded`}
              </span>
            </span>
            <button
              onClick={() => setUploadErrors([])}
              aria-label="Dismiss upload errors"
              className="p-1 rounded-full hover:bg-rose-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <ul className="list-disc pl-6 space-y-0.5">
            {uploadErrors.map((msg, i) => (
              <li key={i} className="break-words">
                {msg}
              </li>
            ))}
          </ul>
        </div>
      )}

      {uploadedCount !== null && uploadErrors.length === 0 && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-[#74D96F]/15 border border-[#74D96F]/40 text-xs text-[#1F541D]"
        >
          <span className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              {uploadedCount === 1 ? "File uploaded." : `${uploadedCount} files uploaded.`} Indexing into the Second Brain has started.
            </span>
          </span>
          <button onClick={() => setUploadedCount(null)} aria-label="Dismiss" className="p-1 rounded-full hover:bg-[#74D96F]/20 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Download / re-index failures */}
      {actionError && (
        <div role="alert" className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
          <span className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="break-words">{actionError}</span>
          </span>
          <button onClick={() => setActionError(null)} aria-label="Dismiss" className="p-1 rounded-full hover:bg-rose-100 cursor-pointer shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Spatial Metric Cards */}
      {showStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-3xl bg-white border border-[#EDEDED] shadow-sm hover:border-[#BEBEBE] transition-all card-hover">
            <div className="flex items-center justify-between text-xs text-[#666666] font-medium">
              <span>Total Stored Assets</span>
              <Layers className="w-4 h-4 text-[#74D96F]" />
            </div>
            <div className="text-2xl font-black text-[#262626] mt-2">{files.length}</div>
            <div className="text-[10px] text-[#888888] mt-1 font-mono">{formatSize(totalBytes)} stored</div>
          </div>

          <div className="p-4 rounded-3xl bg-white border border-[#EDEDED] shadow-sm hover:border-[#BEBEBE] transition-all card-hover">
            <div className="flex items-center justify-between text-xs text-[#666666] font-medium">
              <span>Knowledge Indexed</span>
              <Sparkles className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-black text-emerald-600 mt-2">{indexedCount}</div>
            <div className="text-[10px] text-[#888888] mt-1">
              {files.length - indexedCount > 0 ? `${files.length - indexedCount} not yet indexed` : "Chunked with pgvector"}
            </div>
          </div>

          <div className="p-4 rounded-3xl bg-white border border-[#EDEDED] shadow-sm hover:border-[#BEBEBE] transition-all card-hover">
            <div className="flex items-center justify-between text-xs text-[#666666] font-medium">
              <span>Supabase Vault</span>
              <ShieldCheck className="w-4 h-4 text-purple-500" />
            </div>
            <div className="text-2xl font-black text-[#262626] mt-2">Private</div>
            <div className="text-[10px] text-[#888888] mt-1">Presigned signed URLs only</div>
          </div>

          <div className="p-4 rounded-3xl bg-white border border-[#EDEDED] shadow-sm hover:border-[#BEBEBE] transition-all card-hover">
            <div className="flex items-center justify-between text-xs text-[#666666] font-medium">
              <span>Agent Grounding</span>
              <Zap className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-black text-[#262626] mt-2">{indexedCount}</div>
            <div className="text-[10px] text-[#888888] mt-1">
              {indexedCount === 1 ? "document" : "documents"} available as context
            </div>
          </div>
        </div>
      )}

      {/* Drag & Drop Antigravity Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isUploading && fileInputRef.current?.click()}
        className={`relative overflow-hidden rounded-3xl border-2 border-dashed p-8 transition-all text-center ${
          isUploading ? "cursor-wait opacity-80" : "cursor-pointer"
        } ${
          isDragging
            ? "border-[#74D96F] bg-[#74D96F]/10 scale-[1.01]"
            : "border-[#DCDCDC] bg-white/70 hover:border-[#BEBEBE] hover:bg-white"
        }`}
      >
        <div className="flex flex-col items-center justify-center space-y-3">
          <div
            className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-transform ${
              isDragging ? "scale-110 bg-[#74D96F]/30" : "bg-[#EDEDED] text-[#262626]"
            }`}
          >
            <UploadCloud className="w-7 h-7 text-[#56BE51]" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#262626]">
              {isUploading ? "Processing..." : "Drag & drop files here, or click to browse"}
            </h3>
            <p className="text-xs text-[#666666] mt-1">
              Supports PDF, DOCX, XLSX, TXT, CSV, Markdown, JSON, and Images (up to 100 MB)
            </p>
          </div>
          {uploadProgress && (
            <div role="status" className="mt-2 text-xs font-semibold text-emerald-600 animate-pulse">
              {uploadProgress}
            </div>
          )}
        </div>
      </div>

      {/* Search, Filter & View Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-[#888888] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Search files"
            placeholder="Search documents or content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-full border border-[#DCDCDC] bg-white text-xs text-[#262626] placeholder-[#888888] focus:outline-none focus:border-[#74D96F] transition"
          />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: "all", label: "All" },
            { id: "pdf", label: "PDF" },
            { id: "sheet", label: "Sheets" },
            { id: "doc", label: "Docs" },
            { id: "image", label: "Images" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                filterType === tab.id
                  ? "bg-[#262626] text-white"
                  : "bg-white border border-[#EDEDED] text-[#666666] hover:text-[#262626]"
              }`}
            >
              {tab.label}
            </button>
          ))}

          <div className="border-l border-[#EDEDED] pl-2 flex items-center space-x-1">
            <button
              onClick={() => setViewMode("grid")}
              aria-label="Grid view"
              className={`p-1.5 rounded-lg transition ${
                viewMode === "grid" ? "bg-[#EDEDED] text-[#262626]" : "text-[#888888] hover:text-[#262626]"
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("table")}
              aria-label="Table view"
              className={`p-1.5 rounded-lg transition ${
                viewMode === "table" ? "bg-[#EDEDED] text-[#262626]" : "text-[#888888] hover:text-[#262626]"
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {!isAdmin && (
        <p className="text-[11px] text-[#9E9E9E] flex items-center space-x-1.5">
          <Lock className="w-3 h-3" />
          <span>Restricted files are only visible to admins and to the person who uploaded them.</span>
        </p>
      )}

      {/* Files Display: loading / error / empty / grid / table */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-3xl border border-[#EDEDED] bg-white p-5 space-y-3">
              <div className="skeleton h-10 w-10 rounded-2xl" />
              <div className="skeleton h-3 w-2/3 rounded-full" />
              <div className="skeleton h-3 w-1/3 rounded-full" />
            </div>
          ))}
        </div>
      ) : loadError && files.length === 0 ? null : filteredFiles.length === 0 ? (
        <div className="rounded-3xl border border-[#EDEDED] bg-white p-12 text-center space-y-3">
          <HardDrive className="w-10 h-10 text-[#BEBEBE] mx-auto" />
          <h3 className="text-sm font-bold text-[#262626]">
            {files.length > 0 ? "No files match your filters" : "No files yet"}
          </h3>
          <p className="text-xs text-[#888888]">
            {files.length > 0
              ? "Try adjusting your search terms or filter selection."
              : "Upload a document to store it securely and index it into the Second Brain."}
          </p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredFiles.map((file) => (
            <div
              key={file.id}
              className="rounded-3xl border border-[#EDEDED] bg-white p-5 hover:border-[#BEBEBE] card-hover shadow-xs flex flex-col justify-between space-y-4 group"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-10 h-10 rounded-2xl bg-[#F8F9FA] border border-[#EDEDED] flex items-center justify-center shrink-0">
                      {getFileIcon(file.mimeType)}
                    </div>
                    <div className="min-w-0">
                      <h4
                        className="text-xs font-bold text-[#262626] truncate group-hover:text-[#56BE51] transition"
                        title={file.filename}
                      >
                        {file.filename}
                      </h4>
                      <p className="text-[10px] text-[#888888] font-mono mt-0.5">
                        {formatSize(file.byteSize)} • {subtype(file.mimeType, "doc")}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge file={file} />
                    <VisibilityBadge visibility={file.visibility} />
                  </div>
                </div>

                {file.summary && (
                  <p className="text-[11px] text-[#555555] line-clamp-2 bg-[#F8F9FA] p-2.5 rounded-xl border border-[#EDEDED]">
                    {file.summary}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-[#EDEDED] text-xs">
                <button
                  onClick={() => openInspector(file)}
                  className="inline-flex items-center space-x-1 text-[11px] font-bold text-[#262626] hover:text-[#56BE51] transition cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Inspect Knowledge</span>
                </button>

                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => void handleDownload(file)}
                    disabled={downloadingId === file.id}
                    className="p-1.5 rounded-lg text-[#666666] hover:text-[#262626] hover:bg-[#F8F9FA] transition disabled:opacity-40 cursor-pointer"
                    title="Download via signed link"
                    aria-label={`Download ${file.filename}`}
                  >
                    {downloadingId === file.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => void handleReindex(file)}
                    disabled={reindexingId !== null}
                    className="p-1.5 rounded-lg text-[#666666] hover:text-emerald-600 hover:bg-[#F8F9FA] transition disabled:opacity-40 cursor-pointer"
                    title="Re-index file knowledge"
                    aria-label={`Re-index ${file.filename}`}
                  >
                    <RefreshCw className={`w-4 h-4 ${reindexingId === file.id ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-[#EDEDED] bg-white overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#262626]">
              <thead>
                <tr className="border-b border-[#EDEDED] bg-[#F8F9FA] text-[#666666] font-bold uppercase text-[10px]">
                  <th className="py-3 px-4">Filename</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Knowledge Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDEDED]">
                {filteredFiles.map((file) => (
                  <tr key={file.id} className="hover:bg-[#F8F9FA] transition">
                    <td className="py-3.5 px-4 font-bold text-[#262626]">
                      <div className="flex items-center space-x-2.5">
                        {getFileIcon(file.mimeType)}
                        <span className="truncate max-w-xs" title={file.filename}>
                          {file.filename}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-[#666666]">{subtype(file.mimeType, "binary")}</td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-[#262626]">{formatSize(file.byteSize)}</td>
                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge file={file} />
                        <VisibilityBadge visibility={file.visibility} />
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        onClick={() => openInspector(file)}
                        className="px-2.5 py-1 rounded-full bg-[#EDEDED] hover:bg-[#DCDCDC] text-[10px] font-bold text-[#262626] transition cursor-pointer"
                      >
                        Inspect
                      </button>
                      <button
                        onClick={() => void handleDownload(file)}
                        disabled={downloadingId === file.id}
                        aria-label={`Download ${file.filename}`}
                        className="p-1 rounded-lg text-[#666666] hover:text-[#262626] transition disabled:opacity-40 cursor-pointer"
                      >
                        {downloadingId === file.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => void handleReindex(file)}
                        disabled={reindexingId !== null}
                        aria-label={`Re-index ${file.filename}`}
                        className="p-1 rounded-lg text-[#666666] hover:text-emerald-600 transition disabled:opacity-40 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${reindexingId === file.id ? "animate-spin" : ""}`} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Knowledge Inspector Modal Drawer */}
      {inspectingFile && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Knowledge for ${inspectingFile.filename}`}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in"
        >
          <div className="w-full max-w-2xl bg-white rounded-3xl border border-[#EDEDED] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-scale-in">
            {/* Modal Header */}
            <div className="p-5 border-b border-[#EDEDED] flex items-center justify-between bg-[#F8F9FA]">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-white border border-[#EDEDED] flex items-center justify-center shrink-0">
                  {getFileIcon(inspectingFile.mimeType)}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-[#262626] truncate max-w-sm">{inspectingFile.filename}</h3>
                  <p className="text-[10px] text-[#666666] font-mono truncate">
                    {formatSize(inspectingFile.byteSize)} • {inspectingFile.visibility}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                <button
                  onClick={() => void handleReindex(inspectingFile)}
                  disabled={reindexingId !== null}
                  className="px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold hover:bg-emerald-100 transition flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${reindexingId === inspectingFile.id ? "animate-spin" : ""}`} />
                  <span>{reindexingId === inspectingFile.id ? "Reindexing..." : "Re-Index"}</span>
                </button>
                <button
                  onClick={closeInspector}
                  aria-label="Close"
                  className="p-1.5 rounded-full hover:bg-[#EDEDED] text-[#666666] transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6">
              {actionError && (
                <div role="alert" className="flex items-start space-x-2 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="break-words">{actionError}</span>
                </div>
              )}

              {isKnowledgeLoading ? (
                <div className="py-12 text-center space-y-3" aria-busy="true">
                  <RefreshCw className="w-6 h-6 text-[#74D96F] animate-spin mx-auto" />
                  <p className="text-xs text-[#666666]">Retrieving knowledge chunks from Second Brain...</p>
                </div>
              ) : knowledgeError ? (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700"
                >
                  <span className="flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>Couldn't load knowledge: {knowledgeError}</span>
                  </span>
                  <button onClick={() => void fetchKnowledge(inspectingFile)} className="font-bold underline cursor-pointer shrink-0">
                    Retry
                  </button>
                </div>
              ) : knowledgeData ? (
                <>
                  <div className="flex items-center gap-2">
                    <StatusBadge file={knowledgeData.file ?? inspectingFile} />
                  </div>

                  {/* Summary Callout */}
                  {(inspectingFile.summary || knowledgeData.fullText) && (
                    <div className="p-4 rounded-2xl bg-[#74D96F]/10 border border-[#74D96F]/30 space-y-1.5">
                      <div className="text-xs font-bold text-[#262626] flex items-center space-x-1.5">
                        <Sparkles className="w-4 h-4 text-[#56BE51]" />
                        <span>Document Abstract & Semantic Grounding</span>
                      </div>
                      <p className="text-xs text-[#444444] leading-relaxed">
                        {inspectingFile.summary ||
                          (knowledgeData.fullText.length > 300
                            ? knowledgeData.fullText.slice(0, 300) + "..."
                            : knowledgeData.fullText)}
                      </p>
                    </div>
                  )}

                  {/* Chunks List */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs font-bold text-[#262626]">
                      <span>Indexed Knowledge Chunks ({knowledgeData.totalChunks})</span>
                    </div>

                    {knowledgeData.chunks.length === 0 ? (
                      <div className="p-4 rounded-2xl bg-[#F8F9FA] text-center text-xs text-[#888888]">
                        {(knowledgeData.file ?? inspectingFile).ocrStatus === "processing" ||
                        (knowledgeData.file ?? inspectingFile).ocrStatus === "pending"
                          ? "Indexing is still in progress. Check back in a moment."
                          : 'No chunks extracted yet. Click "Re-Index" to parse the document.'}
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {knowledgeData.chunks.map((chunk, idx) => (
                          <div
                            key={chunk.id || idx}
                            className="p-3.5 rounded-2xl border border-[#EDEDED] bg-[#F8F9FA] hover:border-[#BEBEBE] transition space-y-1.5 text-xs"
                          >
                            <div className="flex items-center justify-between text-[10px] text-[#888888] font-mono">
                              <span>Chunk #{idx + 1}</span>
                              {chunk.created_at && <span>Indexed {new Date(chunk.created_at).toLocaleDateString()}</span>}
                            </div>
                            <p className="text-[#333333] font-mono text-[11px] whitespace-pre-wrap leading-relaxed">
                              {chunk.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-[#EDEDED] bg-[#F8F9FA] flex items-center justify-between">
              <button
                onClick={() => void handleDownload(inspectingFile)}
                disabled={downloadingId === inspectingFile.id}
                className="px-4 py-2 rounded-full border border-[#DCDCDC] bg-white hover:bg-[#EDEDED] text-xs font-bold text-[#262626] transition flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
              >
                {downloadingId === inspectingFile.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>Download File</span>
              </button>
              <button
                onClick={closeInspector}
                className="px-5 py-2 rounded-full bg-[#262626] text-white text-xs font-bold hover:bg-black transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
