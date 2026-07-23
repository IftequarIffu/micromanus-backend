import {
  ToolLoopAgent,
  isStepCount,
  type LanguageModel,
} from "ai";
import type { createPdfTool } from "../tools/pdf.ts";
import type { createSearchTool } from "../tools/search.ts";

/** Max LLM steps per chat turn (think → tools → observe → final text). */
export const CHAT_AGENT_MAX_STEPS = 8;

export const CHAT_AGENT_INSTRUCTIONS =
  "You are a helpful assistant in micromanus. " +
  "Use the web_search tool (Tavily) whenever current information or citations would help — do not invent news or URLs. " +
  "When the user asks for a PDF, report, or downloadable document: " +
  "(1) call web_search at least twice with different queries/angles to gather Tavily sources; " +
  "(2) call create_pdf exactly once with a real title, at least 5 detailed sections (each several paragraphs of analysis grounded in the search results — never short stubs), " +
  "and a sources list whose title+url pairs come only from those web_search results — do not call create_pdf again to revise the same report; " +
  "(3) in your final reply, briefly summarize and tell the user the PDF is ready via the View PDF control — " +
  "never invent, reconstruct, or paste any download, storage, or signed URL. Be accurate; prefer depth for PDF reports.";

export type ChatTools = {
  web_search: ReturnType<typeof createSearchTool>;
  create_pdf: ReturnType<typeof createPdfTool>;
};

export type CreateChatAgentParams = {
  model: LanguageModel;
  tools: ChatTools;
};

/**
 * Per-request chat agent: multi-step tool loop (BYOK model + request-scoped tools).
 */
export function createChatAgent(
  params: CreateChatAgentParams,
): ToolLoopAgent<never, ChatTools> {
  return new ToolLoopAgent({
    model: params.model,
    tools: params.tools,
    instructions: CHAT_AGENT_INSTRUCTIONS,
    stopWhen: isStepCount(CHAT_AGENT_MAX_STEPS),
    // Billing / auth failures should fail fast (default retries hide the real error)
    maxRetries: 0,
  });
}
