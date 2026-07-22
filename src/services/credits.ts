import type { CreditBalance, CreditUsage } from "../../db/types.ts";
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
): Promise<{ balance: number; usage: CreditUsage[] }> {
  const [balanceRow, usage] = await Promise.all([
    getCreditBalance(userId),
    listCreditUsageForUser(userId, chatId),
  ]);

  return {
    balance: balanceRow?.balance ?? 0,
    usage,
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
