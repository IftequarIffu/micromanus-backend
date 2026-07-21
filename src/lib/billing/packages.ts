export type CreditPackageId = "starter" | "standard" | "pro";

export type CreditPackage = {
  id: CreditPackageId;
  label: string;
  credits: number;
  /** Amount in USD cents. */
  amountPaidCents: number;
};

export const CREDIT_PACKAGES: Record<CreditPackageId, CreditPackage> = {
  starter: { id: "starter", label: "Starter", credits: 500, amountPaidCents: 500 },
  standard: { id: "standard", label: "Standard", credits: 2000, amountPaidCents: 1500 },
  pro: { id: "pro", label: "Pro", credits: 5000, amountPaidCents: 3000 },
};

export function isCreditPackageId(value: string): value is CreditPackageId {
  return value in CREDIT_PACKAGES;
}

export function getPackageOrThrow(packageId: string): CreditPackage {
  if (!isCreditPackageId(packageId)) {
    throw new Error(`unknown_package:${packageId}`);
  }
  return CREDIT_PACKAGES[packageId];
}
