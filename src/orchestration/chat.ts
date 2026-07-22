import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import {
  APICallError,
  isStepCount,
  NoOutputGeneratedError,
  RetryError,
  streamText,
  type ModelMessage,
} from "ai";
import type { Response } from "express";
import type { LlmProvider, Message } from "../../db/types.ts";
import { creditsFromTokens } from "../lib/billing/rates.ts";
import { getDecryptedProviderKey } from "../services/api-keys.ts";
import {
  addAssistantMessage,
  persistSourcesForMessage,
} from "../services/chats.ts";
import { chargeCredits } from "../services/credits.ts";
import { scrubStorageSignedUrls } from "../lib/storage/pdfs.ts";
import { createPdfTool, type PdfCreatedMeta } from "../tools/pdf.ts";
import { createSearchTool, type SearchResult } from "../tools/search.ts";
import { resolveModel, type ModelDefinition } from "./models.ts";

export function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const flushable = res as Response & { flush?: () => void };
  flushable.flush?.();
}

export function initSse(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
}

function toModelMessages(history: Message[]): ModelMessage[] {
  return history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

function buildLanguageModel(provider: LlmProvider, modelId: string, apiKey: string) {
  switch (provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai(modelId);
    }
    case "claude": {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(modelId);
    }
    case "gemini": {
      const google = createGoogle({ apiKey });
      return google(modelId);
    }
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

/** Safe client-facing message from provider/SDK errors (never includes secrets). */
export function publicLlmErrorMessage(err: unknown): string {
  if (RetryError.isInstance(err)) {
    return publicLlmErrorMessage(err.lastError);
  }
  if (NoOutputGeneratedError.isInstance(err) && err.cause != null) {
    return publicLlmErrorMessage(err.cause);
  }
  if (APICallError.isInstance(err)) {
    const status = err.statusCode != null ? ` (HTTP ${err.statusCode})` : "";
    return `${err.message}${status}`;
  }
  if (err instanceof Error && err.message) {
    // Prefer a nested cause when the outer message is the generic SDK one
    if (err.message.includes("No output generated") && err.cause != null) {
      return publicLlmErrorMessage(err.cause);
    }
    return err.message;
  }
  return "Assistant generation failed";
}

export type StreamChatParams = {
  res: Response;
  userId: string;
  chatId: string;
  modelId: string;
  /** Prior messages including the latest user message. */
  history: Message[];
  /** When set, emit chat_created before the LLM call. */
  emitChatCreated?: boolean;
};

/**
 * Streams an assistant reply over SSE, then persists message / sources / credits.
 * Assumes auth, credit gate, and ownership checks already passed.
 */
export async function streamChatCompletion(params: StreamChatParams): Promise<void> {
  const { res, userId, chatId, modelId, history, emitChatCreated } = params;
  const modelDef: ModelDefinition = resolveModel(modelId);

  console.log(
    `chat message received chatId=${chatId} userId=${userId} model=${modelId} provider=${modelDef.provider}`,
  );

  if (emitChatCreated) {
    writeSse(res, "chat_created", { chatId });
  }

  const languageModel = await (async () => {
    const apiKey = await getDecryptedProviderKey(userId, modelDef.provider);
    return buildLanguageModel(modelDef.provider, modelDef.id, apiKey);
  })();

  const collectedSources: SearchResult[] = [];
  let lastPdf: PdfCreatedMeta | undefined;
  const search = createSearchTool((results) => {
    for (const r of results) {
      if (!collectedSources.some((s) => s.url === r.url)) {
        collectedSources.push(r);
      }
    }
  });
  const create_pdf = createPdfTool({
    userId,
    chatId,
    onCreated: (meta) => {
      lastPdf = meta;
      // Emit as soon as the tool succeeds (during the agent loop, before final tokens finish).
      writeSse(res, "pdf_ready", {
        chatId,
        url: meta.url,
        filename: meta.filename,
      });
    },
  });

  console.log(`LLM call started chatId=${chatId} model=${modelId}`);

  let streamError: unknown;

  try {
    const result = streamText({
      model: languageModel,
      messages: toModelMessages(history),
      tools: { web_search: search, create_pdf },
      // Allow multiple Tavily searches + a detailed PDF tool call + final reply.
      stopWhen: isStepCount(8),
      // Billing / auth failures should fail fast (default retries hide the real error for ~10s)
      maxRetries: 0,
      instructions:
        "You are a helpful assistant in micromanus. " +
        "Use the web_search tool (Tavily) whenever current information or citations would help — do not invent news or URLs. " +
        "When the user asks for a PDF, report, or downloadable document: " +
        "(1) call web_search at least twice with different queries/angles to gather Tavily sources; " +
        "(2) call create_pdf exactly once with a real title, at least 5 detailed sections (each several paragraphs of analysis grounded in the search results — never short stubs), " +
        "and a sources list whose title+url pairs come only from those web_search results — do not call create_pdf again to revise the same report; " +
        "(3) in your final reply, briefly summarize and tell the user the PDF is ready via the View PDF control — " +
        "never invent, reconstruct, or paste any download, storage, or signed URL. Be accurate; prefer depth for PDF reports.",
      onError: ({ error }) => {
        streamError = error;
        console.error(
          `LLM stream error chatId=${chatId} message=${publicLlmErrorMessage(error)}`,
        );
      },
    });

    for await (const delta of result.textStream) {
      if (delta) {
        writeSse(res, "token", { text: delta });
      }
    }

    if (streamError) {
      throw streamError;
    }

    const [text, usage] = await Promise.all([result.text, result.usage]);

    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const cachedTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
    const creditsCharged = creditsFromTokens(
      modelDef.provider,
      inputTokens,
      outputTokens,
      cachedTokens,
    );

    console.log(
      `LLM call completed chatId=${chatId} model=${modelId} ` +
        `tokens in=${inputTokens} out=${outputTokens} cached=${cachedTokens}`,
    );

    if (!text || text.length === 0) {
      writeSse(res, "error", {
        message: "Empty model response",
        code: "empty_response",
      });
      writeSse(res, "done", { ok: false });
      res.end();
      return;
    }

    const assistantMessage = await addAssistantMessage(
      chatId,
      scrubStorageSignedUrls(text),
      modelId,
      lastPdf
        ? { storagePath: lastPdf.path, filename: lastPdf.filename }
        : undefined,
    );

    if (collectedSources.length > 0) {
      await persistSourcesForMessage(
        chatId,
        assistantMessage.id,
        collectedSources.map((s) => ({
          url: s.url,
          content: `[${s.title}] ${s.content}`.slice(0, 4000),
        })),
      );
    }

    try {
      await chargeCredits({
        userId,
        chatId,
        modelName: modelId,
        provider: modelDef.provider,
        inputTokens,
        outputTokens,
        cachedTokens,
        creditsCharged,
      });
    } catch (creditErr) {
      const msg = creditErr instanceof Error ? creditErr.message : "credit_error";
      console.error(`credit ledger failed chatId=${chatId} message=${msg}`);
      writeSse(res, "error", { message: "Failed to record credit usage", code: "credit_error" });
    }

    writeSse(res, "done", {
      ok: true,
      chatId,
      messageId: assistantMessage.id,
      usage: { inputTokens, outputTokens, cachedTokens, creditsCharged },
      sources: collectedSources.map((s) => ({ title: s.title, url: s.url })),
      ...(lastPdf
        ? { pdf: { url: lastPdf.url, filename: lastPdf.filename } }
        : {}),
    });
    res.end();
  } catch (err) {
    const message = publicLlmErrorMessage(streamError ?? err);
    console.error(`LLM call failed chatId=${chatId} message=${message}`);
    try {
      writeSse(res, "error", { message, code: "llm_failed" });
      writeSse(res, "done", { ok: false });
      res.end();
    } catch {
      // response may already be closed
    }
  }
}
