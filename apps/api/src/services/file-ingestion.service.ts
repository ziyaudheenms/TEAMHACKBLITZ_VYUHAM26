/**
 * File Ingestion and Knowledge Grounding Service
 *
 * Downloads files stored in Supabase Storage, extracts textual contents via the
 * AI Engine, generates semantic vector embeddings, and stores knowledge chunks
 * in the database for AI Second Brain retrieval.
 */

import { getSupabaseServiceClient } from "../lib/supabase";

const STORAGE_BUCKET =
  process.env.STORAGE_ASSETS_BUCKET || process.env.STORAGE_BUCKET || "bizcontext-assets";

export interface IngestionChunk {
  chunk_index: number;
  content: string;
  token_count?: number;
  embedding?: number[];
}

export interface IngestionResult {
  fileId: string;
  filename: string;
  totalChunks: number;
  characterCount: number;
  summaryPreview: string;
  status: "completed" | "failed";
  error?: string;
}

export class FileIngestionService {
  private getAiEngineUrl(): string {
    return (process.env.AI_ENGINE_URL || "http://localhost:8000").replace(/\/+$/, "");
  }

  /**
   * Performs end-to-end ingestion of an uploaded file into Knowledge Chunks.
   */
  async ingestFile(fileId: string, organisationId: string): Promise<IngestionResult> {
    const supabase = getSupabaseServiceClient();

    // 1. Fetch file record
    const { data: file, error: fetchErr } = await supabase
      .from("files")
      .select("id, filename, mime_type, storage_path, organisation_id, is_upload_confirmed")
      .eq("id", fileId)
      .eq("organisation_id", organisationId)
      .is("deleted_at", null)
      .single();

    if (fetchErr || !file) {
      throw new Error(`File ${fileId} not found in organisation ${organisationId}`);
    }

    // Mark status as processing
    await supabase
      .from("files")
      .update({ ocr_status: "processing", updated_at: new Date().toISOString() })
      .eq("id", fileId);

    try {
      // 2. Download file bytes from Supabase Storage
      let bucketToUse = STORAGE_BUCKET;
      let downloadRes = await supabase.storage.from(bucketToUse).download(file.storage_path);

      // Fallback to "assets" bucket if primary bucket download fails
      if (downloadRes.error && bucketToUse !== "assets") {
        const altRes = await supabase.storage.from("assets").download(file.storage_path);
        if (!altRes.error) {
          downloadRes = altRes;
          bucketToUse = "assets";
        }
      }

      if (downloadRes.error || !downloadRes.data) {
        throw new Error(
          `Failed to download file bytes from Supabase Storage bucket '${bucketToUse}': ${downloadRes.error?.message}`
        );
      }

      const fileBuffer = Buffer.from(await downloadRes.data.arrayBuffer());
      const base64Str = fileBuffer.toString("base64");

      // 3. Request extraction & chunking from AI Engine
      let extractionData: {
        filename: string;
        mime_type: string;
        page_count: number;
        character_count: number;
        summary_preview: string;
        total_chunks: number;
        chunks: IngestionChunk[];
      };

      try {
        const aiEngineUrl = this.getAiEngineUrl();
        const extractRes = await fetch(`${aiEngineUrl}/api/v1/extract/document`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            file_bytes_base64: base64Str,
            filename: file.filename,
            mime_type: file.mime_type,
            chunk_size: 1500,
            chunk_overlap: 200,
          }),
        });

        if (!extractRes.ok) {
          const errText = await extractRes.text();
          throw new Error(`AI Engine extraction returned ${extractRes.status}: ${errText}`);
        }

        extractionData = (await extractRes.json()) as typeof extractionData;
      } catch (aiEngineErr: any) {
        console.warn(
          `[FileIngestion] AI engine call failed, running local text fallback for ${file.filename}:`,
          aiEngineErr?.message
        );
        // Fallback for plain text, csv, json, md
        const rawText = fileBuffer.toString("utf-8");
        const fallbackChunks: IngestionChunk[] = [];
        const chunkSize = 1500;
        for (let i = 0; i < rawText.length; i += 1300) {
          const chunkStr = rawText.slice(i, i + chunkSize);
          if (chunkStr.trim()) {
            fallbackChunks.push({
              chunk_index: fallbackChunks.length,
              content: chunkStr,
            });
          }
        }
        extractionData = {
          filename: file.filename,
          mime_type: file.mime_type,
          page_count: 1,
          character_count: rawText.length,
          summary_preview: rawText.slice(0, 300).trim(),
          total_chunks: fallbackChunks.length,
          chunks: fallbackChunks,
        };
      }

      // 4. Idempotently clear previous knowledge chunks for this file
      await supabase
        .from("knowledge_chunks")
        .delete()
        .eq("source_id", fileId)
        .eq("source_type", "file");

      // 5. Insert new knowledge chunks into PostgreSQL / Supabase
      if (extractionData.chunks && extractionData.chunks.length > 0) {
        const chunkRows = extractionData.chunks.map((c) => ({
          organisation_id: organisationId,
          source_type: "file",
          source_id: fileId,
          content: c.content,
          embedding: c.embedding ? JSON.stringify(c.embedding) : null,
        }));

        // Batch insert in groups of 50
        const batchSize = 50;
        for (let i = 0; i < chunkRows.length; i += batchSize) {
          const batch = chunkRows.slice(i, i + batchSize);
          const { error: insertErr } = await supabase.from("knowledge_chunks").insert(batch);
          if (insertErr) {
            console.error(
              `[FileIngestion] Error inserting knowledge_chunks batch for file ${fileId}:`,
              insertErr.message
            );
          }
        }
      }

      // 6. Update file status to completed
      const summaryText =
        extractionData.summary_preview ||
        `Document ${file.filename} containing ${extractionData.character_count} characters across ${extractionData.total_chunks} indexed knowledge chunks.`;

      await supabase
        .from("files")
        .update({
          ocr_status: "completed",
          ocr_text: extractionData.summary_preview,
          summary: summaryText,
          updated_at: new Date().toISOString(),
        })
        .eq("id", fileId);

      return {
        fileId,
        filename: file.filename,
        totalChunks: extractionData.total_chunks,
        characterCount: extractionData.character_count,
        summaryPreview: extractionData.summary_preview,
        status: "completed",
      };
    } catch (error: any) {
      console.error(`[FileIngestion] Ingestion failed for file ${fileId}:`, error?.message);

      await supabase
        .from("files")
        .update({
          ocr_status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", fileId);

      return {
        fileId,
        filename: file.filename,
        totalChunks: 0,
        characterCount: 0,
        summaryPreview: "",
        status: "failed",
        error: error?.message,
      };
    }
  }

  /**
   * Retrieves extracted text and knowledge chunks for a given file.
   */
  async getFileKnowledge(fileId: string, organisationId: string) {
    const supabase = getSupabaseServiceClient();

    const { data: file, error: fileErr } = await supabase
      .from("files")
      .select("id, filename, mime_type, byte_size, ocr_status, summary, created_at, updated_at")
      .eq("id", fileId)
      .eq("organisation_id", organisationId)
      .is("deleted_at", null)
      .single();

    if (fileErr || !file) {
      return null;
    }

    const { data: chunks } = await supabase
      .from("knowledge_chunks")
      .select("id, content, created_at")
      .eq("source_id", fileId)
      .eq("source_type", "file")
      .order("created_at", { ascending: true });

    const chunkList = chunks || [];
    const fullText = chunkList.map((c) => c.content).join("\n\n");

    return {
      file,
      totalChunks: chunkList.length,
      chunks: chunkList,
      fullText,
    };
  }
}

export const fileIngestionService = new FileIngestionService();
