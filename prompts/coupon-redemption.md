# Coupon redemption (platform credits)

## Goal

Implement **`POST /credits/redeem`**: an authenticated user submits a platform coupon code; if the coupon is valid, insert a `coupon_redemptions` row, bump `coupons.redemptions_count`, and increment `credit_balances.balance` by `credits_value` — all in **one database transaction**.

This is **micromanus platform coupons** (tables `coupons` / `coupon_redemptions`), not Stripe Promotion Codes. Stripe checkout/webhook stay untouched.

**Out of scope:** admin CRUD for creating/editing coupons via API, Stripe coupons, frontend, refunds, and any change to chat/streaming or API-key routes.

## Skills read

- `.agents/skills/supabase/SKILL.md` (service-role access, RLS already deny-by-default, prefer transactional RPC over multi-step client writes)
- `AGENTS.md` §7 decisions 1 & 3 & 6, §8 (`coupons`, `coupon_redemptions`, `credit_balances`), §13 (credits), §15 (`POST /credits/redeem`), §17 (coupon redemption paragraph), §18 (logging), §19–§21 (tests/checks)

## Existing code inspected

- `src/routes/credits.ts` — `GET /credits` + `POST /credits/checkout` work; **`POST /credits/redeem` is `notImplemented` (501)**
- `src/services/credits.ts` — balance gate, summary, charge, Stripe checkout/webhook handlers; **no redeem**
- `src/db/repositories/credits.ts` — balance/usage/purchase helpers + `complete_credit_purchase` RPC; **no coupon helpers**
- `db/schema.sql` — `coupons` + `coupon_redemptions` tables exist with checks (`credits_value > 0`, `redemptions_count <= max_redemptions`, unique `(coupon_code, user_id)`); RLS enabled; service_role grants present; **no redeem RPC yet**
- `db/types.ts` — `Coupon`, `CouponRedemption` already defined
- `db/migrations/002_complete_credit_purchase.sql` — pattern to mirror for atomic balance increment
- `README.md` — route table still marks redeem as `501`

## Decisions / assumptions

1. **Request body:** `{ "code": "<string>" }` validated with Zod — trim, non-empty, max length 64. Reject empty/whitespace with `400` / `invalid_body`.
2. **Code normalization:** store and match codes as **uppercase** after trim (e.g. `welcome100` → `WELCOME100`). Seed/test inserts should use uppercase codes. Document in seed SQL.
3. **Validity rules** (all must pass):
   - Coupon row exists
   - `active === true`
   - `expires_at` is null **or** `expires_at > now()`
   - `redemptions_count < max_redemptions`
   - User has **not** already redeemed this code (unique `(coupon_code, user_id)`)
4. **Atomic redeem via Postgres RPC** `redeem_coupon(p_user_id uuid, p_code text)` (preferred, same pattern as `complete_credit_purchase`):
   1. `SELECT … FROM coupons WHERE code = upper(trim(p_code)) FOR UPDATE`
   2. Raise typed exceptions for not found / inactive / expired / exhausted
   3. `INSERT INTO coupon_redemptions (coupon_code, user_id)` — on unique violation → already redeemed
   4. `UPDATE coupons SET redemptions_count = redemptions_count + 1` (check constraint enforces ≤ max)
   5. Upsert/increment `credit_balances.balance` by `credits_value` (create row if absent, same as purchase RPC)
   6. Return a JSON/result shape the service can map: e.g. `{ credits_granted, balance, coupon_code, redemption_id }` or return the redemption row + let the service re-read balance
5. **HTTP / AppError mapping** (stable `code` field for clients):

   | Condition | status | `code` |
   |---|---|---|
   | Missing/invalid body | 400 | `invalid_body` |
   | Coupon not found | 404 | `coupon_not_found` |
   | Inactive | 400 | `coupon_inactive` |
   | Expired | 400 | `coupon_expired` |
   | Max redemptions reached | 400 | `coupon_exhausted` |
   | User already redeemed | 409 | `coupon_already_redeemed` |
   | Success | 200 | — |

6. **Success response body:**
   ```json
   {
     "code": "WELCOME100",
     "creditsGranted": 100,
     "balance": 150
   }
   ```
   (`balance` = remaining platform balance after redeem.)
7. **Layers:** route (Zod + thin) → `services/credits.redeemCoupon` → `db/repositories` (RPC). No Supabase calls in the route handler.
8. **Logging** (§18): log attempt (`userId`, normalized code — never secrets) and outcome (success with credits/balance, or failure reason/`code`).
9. **No admin create-coupon API** in this prompt. Manual seed via SQL for testing (include in test steps). Optionally add a short README subsection under credits.
10. **Concurrency:** `FOR UPDATE` on the coupon row + unique redemption constraint prevent double-grant under concurrent requests. Prefer mapping unique-violation from the insert to `coupon_already_redeemed` even if the pre-check raced.
11. **Auth:** reuse existing `requireAuth` on `creditsRouter`; `user_id` only from verified session.

## Files likely to change

```
db/schema.sql                              # add redeem_coupon RPC + grants (keep in sync)
db/migrations/003_redeem_coupon.sql        # Dashboard-applicable migration
src/db/repositories/credits.ts             # redeemCouponViaRpc (or coupons.ts if cleaner)
src/db/repositories/index.ts               # export
src/services/credits.ts                    # redeemCoupon service + error mapping
src/routes/credits.ts                      # wire POST /credits/redeem
src/db/map-error.ts                        # optional: map redeem RPC exception messages → AppError
README.md                                  # mark redeem live; add seed + curl steps
```

No new env vars. No Stripe changes.

## Implementation requirements

1. Add `redeem_coupon` Postgres function (`security invoker`, `search_path = public`), `REVOKE ALL … FROM public`, `GRANT EXECUTE … TO service_role`.
2. Mirror the function into `db/schema.sql` and ship `db/migrations/003_redeem_coupon.sql` for Dashboard apply.
3. Repository function calls `client.rpc("redeem_coupon", { p_user_id, p_code })` and surfaces Postgres exception text/codes for the service layer.
4. Service maps exceptions → `AppError` with the table above; on success logs and returns `{ code, creditsGranted, balance }`.
5. Route replaces `notImplemented` with Zod parse + service call + `AppError` → JSON (same style as checkout).
6. Do not decrypt keys, call Stripe, or touch chat orchestration.

## Security requirements

- Never trust a `userId` from the body.
- Service-role only; RLS stays deny-by-default for Data API roles.
- Do not log or return internal coupon admin fields beyond what’s needed (`credits_value` / granted amount and new balance are OK).
- Coupon codes are not secrets like API keys, but still avoid logging bulk coupon dumps.
- Atomicity: never increment balance without a redemption row (and count bump) in the same transaction.

## Acceptance criteria

- [ ] `POST /credits/redeem` with valid unused code returns `200` and increases balance by `credits_value`
- [ ] Same user redeeming the same code again returns `409` / `coupon_already_redeemed` with **no** second balance increment
- [ ] Inactive / expired / exhausted / unknown codes return the mapped errors above with **no** balance change
- [ ] Concurrent double-submit cannot grant credits twice (unique + `FOR UPDATE`)
- [ ] `GET /credits` reflects the new balance after a successful redeem
- [ ] Stripe checkout/webhook behavior unchanged
- [ ] `npm run typecheck` and `npm run lint` pass; `npm run build` if routes/server modules changed

## Checks to run

```bash
npm run typecheck
npm run lint
npm run build
```

Apply migration in Supabase Dashboard → SQL Editor:

```text
db/migrations/003_redeem_coupon.sql
```

## Exact manual test steps (curl)

Prerequisites: API running (`npm run dev`), valid Supabase access token, user row exists, migration `003` applied.

1. **Seed a test coupon** (SQL Editor):

```sql
insert into coupons (code, credits_value, max_redemptions, redemptions_count, expires_at, active)
values ('WELCOME100', 100, 1000, 0, null, true)
on conflict (code) do update
set
  credits_value = excluded.credits_value,
  max_redemptions = excluded.max_redemptions,
  redemptions_count = 0,
  expires_at = null,
  active = true;
```

2. **Note current balance:**

```bash
curl -sS http://localhost:3000/credits \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"
```

3. **Redeem successfully:**

```bash
curl -sS -X POST http://localhost:3000/credits/redeem \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"code":"welcome100"}'
# expect 200: {"code":"WELCOME100","creditsGranted":100,"balance":<previous+100>}
```

4. **Idempotent reject (same user):**

```bash
curl -sS -X POST http://localhost:3000/credits/redeem \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"code":"WELCOME100"}'
# expect 409: code coupon_already_redeemed; balance unchanged
```

5. **Unknown code:**

```bash
curl -sS -X POST http://localhost:3000/credits/redeem \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"code":"NOPE"}'
# expect 404: coupon_not_found
```

6. **Optional negative cases** (SQL then curl):
   - `update coupons set active = false where code = 'WELCOME100';` → expect `coupon_inactive`
   - `update coupons set active = true, expires_at = now() - interval '1 day' where code = 'WELCOME100';` → expect `coupon_expired`
   - New code with `max_redemptions = 1` already at `redemptions_count = 1` → expect `coupon_exhausted`

7. Watch the API terminal for redeem attempt/outcome logs.
