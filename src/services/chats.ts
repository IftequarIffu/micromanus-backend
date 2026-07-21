import type { Chat, CreditUsage, Message, Source } from "../../db/types.ts";
import { createChat, getChatOwnedByUser } from "../db/repositories/chats.ts";
import { insertMessage, listMessagesByChatId } from "../db/repositories/messages.ts";
import { insertSources, listSourcesByChatId } from "../db/repositories/sources.ts";
import { listCreditUsageByChatId } from "../db/repositories/credits.ts";
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
): Promise<Message> {
  return insertMessage({ chatId, role: "assistant", content, model });
}

export async function getChatHistory(chatId: string): Promise<Message[]> {
  return listMessagesByChatId(chatId);
}

export type ChatDetail = {
  chat: Chat;
  messages: Message[];
  sources: Source[];
  usage: CreditUsage[];
};

export async function getChatDetail(chatId: string, userId: string): Promise<ChatDetail> {
  const chat = await requireOwnedChat(chatId, userId);
  const [messages, sources, usage] = await Promise.all([
    listMessagesByChatId(chatId),
    listSourcesByChatId(chatId),
    listCreditUsageByChatId(chatId),
  ]);
  return { chat, messages, sources, usage };
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
