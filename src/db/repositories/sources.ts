import type { Source } from "../../../db/types.ts";
import { getSupabaseClient } from "../client.ts";

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase service-role client is not configured");
  }
  return client;
}

export type InsertSourceInput = {
  chatId: string;
  messageId: string;
  sourceLink: string;
  content: string;
};

export async function insertSources(inputs: InsertSourceInput[]): Promise<Source[]> {
  if (inputs.length === 0) {
    return [];
  }

  const client = requireClient();
  const { data, error } = await client
    .from("sources")
    .insert(
      inputs.map((row) => ({
        chat_id: row.chatId,
        message_id: row.messageId,
        source_link: row.sourceLink,
        content: row.content,
      })),
    )
    .select("*");

  if (error) {
    throw new Error(`sources.insert failed: ${error.code ?? error.message}`);
  }
  return (data ?? []) as Source[];
}

export async function listSourcesByChatId(chatId: string): Promise<Source[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("sources")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`sources.list failed: ${error.code ?? error.message}`);
  }
  return (data ?? []) as Source[];
}
