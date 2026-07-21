# Chat message streaming (lazy chat creation + BYOK LLM)

## Goal

Implement **backend chat functionality** per `AGENTS.md` §11–§15: lazy chat creation on first message, SSE streaming of assistant replies via Vercel AI SDK (OpenAI / Claude / Gemini) using the requesting user's **bring-your-own-key**, Tavily search as an LLM tool with source persistence, platform credit balance gate + usage ledger write, and `GET /chats/:chatId` / `GET /models`.

**Out of scope for this prompt:** Stripe checkout/webhooks, coupon redemption, PDF tool (leave a stub or omit until `tool-use-pdf-search.md`).

## Skills read

- `.agents/skills/ai-sdk/SKILL.md` — install `ai` + provider packages; **never write AI SDK APIs from memory**; verify against `node_modules/ai/docs/` for the installed version (`streamText`, tools, per-request API keys)
- `.agents/skills/supabase/SKILL.md` — service-role queries, schema/RLS, no client-trusted `user_id`
- `.agents/skills/tavily-best-practices/SKILL.md` (+ search reference) — system-owned Tavily Search for the search tool
- `AGENTS.md` §7 decisions 4–6, §8 (schema), §10 (BYOK), §11–§14 (chat/streaming/credits/tools), §15 (routes), §16 (key vault), §18 (logging)

## Existing code inspected

- Auth works: `src/middleware/auth.ts` + `verify-supabase-jwt.ts` + `users` repo/service; `GET /me`
- `src/routes/chats.ts` — stubs: `POST /chats`, `GET /chats/:chatId`, `POST /chats/:chatId/messages` (**outdated** vs AGENTS §7 decision 4 / §15)
- `src/orchestration/index.ts`, `src/tools/index.ts` — empty stubs
- `src/lib/crypto/keys.ts` — encrypt/decrypt throw `not implemented`
- `src/lib/billing/rates.ts` — placeholder rates all `0`
- `db/schema.sql` `api_keys` — **system-wide** `(provider, encrypted_key, active)` including `tavily`/`stripe` in enum — **does not match** AGENTS BYOK `(user_id, provider)` + `iv`/`auth_tag`/`last_four`
- `src/config/env.ts` / `.env.example` still list `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_GEMINI_API_KEY` — contradict AGENTS §16/§20 (LLM keys are BYOK only)
- `package.json` — no `ai`, `@ai-sdk/*`, or Tavily client yet
- No `api-keys` routes mounted

## Decisions / assumptions

1. **Align routes with current AGENTS.md (not scaffold):**
   - Remove `POST /chats` as a create-only endpoint.
   - Add `POST /chats/messages` — first message; creates chat + user message; first SSE event is `chat_created` with `{ chatId }`.
   - Keep `POST /chats/:chatId/messages` — follow-up messages.
   - Keep `GET /chats/:chatId` — messages, sources, credit_usage for that chat (owner-only; foreign chat → `404`).
   - Implement `GET /models` with a small curated list of model ids mapped to providers.

2. **BYOK is in scope for this prompt** (chat cannot work without it). Include:
   - Schema migration of `api_keys` to per-user BYOK shape (AGENTS §8).
   - Isolated key vault (`src/lib/keyVault.ts` or replace `src/lib/crypto/keys.ts`) using Node `crypto` AES-256-GCM + `ENCRYPTION_KEY`.
   - Routes: `POST /api-keys`, `GET /api-keys`, `DELETE /api-keys/:provider`.
   - Chat fails fast with a clear error if no key for the requested provider — **never** fall back to env LLM keys.
   - Remove unused system LLM env vars from `.env.example` / `env.ts` (keep `TAVILY_API_KEY`, Stripe, Supabase, `ENCRYPTION_KEY`).

3. **Search tool in scope; PDF deferred.** Wire Tavily search as an AI SDK tool the model may call. Persist search results used for the reply into `sources` in the orchestration layer after the stream completes (not inside the tool). PDF tool: omit or stub export only.

4. **Credits gate + ledger write in scope; Stripe/coupons deferred.** Before LLM: require `credit_balances.balance > 0` else `402` (`insufficient_credits`). After successful complete stream: insert `credit_usage` + decrement balance together. Rates may remain placeholder zeros for now — still write the ledger row with computed `credits_charged`. Document SQL to seed a test balance. Full `GET /credits` can be thin (balance + usage for user / optional chatId) or deferred to a credits prompt if timeboxed — prefer implementing a minimal `GET /credits` since chat needs balance semantics.

5. **Streaming transport: SSE** over Express response (`Content-Type: text/event-stream`, no compression on these routes). Event shape:
   - `event: chat_created` / `data: {"chatId":"..."}` — only on first-message route, immediately after chat+user-message insert, **before** LLM/search.
   - `event: token` (or AI SDK-compatible text deltas) for streamed text.
   - `event: done` / error event on completion/failure.
   Document the exact event names in README / route comments so a future frontend can consume them. Prefer verifying whether `streamText` has an Express/Node SSE helper in the installed AI SDK docs; use that if suitable, otherwise pipe manually.

6. **Request body (both message POSTs):** Zod-validated `{ content: string, model: string }` (and optionally `provider` if not derivable from `model`). Never accept `user_id` or client-supplied `chatId` for creation.

7. **Provider clients:** construct OpenAI / Anthropic / Google clients **per request** with the decrypted user key (AI SDK provider `apiKey` option — confirm in bundled docs). Map `model` → provider via a centralized registry (same source as `GET /models`).

8. **Supabase “transactions”:** JS client has no multi-statement txn. Prefer:
   - Postgres RPC (`create_chat_with_first_message`, `record_credit_usage_and_decrement`) **or**
   - sequential writes with clear failure logging and no negative balance (CHECK already exists).
   Document chosen approach. Chat+first user message must persist even if LLM later fails (AGENTS §11).

9. **Title:** set `chats.title` from a truncated first user message (e.g. first ~80 chars) at creation time.

10. **Install packages:** `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, and a Tavily client (or thin `fetch` wrapper). Pin versions; read bundled AI SDK docs before coding stream/tool APIs.

## Files likely to change

```
db/schema.sql                          # migrate api_keys to BYOK; ALTER notes for Dashboard
db/types.ts                            # ApiKey BYOK shape; drop tavily/stripe from llm key type
package.json / bun.lock                # ai + providers + tavily
.env.example / src/config/env.ts       # drop system LLM keys; require ENCRYPTION_KEY at key/chat use
src/lib/keyVault.ts (or crypto/keys)   # AES-256-GCM encrypt/decrypt
src/db/repositories/chats.ts
src/db/repositories/messages.ts
src/db/repositories/sources.ts
src/db/repositories/api-keys.ts
src/db/repositories/credits.ts         # balance get + usage insert + decrement
src/services/api-keys.ts
src/services/chats.ts                  # create+message, ownership, get chat aggregate
src/services/credits.ts                # balance check helpers
src/orchestration/chat.ts              # streamText, tools, post-stream persistence
src/orchestration/models.ts            # model registry
src/tools/search.ts                    # Tavily search tool (Zod in/out)
src/tools/index.ts
src/routes/chats.ts                    # real handlers + SSE
src/routes/api-keys.ts                 # new
src/routes/models.ts                   # curated list
src/routes/credits.ts                  # minimal GET (optional but preferred)
src/app.ts                             # mount api-keys; fix chat routes
README.md                              # curl tests + schema ALTER apply steps
prompts/chat-message-streaming.md      # this file
```

## Implementation requirements

1. **Schema:** Update `api_keys` to: `user_id`, `provider` (`openai`|`claude`|`gemini` only), `encrypted_key`, `iv`, `auth_tag`, `last_four`, `created_at`, `updated_at`, unique `(user_id, provider)`. Provide idempotent SQL (drop/recreate or ALTER) and instruct applying via Supabase SQL Editor before testing. Update `db/types.ts`.

2. **Key vault + api-keys routes:** encrypt on save; list never decrypts; delete by `(userId, provider)`; basic key shape validation only.

3. **Repositories / services:** chats, messages, sources, api_keys, credit_balances/credit_usage — no Supabase calls inside route handlers.

4. **Orchestration:**
   - Resolve model → provider → decrypt key → `streamText` with history + search tool.
   - Emit SSE; on success persist assistant message, sources, credit_usage + balance decrement.
   - On mid-stream failure: log; do not write final assistant message as complete; do not charge full credits; leave chat+user message intact for new-chat path.

5. **Latency:** `chat_created` before any LLM/Tavily work. Do not pre-run Tavily sequentially before starting the model when using tool calling.

6. **Logging:** chat created, message received, LLM start/complete + tokens, search invoked + result count, credit check/deduction, errors — never log decrypted keys or ciphertext.

7. **Layers:** routes (validate + SSE headers) → services → orchestration / repos / keyVault / tools.

## Security requirements

- Never trust body `user_id` / client-generated chat ids for ownership.
- Foreign or missing chat → `404` (not `403`).
- Never expose `ENCRYPTION_KEY`, decrypted provider keys, service-role key, or Tavily key.
- `GET /api-keys` returns only `provider`, `last_four`, `created_at`, `updated_at`.
- No system LLM env fallback.
- SSE routes: auth before opening the stream; reject `402`/`400`/`404` as JSON **before** switching to `text/event-stream` when possible.

## Acceptance criteria

- [ ] `POST /chats/messages` with valid auth, balance > 0, and stored provider key creates chat + user message, emits SSE `chat_created` first, then streams assistant tokens; persists assistant message + optional sources + credit_usage after completion
- [ ] `POST /chats/:chatId/messages` streams a follow-up in an owned chat; other user's chatId → `404`
- [ ] Missing provider key → clear error before LLM call; balance ≤ 0 → `402`
- [ ] `GET /chats/:chatId` returns messages, sources, usage for owner
- [ ] `GET /models` returns available models
- [ ] `POST/GET/DELETE /api-keys` work with encrypted storage; list is masked
- [ ] No plaintext keys in logs or API responses
- [ ] `bun run typecheck` and `bun run lint` pass

## Checks to run

```bash
bun run typecheck
bun run lint
bun run build   # routes/orchestration/config changed
```

## Manual test steps (after implementation)

Apply updated `db/schema.sql` (or the ALTER block) in Supabase Dashboard → SQL Editor. Seed credits for your user:

```sql
insert into credit_balances (user_id, balance)
values ('<YOUR_USER_UUID>', 1000)
on conflict (user_id) do update set balance = excluded.balance, updated_at = now();
```

```bash
# Terminal A
bun run dev

# Terminal B — save a BYOK key (example: openai)
curl -sS http://localhost:3000/api-keys \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","apiKey":"sk-..."}'

curl -sS http://localhost:3000/api-keys \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"
# expect masked last_four only

curl -sS http://localhost:3000/models \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"

# First message of a new chat (SSE)
curl -sS -N http://localhost:3000/chats/messages \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"content":"Say hello in one sentence.","model":"<model-id-from-/models>"}'
# expect: event chat_created with chatId, then token events, then done

# Follow-up (replace CHAT_ID)
curl -sS -N http://localhost:3000/chats/<CHAT_ID>/messages \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"content":"What did I just ask you?","model":"<model-id>"}'

curl -sS http://localhost:3000/chats/<CHAT_ID> \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"
# expect messages + any sources + usage

# Insufficient credits
# set balance to 0 in SQL, then POST /chats/messages → expect 402
```

Watch the dev-server terminal for chat/LLM/search/credit logs (no key material).
