import type { LlmProvider } from "../../db/types.ts";
import { AppError } from "../middleware/error.ts";

export type ModelDefinition = {
  id: string;
  provider: LlmProvider;
  label: string;
};

/**
 * Curated models from AI SDK provider docs (installed package versions).
 * ids must match what createOpenAI / createAnthropic / createGoogle accept.
 */
export const AVAILABLE_MODELS: readonly ModelDefinition[] = [
  { id: "gpt-5.4-mini", provider: "openai", label: "GPT-5.4 Mini" },
  { id: "gpt-5.4-nano", provider: "openai", label: "GPT-5.4 Nano" },
  { id: "claude-sonnet-4-5-20250929", provider: "claude", label: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4-5-20251001", provider: "claude", label: "Claude Haiku 4.5" },
  { id: "gemini-2.5-flash", provider: "gemini", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", provider: "gemini", label: "Gemini 2.5 Pro" },
] as const;

const byId = new Map(AVAILABLE_MODELS.map((m) => [m.id, m]));

export function resolveModel(modelId: string): ModelDefinition {
  const model = byId.get(modelId);
  if (!model) {
    throw new AppError(400, "unknown_model", `Unknown model "${modelId}"`);
  }
  return model;
}

export function listModels(): ModelDefinition[] {
  return [...AVAILABLE_MODELS];
}
