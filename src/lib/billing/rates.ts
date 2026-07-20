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
