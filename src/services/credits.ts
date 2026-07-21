import type { CreditBalance, CreditUsage } from "../../db/types.ts";
import {
  getCreditBalance,
  listCreditUsageForUser,
  recordCreditUsageAndDecrement,
  type RecordUsageInput,
} from "../db/repositories/credits.ts";
import { AppError } from "../middleware/error.ts";

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
