import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../config/env.ts";

let client: SupabaseClient | null = null;

/**
 * Returns a service-role Supabase client when URL + key are configured.
 * Returns null during scaffold/local boot without secrets.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (client) {
    return client;
  }

  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return client;
}
