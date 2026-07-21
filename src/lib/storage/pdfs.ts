import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "../../db/client.ts";

export const CHAT_PDFS_BUCKET = "chat-pdfs";

/** Signed URL lifetime for generated chat PDFs (24 hours). */
export const PDF_SIGNED_URL_SECONDS = 60 * 60 * 24;

/** Max PDF size accepted by the bucket (Storage-side limit). */
const PDF_FILE_SIZE_LIMIT = "10MB";

let bucketReady: Promise<void> | null = null;

export function sanitizePdfFilename(raw: string | undefined): string {
  const base = (raw ?? "report")
    .trim()
    .replace(/[/\\]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  const stem = base.length > 0 ? base.replace(/\.pdf$/i, "") : "report";
  const safe = stem.length > 0 ? stem : "report";
  return `${safe}.pdf`;
}

function isAlreadyExistsError(message: string): boolean {
  return /already exists|duplicate|resource already|409/i.test(message);
}

function isBucketMissingError(message: string): boolean {
  return /bucket not found|not found/i.test(message);
}

/**
 * Ensure the private chat-pdfs bucket exists.
 * Prefers Postgres RPC (works when Storage admin API is Forbidden), then createBucket.
 */
export async function ensureChatPdfsBucket(supabase: SupabaseClient): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { error: rpcError } = await supabase.rpc("ensure_chat_pdfs_bucket");
      if (!rpcError) {
        console.log(`storage bucket ready name=${CHAT_PDFS_BUCKET} via=rpc`);
        return;
      }

      // RPC not applied yet — try Storage API (may be Forbidden on some projects/keys).
      const { data, error: getError } = await supabase.storage.getBucket(CHAT_PDFS_BUCKET);
      if (!getError && data) {
        return;
      }

      const { error: createError } = await supabase.storage.createBucket(CHAT_PDFS_BUCKET, {
        public: false,
        allowedMimeTypes: ["application/pdf"],
        fileSizeLimit: PDF_FILE_SIZE_LIMIT,
      });

      if (!createError || isAlreadyExistsError(createError.message)) {
        console.log(`storage bucket ready name=${CHAT_PDFS_BUCKET} via=createBucket`);
        return;
      }

      throw new Error(
        `Storage bucket "${CHAT_PDFS_BUCKET}" is missing and could not be created. ` +
          `Run db/migrations/004_chat_pdfs_bucket.sql in the Supabase SQL Editor, then retry. ` +
          `(rpc: ${rpcError.message}; createBucket: ${createError.message})`,
      );
    })().catch((err) => {
      bucketReady = null;
      throw err;
    });
  }

  await bucketReady;
}

/**
 * Upload PDF bytes to the private chat-pdfs bucket and return a signed download URL.
 * Object path is always `{userId}/{chatId}/{uuid}-{filename}` — never from client input alone.
 * Ensures the bucket exists first (RPC or createBucket).
 */
export async function uploadChatPdf(params: {
  userId: string;
  chatId: string;
  filename: string;
  bytes: Buffer;
}): Promise<{ path: string; url: string; filename: string; bytes: number }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase is not configured");
  }

  await ensureChatPdfsBucket(supabase);

  const filename = sanitizePdfFilename(params.filename);
  const path = `${params.userId}/${params.chatId}/${randomUUID()}-${filename}`;

  let uploadError = (
    await supabase.storage.from(CHAT_PDFS_BUCKET).upload(path, params.bytes, {
      contentType: "application/pdf",
      upsert: false,
    })
  ).error;

  // If bucket was missing, force ensure again and retry once.
  if (uploadError && isBucketMissingError(uploadError.message)) {
    bucketReady = null;
    await ensureChatPdfsBucket(supabase);
    uploadError = (
      await supabase.storage.from(CHAT_PDFS_BUCKET).upload(path, params.bytes, {
        contentType: "application/pdf",
        upsert: false,
      })
    ).error;
  }

  if (uploadError) {
    throw new Error(`PDF upload failed: ${uploadError.message}`);
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(CHAT_PDFS_BUCKET)
    .createSignedUrl(path, PDF_SIGNED_URL_SECONDS);

  if (signError || !signed?.signedUrl) {
    throw new Error(`PDF signed URL failed: ${signError?.message ?? "missing url"}`);
  }

  return {
    path,
    url: signed.signedUrl,
    filename,
    bytes: params.bytes.length,
  };
}
