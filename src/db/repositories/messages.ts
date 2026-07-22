import type { Message, MessageRole } from "../../../db/types.ts";
import { getSupabaseClient } from "../client.ts";

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase service-role client is not configured");
  }
  return client;
}

export type InsertMessageInput = {
  chatId: string;
  role: MessageRole;
  content: string;
  model?: string | null;
};

export async function insertMessage(input: InsertMessageInput): Promise<Message> {
  const client = requireClient();
  const { data, error } = await client
    .from("messages")
    .insert({
      chat_id: input.chatId,
      role: input.role,
      content: input.content,
      model: input.model ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`messages.insert failed: ${error.code ?? error.message}`);
  }
  return data as Message;
}

export async function listMessagesByChatId(chatId: string): Promise<Message[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`messages.list failed: ${error.code ?? error.message}`);
  }
  return (data ?? []) as Message[];
}

export async function updateMessagePdfMeta(
  messageId: string,
  pdf: { storagePath: string; filename: string },
): Promise<Message> {
  const client = requireClient();
  const { data, error } = await client
    .from("messages")
    .update({
      pdf_storage_path: pdf.storagePath,
      pdf_filename: pdf.filename,
    })
    .eq("id", messageId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`messages.updatePdfMeta failed: ${error.code ?? error.message}`);
  }
  return data as Message;
}
