"use client";

import React, { useState, useEffect, useRef } from "react";
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
  Layers,
  X,
  ExternalLink,
  ShieldCheck,
  Zap,
  LayoutGrid,
  List,
} from "lucide-react";
import { api } from "../../services/api";
import { StoredFile } from "../../types";

export default function StoragePage() {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"table" | "grid">("grid");

  // Knowledge Inspector Modal state
  const [inspectingFile, setInspectingFile] = useState<StoredFile | null>(null);
  const [knowledgeData, setKnowledgeData] = useState<{
    file: StoredFile;
    totalChunks: number;
    chunks: Array<{ id: string; content: string; created_at: string }>;
    fullText: string;
  } | null>(null);
  const [isKnowledgeLoading, setIsKnowledgeLoading] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = async () => {
    try {
      setIsLoading(true);
      const data = await api.getFiles();
      setFiles(data);
    } catch (err) {
      console.error("Failed to load files:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, []);

  const handleFileUpload = async (selectedFiles: FileList | null) => {
    if (!selectedFiles || selectedFiles.length === 0) return;
    setIsUploading(true);

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        setUploadProgress(`Uploading ${file.name} to Supabase Storage...`);
        const uploaded = await api.uploadRealFile(file);
        setFiles((prev) => [uploaded, ...prev.filter((f) => f.id !== uploaded.id)]);
      }
      setUploadProgress("Ingesting into Second Brain...");
      setTimeout(() => {
        loadFiles();
      }, 1500);
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
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
    if (e.dataTransfer.files) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const openInspector = async (file: StoredFile) => {
    setInspectingFile(file);
    setIsKnowledgeLoading(true);
    setKnowledgeData(null);
    try {
      const data = await api.getFileKnowledge(file.id);
      setKnowledgeData(data);
    } catch (err) {
      console.error("Failed to load file knowledge:", err);
    } finally {
      setIsKnowledgeLoading(false);
    }
  };

  const handleReindex = async (fileId: string) => {
    setIsReindexing(true);
    try {
      await api.reindexFile(fileId);
      await loadFiles();
      if (inspectingFile?.id === fileId) {
        const updated = await api.getFileKnowledge(fileId);
        setKnowledgeData(updated);
      }
    } catch (err) {
      console.error("Reindex error:", err);
    } finally {
      setIsReindexing(false);
    }
  };

  const handleDownload = async (file: StoredFile) => {
    try {
      const url = await api.getFileDownloadUrl(file.id);
      if (url) {
        window.open(url, "_blank");
      } else {
        alert("Download URL expired or unavailable.");
      }
    } catch {
      alert("Unable to generate download URL.");
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const getFileIcon = (mime: string) => {
    const lower = mime.toLowerCase();
    if (lower.includes("image")) return <ImageIcon className="w-5 h-5 text-emerald-500" />;
    if (lower.includes("pdf")) return <FileText className="w-5 h-5 text-rose-500" />;
    if (lower.includes("spreadsheet") || lower.includes("excel") || lower.includes("csv"))
      return <FileSpreadsheet className="w-5 h-5 text-emerald-600" />;
    if (lower.includes("word") || lower.includes("document"))
      return <FileText className="w-5 h-5 text-blue-500" />;
    return <FileCode className="w-5 h-5 text-purple-500" />;
  };

  const filteredFiles = files.filter((f) => {
    const matchesSearch =
      f.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (f.summary && f.summary.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;
    if (filterType === "all") return true;
    if (filterType === "pdf") return f.mimeType.toLowerCase().includes("pdf");
    if (filterType === "sheet")
      return (
        f.mimeType.toLowerCase().includes("sheet") ||
        f.mimeType.toLowerCase().includes("excel") ||
        f.mimeType.toLowerCase().includes("csv")
      );
    if (filterType === "image") return f.mimeType.toLowerCase().includes("image");
    if (filterType === "doc")
      return (
        f.mimeType.toLowerCase().includes("word") ||
        f.mimeType.toLowerCase().includes("document") ||
        f.mimeType.toLowerCase().includes("text")
      );
    return true;
  });

  const totalBytes = files.reduce((acc, f) => acc + (f.byteSize || 0), 0);
  const indexedCount = files.filter(
    (f) => f.ocrStatus === "completed" || (f as any).is_upload_confirmed
  ).length;

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* Hidden native file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => handleFileUpload(e.target.files)}
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
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="px-5 py-2.5 rounded-full bg-[#74D96F] hover:bg-[#62CE5C] active:scale-95 text-[#262626] text-xs font-bold shadow-md shadow-[#74D96F]/20 transition-all flex items-center space-x-2 disabled:opacity-50 cursor-pointer"
          >
            <UploadCloud className="w-4 h-4" />
            <span>{isUploading ? "Uploading..." : "Upload & Ground Asset"}</span>
          </button>
        </div>
      </div>

      {/* Spatial Metric Cards */}
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
          <div className="text-[10px] text-[#888888] mt-1">Chunked with pgvector</div>
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
          <div className="text-2xl font-black text-[#262626] mt-2">Active</div>
          <div className="text-[10px] text-[#888888] mt-1">Contextual chat recall</div>
        </div>
      </div>

      {/* Drag & Drop Antigravity Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative overflow-hidden rounded-3xl border-2 border-dashed p-8 transition-all cursor-pointer text-center ${
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
              Supports PDF, DOCX, XLSX, TXT, CSV, Markdown, and Images (up to 50MB)
            </p>
          </div>
          {uploadProgress && (
            <div className="mt-2 text-xs font-semibold text-emerald-600 animate-pulse">
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
              className={`p-1.5 rounded-lg transition ${
                viewMode === "grid" ? "bg-[#EDEDED] text-[#262626]" : "text-[#888888] hover:text-[#262626]"
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`p-1.5 rounded-lg transition ${
                viewMode === "table" ? "bg-[#EDEDED] text-[#262626]" : "text-[#888888] hover:text-[#262626]"
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Files Display: Grid or Table */}
      {filteredFiles.length === 0 ? (
        <div className="rounded-3xl border border-[#EDEDED] bg-white p-12 text-center space-y-3">
          <HardDrive className="w-10 h-10 text-[#BEBEBE] mx-auto" />
          <h3 className="text-sm font-bold text-[#262626]">No asset files found</h3>
          <p className="text-xs text-[#888888]">
            {searchQuery
              ? "Try adjusting your search terms or filter selection."
              : "Upload a document to store it in Supabase and index it into the Second Brain."}
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
                        {formatSize(file.byteSize)} • {file.mimeType.split("/")[1] || "doc"}
                      </p>
                    </div>
                  </div>

                  {file.ocrStatus === "completed" ? (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold shrink-0">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>Indexed</span>
                    </span>
                  ) : file.ocrStatus === "processing" ? (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-cyan-50 border border-cyan-200 text-cyan-700 text-[10px] font-bold shrink-0">
                      <Clock className="w-3 h-3 text-cyan-600 animate-spin" />
                      <span>Indexing</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold shrink-0">
                      <AlertTriangle className="w-3 h-3 text-amber-600" />
                      <span>Pending</span>
                    </span>
                  )}
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
                  className="inline-flex items-center space-x-1 text-[11px] font-bold text-[#262626] hover:text-[#56BE51] transition"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Inspect Knowledge</span>
                </button>

                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => handleDownload(file)}
                    className="p-1.5 rounded-lg text-[#666666] hover:text-[#262626] hover:bg-[#F8F9FA] transition"
                    title="Download presigned asset"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleReindex(file.id)}
                    className="p-1.5 rounded-lg text-[#666666] hover:text-emerald-600 hover:bg-[#F8F9FA] transition"
                    title="Re-index file knowledge"
                  >
                    <RefreshCw className="w-4 h-4" />
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
                    <td className="py-3.5 px-4 font-bold text-[#262626] flex items-center space-x-2.5">
                      {getFileIcon(file.mimeType)}
                      <span className="truncate max-w-xs">{file.filename}</span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-[#666666]">
                      {file.mimeType.split("/")[1] || "binary"}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-[#262626]">
                      {formatSize(file.byteSize)}
                    </td>
                    <td className="py-3.5 px-4">
                      {file.ocrStatus === "completed" ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Indexed</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold">
                          <Clock className="w-3 h-3 text-amber-600" />
                          <span>Pending</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2">
                      <button
                        onClick={() => openInspector(file)}
                        className="px-2.5 py-1 rounded-full bg-[#EDEDED] hover:bg-[#DCDCDC] text-[10px] font-bold text-[#262626] transition"
                      >
                        Inspect
                      </button>
                      <button
                        onClick={() => handleDownload(file)}
                        className="p-1 rounded-lg text-[#666666] hover:text-[#262626] transition"
                      >
                        <Download className="w-3.5 h-3.5" />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
          <div className="w-full max-w-2xl bg-white rounded-3xl border border-[#EDEDED] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-scale-in">
            {/* Modal Header */}
            <div className="p-5 border-b border-[#EDEDED] flex items-center justify-between bg-[#F8F9FA]">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-white border border-[#EDEDED] flex items-center justify-center">
                  {getFileIcon(inspectingFile.mimeType)}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#262626] truncate max-w-sm">
                    {inspectingFile.filename}
                  </h3>
                  <p className="text-[10px] text-[#666666] font-mono">
                    {inspectingFile.storagePath} • {formatSize(inspectingFile.byteSize)}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleReindex(inspectingFile.id)}
                  disabled={isReindexing}
                  className="px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold hover:bg-emerald-100 transition flex items-center space-x-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isReindexing ? "animate-spin" : ""}`} />
                  <span>{isReindexing ? "Reindexing..." : "Re-Index"}</span>
                </button>
                <button
                  onClick={() => setInspectingFile(null)}
                  className="p-1.5 rounded-full hover:bg-[#EDEDED] text-[#666666] transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6">
              {isKnowledgeLoading ? (
                <div className="py-12 text-center space-y-3">
                  <RefreshCw className="w-6 h-6 text-[#74D96F] animate-spin mx-auto" />
                  <p className="text-xs text-[#666666]">Retrieving knowledge chunks from Second Brain...</p>
                </div>
              ) : knowledgeData ? (
                <>
                  {/* Summary Callout */}
                  <div className="p-4 rounded-2xl bg-[#74D96F]/10 border border-[#74D96F]/30 space-y-1.5">
                    <div className="text-xs font-bold text-[#262626] flex items-center space-x-1.5">
                      <Sparkles className="w-4 h-4 text-[#56BE51]" />
                      <span>Document Abstract & Semantic Grounding</span>
                    </div>
                    <p className="text-xs text-[#444444] leading-relaxed">
                      {inspectingFile.summary || knowledgeData.fullText.slice(0, 300) + "..."}
                    </p>
                  </div>

                  {/* Chunks List */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs font-bold text-[#262626]">
                      <span>Indexed Knowledge Chunks ({knowledgeData.totalChunks})</span>
                      <span className="text-[10px] text-[#888888] font-mono">1536-dim vector embedded</span>
                    </div>

                    {knowledgeData.chunks.length === 0 ? (
                      <div className="p-4 rounded-2xl bg-[#F8F9FA] text-center text-xs text-[#888888]">
                        No chunks extracted yet. Click "Re-Index" to parse the document.
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
                              <span>Indexed {new Date(chunk.created_at).toLocaleDateString()}</span>
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
              ) : (
                <div className="py-8 text-center text-xs text-[#888888]">
                  No knowledge data extracted yet for this document.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-[#EDEDED] bg-[#F8F9FA] flex items-center justify-between">
              <button
                onClick={() => handleDownload(inspectingFile)}
                className="px-4 py-2 rounded-full border border-[#DCDCDC] bg-white hover:bg-[#EDEDED] text-xs font-bold text-[#262626] transition flex items-center space-x-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Presigned File</span>
              </button>
              <button
                onClick={() => setInspectingFile(null)}
                className="px-5 py-2 rounded-full bg-[#262626] text-white text-xs font-bold hover:bg-black transition"
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
