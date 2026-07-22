import type { Chat } from "../../../db/types.ts";
import { getSupabaseClient } from "../client.ts";

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase service-role client is not configured");
  }
  return client;
}

export type CreateChatInput = {
  userId: string;
  title: string | null;
};

export async function createChat(input: CreateChatInput): Promise<Chat> {
  const client = requireClient();
  const { data, error } = await client
    .from("chats")
    .insert({
      user_id: input.userId,
      title: input.title,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`chats.create failed: ${error.code ?? error.message}`);
  }
  return data as Chat;
}

export async function getChatById(chatId: string): Promise<Chat | null> {
  const client = requireClient();
  const { data, error } = await client.from("chats").select("*").eq("id", chatId).maybeSingle();
  if (error) {
    throw new Error(`chats.getById failed: ${error.code ?? error.message}`);
  }
  return data as Chat | null;
}

/** Returns the chat only if it belongs to userId; otherwise null (no existence leak). */
export async function getChatOwnedByUser(chatId: string, userId: string): Promise<Chat | null> {
  const client = requireClient();
  const { data, error } = await client
    .from("chats")
    .select("*")
    .eq("id", chatId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`chats.getOwned failed: ${error.code ?? error.message}`);
  }
  return data as Chat | null;
}

/**
 * Delete a chat owned by userId. Cascades messages, sources, credit_usage in Postgres.
 * Returns true if a row was deleted.
 */
export async function deleteChatOwnedByUser(chatId: string, userId: string): Promise<boolean> {
  const client = requireClient();
  const { data, error } = await client
    .from("chats")
    .delete()
    .eq("id", chatId)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    throw new Error(`chats.delete failed: ${error.code ?? error.message}`);
  }
  return (data?.length ?? 0) > 0;
}
