import type { ApiKeyPublic, LlmProvider } from "../../db/types.ts";
import {
  deleteApiKey as deleteApiKeyRow,
  getApiKeyByUserAndProvider,
  listApiKeysByUser,
  upsertApiKey,
} from "../db/repositories/api-keys.ts";
import { AppError } from "../middleware/error.ts";
import { decryptApiKey, encryptApiKey, lastFourOfKey } from "../lib/keyVault.ts";

const PROVIDERS: readonly LlmProvider[] = ["openai", "claude", "gemini"];

export function isLlmProvider(value: string): value is LlmProvider {
  return (PROVIDERS as readonly string[]).includes(value);
}

/** Basic shape check only — no live provider call. */
export function validateProviderKeyShape(provider: LlmProvider, apiKey: string): void {
  const key = apiKey.trim();
  if (key.length < 8) {
    throw new AppError(400, "invalid_api_key", "API key is too short");
  }

  if (provider === "openai" && !key.startsWith("sk-")) {
    throw new AppError(400, "invalid_api_key", "OpenAI keys should start with sk-");
  }

  if (provider === "claude" && !key.startsWith("sk-ant-")) {
    throw new AppError(400, "invalid_api_key", "Anthropic keys should start with sk-ant-");
  }

  if (provider === "gemini" && key.length < 20) {
    throw new AppError(400, "invalid_api_key", "Gemini API key looks too short");
  }
}

export async function saveApiKey(
  userId: string,
  provider: LlmProvider,
  apiKey: string,
): Promise<ApiKeyPublic> {
  validateProviderKeyShape(provider, apiKey);
  const encrypted = encryptApiKey(apiKey.trim());
  const row = await upsertApiKey({
    userId,
    provider,
    encryptedKey: encrypted.encryptedKey,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    lastFour: lastFourOfKey(apiKey),
  });

  console.log(`api key saved userId=${userId} provider=${provider}`);
  return {
    provider: row.provider,
    last_four: row.last_four,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listPublicApiKeys(userId: string): Promise<ApiKeyPublic[]> {
  const rows = await listApiKeysByUser(userId);
  return rows.map((row) => ({
    provider: row.provider,
    last_four: row.last_four,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export async function removeApiKey(userId: string, provider: LlmProvider): Promise<void> {
  const deleted = await deleteApiKeyRow(userId, provider);
  if (!deleted) {
    throw new AppError(404, "api_key_not_found", "No API key configured for this provider");
  }
  console.log(`api key deleted userId=${userId} provider=${provider}`);
}

/** Fail fast if the user has no stored key for this provider (no decrypt). */
export async function requireProviderKeyConfigured(
  userId: string,
  provider: LlmProvider,
): Promise<void> {
  const row = await getApiKeyByUserAndProvider(userId, provider);
  if (!row) {
    throw new AppError(
      400,
      "api_key_not_configured",
      `No API key configured for provider "${provider}"`,
    );
  }
}

/**
 * Decrypt the user's provider key for a single LLM call.
 * Caller must not log, cache, or persist the returned plaintext.
 */
export async function getDecryptedProviderKey(
  userId: string,
  provider: LlmProvider,
): Promise<string> {
  const row = await getApiKeyByUserAndProvider(userId, provider);
  if (!row) {
    throw new AppError(
      400,
      "api_key_not_configured",
      `No API key configured for provider "${provider}"`,
    );
  }

  return decryptApiKey({
    encryptedKey: row.encrypted_key,
    iv: row.iv,
    authTag: row.auth_tag,
  });
}
