import type {
  CreditBalance,
  CreditPurchase,
  CreditUsage,
  LlmProvider,
} from "../../../db/types.ts";
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

export type CreditUsageWithChat = CreditUsage & {
  chats: { title: string | null } | null;
};

export async function listCreditUsageForUser(
  userId: string,
  chatId?: string,
): Promise<CreditUsageWithChat[]> {
  const client = requireClient();
  let query = client
    .from("credit_usage")
    .select("*, chats(title)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (chatId) {
    query = query.eq("chat_id", chatId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`credit_usage.list failed: ${error.code ?? error.message}`);
  }
  return (data ?? []) as CreditUsageWithChat[];
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

export type InsertPendingPurchaseInput = {
  userId: string;
  stripeSessionId: string;
  amountPaidCents: number;
  creditsGranted: number;
};

export async function insertPendingPurchase(
  input: InsertPendingPurchaseInput,
): Promise<CreditPurchase> {
  const client = requireClient();
  const { data, error } = await client
    .from("credit_purchases")
    .insert({
      user_id: input.userId,
      stripe_session_id: input.stripeSessionId,
      amount_paid_cents: input.amountPaidCents,
      credits_granted: input.creditsGranted,
      status: "pending",
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`credit_purchases.insertPending failed: ${error.code ?? error.message}`);
  }
  return data as CreditPurchase;
}

export async function getPurchaseBySessionId(
  stripeSessionId: string,
): Promise<CreditPurchase | null> {
  const client = requireClient();
  const { data, error } = await client
    .from("credit_purchases")
    .select("*")
    .eq("stripe_session_id", stripeSessionId)
    .maybeSingle();

  if (error) {
    throw new Error(`credit_purchases.getBySession failed: ${error.code ?? error.message}`);
  }
  return data as CreditPurchase | null;
}

export type CompletePurchaseInput = {
  stripeSessionId: string;
  userId: string;
  amountPaidCents: number;
  creditsGranted: number;
};

export async function completeCreditPurchase(
  input: CompletePurchaseInput,
): Promise<CreditPurchase> {
  const client = requireClient();
  const { data, error } = await client.rpc("complete_credit_purchase", {
    p_stripe_session_id: input.stripeSessionId,
    p_user_id: input.userId,
    p_amount_paid_cents: input.amountPaidCents,
    p_credits_granted: input.creditsGranted,
  });

  if (error) {
    throw new Error(`credit_purchases.complete failed: ${error.message}`);
  }
  return data as CreditPurchase;
}

export type RedeemCouponResult = {
  coupon_code: string;
  credits_granted: number;
  balance: number;
  redemption_id: string;
};

export async function redeemCoupon(
  userId: string,
  code: string,
): Promise<RedeemCouponResult> {
  const client = requireClient();
  const { data, error } = await client.rpc("redeem_coupon", {
    p_user_id: userId,
    p_code: code,
  });

  if (error) {
    throw error;
  }
  return data as RedeemCouponResult;
}
