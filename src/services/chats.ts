import type {
  Chat,
  CreditUsage,
  Message,
  MessagePublic,
  Source,
} from "../../db/types.ts";
import { createChat, deleteChatOwnedByUser, getChatOwnedByUser } from "../db/repositories/chats.ts";
import {
  insertMessage,
  listMessagesByChatId,
  updateMessagePdfMeta,
} from "../db/repositories/messages.ts";
import { insertSources, listSourcesByChatId } from "../db/repositories/sources.ts";
import { listCreditUsageByChatId } from "../db/repositories/credits.ts";
import { createChatPdfSignedUrl, deleteChatPdfs } from "../lib/storage/pdfs.ts";
import { AppError } from "../middleware/error.ts";

const TITLE_MAX = 80;

export function titleFromFirstMessage(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  if (trimmed.length <= TITLE_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, TITLE_MAX - 1)}…`;
}

export type CreatedChatWithMessage = {
  chat: Chat;
  userMessage: Message;
};

export async function createChatWithFirstMessage(
  userId: string,
  content: string,
): Promise<CreatedChatWithMessage> {
  const chat = await createChat({
    userId,
    title: titleFromFirstMessage(content),
  });
  const userMessage = await insertMessage({
    chatId: chat.id,
    role: "user",
    content,
  });
  console.log(`chat created userId=${userId} chatId=${chat.id}`);
  return { chat, userMessage };
}

export async function requireOwnedChat(chatId: string, userId: string): Promise<Chat> {
  const chat = await getChatOwnedByUser(chatId, userId);
  if (!chat) {
    throw new AppError(404, "chat_not_found", "Chat not found");
  }
  return chat;
}

export async function addUserMessage(chatId: string, content: string): Promise<Message> {
  return insertMessage({ chatId, role: "user", content });
}

export async function addAssistantMessage(
  chatId: string,
  content: string,
  model: string,
  pdf?: { storagePath: string; filename: string },
): Promise<Message> {
  const message = await insertMessage({ chatId, role: "assistant", content, model });
  if (!pdf) {
    return message;
  }
  try {
    return await updateMessagePdfMeta(message.id, pdf);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "update_pdf_meta_failed";
    console.error(`assistant pdf meta failed messageId=${message.id} message=${msg}`);
    return message;
  }
}

export async function getChatHistory(chatId: string): Promise<Message[]> {
  return listMessagesByChatId(chatId);
}

export type ChatDetail = {
  chat: Chat;
  messages: MessagePublic[];
  sources: Source[];
  usage: CreditUsage[];
};

function toPublicMessageBase(m: Message): Omit<MessagePublic, "pdf"> {
  return {
    id: m.id,
    chat_id: m.chat_id,
    role: m.role,
    content: m.content,
    model: m.model,
    created_at: m.created_at,
  };
}

async function toPublicMessage(m: Message): Promise<MessagePublic> {
  const base = toPublicMessageBase(m);
  if (!m.pdf_storage_path || !m.pdf_filename) {
    return base;
  }

  const url = await createChatPdfSignedUrl(m.pdf_storage_path);
  if (!url) {
    return base;
  }

  return {
    ...base,
    pdf: { url, filename: m.pdf_filename },
  };
}

export async function getChatDetail(chatId: string, userId: string): Promise<ChatDetail> {
  const chat = await requireOwnedChat(chatId, userId);
  const [messages, sources, usage] = await Promise.all([
    listMessagesByChatId(chatId),
    listSourcesByChatId(chatId),
    listCreditUsageByChatId(chatId),
  ]);
  const publicMessages = await Promise.all(messages.map((m) => toPublicMessage(m)));
  return { chat, messages: publicMessages, sources, usage };
}

/**
 * Permanently delete an owned chat: Storage PDFs under the chat prefix, then the
 * chat row (messages/sources/usage cascade in Postgres).
 */
export async function deleteOwnedChat(chatId: string, userId: string): Promise<void> {
  await requireOwnedChat(chatId, userId);

  const messages = await listMessagesByChatId(chatId);
  const extraPaths = messages
    .map((m) => m.pdf_storage_path)
    .filter((p): p is string => typeof p === "string" && p.length > 0);

  try {
    await deleteChatPdfs({ userId, chatId, extraPaths });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "pdf_delete_failed";
    console.error(`chat pdf cleanup failed chatId=${chatId} message=${msg}`);
  }

  const deleted = await deleteChatOwnedByUser(chatId, userId);
  if (!deleted) {
    throw new AppError(404, "chat_not_found", "Chat not found");
  }

  console.log(`chat deleted userId=${userId} chatId=${chatId}`);
}

export async function persistSourcesForMessage(
  chatId: string,
  messageId: string,
  sources: Array<{ url: string; content: string }>,
): Promise<Source[]> {
  if (sources.length === 0) {
    return [];
  }
  return insertSources(
    sources.map((s) => ({
      chatId,
      messageId,
      sourceLink: s.url,
      content: s.content,
    })),
  );
}
