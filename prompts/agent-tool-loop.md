# Agent tool loop (think → act → observe → repeat)

## Goal

Make chat completions a first-class **agent loop**: the model can think, call tools, observe results, think again, call more tools, and only then produce a final reply — using the AI SDK’s recommended `ToolLoopAgent` abstraction (AI SDK 7).

Today `streamChatCompletion` already runs a multi-step loop via `streamText` + `stopWhen: isStepCount(8)`, but it is an ad-hoc call site. This work formalizes that into a reusable agent, adds step/tool lifecycle logging, and (optionally) surfaces mid-loop tool progress on the SSE stream so the client can show “searching…”, “creating PDF…”, etc.

**Out of scope:** new tools, frontend UI implementation, credit rate changes, provider model list changes, manual hand-rolled `while` loops, HarnessAgent / Claude Code harnesses.

## Skills read

- `.agents/skills/ai-sdk/SKILL.md` — prefer `ToolLoopAgent` over hand-rolled loops; verify APIs against installed `ai@7.0.32` docs under `node_modules/ai/docs/`
- Bundled docs (must re-check at implement time):
  - `node_modules/ai/docs/03-agents/01-overview.mdx`
  - `node_modules/ai/docs/03-agents/02-building-agents.mdx`
  - `node_modules/ai/docs/03-agents/04-loop-control.mdx`
  - `node_modules/ai/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`
- `AGENTS.md` §11–§12 (streaming / tool loop), §14 (tools), §16 (no secrets), §18 (logging), §19–§21 (tests/checks)

## Existing code inspected

- `src/orchestration/chat.ts` — `streamText({ tools: { web_search, create_pdf }, stopWhen: isStepCount(8), … })`, streams `result.textStream` → SSE `token`; collects sources/PDF; persists after stream
- `src/tools/search.ts` — `createSearchTool(onResults)` via AI SDK `tool()`
- `src/tools/pdf.ts` — `createPdfTool({ userId, chatId, onCreated })`; emits `pdf_ready` mid-loop via callback
- `src/orchestration/models.ts` — curated BYOK models
- `FRONTEND_AGENTS.md` §8 — SSE events today: `chat_created` | `token` | `pdf_ready` | `error` | `done` (no generic tool-step events)

## Decisions / assumptions

1. **Use `ToolLoopAgent`, not a manual while-loop.** Per AI SDK agents docs: construct a per-request agent (model + decrypted BYOK key are request-scoped), then `agent.stream({ messages })`. Keep Express SSE transport — do **not** switch to `createAgentUIStreamResponse` / `useChat` (frontend stays on custom SSE per `FRONTEND_AGENTS.md`).

2. **Loop semantics stay the same as today, just structured:**
   - Tools: `web_search`, `create_pdf` (same modules).
   - `stopWhen: isStepCount(8)` (enough for multiple searches + PDF + final text). Do not use `isLoopFinished()` without a step cap.
   - `maxRetries: 0` (preserve fail-fast billing/auth errors).
   - Same system `instructions` string (search before PDF; one PDF; no invented signed URLs).

3. **Streaming:** Prefer `agent.stream({ messages })` and keep emitting final assistant text via `textStream` → SSE `token`. Verify against installed docs that `stream()` accepts `messages` (chat history) the same way `streamText` does. If the agent API differs, adapt minimally (e.g. `prompt` only for single-turn) — history must still be passed for follow-up chats.

4. **Lifecycle observability (server logs — required):**
   - `onStepStart` / `onStepEnd` — log `chatId`, step number, finish reason, tool names used
   - `onToolExecutionStart` / `onToolExecutionEnd` — log tool name, duration ms, success vs error (**never** log tool inputs/outputs that may contain large report bodies or signed URLs beyond existing pdf path logs; never log API keys)
   - Keep existing search/pdf tool console logs

5. **SSE tool progress (client-visible — required):** Emit lightweight mid-loop events so the UI can show agent activity without parsing text:
   - `event: tool_start` — `{ chatId, toolName, toolCallId }`
   - `event: tool_end` — `{ chatId, toolName, toolCallId, ok: boolean }`
   - Do **not** put full tool args/results on the wire (size + secrets risk). `pdf_ready` remains the rich PDF event.
   - Update `FRONTEND_AGENTS.md` §8 event table + sequence diagrams to document these (contract only; no frontend code in this repo).

6. **Persistence / billing unchanged:** After the agent finishes, still: scrub signed URLs from assistant text, `addAssistantMessage`, persist sources, `chargeCredits`, emit `done` with usage/sources/pdf. Do not persist intermediate tool-only steps as separate assistant messages.

7. **Factory shape:** Extract something like `createChatAgent({ model, tools, instructions, stopWhen, callbacks })` in orchestration (e.g. `src/orchestration/agent.ts` or keep inline in `chat.ts` if small). Route handlers stay thin; no LLM/agent construction in routes.

8. **Credits:** Token usage from the agent stream result must still be the **aggregate** across all steps (verify `result.usage` / total usage field name against AI SDK 7 docs — charge once on the totals, not per step).

## Files likely to change

- `src/orchestration/chat.ts` — switch `streamText` → `ToolLoopAgent` + `stream()`; wire lifecycle → logs + SSE
- `src/orchestration/agent.ts` (new, optional) — agent factory / shared instructions + stop condition
- `FRONTEND_AGENTS.md` — document `tool_start` / `tool_end`
- `README.md` — only if SSE event list is documented there; keep in sync

## Implementation requirements

1. Re-read AI SDK `ToolLoopAgent` / `stream` / lifecycle callback docs for `ai@7.0.32` before coding; do not invent APIs.
2. Replace the `streamText` call site with a per-request `ToolLoopAgent` that receives the already-built language model + tools.
3. Preserve: `chat_created` timing, `token` streaming, `pdf_ready` mid-tool, credit ledger, source persistence, error SSE shape.
4. Emit `tool_start` / `tool_end` from lifecycle callbacks (or equivalent stream parts if callbacks are insufficient — prefer callbacks).
5. Ensure empty final text still yields `empty_response` as today.
6. No decrypted keys in logs, SSE payloads, or agent instructions.

## Security requirements

- Never stream or log decrypted provider keys, `ENCRYPTION_KEY`, Tavily/Stripe secrets, or full PDF section bodies.
- `tool_start` / `tool_end` payloads: names + ids + ok flag only.
- Keep BYOK decrypt scoped to building the model instance, then fall out of scope.

## Acceptance criteria

- [ ] A user message that needs research can trigger **multiple** `web_search` calls across steps, then a final text answer, within the step limit.
- [ ] A PDF request can: search (≥1–2) → `create_pdf` → final text, with `pdf_ready` still mid-stream.
- [ ] Server logs show distinct steps and tool start/end for a multi-tool turn.
- [ ] Client SSE receives `tool_start` / `tool_end` for each tool execution, then `token`* / `done`.
- [ ] Existing auth, credit gate, ownership, and persistence behavior unchanged.
- [ ] `npm run typecheck` and `npm run lint` pass.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm run build` (orchestration / streaming entry changed)

## Exact manual test steps (after implementation)

Prereqs: `npm run dev`, valid Bearer JWT, platform credits > 0, BYOK key for the chosen model, `TAVILY_API_KEY` set, Storage `chat-pdfs` bucket available.

```bash
# 1) Multi-step search loop (expect several tool_start/tool_end for web_search, then tokens)
curl -N -sS -X POST "http://localhost:3000/chats/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.4-mini","content":"What are the latest developments in quantum computing this week? Cite sources."}'

# Watch SSE: chat_created → tool_start/tool_end (web_search, possibly repeated) → token* → done
# Watch server logs: step N start/end, search tool invoked …

# 2) Search + PDF loop
curl -N -sS -X POST "http://localhost:3000/chats/$CHAT_ID/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.4-mini","content":"Create a detailed PDF report on renewable energy trends in 2026 with citations."}'

# Watch SSE: tool_start/end (web_search x N) → tool_start/end (create_pdf) → pdf_ready → token* → done with pdf
```
