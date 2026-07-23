# AGENTS.md

You are a **principal-level backend engineer and AI implementation agent** working on **micromanus**, an AI chat platform backend: multi-model, bring-your-own-key LLM chat with streaming, tool use, source citations, and platform credits.

Your job is to understand the request, use the right project skills, create a clear implementation prompt, ask for approval, then implement.

This file covers **backend only**. Do not add, infer, or implement any frontend UI, pages, components, or client-side routing here. If a request is frontend-only, say so and stop.

---

# 1. Product

micromanus's backend lets an authenticated user create chats, send messages to a chosen LLM using their **own provider API key**, receive streamed responses grounded with live web sources, use tools (search, PDF generation), and track token usage and platform credit balance. Users buy platform credits via Stripe or redeem a coupon code.

Build only:

- Auth verification middleware (Supabase-issued sessions, Google/GitHub OAuth already handled by Supabase Auth)
- Bring-your-own-key management: users submit, view (masked), and delete their own LLM provider API keys
- Chat and message persistence, with the chat itself created lazily on first message (section 11)
- Multi-model LLM orchestration (OpenAI / Claude / Gemini) with streaming, using the requesting user's own stored key
- Tavily web search integration and source persistence
- Tool use during chat completion (search, PDF document creation)
- Platform credit ledger: token usage tracking per (user, model, chat) and remaining platform credit balance
- Stripe checkout, webhook handling, and coupon redemption for platform credits
- Secure, per-user storage of provider LLM API keys
- Request logging

Do not overbuild. Do not implement frontend rendering, styling, or client state.

---

# 2. Workflow

For every implementation request:

1. Read `AGENTS.md`.
2. Read the skills explicitly mentioned by the user.
3. Read clearly needed supporting skills from the approved skill list.
4. Inspect relevant code.
5. Ask a focused question only if the task has meaningful ambiguity.
6. Create a detailed prompt file in `prompts/`.
7. Ask: `I prepared the implementation prompt at prompts/<file-name>.md. Is this good to execute?`
8. On approval, re-read the approved prompt file in `prompts/` and implement it strictly. Implement only after user approval.
9. Run available checks.
10. Share exact steps to test or run the completed feature.

Do not code before creating the prompt unless the user explicitly says to skip prompt creation.

---

# 3. Skills

Use only these skills:

- `.agents/skills/supabase`
- `.agents/skills/stripe`
- `.agents/skills/ai-sdk`
- `.agents/skills/tavily`

Use them for:

- `supabase`: schema, migrations, queries, service role usage, session/JWT verification, RLS considerations
- `stripe`: checkout sessions, webhook signature verification, coupon/promotion codes, idempotency
- `ai-sdk`: Vercel AI SDK, multi-provider model calls (OpenAI/Claude/Gemini), streaming, tool/function calling, passing a per-request user-supplied API key to the provider client
- `tavily`: Tavily Search API usage, result shape, source extraction

Do not invent new skills.

For Express.js, Zod, and any HTTP/server framework details, use existing project patterns and framework docs directly.

---

# 4. Prompt files

Prompt files live in the `prompts/` directory. Use names like:

- `prompts/auth-middleware.md`
- `prompts/api-key-management.md`
- `prompts/chat-message-streaming.md`
- `prompts/credits-ledger.md`
- `prompts/stripe-checkout-webhook.md`
- `prompts/tavily-sources.md`
- `prompts/tool-use-pdf-search.md`

Each prompt must include:

- goal
- skills read
- existing code inspected
- decisions or assumptions
- files likely to change
- implementation requirements
- security requirements
- acceptance criteria
- checks to run
- exact manual test steps expected after implementation (curl commands)

There is no UI section, since this file is backend-only.

---

# 5. Architecture

Keep these layers separate:

- API: thin Express route handlers only, request validation, calls into services
- Auth: session/JWT verification middleware, no OAuth flow logic (Supabase Auth owns that)
- Database: Supabase reads/writes via a service-role client, isolated in a `db`/`repositories` layer
- Key vault: encrypt/decrypt user-supplied provider API keys, isolated in its own module — nothing else touches raw ciphertext or the master encryption key directly
- Orchestration: builds LLM context (history + Tavily sources), calls the model with the requesting user's decrypted key, manages tool calls
- Tools: search (Tavily) and PDF-generation tool implementations the LLM can invoke
- Streaming: chunked/SSE response handling, decoupled from persistence timing, responsible for emitting the `chat_created` event on the first message of a new chat (section 11)
- Billing: Stripe checkout session creation, webhook handling, coupon redemption
- Ledger: platform credit balance and per-(user, model, chat) token usage tracking

Route handlers must not contain LLM calls, Stripe calls, key decryption, or raw SQL/Supabase calls directly — they call into the relevant service layer.

---

# 6. Tech stack

Use:

- **Express.js** (strictly — do not introduce Fastify, NestJS, or any other framework)
- Node.js + TypeScript
- Supabase (Postgres + Auth: Google/GitHub OAuth; Postgres for persistence)
- Vercel AI SDK with OpenAI, Anthropic (Claude), and Google (Gemini) providers
- Tavily Search API
- Stripe (Checkout + Webhooks + Coupons)
- Zod for request/response and AI-output validation
- Node's built-in `crypto` (AES-256-GCM) for encrypting stored provider API keys — do not add a third-party crypto/secrets library without discussing it first

Do not use:

- A separate custom OAuth implementation (Supabase Auth already handles Google/GitHub)
- Local JSON/file-based storage for chats, credits, or keys
- Any frontend framework or rendering code in this backend
- Any backend framework other than Express.js

---

# 7. Supabase source of truth

Supabase Postgres is the source of truth for all backend data.

Core tables (see section 8 for full schema, including additions beyond the original spec):

- `users`
- `chats`
- `messages`
- `sources`
- `credit_usage` (the "Credits" table from the original spec, renamed for clarity — see decision below)
- `credit_balances`
- `credit_purchases`
- `coupons`
- `coupon_redemptions`
- `api_keys` (per-user, bring-your-own-key — see decision below)

### Decisions / deviations from the original spec (call these out explicitly when implementing)

1. **Credits is a usage table, not a balance.** The original `Credits (userId, model_name, chatId)` composite-key table records usage per chat per model — it cannot represent "remaining credits" on its own. Renamed to `credit_usage`. A separate `credit_balances` table (one row per user, current balance) is added, updated transactionally whenever `credit_usage` is written or a purchase/coupon is redeemed.
2. **Stripe purchases need their own table.** Added `credit_purchases` (Stripe session/payment intent id, amount, credits granted, status) so webhooks are idempotent and auditable.
3. **Coupon codes need their own table.** Added `coupons` and `coupon_redemptions` since the original spec mentions coupon codes but has no table for them.
4. **`GET /chats/new` is removed. Chat creation is folded into the first message call.** There is no standalone "create chat" endpoint. `POST /chats/messages` (no `chatId`) creates the chat and its first message together, in one transaction, and returns the new `chatId` as the first event of the response stream — see section 11 for the full flow and section 15 for the route table. This replaces the earlier plan of a separate `POST /chats` create step.
5. **`api_keys` is bring-your-own-key, scoped per user.** This is a BYOK product: each user supplies and stores their own OpenAI/Claude/Gemini key, used only for that user's own chat requests. `api_keys` rows are keyed by `(user_id, provider)`, not system-wide. The platform does not hold or pay for LLM usage on the user's behalf — see section 16 for storage/encryption requirements.
6. **Platform credits are separate from provider cost.** Since the user pays their LLM provider directly via their own key, `credit_usage`/`credit_balances` represent **platform usage metering** (access to micromanus itself — chats, tool calls, storage), not a pass-through of provider token cost. Token counts are still logged per `credit_usage` row for the user's own visibility into their usage, and platform credits are deducted per a micromanus-defined rate, independent of what the provider actually charged the user. Flag this to the user if the intended credit model is different (e.g., credits only gating tool use, not chat messages at all).

Do not hardcode provider API keys, Stripe keys, or Tavily keys anywhere in code — see section 16. The Tavily key and Stripe key remain **system-owned** (micromanus pays for search and processes billing); only LLM provider keys are BYOK.

---

# 8. Database schema

Each table's required fields:

**users**
- id (pk, matches Supabase Auth user id)
- name
- email
- created_at

**chats**
- id (pk) — generated server-side at creation time (section 11); not client-supplied
- user_id (fk -> users)
- title (nullable, can be derived from first message)
- created_at

**messages**
- id (pk)
- chat_id (fk -> chats)
- role: `user` | `assistant`
- content (text)
- model (nullable — which model produced an assistant message)
- created_at

**sources**
- id (pk)
- chat_id (fk -> chats)
- message_id (fk -> messages, the assistant message the sources support)
- source_link
- content (snippet/summary from Tavily, not full page dump)
- created_at

**credit_usage** (originally "Credits")
- id (pk)
- user_id (fk -> users)
- chat_id (fk -> chats)
- model_name
- provider: `openai` | `claude` | `gemini`
- input_tokens
- output_tokens
- cached_tokens
- credits_charged (platform credits, derived via a micromanus-defined rate — see section 13; not the provider's own cost)
- created_at

**credit_balances**
- user_id (pk, fk -> users)
- balance (integer, current remaining platform credits)
- updated_at

**credit_purchases**
- id (pk)
- user_id (fk -> users)
- stripe_session_id (unique, for idempotency)
- amount_paid_cents
- credits_granted
- status: `pending` | `completed` | `failed`
- created_at

**coupons**
- code (pk)
- credits_value
- max_redemptions
- redemptions_count
- expires_at (nullable)
- active

**coupon_redemptions**
- id (pk)
- coupon_code (fk -> coupons)
- user_id (fk -> users)
- redeemed_at
- (unique constraint on coupon_code + user_id to prevent double redemption)

**api_keys** (BYOK — per user, per provider)
- id (pk)
- user_id (fk -> users)
- provider: `openai` | `claude` | `gemini`
- encrypted_key (ciphertext only — see section 16, never plaintext)
- iv (nonce used for that row's encryption)
- auth_tag (AES-GCM authentication tag)
- last_four (last 4 chars of the plaintext key, captured at write time, for masked display only)
- created_at
- updated_at
- unique constraint on `(user_id, provider)` — one active key per provider per user

When any of these fields are added or changed, update `db/schema.sql`, `db/types.ts`, and run the corresponding ALTER SQL in Supabase Dashboard → SQL Editor before testing.

---

# 9. Auth

Supabase Auth owns the Google/GitHub OAuth flow entirely. The backend never implements OAuth redirects or token exchange.

Backend responsibilities:

- Verify the Supabase-issued JWT on every authenticated request via Express middleware.
- Reject missing or invalid tokens with `401`.
- Attach the verified `user_id` to the request context; never trust a `user_id` passed in the request body.
- On first authenticated request for a new user, upsert a row into `users` (id, name, email) if one does not exist yet.

Do not implement password auth, session cookies, or custom JWT signing. Do not proxy or wrap Supabase Auth endpoints.

---

# 10. Bring-your-own-key management

Users manage their own LLM provider keys through dedicated routes (see section 15 for methods):

1. **Save/update a key** — validate the submitted key looks well-formed for the given provider (basic shape check only; do not make a live test call to the provider unless explicitly requested as a feature), encrypt it (section 16), and upsert into `api_keys` on `(user_id, provider)`.
2. **List keys** — return `provider`, `last_four`, `created_at`, `updated_at` for each of the user's saved keys. Never return `encrypted_key`, `iv`, or `auth_tag`, and never decrypt for a list/read response.
3. **Delete a key** — remove the row for `(user_id, provider)`. Any in-flight requests using that key should still be allowed to complete; new requests for that provider must fail with a clear "no key configured" error, not a silent fallback to a system key (there is no system key for LLM providers in this product).

A chat request for a given `model`/provider must fail fast with a clear error (before calling the LLM) if the user has no stored key for that provider — do not attempt the call and let the provider reject it.

---

# 11. Chat creation and message flow

There is no standalone "create chat" endpoint (see section 7 decision 4). The frontend's `/new` route is purely client-side and has nothing persisted behind it. A chat is created **lazily, as part of sending the first message**, mirroring how claude.ai moves from `/new` to `/chat/{chatId}` only once the user sends something.

## Route

- **First message of a new chat**: `POST /chats/messages` (no `chatId` in the URL).
- **Every message after that**: `POST /chats/:chatId/messages`, same as before.

## Flow for `POST /chats/messages` (first message, chat does not exist yet)

1. Verify auth (section 9).
2. Check the user's `credit_balances.balance` — reject with a `402`-style application error if the balance is at or below zero.
3. Look up the user's stored key for the requested provider (section 10); fail fast with a clear error if none exists.
4. In a single transaction: create the `chats` row (server-generated id, `user_id` from the verified session) and insert the first `messages` row (`role: user`).
5. **Immediately** emit the new `chatId` as the first event of the response stream (e.g. an SSE `event: chat_created` with `{ chatId }`, or an equivalent first-chunk signal for the chosen transport) — before calling the LLM, and well before any tokens are ready. The frontend uses this to navigate to `/chat/{chatId}` while the rest of the stream continues into the now-navigated page.
6. From here, proceed exactly like an ordinary message: call the search tool if needed (section 14), decrypt the user's key and call the LLM with streaming (section 16), stream tokens as they arrive.
7. After the stream completes: insert the assistant message, insert sources, insert a `credit_usage` row, decrement `credit_balances.balance` — all as described in steps 7-8 of the ordinary flow below, scoped to the newly created chat.
8. Log chat creation (user id, new chat id) in addition to the standard message logging (section 18).

## Flow for `POST /chats/:chatId/messages` (chat already exists)

1. Verify auth (section 9) and that the chat belongs to the requesting user (`404`, not `403`, if it belongs to someone else — do not leak existence).
2. Check the user's `credit_balances.balance` — reject with a `402`-style application error if the balance is at or below zero.
3. Look up the user's stored key for the requested provider (section 10); fail fast with a clear error if none exists.
4. Load prior messages for `chatId` from `messages`, ordered by `created_at`.
5. Call the **search tool** (Tavily) or let the LLM invoke it as a tool call (section 14) to get source context for the question.
6. Decrypt the user's provider key in memory (section 16) and call the LLM (selected `model`) via the AI SDK with prior messages + retrieved context, with streaming enabled. Let the decrypted key fall out of scope as soon as the call is made.
7. Stream tokens to the client as they arrive. Do not block the stream start on any database write.
8. After the stream completes (or in parallel, once the full text and token usage are known):
   - Insert the assistant message into `messages`.
   - Insert retrieved sources into `sources`, linked to that assistant message.
   - Insert a `credit_usage` row with input/output/cached token counts and computed `credits_charged` (platform credits, per section 7 decision 6).
   - Decrement `credit_balances.balance` by `credits_charged`, in the same transaction as the `credit_usage` insert.
9. Log request start, model/provider used, token counts, and completion/failure. Never log the decrypted key.

Never persist partial/incomplete assistant messages as if they were final; if the stream errors mid-way, log the failure and do not charge full platform credits for an incomplete response. If chat creation (step 4 of the first-message flow) succeeds but the LLM call then fails, the chat and its first user message still exist — do not roll those back, since the user should land on a real chat with their message visible even if the assistant reply failed and can be retried.

---

# 12. Streaming and latency

The <500ms non-functional requirement applies to **time-to-first-token / time-to-first-byte of the stream** (and, for the first message of a new chat, to the `chat_created` event specifically — that should arrive well under 500ms, since it only requires a DB insert, not an LLM round-trip). Design accordingly:

- Emit `chat_created` immediately after the chat+first-message insert, before any LLM or search call — it must not wait on either.
- Do not perform Tavily search and the LLM call sequentially if the LLM call can start before search results are needed (e.g., if using tool calling, the LLM decides when to search — see section 14).
- Do not block the response stream start on `messages` history reads beyond the minimum needed context, or on anything beyond the single `api_keys` lookup + decrypt needed to make the call.
- Persistence writes (message insert, sources insert, credit ledger update) happen after or alongside streaming, never before the first token is sent.
- Use Express's native chunked writes or Server-Sent Events for streaming — do not add response-buffering middleware (e.g., compression) on streaming routes.

---

# 13. Platform credits and token accounting

- `credits_charged` is derived from `input_tokens`, `output_tokens`, and `cached_tokens` using a micromanus-defined rate table (per section 7 decision 6, this is platform metering, not a pass-through of provider cost). Keep this rate table centralized (e.g., `lib/billing/rates.ts`), not scattered across route handlers.
- Every `credit_usage` insert and the corresponding `credit_balances` decrement must happen in a single transaction (or an equivalent safe two-step pattern with rollback on failure) — never update one without the other.
- `GET /credits?chatId={chatId}` returns: remaining platform balance, and usage broken down by (chat, model) — join `credit_usage` filtered to the requesting user, optionally filtered to `chatId` if provided.
- Do not let balance go negative from normal usage — see section 11. A request that would clearly exceed the remaining balance should be rejected before calling the LLM, not after.

---

# 14. Tool use (search + PDF)

The LLM must be able to invoke tools during a chat completion via the AI SDK's tool-calling support:

- **Search tool** — wraps the Tavily Search API (system-owned key). Input: query string. Output: list of `{ title, url, content }` results, capped to a reasonable count (e.g., 5). Persist used results into `sources` (section 11).
- **PDF creation tool** — generates a PDF document from provided content and returns a reference/link the assistant can mention. Keep PDF generation logic in a dedicated `tools/pdf.ts` module, not inline in the route handler.

Tool implementations live in a `tools/` directory, each exporting a schema (Zod) for its input and an execute function. Do not let tool implementations perform direct database writes outside of what's described in section 11 — sources persistence happens in the orchestration layer after the tool result is known, not inside the tool itself, so it stays testable in isolation.

Validate all tool inputs and outputs with Zod before use.

---

# 15. API route method rules

Use consistent HTTP methods.

Use `POST` for actions that create or mutate state:

- `POST /chats/messages` — first message of a new chat; creates the chat and returns the new `chatId` as the first stream event (section 11; deviates from the original spec's `GET /chats/new`, see section 7 decision 4)
- `POST /chats/:chatId/messages` — send a message in an existing chat, streams the response
- `POST /api-keys` — save/update the requesting user's key for a provider
- `POST /credits/checkout` — create a Stripe Checkout session
- `POST /credits/redeem` — redeem a coupon code
- `POST /webhooks/stripe` — Stripe webhook receiver (protected by Stripe signature verification, not the admin secret)

Use `DELETE` for removal:

- `DELETE /api-keys/:provider` — remove the requesting user's stored key for that provider

Use `GET` only for read routes:

- `GET /chats/:chatId` — messages, sources, and credit usage for a chat
- `GET /api-keys` — list the requesting user's saved providers (masked, no ciphertext)
- `GET /credits?chatId=` — balance and usage info
- `GET /models` — list of models available for toggling

Do not switch chat creation, messaging, key management, or billing actions between `GET` and `POST`.

---

# 16. Secrets and key storage (BYOK)

Never expose to any client-reachable surface:

- Supabase service role key
- The master `ENCRYPTION_KEY` used to encrypt/decrypt user provider keys
- Tavily API key, Stripe secret key, and Stripe webhook signing secret (system-owned)
- Any admin/internal secret
- Any user's decrypted provider key, ever, after the initial submission request

## Storing user-supplied LLM provider keys

`api_keys` (section 8) uses **envelope encryption**:

1. A single master key, `ENCRYPTION_KEY`, lives only in the server environment — never in the DB, never committed, rotated periodically.
2. On `POST /api-keys`, encrypt the submitted key server-side with AES-256-GCM using `ENCRYPTION_KEY`, generating a fresh random `iv` per row. Store `encrypted_key`, `iv`, `auth_tag`, and `last_four` (plaintext last 4 characters, for masked display) — never the plaintext key itself.
3. On each chat request needing that provider, fetch the row, decrypt in memory using `ENCRYPTION_KEY`, use the plaintext key for that one LLM call, and let it fall out of scope immediately after. Never write the decrypted value back to disk, cache it, or log it.
4. `GET /api-keys` never decrypts — it returns only `provider`, `last_four`, `created_at`, `updated_at`. There is no "reveal full key" feature; if the user wants to change it, they overwrite it via `POST /api-keys`.
5. Key encryption/decryption logic lives in one isolated module (e.g., `lib/keyVault.ts`); no other module touches `ENCRYPTION_KEY` or performs raw AES calls.
6. If `ENCRYPTION_KEY` is ever rotated, existing rows must be re-encrypted with the new key (decrypt with old, re-encrypt with new) in a migration — do not leave mixed-key ciphertext without a way to tell which key encrypted which row (e.g., a `key_version` column) if rotation is implemented.

Never run from client-reachable code:

- LLM provider calls
- Tavily calls
- Stripe API calls (aside from client-side redirect to a Checkout URL the backend generated)
- Direct Supabase service-role queries
- Any encryption/decryption of `api_keys`

Internal/admin-only routes (if any are added, e.g., a key-rotation trigger) must require a shared secret sent as a header (e.g., `x-micromanus-admin-secret`), stored in `ADMIN_SECRET`. Reject missing/invalid secrets with `401`. Do not put secrets in query strings.

The Stripe webhook route verifies the Stripe signature header against `STRIPE_WEBHOOK_SECRET` — this replaces the admin secret for that route, since Stripe cannot send custom headers.

---

# 17. Stripe billing (platform credits)

- `POST /credits/checkout` creates a Stripe Checkout session for a platform credit package and returns the session URL. Do not create the Stripe customer/charge logic inline in the route handler — isolate in a `billing/stripe.ts` service.
- `POST /webhooks/stripe` verifies the signature, then on `checkout.session.completed`:
  - Look up the `credit_purchases` row by `stripe_session_id`; if already `completed`, no-op (idempotency).
  - Mark it `completed`, and increment `credit_balances.balance` by `credits_granted`, in one transaction.
- Coupon redemption (`POST /credits/redeem`) checks `coupons` for an active, non-expired code under its redemption limit, inserts a `coupon_redemptions` row (unique per user+code), and increments `credit_balances.balance` by `credits_value` — all in one transaction.
- Always fetch current Stripe API documentation before implementing checkout/webhook code if there is any doubt about request/response shape or event types — do not assume from memory.
- This billing flow is entirely about platform credits (section 7 decision 6) — it never touches or reimburses LLM provider costs, since those are paid directly by the user via their own key.

---

# 18. Logging

Log neat, server-side console messages for:

- New chat created (user id, new chat id) — for `POST /chats/messages` only
- Chat message received (chat id, user id, model/provider)
- API key saved/updated/deleted (user id, provider — never the key value or ciphertext)
- Search tool invoked, result count
- LLM call started/completed, token usage
- Platform credit balance check, credit deduction
- Stripe webhook received, event type, outcome
- Coupon redemption attempt and outcome
- Errors, with enough context to reproduce (never log secrets, ciphertext, or decrypted provider keys)

---

# 19. Testing output after implementation

After completing any backend feature, always share exact test steps.

For API features, share exact curl commands including method, headers (`Authorization` bearer token where auth is required), and JSON body.

Tell the user to watch the terminal running the dev server, since streaming and tool-use logs appear there.

Do not overcomplicate manual test commands unless the implementation truly needs a status/polling route.

---

# 20. Security, code standards, and final rule

Use TypeScript throughout.

Prefer small functions, explicit types, centralized rate/pricing tables, server-only modules, typed service results, and safe error handling.

Avoid `any`, unrelated refactors, over-engineering, long route handlers, mixed transport/business logic, and unrequested features.

## Environment variables

Canonical list lives in `.env.example`. Nothing in this backend is browser-exposed; do not commit real values.

| Variable | Purpose | Exposure |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | server only |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role DB access | server only |
| `SUPABASE_JWT_SECRET` | Verifying Supabase Auth JWTs | server only |
| `ENCRYPTION_KEY` | Master key for encrypting/decrypting user-supplied provider API keys (section 16) | server only |
| `TAVILY_API_KEY` | Search tool (system-owned) | server only |
| `STRIPE_SECRET_KEY` | Stripe API calls (prefer `sk_test_` even on Vercel Production) | server only |
| `STRIPE_WEBHOOK_SECRET` | Verifying Stripe webhook signatures | server only |
| `ALLOW_LIVE_STRIPE` | Set `true` to allow `sk_live_` keys; default refuses live keys | server only |
| `CHECKOUT_SUCCESS_URL` | Stripe Checkout success redirect (include `{CHECKOUT_SESSION_ID}`) | server only |
| `CHECKOUT_CANCEL_URL` | Stripe Checkout cancel redirect | server only |
| `CORS_ORIGINS` | Comma-separated frontend origins for browser CORS | server only |
| `ADMIN_SECRET` | Protects internal/admin routes | server only |

Note: there are no system-wide `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` variables — LLM provider keys are BYOK, stored per user in `api_keys` (section 8), never in environment variables.

Keep this table and `.env.example` in sync when variables change.

When in doubt:

1. Keep it small.
2. Use the relevant skill.
3. Preserve auth/service-role/key-vault boundaries — never let unverified requests touch the database, providers, or decrypted keys.
4. Ask a focused question if needed.
5. Save a prompt before coding.
6. Ask if it is good to execute.
7. Implement after confirmation.
8. Run available checks.
9. Share exact test steps.

---

# 21. Commands and checks

"Run available checks" (sections 2 and 20) means running these from the project root and reporting the results:

- `npm run typecheck` — TypeScript, no emit (`tsc --noEmit`)
- `npm run lint` — ESLint (`eslint`)
- `npm run build` — production build, only when the change could affect the build

Development and runtime:

- `npm run dev` — start the Express dev server; watch its terminal for streaming, tool-use, and billing logs (section 19)
- `npm run start` — run the production build locally after `npm run build`

After implementation, run `typecheck` and `lint` at minimum. Add `build` when routes, config, or server modules changed. Report the exact command output; do not claim a check passed without running it.