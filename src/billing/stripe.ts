import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { loadEnv } from "../config/env.ts";
import { AppError } from "../middleware/error.ts";
import {
  getPackageOrThrow,
  type CreditPackage,
  type CreditPackageId,
} from "../lib/billing/packages.ts";

const STRIPE_API_VERSION = "2026-06-24.dahlia" as const;

let stripeClient: Stripe | null = null;

function requireStripeSecretKey(): string {
  const env = loadEnv();
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(503, "stripe_not_configured", "STRIPE_SECRET_KEY is not configured");
  }
  return env.STRIPE_SECRET_KEY;
}

function requireCheckoutUrls(): { successUrl: string; cancelUrl: string } {
  const env = loadEnv();
  if (!env.CHECKOUT_SUCCESS_URL || !env.CHECKOUT_CANCEL_URL) {
    throw new AppError(
      503,
      "checkout_urls_not_configured",
      "CHECKOUT_SUCCESS_URL and CHECKOUT_CANCEL_URL must be set",
    );
  }
  return {
    successUrl: env.CHECKOUT_SUCCESS_URL,
    cancelUrl: env.CHECKOUT_CANCEL_URL,
  };
}

export function getStripeClient(): Stripe {
  if (stripeClient) {
    return stripeClient;
  }
  stripeClient = new Stripe(requireStripeSecretKey(), { apiVersion: STRIPE_API_VERSION });
  return stripeClient;
}

function integrationIdentifier(): string {
  return `micromanus_checkout_${randomBytes(4).toString("hex")}`;
}

export type CreateCheckoutSessionInput = {
  userId: string;
  packageId: CreditPackageId;
};

export type CreateCheckoutSessionResult = {
  sessionId: string;
  url: string;
  pkg: CreditPackage;
};

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CreateCheckoutSessionResult> {
  const { successUrl, cancelUrl } = requireCheckoutUrls();
  const pkg = getPackageOrThrow(input.packageId);
  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: input.userId,
    integration_identifier: integrationIdentifier(),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: pkg.amountPaidCents,
          product_data: {
            name: `micromanus ${pkg.label} credits (${pkg.credits})`,
          },
        },
      },
    ],
    metadata: {
      userId: input.userId,
      packageId: pkg.id,
      creditsGranted: String(pkg.credits),
      amountPaidCents: String(pkg.amountPaidCents),
    },
  });

  if (!session.url) {
    throw new AppError(502, "stripe_session_missing_url", "Checkout session did not include a URL");
  }

  return {
    sessionId: session.id,
    url: session.url,
    pkg,
  };
}

export async function constructStripeEvent(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
): Promise<Stripe.Event> {
  const env = loadEnv();
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new AppError(
      503,
      "stripe_webhook_not_configured",
      "STRIPE_WEBHOOK_SECRET is not configured",
    );
  }
  if (!signatureHeader) {
    throw new AppError(400, "missing_stripe_signature", "Missing Stripe-Signature header");
  }

  const stripe = getStripeClient();
  try {
    // Bun's SubtleCryptoProvider requires the async verifier.
    return await stripe.webhooks.constructEventAsync(
      rawBody,
      signatureHeader,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid signature";
    console.error(`stripe webhook signature verify failed: ${message}`);
    throw new AppError(400, "invalid_stripe_signature", "Invalid Stripe webhook signature");
  }
}
