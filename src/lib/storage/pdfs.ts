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

/**
 * Re-sign an existing object path in chat-pdfs (e.g. when hydrating a chat).
 * Returns null if signing fails — callers should omit pdf rather than fail the request.
 * Omits `download` so the browser can display the PDF inline (Content-Disposition: inline).
 */
export async function createChatPdfSignedUrl(path: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const trimmed = path.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.startsWith("/")) {
    return null;
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(CHAT_PDFS_BUCKET)
    .createSignedUrl(trimmed, PDF_SIGNED_URL_SECONDS);

  if (signError || !signed?.signedUrl) {
    console.error(
      `PDF re-sign failed path=${trimmed} message=${signError?.message ?? "missing url"}`,
    );
    return null;
  }

  return signed.signedUrl;
}

/** Object names are `{uuid}-{filename}` — strip the UUID prefix when present. */
export function filenameFromChatPdfObjectName(objectName: string): string {
  const stripped = objectName.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    "",
  );
  return sanitizePdfFilename(stripped.length > 0 ? stripped : objectName);
}

/**
 * Newest PDF in chat-pdfs/{userId}/{chatId}/ with a fresh signed URL.
 * Used when message rows lack pdf_storage_path (migration not applied / legacy rows).
 */
export async function getLatestChatPdfSigned(params: {
  userId: string;
  chatId: string;
}): Promise<{ path: string; url: string; filename: string } | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const prefix = `${params.userId}/${params.chatId}`;
  const { data: listed, error: listError } = await supabase.storage
    .from(CHAT_PDFS_BUCKET)
    .list(prefix, {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" },
    });

  if (listError) {
    console.error(
      `PDF list for hydrate failed prefix=${prefix} message=${listError.message}`,
    );
    return null;
  }

  const newest = (listed ?? []).find((item) => item.name?.toLowerCase().endsWith(".pdf"));
  if (!newest?.name) {
    return null;
  }

  const path = `${prefix}/${newest.name}`;
  const url = await createChatPdfSignedUrl(path);
  if (!url) {
    return null;
  }

  return {
    path,
    url,
    filename: filenameFromChatPdfObjectName(newest.name),
  };
}

/**
 * Strip Supabase Storage signed URLs from assistant text.
 * LLMs often paste/truncate JWT query tokens, which then 400 with InvalidJWT in the browser.
 */
export function scrubStorageSignedUrls(text: string): string {
  return text.replace(
    /https?:\/\/[^\s)\]>"']*\/storage\/v1\/object\/sign\/[^\s)\]>"']+/gi,
    "(PDF available via View PDF)",
  );
}

/**
 * Delete all PDF objects for a chat. Paths are always `{userId}/{chatId}/…`.
 * Also removes any explicit message storage paths (covers legacy/orphan names).
 * Returns number of objects removed; logs and continues on storage errors.
 */
export async function deleteChatPdfs(params: {
  userId: string;
  chatId: string;
  /** Extra object paths from message rows (must stay under userId/chatId). */
  extraPaths?: string[];
}): Promise<number> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return 0;
  }

  const prefix = `${params.userId}/${params.chatId}`;
  const paths = new Set<string>();

  for (const raw of params.extraPaths ?? []) {
    const trimmed = raw.trim();
    if (
      trimmed &&
      !trimmed.includes("..") &&
      !trimmed.startsWith("/") &&
      trimmed.startsWith(`${prefix}/`)
    ) {
      paths.add(trimmed);
    }
  }

  const { data: listed, error: listError } = await supabase.storage
    .from(CHAT_PDFS_BUCKET)
    .list(prefix, { limit: 1000 });

  if (listError) {
    console.error(
      `PDF list failed prefix=${prefix} message=${listError.message}`,
    );
  } else {
    for (const item of listed ?? []) {
      if (item.name) {
        paths.add(`${prefix}/${item.name}`);
      }
    }
  }

  if (paths.size === 0) {
    return 0;
  }

  const toRemove = [...paths];
  const { error: removeError } = await supabase.storage
    .from(CHAT_PDFS_BUCKET)
    .remove(toRemove);

  if (removeError) {
    console.error(
      `PDF remove failed prefix=${prefix} count=${toRemove.length} message=${removeError.message}`,
    );
    return 0;
  }

  console.log(`pdfs deleted chatId=${params.chatId} count=${toRemove.length}`);
  return toRemove.length;
}
