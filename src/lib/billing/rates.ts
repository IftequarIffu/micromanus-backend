import type { LlmProvider } from "../../../db/types.ts";

/** Credits charged per 1k tokens. Placeholder zeros until billing rates are finalized. */
export type ProviderRates = {
  inputPer1k: number;
  outputPer1k: number;
  cachedPer1k: number;
};

export const PROVIDER_RATES: Record<LlmProvider, ProviderRates> = {
  openai: { inputPer1k: 0, outputPer1k: 0, cachedPer1k: 0 },
  claude: { inputPer1k: 0, outputPer1k: 0, cachedPer1k: 0 },
  gemini: { inputPer1k: 0, outputPer1k: 0, cachedPer1k: 0 },
};

export function creditsFromTokens(
  provider: LlmProvider,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
): number {
  const rates = PROVIDER_RATES[provider];
  const input = (inputTokens / 1000) * rates.inputPer1k;
  const output = (outputTokens / 1000) * rates.outputPer1k;
  const cached = (cachedTokens / 1000) * rates.cachedPer1k;
  return Math.ceil(input + output + cached);
}

/**
 * Published provider list prices (USD per 1M tokens).
 * Used to estimate BYOK spend — the user is billed by their provider, not micromanus.
 */
export type ModelUsdRates = {
  /** USD per 1M non-cached input tokens */
  inputPer1M: number;
  /** USD per 1M output tokens */
  outputPer1M: number;
  /** USD per 1M cache-read / cached input tokens */
  cachedPer1M: number;
};

/** Rates keyed by model id from AVAILABLE_MODELS. */
export const MODEL_USD_RATES: Record<string, ModelUsdRates> = {
  "gpt-5.4-mini": { inputPer1M: 0.75, outputPer1M: 4.5, cachedPer1M: 0.075 },
  "gpt-5.4-nano": { inputPer1M: 0.2, outputPer1M: 1.25, cachedPer1M: 0.02 },
  "claude-sonnet-4-5-20250929": { inputPer1M: 3, outputPer1M: 15, cachedPer1M: 0.3 },
  "claude-haiku-4-5-20251001": { inputPer1M: 1, outputPer1M: 5, cachedPer1M: 0.1 },
  "gemini-2.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5, cachedPer1M: 0.03 },
  // Standard tier (<=200k prompt); long-context tier is higher.
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10, cachedPer1M: 0.125 },
};

/**
 * Estimate USD cost from token counts.
 * Treats `cachedTokens` as a subset of `inputTokens` billed at the cache rate;
 * remaining input is billed at the full input rate.
 */
export function usdCostFromTokens(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
): number {
  const rates = MODEL_USD_RATES[modelName];
  if (!rates) {
    return 0;
  }

  const cached = Math.min(Math.max(0, cachedTokens), Math.max(0, inputTokens));
  const billableInput = Math.max(0, inputTokens) - cached;
  const cost =
    (billableInput / 1_000_000) * rates.inputPer1M +
    (cached / 1_000_000) * rates.cachedPer1M +
    (Math.max(0, outputTokens) / 1_000_000) * rates.outputPer1M;

  // Keep sub-cent precision for small chats; round to 1/100 of a cent.
  return Math.round(cost * 100_000) / 100_000;
}
