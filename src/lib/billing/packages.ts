/** USD cents charged per platform credit ($1). */
export const CENTS_PER_CREDIT = 100;

/** Minimum credits purchasable in one Stripe checkout. */
export const MIN_CHECKOUT_CREDITS = 5;

export type CreditPurchaseQuote = {
  credits: number;
  /** Amount in USD cents (= credits × CENTS_PER_CREDIT). */
  amountPaidCents: number;
};

export function isValidCheckoutCredits(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_CHECKOUT_CREDITS;
}

export function quoteCreditPurchase(credits: number): CreditPurchaseQuote {
  if (!isValidCheckoutCredits(credits)) {
    throw new Error(`invalid_credits:${String(credits)}`);
  }
  return {
    credits,
    amountPaidCents: credits * CENTS_PER_CREDIT,
  };
}
