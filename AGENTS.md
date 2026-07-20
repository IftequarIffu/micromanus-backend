# AGENTS.md

You are a **principal-level backend engineer and AI implementation agent** working on **micromanus**, an AI chat platform backend: multi-model LLM chat with streaming, tool use, source citations, credits, and Stripe billing.

Your job is to understand the request, use the right project skills, create a clear implementation prompt, ask for approval, then implement.

This file covers **backend only**. Do not add, infer, or implement any frontend UI, pages, components, or client-side routing here. If a request is frontend-only, say so and stop.

---

# 1. Product

micromanus's backend lets an authenticated user create chats, send messages to a chosen LLM, receive streamed responses grounded with live web sources, use tools (search, PDF generation), and track token usage and credit balance. Users buy credits via Stripe or redeem a coupon code.

Build only:

- Auth verification middleware (Supabase-issued sessions, Google/GitHub OAuth already handled by Supabase Auth)
- Chat and message persistence
- Multi-model LLM orchestration (OpenAI / Claude / Gemini) with streaming
- Tavily web search integration and source persistence
- Tool use during chat completion (search, PDF document creation)
- Credit ledger: usage tracking per (user, model, chat) and remaining balance
- Stripe checkout, webhook handling, and coupon redemption for credits
- Secure storage of provider LLM API keys
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
- `ai-sdk`: Vercel AI SDK, multi-provider model calls (OpenAI/Claude/Gemini), streaming, tool/function calling
- `tavily`: Tavily Search API usage, result shape, source extraction

Do not invent new skills.

For Express, Zod, and any HTTP/server framework details, use existing project patterns, package docs, and framework docs directly.

---

# 4. Prompt files

Prompt files live in the `prompts/` directory. Use names like:

- `prompts/auth-middleware.md`
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

- API: thin route handlers only (Express), request validation, calls into services
- Auth: session/JWT verification middleware, no OAuth flow logic (Supabase Auth owns that)
- Database: Supabase reads/writes via a service-role client, isolated in a `db`/`repositories` layer
- Orchestration: builds LLM context (history + Tavily sources), calls the model, manages tool calls
- Tools: search (Tavily) and PDF-generation tool implementations the LLM can invoke
- Streaming: chunked/SSE response handling, decoupled from persistence timing
- Billing: Stripe checkout session creation, webhook handling, coupon redemption
- Ledger: credit balance and per-(user, model, chat) usage tracking, token accounting

Route handlers must not contain LLM calls, Stripe calls, or raw SQL/Supabase calls directly — they call into the relevant service layer.

---

# 6. Tech stack

Use:

- Node.js backend (Express)
- TypeScript
- Supabase (Postgres + Auth: Google/GitHub OAuth; Postgres for persistence)
- Vercel AI SDK with OpenAI, Anthropic (Claude), and Google (Gemini) providers
- Tavily Search API
- Stripe (Checkout + Webhooks + Coupons)
- Zod for request/response and AI-output validation

Do not use:

- A separate custom OAuth implementation (Supabase Auth already handles Google/GitHub)
- Local JSON/file-based storage for chats, credits, or keys
- Any frontend framework or rendering code in this backend

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
- `api_keys`

### Decisions / deviations from the original spec (call these out explicitly when implementing)

1. **Credits is a usage table, not a balance.** The original `Credits (userId, model_name, chatId)` composite-key table records usage per chat per model — it cannot represent "remaining credits" on its own. Renamed to `credit_usage`. A separate `credit_balances` table (one row per user, current balance) is added, updated transactionally whenever `credit_usage` is written or a purchase/coupon is redeemed.
2. **Stripe purchases need their own table.** Added `credit_purchases` (Stripe session/payment intent id, amount, credits granted, status) so webhooks are idempotent and auditable.
3. **Coupon codes need their own table.** Added `coupons` (code, credits value, max redemptions, expiry, redeemed_by tracking) since the original spec mentions coupon codes but has no table for them.
4. **`GET /chats/new` becomes `POST /chats`.** Creating a chat is a mutation; per the API method rules in section 14, mutations use `POST`. This is a deviation from the original spec's `GET /chats/new` and must be flagged to the user before implementing.
5. **API Key storage is for system/provider keys, not user-supplied keys**, since the requirement is "system must store LLM API keys securely" and the app calls OpenAI/Claude/Gemini on the user's behalf. If per-user bring-your-own-key support is wanted later, that is a new feature, not part of this scope.

Do not hardcode provider API keys, Stripe keys, or Tavily keys anywhere in code — see section 15.

---

# 8. Database schema

Each table's required fields:

**users**
- id (pk, matches Supabase Auth user id)
- name
- email
- created_at

**chats**
- id (pk)
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
- credits_charged (derived from tokens via a per-provider rate — see section 12)
- created_at

**credit_balances**
- user_id (pk, fk -> users)
- balance (integer, current remaining credits)
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

**api_keys**
- id (pk)
- provider: `openai` | `claude` | `gemini` | `tavily` | `stripe`
- encrypted_key (never store plaintext; see section 15)
- active
- created_at

When any of these fields are added or changed, update `db/schema.sql`, `db/types.ts`, and run the corresponding ALTER SQL in Supabase Dashboard → SQL Editor before testing.

---

# 9. Auth

Supabase Auth owns the Google/GitHub OAuth flow entirely. The backend never implements OAuth redirects or token exchange.

Backend responsibilities:

- Verify the Supabase-issued JWT on every authenticated request via middleware.
- Reject missing or invalid tokens with `401`.
- Attach the verified `user_id` to the request context; never trust a `user_id` passed in the request body.
- On first authenticated request for a new user, upsert a row into `users` (id, name, email) if one does not exist yet.

Do not implement password auth, session cookies, or custom JWT signing. Do not proxy or wrap Supabase Auth endpoints.

---

# 10. Chat and message flow

Canonical flow for `POST /chats/:chatId/messages`:

1. Verify auth (section 9) and that the chat belongs to the requesting user.
2. Check the user's `credit_balances.balance` — reject with `402`-style application error if the balance is at or below zero. Do not silently allow negative balances to grow further.
3. Load prior messages for `chatId` from `messages`, ordered by `created_at`.
4. Call the **search tool** (Tavily) or let the LLM invoke it as a tool call (see section 13) to get source context for the question.
5. Call the LLM (selected `model`) via the AI SDK with prior messages + retrieved context, with streaming enabled.
6. Stream tokens to the client as they arrive. Do not block the stream start on any database write.
7. After the stream completes (or in parallel, once the full text and token usage are known):
   - Insert the assistant message into `messages`.
   - Insert retrieved sources into `sources`, linked to that assistant message.
   - Insert a `credit_usage` row with input/output/cached token counts and computed `credits_charged`.
   - Decrement `credit_balances.balance` by `credits_charged`, in the same transaction as the `credit_usage` insert.
8. Log request start, model used, token counts, and completion/failure.

Never persist partial/incomplete assistant messages as if they were final; if the stream errors mid-way, log the failure and do not charge full credits for an incomplete response (charge only for tokens actually generated, per provider usage reporting).

---

# 11. Streaming and latency

The <500ms non-functional requirement applies to **time-to-first-token / time-to-first-byte of the stream**, not full response completion. Design accordingly:

- Do not perform Tavily search and the LLM call sequentially if the LLM call can start before search results are needed (e.g., if using tool calling, the LLM decides when to search — see section 13). If search is done eagerly before the LLM call, keep it as fast as possible and consider timeout budgets.
- Do not block the response stream start on `messages` history reads beyond the minimum needed context.
- Persistence writes (message insert, sources insert, credit ledger update) happen after or alongside streaming, never before the first token is sent.
- Use HTTP chunked transfer or Server-Sent Events; the exact mechanism depends on the chosen framework (Express: manual chunked writes or a streaming library) — consult framework docs, do not guess API shape.

---

# 12. Credits and token accounting

- `credits_charged` is derived from `input_tokens`, `output_tokens`, and `cached_tokens` using a per-provider rate table. Keep this rate table centralized (e.g., `lib/billing/rates.ts`), not scattered across route handlers.
- Every `credit_usage` insert and the corresponding `credit_balances` decrement must happen in a single transaction (or an equivalent safe two-step pattern with rollback on failure) — never update one without the other.
- `GET /credits?chatId={chatId}` returns: remaining balance, and usage broken down by (chat, model) — join `credit_usage` filtered to the requesting user, optionally filtered to `chatId` if provided.
- Do not let balance go negative from normal usage — see section 10 step 2. A request that would clearly exceed the remaining balance should be rejected before calling the LLM, not after.

---

# 13. Tool use (search + PDF)

The LLM must be able to invoke tools during a chat completion via the AI SDK's tool-calling support:

- **Search tool** — wraps the Tavily Search API. Input: query string. Output: list of `{ title, url, content }` results, capped to a reasonable count (e.g., 5). Persist used results into `sources` (section 10, step 7).
- **PDF creation tool** — generates a PDF document from provided content and returns a reference/link the assistant can mention. Keep PDF generation logic in a dedicated `tools/pdf.ts` module, not inline in the route handler.

Tool implementations live in a `tools/` directory, each exporting a schema (Zod) for its input and an execute function. Do not let tool implementations perform direct database writes outside of what's described in section 10 — sources persistence happens in the orchestration layer after the tool result is known, not inside the tool itself, so it stays testable in isolation.

Validate all tool inputs and outputs with Zod before use.

---

# 14. API route method rules

Use consistent HTTP methods.

Use `POST` for actions that create or mutate state:

- `POST /chats` — create a new chat, returns chat id (deviates from original `GET /chats/new`; see section 7 decision 4)
- `POST /chats/:chatId/messages` — send a message, streams the response
- `POST /credits/checkout` — create a Stripe Checkout session
- `POST /credits/redeem` — redeem a coupon code
- `POST /webhooks/stripe` — Stripe webhook receiver (protected by Stripe signature verification, not the admin secret)

Use `GET` only for read routes:

- `GET /chats/:chatId` — messages, sources, and credit usage for a chat
- `GET /credits?chatId=` — balance and usage info
- `GET /models` — list of models available for toggling

Do not switch chat creation, messaging, or billing actions between `GET` and `POST`.

---

# 15. Secrets and key storage

Never expose to any client-reachable surface:

- Supabase service role key
- OpenAI / Anthropic / Gemini API keys
- Tavily API key
- Stripe secret key and webhook signing secret
- Any admin/internal secret

Provider API keys (`api_keys` table, section 8) must be stored **encrypted at rest**, not plaintext, using a server-side encryption key (e.g., `KMS`/`libsodium`/`crypto` with a key from environment, never hardcoded). Decrypt only in-memory, server-side, immediately before use.

Never run from client-reachable code:

- LLM provider calls
- Tavily calls
- Stripe API calls (aside from client-side redirect to a Checkout URL the backend generated)
- Direct Supabase service-role queries

Internal/admin-only routes (if any are added, e.g., a key-rotation endpoint) must require a shared secret sent as a header (e.g., `x-micromanus-admin-secret`), stored in `ADMIN_SECRET`. Reject missing/invalid secrets with `401`. Do not put secrets in query strings.

Stripe webhook route verifies the Stripe signature header against `STRIPE_WEBHOOK_SECRET` — this replaces the admin secret for that route, since Stripe cannot send custom headers.

---

# 16. Stripe billing

- `POST /credits/checkout` creates a Stripe Checkout session for a credit package and returns the session URL. Do not create the Stripe customer/charge logic inline in the route handler — isolate in a `billing/stripe.ts` service.
- `POST /webhooks/stripe` verifies the signature, then on `checkout.session.completed`:
  - Look up the `credit_purchases` row by `stripe_session_id`; if already `completed`, no-op (idempotency).
  - Mark it `completed`, and increment `credit_balances.balance` by `credits_granted`, in one transaction.
- Coupon redemption (`POST /credits/redeem`) checks `coupons` for an active, non-expired code under its redemption limit, inserts a `coupon_redemptions` row (unique per user+code), and increments `credit_balances.balance` by `credits_value` — all in one transaction.
- Always fetch current Stripe API documentation before implementing checkout/webhook code if there is any doubt about request/response shape or event types — do not assume from memory.

---

# 17. Logging

Log neat, server-side console messages for:

- Chat message received (chat id, user id, model)
- Search tool invoked, result count
- LLM call started/completed, token usage
- Credit balance check, credit deduction
- Stripe webhook received, event type, outcome
- Coupon redemption attempt and outcome
- Errors, with enough context to reproduce (never log secrets or full API keys)

---

# 18. Testing output after implementation

After completing any backend feature, always share exact test steps.

For API features, share exact curl commands including method, headers (`Authorization` bearer token where auth is required), and JSON body.

Tell the user to watch the terminal running the dev server, since streaming and tool-use logs appear there.

Do not overcomplicate manual test commands unless the implementation truly needs a status/polling route.

---

# 19. Security, code standards, and final rule

Use TypeScript throughout.

Prefer small functions, explicit types, centralized rate/pricing tables, server-only modules, typed service results, and safe error handling.

Avoid `any`, unrelated refactors, over-engineering, long route handlers, mixed transport/business logic, and unrequested features.

## Environment variables

Canonical list lives in `.env.example`. Nothing in this backend is browser-exposed; there is no `NEXT_PUBLIC_*`-equivalent concern here, but do not commit real values.

| Variable | Purpose | Exposure |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | server only |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role DB access | server only |
| `SUPABASE_JWT_SECRET` | Verifying Supabase Auth JWTs | server only |
| `OPENAI_API_KEY` | OpenAI provider calls | server only |
| `ANTHROPIC_API_KEY` | Claude provider calls | server only |
| `GOOGLE_GEMINI_API_KEY` | Gemini provider calls | server only |
| `TAVILY_API_KEY` | Search tool | server only |
| `STRIPE_SECRET_KEY` | Stripe API calls | server only |
| `STRIPE_WEBHOOK_SECRET` | Verifying Stripe webhook signatures | server only |
| `ENCRYPTION_KEY` | Encrypting stored provider API keys (section 15) | server only |
| `ADMIN_SECRET` | Protects internal/admin routes | server only |

Keep this table and `.env.example` in sync when variables change.

When in doubt:

1. Keep it small.
2. Use the relevant skill.
3. Preserve auth/service-role boundaries — never let unverified requests touch the database or providers.
4. Ask a focused question if needed.
5. Save a prompt before coding.
6. Ask if it is good to execute.
7. Implement after confirmation.
8. Run available checks.
9. Share exact test steps.

---

# 20. Commands and checks

"Run available checks" (sections 2 and 19) means running these from the project root and reporting the results:

- `npm run typecheck` — TypeScript, no emit (`tsc --noEmit`)
- `npm run lint` — ESLint (`eslint`)
- `npm run build` — production build, only when the change could affect the build

Development and runtime:

- `npm run dev` — start the backend dev server; watch its terminal for streaming, tool-use, and billing logs (section 18)
- `npm run start` — run the production build locally after `npm run build`

After implementation, run `typecheck` and `lint` at minimum. Add `build` when routes, config, or server modules changed. Report the exact command output; do not claim a check passed without running it.