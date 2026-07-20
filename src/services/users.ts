import type { User } from "../../db/types.ts";
import { getSupabaseClient } from "../db/client.ts";
import { getUserById, upsertUser } from "../db/repositories/users.ts";


export type EnsureUserInput = {
  userId: string;
  /** Email claim from the verified JWT, if present. */
  emailFromJwt?: string;
  /** Raw access token — used only when the local users row is missing. */
  accessToken: string;
};

function displayNameFromAuthUser(meta: Record<string, unknown> | undefined, email: string): string {
  const fullName = typeof meta?.full_name === "string" ? meta.full_name.trim() : "";
  const name = typeof meta?.name === "string" ? meta.name.trim() : "";
  const preferred = fullName || name;
  if (preferred) {
    return preferred;
  }
  const local = email.split("@")[0];
  return local && local.length > 0 ? local : "User";
}

/**
 * Ensures a public.users row exists for the authenticated subject.
 * Calls Auth getUser only when the row is missing (profile hydrate).
 */
export async function ensureUser(input: EnsureUserInput): Promise<User> {
  const existing = await getUserById(input.userId);
  if (existing) {
    return existing;
  }

  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase service-role client is not configured");
  }

  const { data, error } = await client.auth.getUser(input.accessToken);
  if (error || !data.user) {
    throw new Error(`auth.getUser failed: ${error?.message ?? "no user"}`);
  }

  const authUser = data.user;
  if (authUser.id !== input.userId) {
    throw new Error("auth.getUser subject mismatch");
  }

  const email = authUser.email ?? input.emailFromJwt;
  if (!email) {
    throw new Error("Authenticated user has no email");
  }

  const name = displayNameFromAuthUser(
    authUser.user_metadata as Record<string, unknown> | undefined,
    email,
  );

  return upsertUser({ id: input.userId, name, email });
}

export async function getCurrentUser(userId: string): Promise<User | null> {
  return getUserById(userId);
}
