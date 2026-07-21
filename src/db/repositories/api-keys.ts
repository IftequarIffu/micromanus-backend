import type { ApiKey, LlmProvider } from "../../../db/types.ts";
import { getSupabaseClient } from "../client.ts";
import { mapDbError } from "../map-error.ts";

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase service-role client is not configured");
  }
  return client;
}

export type UpsertApiKeyInput = {
  userId: string;
  provider: LlmProvider;
  encryptedKey: string;
  iv: string;
  authTag: string;
  lastFour: string;
};

export async function upsertApiKey(input: UpsertApiKeyInput): Promise<ApiKey> {
  const client = requireClient();
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("api_keys")
    .upsert(
      {
        user_id: input.userId,
        provider: input.provider,
        encrypted_key: input.encryptedKey,
        iv: input.iv,
        auth_tag: input.authTag,
        last_four: input.lastFour,
        updated_at: now,
      },
      { onConflict: "user_id,provider" },
    )
    .select("*")
    .single();

  if (error) {
    mapDbError("api_keys.upsert failed", error);
  }
  return data as ApiKey;
}

export async function listApiKeysByUser(userId: string): Promise<ApiKey[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("api_keys")
    .select("id,user_id,provider,encrypted_key,iv,auth_tag,last_four,created_at,updated_at")
    .eq("user_id", userId)
    .order("provider", { ascending: true });

  if (error) {
    mapDbError("api_keys.list failed", error);
  }
  return (data ?? []) as ApiKey[];
}

export async function getApiKeyByUserAndProvider(
  userId: string,
  provider: LlmProvider,
): Promise<ApiKey | null> {
  const client = requireClient();
  const { data, error } = await client
    .from("api_keys")
    .select("id,user_id,provider,encrypted_key,iv,auth_tag,last_four,created_at,updated_at")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (error) {
    mapDbError("api_keys.get failed", error);
  }
  return data as ApiKey | null;
}

export async function deleteApiKey(userId: string, provider: LlmProvider): Promise<boolean> {
  const client = requireClient();
  const { data, error } = await client
    .from("api_keys")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider)
    .select("id");

  if (error) {
    mapDbError("api_keys.delete failed", error);
  }
  return (data?.length ?? 0) > 0;
}
