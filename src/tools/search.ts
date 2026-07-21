import { tool } from "ai";
import { tavily } from "@tavily/core";
import { z } from "zod";
import { loadEnv } from "../config/env.ts";

export const searchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
});

export type SearchResult = z.infer<typeof searchResultSchema>;

const searchOutputSchema = z.object({
  results: z.array(searchResultSchema),
});

export type CollectedSource = SearchResult;

/**
 * Tavily web search tool for AI SDK tool-calling.
 * Does not write to the database — orchestration persists sources after the stream.
 */
export function createSearchTool(onResults: (results: SearchResult[]) => void) {
  return tool({
    description:
      "Search the live web for current information. Use when the user question needs up-to-date facts or sources.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Search query"),
    }),
    execute: async ({ query }) => {
      const env = loadEnv();
      if (!env.TAVILY_API_KEY) {
        throw new Error("TAVILY_API_KEY is not configured");
      }

      const client = tavily({ apiKey: env.TAVILY_API_KEY });
      const response = await client.search(query, { maxResults: 5 });

      const results: SearchResult[] = (response.results ?? [])
        .slice(0, 5)
        .map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          content: (r.content ?? "").slice(0, 2000),
        }));

      const parsed = searchOutputSchema.parse({ results });
      console.log(`search tool invoked query_len=${query.length} result_count=${parsed.results.length}`);
      onResults(parsed.results);
      return parsed;
    },
  });
}
