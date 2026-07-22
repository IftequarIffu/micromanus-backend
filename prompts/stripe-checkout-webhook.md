# Stripe checkout + webhook (buy platform credits)

## Goal

Implement **buy platform credits with Stripe**: authenticated users create a Checkout Session via `POST /credits/checkout`, pay on Stripe-hosted Checkout, and on `checkout.session.completed` the webhook marks the purchase complete and increments `credit_balances` idempotently.

**Out of scope:** coupon redemption (`POST /credits/redeem` stays `501`), tax, subscriptions, Connect, Payment Element / custom UI, refunds, and any frontend.

## Skills read

- `.agents/skills/stripe-best-practices/SKILL.md` + `references/payments.md` + `references/security.md`
- Stripe docs (fetch before coding if any doubt): [Checkout Sessions create](https://docs.stripe.com/api/checkout/sessions/create), [Webhooks / signature verify](https://docs.stripe.com/webhooks#verify-events), [Checkout quickstart](https://docs.stripe.com/checkout/quickstart)
- `AGENTS.md` §7 decision 2 & 6, §8 (`credit_purchases`, `credit_balances`), §15 (routes), §16 (secrets), §17 (Stripe billing), §18 (logging), §20 (env)

## Existing code inspected

- `src/routes/credits.ts` — `GET /credits` works; `POST /credits/checkout` and `POST /credits/redeem` are `501`
- `src/routes/webhooks.ts` — `POST /webhooks/stripe` is `501`
- `src/app.ts` — already mounts `express.raw({ type: "application/json" })` on `/webhooks/stripe` **before** `express.json()` (correct for signature verify)
- `src/billing/index.ts` — empty stub
- `src/lib/billing/rates.ts` — token→credit rates only (usage metering); no purchase packages
- `src/db/repositories/credits.ts` — balance get + usage RPC; **no** purchase helpers
- `src/services/credits.ts` — balance gate + summary + charge; no checkout
- `src/config/env.ts` / `.env.example` — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` optional; **no** frontend/success URL vars yet
- `db/schema.sql` — `credit_purchases` + `credit_balances` exist; RPC exists for usage decrement only — **no** complete-purchase RPC yet
- `db/types.ts` — `CreditPurchase`, `PurchaseStatus` already defined
- `package.json` — **no** `stripe` dependency yet

## Decisions / assumptions

1. **One-time Checkout Sessions only** (not PaymentIntents, not subscriptions). Mode `payment`. Omit `payment_method_types` (dynamic payment methods per Stripe skill).
2. **Stripe API version:** initialize the Node SDK with `apiVersion: "2026-06-24.dahlia"` (latest per skill). Pass `integration_identifier` on `checkout.sessions.create` with a stable prefix + 8 random letters (e.g. `micromanus_checkout_<8chars>`).
3. **Dynamic credit pricing lives in code**, not Stripe Dashboard Price IDs — use Checkout `line_items[].price_data` so local/dev works without pre-created Products. Centralize pricing in e.g. `src/lib/billing/packages.ts`:

   - **$1 per credit** (`unit_amount: 100`, `quantity: credits`)
   - **Minimum 5 credits** per checkout

   Request body: `{ "credits": 5 }` (Zod-validated integer). Below minimum → `400` `invalid_credits`.
4. **Checkout → DB → URL flow:**
   1. Validate credits (≥ 5) + require Stripe env configured (else `503`).
   2. Create Checkout Session with `metadata`: `userId`, `creditsGranted` (string), `amountPaidCents` (string); `client_reference_id` = `userId`.
   3. Insert `credit_purchases` row: `status: pending`, `stripe_session_id`, `user_id`, `amount_paid_cents`, `credits_granted`.
   4. Return `{ url, sessionId }` to the client (never create/charge inline in the route).
5. **Success / cancel URLs** from env (add to `.env.example` + `env.ts`):
   - `CHECKOUT_SUCCESS_URL` — e.g. `http://localhost:5173/credits?checkout=success&session_id={CHECKOUT_SESSION_ID}`
   - `CHECKOUT_CANCEL_URL` — e.g. `http://localhost:5173/credits?checkout=cancel`
   Stripe substitutes `{CHECKOUT_SESSION_ID}` in the success URL. Missing URL env at checkout time → `503`.
6. **Webhook `checkout.session.completed`:**
   - Verify signature with `stripe.webhooks.constructEvent(rawBody, stripe-signature, STRIPE_WEBHOOK_SECRET)`.
   - Look up `credit_purchases` by `session.id`.
   - If missing: optionally create from session metadata (defense in depth) **or** log + return `200` after logging error — prefer **upsert from metadata if row missing** so a lost pending insert still grants credits; still enforce unique `stripe_session_id`.
   - If already `completed`: no-op (idempotent), return `200`.
   - Else: in **one DB transaction** (Postgres RPC preferred, matching usage pattern): set status `completed`, upsert/increment `credit_balances.balance` by `credits_granted` (create balance row if absent).
   - Ignore other event types with `200` + log.
   - Always respond `200` after successful verify+handle so Stripe does not infinite-retry on app bugs that are already logged; on signature failure return `400`.
7. **Currency:** `usd` only for v1.
8. **Coupon redeem deferred** — leave `POST /credits/redeem` as `501`.
9. **Layers:** route (Zod + thin) → `services/credits` or `services/billing` → `billing/stripe.ts` (Stripe SDK only) + `db/repositories` (purchases/balances). No Stripe/Supabase calls inside route handlers beyond service calls.
10. **Env at use-time:** boot stays optional for Stripe keys; checkout/webhook fail clearly if unset.

## Files likely to change

```
package.json / bun.lock                 # add stripe
.env.example                            # CHECKOUT_SUCCESS_URL, CHECKOUT_CANCEL_URL; note Stripe CLI webhook forward
src/config/env.ts                       # same
db/schema.sql                           # add complete_credit_purchase RPC (+ grants)
db/migrations/002_complete_credit_purchase.sql  # ALTER/RPC for Dashboard apply
src/lib/billing/packages.ts             # package catalog
src/billing/stripe.ts                   # Stripe client + createCheckoutSession + constructEvent
src/billing/index.ts                    # exports
src/db/repositories/credits.ts          # insert pending purchase; complete RPC; get by session id
src/db/repositories/index.ts            # exports
src/services/credits.ts or billing.ts   # createCheckout + handleStripeWebhook
src/routes/credits.ts                   # POST /credits/checkout
src/routes/webhooks.ts                  # POST /webhooks/stripe (raw body)
README.md                               # Stripe setup + curl + CLI webhook forward
prompts/stripe-checkout-webhook.md      # this file
```

## Implementation requirements

1. Install and pin `stripe` (Node SDK). Configure client with secret key + explicit `apiVersion: "2026-06-24.dahlia"`.
2. Add `CREDIT_PACKAGES` catalog and helper `getPackageOrThrow(packageId)`.
3. Implement `createCheckoutSession({ userId, packageId })` in `src/billing/stripe.ts` using Checkout Sessions API:
   - `mode: "payment"`
   - `line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount, product_data: { name } } }]`
   - `success_url` / `cancel_url` from env
   - `metadata` + `client_reference_id` as above
   - `integration_identifier`
   - Do **not** pass `payment_method_types`
4. Service `createCreditsCheckout(userId, packageId)`: create session → insert pending `credit_purchases` → return `{ url, sessionId }`. If session created but DB insert fails, log loudly (orphaned session is OK; webhook metadata path can still complete).
5. `POST /credits/checkout`: `requireAuth`, Zod body, call service, `200` JSON `{ url, sessionId }`.
6. Implement Postgres RPC e.g. `complete_credit_purchase(p_stripe_session_id text, p_user_id uuid, p_amount_paid_cents integer, p_credits_granted integer)`:
   - If row exists and `completed` → return existing / no-op.
   - If row exists and `pending` → set `completed`, increment balance (upsert balance row if missing).
   - If row missing → insert as `completed` then increment (metadata recovery path).
   - Never double-increment: use status transition `pending → completed` or insert-only-when-missing with unique session id; wrap in one function so balance and status stay consistent.
7. `POST /webhooks/stripe`: use `req.body` as `Buffer` (raw), verify signature, handle `checkout.session.completed`, call complete RPC, log outcome. No JWT auth.
8. Logging (never log secrets / webhook signing secret / full raw payloads with PII beyond session id):
   - Checkout created (user id, package id, session id, credits)
   - Webhook received (event type, session id)
   - Purchase completed / already completed / failed
9. README: Dashboard/test keys, set env, `stripe listen --forward-to localhost:3000/webhooks/stripe`, curl for checkout, how to confirm balance via `GET /credits`.

## Security requirements

- Never expose `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, or service-role key to clients.
- Webhook: **always** verify Stripe signature before trusting the event; reject bad signatures with `400`.
- Do not trust `userId` from the request body for granting credits — checkout uses JWT `userId`; webhook uses session `metadata.userId` / `client_reference_id` only after signature verify, and must match the `credit_purchases.user_id` when a pending row exists.
- No Stripe secret in query strings or logs.
- Route stays thin; Stripe SDK isolated in `billing/stripe.ts`.

## Acceptance criteria

- [ ] `POST /credits/checkout` with valid Bearer + `{ "packageId": "starter" }` returns `{ url, sessionId }` and inserts a `pending` `credit_purchases` row
- [ ] Invalid `packageId` → `400`; missing Stripe/URL env → `503`; unauthenticated → `401`
- [ ] Stripe-hosted Checkout URL opens and accepts a test card (e.g. `4242…`)
- [ ] On `checkout.session.completed` (via CLI forward), purchase becomes `completed` and `credit_balances.balance` increases by package credits exactly once
- [ ] Replaying the same webhook event does not double-credit (idempotent)
- [ ] Bad webhook signature → `400`; other event types → `200` no-op
- [ ] `POST /credits/redeem` still `501`
- [ ] `bun run typecheck` and `bun run lint` pass; `bun run build` if routes/config changed

## Checks to run

```bash
bun run typecheck
bun run lint
bun run build
```

Apply `db/migrations/002_complete_credit_purchase.sql` (or equivalent from `db/schema.sql`) in Supabase Dashboard → SQL Editor before webhook testing.

## Exact manual test steps

Prerequisites: `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET` (from `stripe listen`), `CHECKOUT_SUCCESS_URL`, `CHECKOUT_CANCEL_URL`, valid Supabase JWT, schema/RPC applied. Dev server: `bun run dev`.

1. Forward webhooks:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

Copy the webhook signing secret into `.env` as `STRIPE_WEBHOOK_SECRET`, restart the server if needed.

2. Create checkout (replace token):

```bash
curl -sS -X POST http://localhost:3000/credits/checkout \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"packageId":"starter"}'
```

Expect JSON with `url` and `sessionId`. Open `url` in a browser; pay with test card `4242 4242 4242 4242`, any future expiry, any CVC.

3. Confirm balance:

```bash
curl -sS http://localhost:3000/credits \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"
```

Expect `balance` increased by `500` (starter). In Supabase, `credit_purchases` for that `sessionId` should be `completed`.

4. Idempotency: resend the same `checkout.session.completed` event from Stripe CLI / Dashboard resend — balance must not increase again.

5. Negative cases:

```bash
# bad package
curl -sS -X POST http://localhost:3000/credits/checkout \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"packageId":"nope"}'
# expect 400

# unauthenticated
curl -sS -X POST http://localhost:3000/credits/checkout \
  -H "Content-Type: application/json" \
  -d '{"packageId":"starter"}'
# expect 401

# forged webhook (no/invalid signature)
curl -sS -X POST http://localhost:3000/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{}'
# expect 400
```

Watch the terminal running `bun run dev` for checkout/webhook logs.
