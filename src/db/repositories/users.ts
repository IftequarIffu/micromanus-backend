import type { User } from "../../../db/types.ts";
import { getSupabaseClient } from "../client.ts";

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase service-role client is not configured");
  }
  return client;
}

export async function getUserById(id: string): Promise<User | null> {
  const client = requireClient();
  const { data, error } = await client.from("users").select("*").eq("id", id).maybeSingle();
  if (error) {
    throw new Error(`users.getById failed: ${error.code ?? error.message}`);
  }
  return data as User | null;
}

export type UpsertUserInput = {
  id: string;
  name: string;
  email: string;
};

export async function upsertUser(input: UpsertUserInput): Promise<User> {
  const client = requireClient();
  const { data, error } = await client
    .from("users")
    .upsert(
      {
        id: input.id,
        name: input.name,
        email: input.email,
      },
      { onConflict: "id", ignoreDuplicates: false },
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(`users.upsert failed: ${error.code ?? error.message}`);
  }

  return data as User;
}
