import type { CreditBalance, CreditUsage, LlmProvider } from "../../db/types.ts";
import type Stripe from "stripe";
import { constructStripeEvent, createCheckoutSession } from "../billing/stripe.ts";
import { mapCouponRedeemError, mapDbError } from "../db/map-error.ts";
import {
  completeCreditPurchase,
  getCreditBalance,
  getPurchaseBySessionId,
  insertPendingPurchase,
  listCreditUsageForUser,
  redeemCoupon as redeemCouponRpc,
  type RecordUsageInput,
  recordCreditUsageAndDecrement,
} from "../db/repositories/credits.ts";
import { AppError } from "../middleware/error.ts";
import {
  isValidCheckoutCredits,
  MIN_CHECKOUT_CREDITS,
} from "../lib/billing/packages.ts";
import { usdCostFromTokens } from "../lib/billing/rates.ts";

export type ChatModelUsage = {
  modelName: string;
  provider: LlmProvider;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /** Estimated provider API cost in USD (BYOK), from published list prices. */
  costUsd: number;
};

export type ChatUsageSummary = {
  chatId: string;
  title: string | null;
  models: ChatModelUsage[];
};

export type CreditsSummary = {
  balance: number;
  usageByChat: ChatUsageSummary[];
};

function aggregateUsageByChat(
  rows: Awaited<ReturnType<typeof listCreditUsageForUser>>,
): ChatUsageSummary[] {
  type AccModel = ChatModelUsage;
  type AccChat = {
    chatId: string;
    title: string | null;
    models: Map<string, AccModel>;
    latestAt: string;
  };

  const chats = new Map<string, AccChat>();

  for (const row of rows) {
    let chat = chats.get(row.chat_id);
    if (!chat) {
      chat = {
        chatId: row.chat_id,
        title: row.chats?.title ?? null,
        models: new Map(),
        latestAt: row.created_at,
      };
      chats.set(row.chat_id, chat);
    } else if (row.created_at > chat.latestAt) {
      chat.latestAt = row.created_at;
    }

    const key = row.model_name;
    const existing = chat.models.get(key);
    if (existing) {
      existing.inputTokens += row.input_tokens;
      existing.outputTokens += row.output_tokens;
      existing.cachedTokens += row.cached_tokens;
      existing.costUsd += usdCostFromTokens(
        row.model_name,
        row.input_tokens,
        row.output_tokens,
        row.cached_tokens,
      );
    } else {
      chat.models.set(key, {
        modelName: row.model_name,
        provider: row.provider,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cachedTokens: row.cached_tokens,
        costUsd: usdCostFromTokens(
          row.model_name,
          row.input_tokens,
          row.output_tokens,
          row.cached_tokens,
        ),
      });
    }
  }

  return [...chats.values()]
    .sort((a, b) => (a.latestAt < b.latestAt ? 1 : a.latestAt > b.latestAt ? -1 : 0))
    .map((chat) => ({
      chatId: chat.chatId,
      title: chat.title,
      models: [...chat.models.values()].map((m) => ({
        ...m,
        costUsd: Math.round(m.costUsd * 100_000) / 100_000,
      })),
    }));
}

export async function requirePositiveBalance(userId: string): Promise<CreditBalance> {
  const balance = await getCreditBalance(userId);
  const remaining = balance?.balance ?? 0;
  console.log(`credit balance check userId=${userId} balance=${remaining}`);

  if (!balance || remaining <= 0) {
    throw new AppError(402, "insufficient_credits", "Platform credit balance is zero or missing");
  }
  return balance;
}

export async function getCreditsSummary(
  userId: string,
  chatId?: string,
): Promise<CreditsSummary> {
  const [balanceRow, usage] = await Promise.all([
    getCreditBalance(userId),
    listCreditUsageForUser(userId, chatId),
  ]);

  return {
    balance: balanceRow?.balance ?? 0,
    usageByChat: aggregateUsageByChat(usage),
  };
}

export async function chargeCredits(input: RecordUsageInput): Promise<CreditUsage> {
  const usage = await recordCreditUsageAndDecrement(input);
  console.log(
    `credit deduction userId=${input.userId} chatId=${input.chatId} charged=${input.creditsCharged} ` +
      `tokens in=${input.inputTokens} out=${input.outputTokens} cached=${input.cachedTokens}`,
  );
  return usage;
}

export type CreateCreditsCheckoutResult = {
  url: string;
  sessionId: string;
};

export async function createCreditsCheckout(
  userId: string,
  credits: number,
): Promise<CreateCreditsCheckoutResult> {
  if (!isValidCheckoutCredits(credits)) {
    throw new AppError(
      400,
      "invalid_credits",
      `credits must be an integer >= ${MIN_CHECKOUT_CREDITS}`,
    );
  }

  const { sessionId, url, quote } = await createCheckoutSession({ userId, credits });

  try {
    await insertPendingPurchase({
      userId,
      stripeSessionId: sessionId,
      amountPaidCents: quote.amountPaidCents,
      creditsGranted: quote.credits,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `credit purchase pending insert failed userId=${userId} sessionId=${sessionId} ` +
        `credits=${credits} error=${message} (webhook metadata recovery may still complete)`,
    );
  }

  console.log(
    `checkout created userId=${userId} sessionId=${sessionId} ` +
      `credits=${quote.credits} amountCents=${quote.amountPaidCents}`,
  );

  return { url, sessionId };
}

export type RedeemCouponResponse = {
  code: string;
  creditsGranted: number;
  balance: number;
};

export async function redeemCoupon(
  userId: string,
  code: string,
): Promise<RedeemCouponResponse> {
  const normalized = code.trim().toUpperCase();
  console.log(`coupon redeem attempt userId=${userId} code=${normalized}`);

  try {
    const result = await redeemCouponRpc(userId, code);
    console.log(
      `coupon redeem success userId=${userId} code=${result.coupon_code} ` +
        `creditsGranted=${result.credits_granted} balance=${result.balance}`,
    );
    return {
      code: result.coupon_code,
      creditsGranted: result.credits_granted,
      balance: result.balance,
    };
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : err instanceof Error
          ? err.message
          : String(err);

    const mapped = mapCouponRedeemError(message);
    if (mapped) {
      console.log(
        `coupon redeem failed userId=${userId} code=${normalized} reason=${mapped.code}`,
      );
      throw mapped;
    }

    mapDbError("coupons.redeem", {
      code:
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : undefined,
      message,
    });
  }
}

function parsePositiveInt(value: string | undefined): number | null {
  if (value === undefined || value === "") {
    return null;
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
}

function parseNonNegativeInt(value: string | undefined): number | null {
  if (value === undefined || value === "") {
    return null;
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return n;
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const sessionId = session.id;
  const metadata = session.metadata ?? {};

  const userId = metadata.userId || session.client_reference_id || null;
  const creditsGranted = parsePositiveInt(metadata.creditsGranted ?? undefined) ?? null;
  const amountPaidCents =
    parseNonNegativeInt(metadata.amountPaidCents ?? undefined) ??
    (typeof session.amount_total === "number" ? session.amount_total : null);

  if (!userId || creditsGranted === null || amountPaidCents === null) {
    console.error(
      `stripe checkout.session.completed missing fields sessionId=${sessionId} ` +
        `hasUserId=${Boolean(userId)} credits=${creditsGranted} amount=${amountPaidCents}`,
    );
    return;
  }

  const existing = await getPurchaseBySessionId(sessionId);
  if (existing && existing.user_id !== userId) {
    console.error(
      `stripe purchase user mismatch sessionId=${sessionId} ` +
        `purchaseUserId=${existing.user_id} metadataUserId=${userId}`,
    );
    throw new AppError(400, "purchase_user_mismatch", "Purchase user does not match session metadata");
  }

  if (existing?.status === "completed") {
    console.log(`stripe purchase already completed sessionId=${sessionId} (idempotent)`);
    return;
  }

  const purchase = await completeCreditPurchase({
    stripeSessionId: sessionId,
    userId,
    amountPaidCents,
    creditsGranted,
  });

  console.log(
    `stripe purchase completed sessionId=${sessionId} userId=${userId} ` +
      `credits=${creditsGranted} status=${purchase.status} purchaseId=${purchase.id}`,
  );
}

export async function handleStripeWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
): Promise<{ received: true; type: string }> {
  const event = await constructStripeEvent(rawBody, signatureHeader);
  console.log(`stripe webhook received type=${event.type} id=${event.id}`);

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`stripe webhook checkout.session.completed sessionId=${session.id}`);
      await handleCheckoutSessionCompleted(session);
    } else {
      console.log(`stripe webhook ignored type=${event.type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`stripe webhook handle failed type=${event.type} id=${event.id} error=${message}`);
  }

  return { received: true, type: event.type };
}
