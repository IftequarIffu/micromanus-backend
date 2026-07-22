# micromanus-backend

AI chat platform backend: multi-model LLM chat with streaming, tool use, source citations, credits, and Stripe billing.

This repo is **backend only** (Express + TypeScript on Bun). No frontend.

## Setup

```bash
bun install
cp .env.example .env
# Fill at least: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET, ENCRYPTION_KEY
# Optional for chat tools: TAVILY_API_KEY
# For Stripe checkout: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, CHECKOUT_SUCCESS_URL, CHECKOUT_CANCEL_URL
```

### Supabase schema

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**.
2. Paste the contents of `db/schema.sql` and **Run**.
   - This recreates `api_keys` in the BYOK shape (`user_id`, `iv`, `auth_tag`, `last_four`) and adds `record_credit_usage_and_decrement`, `complete_credit_purchase`, and `redeem_coupon`.
3. If you already applied an older `schema.sql`, also run the pending files under `db/migrations/` in order (`002_complete_credit_purchase.sql`, `003_redeem_coupon.sql`, `004_chat_pdfs_bucket.sql`, `005_messages_pdf_meta.sql`, then `006_welcome_coupon_5_credits.sql`).
4. **Storage (PDF tool):** `004_chat_pdfs_bucket.sql` (or a full `schema.sql` apply) creates private bucket `chat-pdfs` + `ensure_chat_pdfs_bucket` RPC. The API calls that RPC before each PDF upload. You can also create the bucket in Dashboard → **Storage** → **New bucket** → `chat-pdfs` → **Private**.
5. **PDF meta on messages:** `005_messages_pdf_meta.sql` adds `messages.pdf_storage_path` / `pdf_filename` so `GET /chats/:id` can re-sign a download URL after reload.
6. Verify from the repo:

```bash
bun run db:verify
# expect: each table OK (count may be 0)
```

If verify fails right after apply, wait ~10s for the PostgREST schema cache and re-run.

### Auth providers (Google + GitHub)

Supabase Auth owns OAuth. This backend only verifies JWTs and upserts `public.users`.

**Callback URL** (use in Google Cloud / GitHub OAuth app settings):

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

Find it on Dashboard → **Authentication** → **Providers** → Google or GitHub.

#### Google

1. [Google Cloud Console](https://console.cloud.google.com/) → create/select a project → **Google Auth Platform** / APIs & Services → **Credentials**.
2. Create an OAuth client ID (Web application).
3. Authorized redirect URI: the Supabase callback URL above.
4. Copy Client ID + Client Secret into Dashboard → **Authentication** → **Providers** → **Google** → enable and save.
5. Scopes needed: `openid`, `userinfo.email`, `userinfo.profile`.

#### GitHub

1. GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
2. Authorization callback URL: the same Supabase callback URL.
3. Copy Client ID + generate Client Secret into Dashboard → **Authentication** → **Providers** → **GitHub** → enable and save.

#### Signing in (frontend / test client)

`signInWithOAuth({ provider: "google" | "github" })` runs in a **frontend** (or a small local script) using your Supabase **publishable** / anon key — not this API. After sign-in, send the session `access_token` as:

```http
Authorization: Bearer <access_token>
```

This API never implements OAuth redirects or code exchange.

## Scripts

| Command | Purpose |
|---|---|
| `bun run dev` | Dev server with watch reload |
| `bun run typecheck` | TypeScript (`tsc --noEmit`) |
| `bun run lint` | ESLint |
| `bun run build` | Bundle to `dist/` |
| `bun run start` | Run production bundle |
| `bun run db:verify` | Check service-role access to all schema tables |

## Smoke test (auth)

```bash
bun run dev
```

```bash
curl -sS http://localhost:3000/health
# {"ok":true}

curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/me
# 401

curl -sS http://localhost:3000/me \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"
# {"id":"...","name":"...","email":"...","created_at":"..."}
```

## Chat + BYOK (manual test)

Seed platform credits for your user (SQL Editor):

```sql
insert into credit_balances (user_id, balance)
values ('<YOUR_USER_UUID>', 1000)
on conflict (user_id) do update set balance = excluded.balance, updated_at = now();
```

```bash
# Save a provider key (example: openai)
curl -sS http://localhost:3000/api-keys \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","apiKey":"sk-..."}'

curl -sS http://localhost:3000/api-keys \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"
# {"keys":[{"provider":"openai","last_four":"...","created_at":"...","updated_at":"..."}]}

curl -sS http://localhost:3000/models \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"

# First message of a new chat (SSE)
# Events: chat_created → token* → (pdf_ready?) → done
curl -sS -N http://localhost:3000/chats/messages \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"content":"Say hello in one sentence.","model":"gpt-5.4-mini"}'

# New chat whose first message asks for a PDF (lazy create + tools)
# Needs TAVILY_API_KEY + private Storage bucket chat-pdfs
# Events: chat_created → token* → pdf_ready → token* → done (with optional pdf)
curl -sS -N http://localhost:3000/chats/messages \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"content":"Generate a short PDF report on the latest Russia-Ukraine war news with sources.","model":"gpt-5.4-mini"}'

# Follow-up in an existing chat (replace CHAT_ID from chat_created)
curl -sS -N http://localhost:3000/chats/<CHAT_ID>/messages \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"content":"What did I just ask you?","model":"gpt-5.4-mini"}'

curl -sS http://localhost:4000/chats/<CHAT_ID> \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"

# Permanently delete chat + messages + PDFs (204)
curl -sS -o /dev/null -w "%{http_code}\n" -X DELETE http://localhost:4000/chats/<CHAT_ID> \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"

curl -sS "http://localhost:3000/credits?chatId=<CHAT_ID>" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"
```

Watch the dev-server terminal for chat / LLM / search / pdf / credit logs (never key material).

### SSE event shapes

| Event | When | Data |
|---|---|---|
| `chat_created` | First message only, before LLM | `{ "chatId": "..." }` |
| `token` | Each text delta | `{ "text": "..." }` |
| `pdf_ready` | As soon as `create_pdf` tool succeeds (mid-stream) | `{ "chatId": "...", "url": "...", "filename": "..." }` |
| `error` | Soft failures | `{ "message": "..." }` |
| `done` | Stream end | `{ "ok": true\|false, "chatId": "...", "pdf"?: { "url", "filename" }, ... }` |

Signed PDF URLs expire after **24 hours**. Open `url` from `pdf_ready` / `done.pdf` in a browser to download. Confirm the object under Storage → `chat-pdfs` → `{userId}/{chatId}/…` (one object per successful report; duplicate tool calls reuse the first upload). After reload, `GET /chats/:chatId` returns a fresh signed `pdf` on the assistant message when one was stored. PDF works on **both** `POST /chats/messages` (new chat) and `POST /chats/:chatId/messages` (existing chat).

## Buy credits (Stripe Checkout)

Dynamic pricing (defined in `src/lib/billing/packages.ts`):

- **$1 per credit**
- **Minimum 5 credits** per checkout ($5)

1. Put Stripe **test** keys in `.env`: `STRIPE_SECRET_KEY`, `CHECKOUT_SUCCESS_URL`, `CHECKOUT_CANCEL_URL`.
2. Apply `db/migrations/002_complete_credit_purchase.sql` if not already in your DB.
3. Forward webhooks (copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`, then restart the API):

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

4. Create a Checkout session:

```bash
curl -sS -X POST http://localhost:3000/credits/checkout \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"credits":5}'
# {"url":"https://checkout.stripe.com/...","sessionId":"cs_test_..."}
```

5. Open `url` in a browser and pay with test card `4242 4242 4242 4242` (any future expiry, any CVC).
6. Confirm balance:

```bash
curl -sS http://localhost:3000/credits \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"
# balance should increase by 5
```

Replay the same `checkout.session.completed` event — balance must not increase again.

## Redeem coupon (platform credits)

1. Apply `db/migrations/003_redeem_coupon.sql` and `db/migrations/006_welcome_coupon_5_credits.sql` in the Supabase SQL Editor if not already applied.
2. Or seed/update the welcome coupon manually (codes are stored/matched uppercase):

```sql
insert into coupons (code, credits_value, max_redemptions, redemptions_count, expires_at, active)
values ('WELCOME100', 5, 1000, 0, null, true)
on conflict (code) do update
set
  credits_value = excluded.credits_value,
  max_redemptions = excluded.max_redemptions,
  redemptions_count = 0,
  expires_at = null,
  active = true;
```

3. Redeem (case-insensitive input):

```bash
curl -sS -X POST http://localhost:3000/credits/redeem \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"code":"welcome100"}'
# {"code":"WELCOME100","creditsGranted":5,"balance":<previous+5>}
```

4. Redeeming the same code again for the same user returns `409` / `coupon_already_redeemed` with no second balance bump.

## API surface

| Method | Path | Auth |
|---|---|---|
| `GET` | `/health` | no |
| `GET` | `/me` | yes |
| `POST` | `/api-keys` | yes |
| `GET` | `/api-keys` | yes |
| `DELETE` | `/api-keys/:provider` | yes |
| `POST` | `/chats/messages` | yes (SSE) |
| `GET` | `/chats/:chatId` | yes |
| `POST` | `/chats/:chatId/messages` | yes (SSE) |
| `GET` | `/credits?chatId=` | yes |
| `POST` | `/credits/checkout` | yes |
| `POST` | `/credits/redeem` | yes |
| `GET` | `/models` | yes |
| `POST` | `/webhooks/stripe` | Stripe signature |

Note: there is no standalone create-chat route. A chat is created on `POST /chats/messages` (lazy creation). LLM keys are BYOK via `/api-keys`, not env vars.
