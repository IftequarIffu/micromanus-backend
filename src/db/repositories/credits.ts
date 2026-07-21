import type { CreditBalance, CreditUsage, LlmProvider } from "../../../db/types.ts";
import { getSupabaseClient } from "../client.ts";

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase service-role client is not configured");
  }
  return client;
}

export async function getCreditBalance(userId: string): Promise<CreditBalance | null> {
  const client = requireClient();
  const { data, error } = await client
    .from("credit_balances")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`credit_balances.get failed: ${error.code ?? error.message}`);
  }
  return data as CreditBalance | null;
}

export type RecordUsageInput = {
  userId: string;
  chatId: string;
  modelName: string;
  provider: LlmProvider;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  creditsCharged: number;
};

export async function recordCreditUsageAndDecrement(
  input: RecordUsageInput,
): Promise<CreditUsage> {
  const client = requireClient();
  const { data, error } = await client.rpc("record_credit_usage_and_decrement", {
    p_user_id: input.userId,
    p_chat_id: input.chatId,
    p_model_name: input.modelName,
    p_provider: input.provider,
    p_input_tokens: input.inputTokens,
    p_output_tokens: input.outputTokens,
    p_cached_tokens: input.cachedTokens,
    p_credits_charged: input.creditsCharged,
  });

  if (error) {
    throw new Error(`credit_usage.record failed: ${error.message}`);
  }
  return data as CreditUsage;
}

export async function listCreditUsageForUser(
  userId: string,
  chatId?: string,
): Promise<CreditUsage[]> {
  const client = requireClient();
  let query = client
    .from("credit_usage")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (chatId) {
    query = query.eq("chat_id", chatId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`credit_usage.list failed: ${error.code ?? error.message}`);
  }
  return (data ?? []) as CreditUsage[];
}

export async function listCreditUsageByChatId(chatId: string): Promise<CreditUsage[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("credit_usage")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`credit_usage.listByChat failed: ${error.code ?? error.message}`);
  }
  return (data ?? []) as CreditUsage[];
}
