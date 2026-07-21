import { AppError } from "../middleware/error.ts";

const COUPON_ERROR_CODES = new Set([
  "coupon_not_found",
  "coupon_inactive",
  "coupon_expired",
  "coupon_exhausted",
  "coupon_already_redeemed",
]);

function couponAppError(code: string): AppError | null {
  switch (code) {
    case "coupon_not_found":
      return new AppError(404, code, "Coupon code not found");
    case "coupon_inactive":
      return new AppError(400, code, "Coupon is inactive");
    case "coupon_expired":
      return new AppError(400, code, "Coupon has expired");
    case "coupon_exhausted":
      return new AppError(400, code, "Coupon has reached its redemption limit");
    case "coupon_already_redeemed":
      return new AppError(409, code, "You have already redeemed this coupon");
    default:
      return null;
  }
}

/** Extract a known coupon error code from a PostgREST / Postgres error message. */
export function mapCouponRedeemError(message: string): AppError | null {
  for (const code of COUPON_ERROR_CODES) {
    if (message.includes(code)) {
      return couponAppError(code);
    }
  }
  return null;
}

/** Map PostgREST / Postgres errors into AppError when possible. */
export function mapDbError(context: string, error: { code?: string; message?: string }): never {
  const code = error.code ?? "";
  const message = error.message ?? "unknown";

  const couponErr = mapCouponRedeemError(message);
  if (couponErr) {
    throw couponErr;
  }

  // undefined_column / missing schema cache column — usually unapplied BYOK migration
  if (
    code === "42703" ||
    code === "PGRST204" ||
    /column .* does not exist/i.test(message) ||
    /Could not find the .* column/i.test(message)
  ) {
    throw new AppError(
      503,
      "schema_outdated",
      "Database schema is outdated for api_keys. Run db/migrations/001_api_keys_byok.sql in the Supabase SQL Editor, then retry.",
    );
  }

  // missing RPC — redeem_coupon or complete_credit_purchase not applied
  if (
    code === "PGRST202" ||
    /Could not find the function/i.test(message) ||
    /function .* does not exist/i.test(message)
  ) {
    throw new AppError(
      503,
      "schema_outdated",
      "Database schema is outdated. Run pending migrations in db/migrations/ via the Supabase SQL Editor, then retry.",
    );
  }

  throw new Error(`${context}: ${code || message}`);
}
