import { Router, type Response } from "express";
import { z } from "zod";
import { authedUserId, requireAuth } from "../middleware/auth.ts";
import { AppError } from "../middleware/error.ts";
import { initSse, streamChatCompletion } from "../orchestration/chat.ts";
import { resolveModel } from "../orchestration/models.ts";
import {
  addUserMessage,
  createChatWithFirstMessage,
  getChatDetail,
  getChatHistory,
  requireOwnedChat,
} from "../services/chats.ts";
import { requirePositiveBalance } from "../services/credits.ts";
import { requireProviderKeyConfigured } from "../services/api-keys.ts";

export const chatsRouter = Router();

chatsRouter.use(requireAuth);

const messageBodySchema = z.object({
  content: z.string().trim().min(1).max(100_000),
  model: z.string().trim().min(1),
});

function sendAppError(res: Response, err: unknown): boolean {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return true;
  }
  return false;
}

/**
 * First message of a new chat.
 * SSE events: chat_created → token* → done | error
 */
chatsRouter.post("/chats/messages", async (req, res, next) => {
  try {
    const userId = authedUserId(req);
    const parsed = messageBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", code: "invalid_body" });
      return;
    }

    const { content, model: modelId } = parsed.data;
    const modelDef = resolveModel(modelId);

    await requirePositiveBalance(userId);
    await requireProviderKeyConfigured(userId, modelDef.provider);

    const { chat } = await createChatWithFirstMessage(userId, content);
    const history = await getChatHistory(chat.id);

    initSse(res);
    await streamChatCompletion({
      res,
      userId,
      chatId: chat.id,
      modelId,
      history,
      emitChatCreated: true,
    });
  } catch (err) {
    if (sendAppError(res, err)) {
      return;
    }
    next(err);
  }
});

/**
 * Follow-up message in an existing chat.
 * SSE events: token* → done | error
 */
chatsRouter.post("/chats/:chatId/messages", async (req, res, next) => {
  try {
    const userId = authedUserId(req);
    const chatId = String(req.params.chatId ?? "");
    const parsed = messageBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", code: "invalid_body" });
      return;
    }

    const { content, model: modelId } = parsed.data;
    const modelDef = resolveModel(modelId);

    await requireOwnedChat(chatId, userId);
    await requirePositiveBalance(userId);
    await requireProviderKeyConfigured(userId, modelDef.provider);

    await addUserMessage(chatId, content);
    const history = await getChatHistory(chatId);

    initSse(res);
    await streamChatCompletion({
      res,
      userId,
      chatId,
      modelId,
      history,
      emitChatCreated: false,
    });
  } catch (err) {
    if (sendAppError(res, err)) {
      return;
    }
    next(err);
  }
});

chatsRouter.get("/chats/:chatId", async (req, res, next) => {
  try {
    const userId = authedUserId(req);
    const chatId = String(req.params.chatId ?? "");
    const detail = await getChatDetail(chatId, userId);
    res.json({
      id: detail.chat.id,
      title: detail.chat.title,
      created_at: detail.chat.created_at,
      messages: detail.messages,
      sources: detail.sources,
      usage: detail.usage,
    });
  } catch (err) {
    if (sendAppError(res, err)) {
      return;
    }
    next(err);
  }
});
