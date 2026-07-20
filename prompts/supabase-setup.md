# Supabase setup

## Goal

Apply and verify the micromanus Postgres schema on the existing remote Supabase project already referenced by `.env` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`). Harden `db/schema.sql` for a **backend-only / service-role** access model, add a small connectivity verification script, and document Auth (Google/GitHub) dashboard steps. **No** auth middleware JWT verification, repositories, or feature routes in this pass.

## Skills read

- `.agents/skills/supabase/SKILL.md` — changelog check, RLS/grants, Data API exposure, migration workflow, security checklist
- `.agents/skills/supabase-postgres-best-practices/SKILL.md` — indexes / schema design awareness for the existing tables
- Docs consulted: [Securing your API](https://supabase.com/docs/guides/api/securing-your-api.md), [API keys](https://supabase.com/docs/guides/api/api-keys.md) (new `sb_secret_…` keys vs legacy `service_role` JWT)

## Existing code inspected

- `db/schema.sql` — full AGENTS.md §8 tables, enums, indexes, RLS enabled deny-by-default; **no** `GRANT`/`REVOKE`; **no** `users.id → auth.users(id)` FK
- `db/types.ts` — mirrors schema
- `src/db/client.ts` — service-role client factory; returns `null` if URL/key missing; already disables session persistence
- `.env` / `.env.example` — Supabase vars present (do **not** commit or print secrets)
- `README.md` — says apply `db/schema.sql` in SQL Editor; no verify script
- No `supabase/` CLI project, no Supabase MCP servers configured, no `supabase` binary in PATH

## Decisions / assumptions

1. **Remote project already exists.** Use the project in `.env`; do not create a new Supabase project.
2. **`db/schema.sql` remains the apply-able source of truth** for this pass (AGENTS.md §8 / README). Do **not** introduce a full local Supabase CLI + declarative `supabase/schemas/` workflow unless explicitly requested later.
3. **Backend-only Data API posture:** Keep RLS enabled on all public tables. Explicitly:
   - `GRANT` `SELECT, INSERT, UPDATE, DELETE` on all micromanus tables to `service_role`
   - `REVOKE` those privileges from `anon` and `authenticated` (and from `PUBLIC` where needed) so browser/Data API clients cannot touch app tables even if RLS were misconfigured later
   - Especially lock down `api_keys`, `credit_balances`, `credit_purchases`, `coupons`, `coupon_redemptions`
4. **`users.id` references `auth.users(id) on delete cascade`.** Matches AGENTS.md §9 (“id matches Supabase Auth user id”). Safe because Auth owns user creation; backend upserts into `public.users` after JWT verify (later prompt).
5. **Apply method (pick one at execute time — see question below):**
   - **Preferred if user pastes SQL:** User runs updated `db/schema.sql` in Dashboard → SQL Editor; agent then runs verify script.
   - **Preferred if user provides access:** User sets `SUPABASE_ACCESS_TOKEN` (personal access token) in env (gitignored); agent applies via Management API `POST /v1/projects/{ref}/database/migrations` with the schema SQL, then verifies. Do not commit the token.
   - Do **not** use the project secret key to run DDL — it cannot execute arbitrary SQL.
6. **Verification script only** — `scripts/verify-supabase.ts` (or `src/db/verify.ts` run via `bun`): head/`count` select on each table via service-role client; print OK / missing table / permission error codes. No row dumps. Wire as `bun run db:verify` in `package.json`.
7. **Auth providers (Google/GitHub)** are Dashboard configuration only (Supabase Auth owns OAuth). Document exact clicks in README; do not implement OAuth in the backend.
8. **New API keys:** `.env` already uses `sb_secret_…`. Keep using that with `@supabase/supabase-js` (client sets both `apikey` and matching `Authorization`). No code change required unless verify fails with a known key-compat error — then document fallback to legacy `service_role` JWT from Dashboard → API Keys.
9. **Out of scope:** JWT auth middleware, user upsert, repositories, RLS policies for `authenticated` end-users, local `supabase start`, Stripe/Tavily/LLM.

## Files likely to change

```
db/schema.sql                 # auth.users FK + GRANT/REVOKE hardening
db/types.ts                   # only if schema fields change (unlikely)
src/db/client.ts              # only if verify reveals key/client tweaks needed
scripts/verify-supabase.ts    # new connectivity/schema check
package.json                  # "db:verify" script
README.md                     # apply schema + Auth provider + verify steps
.env.example                  # optional SUPABASE_ACCESS_TOKEN comment (never required for runtime)
prompts/supabase-setup.md     # this file
```

## Implementation requirements

1. Update `db/schema.sql`:
   - Add `references auth.users (id) on delete cascade` on `users.id` (keep uuid PK).
   - After table + RLS blocks, add explicit `GRANT` to `service_role` and `REVOKE` from `anon` / `authenticated` for every micromanus table.
   - Keep idempotent style (`create table if not exists`, enum `do $$ … exception` blocks) so re-running in SQL Editor is safe.
   - Do not drop or rename existing objects beyond additive hardening.
2. Add `scripts/verify-supabase.ts` that:
   - Loads env the same way as the app (`src/config/env.ts` or dotenv from `.env`).
   - Fails clearly if `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` missing.
   - For each table in §8: `select` with `head: true` / `count: 'exact'`; report status without printing rows or secrets.
   - Exit non-zero if any required table is missing (`PGRST205` / schema cache) or permission denied unexpectedly for service role.
3. Add `db:verify` script to `package.json`.
4. Update `README.md` Setup section:
   - Copy `.env.example` → `.env` and fill Supabase URL + secret key + JWT secret (already done for this user).
   - Apply `db/schema.sql` in Dashboard → SQL Editor (or note Management API path if used).
   - Run `bun run db:verify`.
   - Enable Google + GitHub under Authentication → Providers; note redirect URLs belong to the **frontend** later — backend only needs JWT verification.
5. After schema is applied (by user or agent via Management API), run `bun run db:verify` and report results.
6. Run `bun run typecheck` and `bun run lint`.

## Security requirements

- Never commit `.env`, access tokens, or real keys.
- Never log full API keys, JWT secrets, or query result row contents in verify output.
- Service-role / secret key only on the server; never expose to clients.
- RLS stays enabled on all public tables; revoke Data API privileges from `anon`/`authenticated` for app tables.
- Do not create permissive `TO authenticated` policies in this pass (would be authz without ownership predicates — BOLA risk per skill checklist).
- Do not print Management API / verify response bodies that could contain data; status codes and PostgREST error codes only.

## Acceptance criteria

- [ ] `db/schema.sql` includes `users.id → auth.users` FK and explicit `service_role` grants + `anon`/`authenticated` revokes
- [ ] Schema applied to the remote project (SQL Editor or Management API)
- [ ] `bun run db:verify` exits 0 and reports all §8 tables reachable via service role
- [ ] README documents apply + Auth providers + verify
- [ ] `bun run typecheck` and `bun run lint` pass
- [ ] No feature/auth-middleware implementation beyond setup/docs/verify

## Checks to run

```bash
bun run typecheck
bun run lint
bun run db:verify
```

## Manual test steps (after implementation)

```bash
# 1. Ensure .env has SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET

# 2. Apply schema (if not applied by agent):
#    Supabase Dashboard → SQL Editor → paste db/schema.sql → Run

# 3. Verify
bun run db:verify
# expect: each table OK (count may be 0)

# 4. Optional smoke via app client (dev server not required):
#    re-run db:verify after restarting if schema cache was stale

# 5. Dashboard: Authentication → Providers → enable Google and GitHub
#    (OAuth redirect URLs: configure when frontend exists)
```

Watch for PostgREST “schema cache” delays: if verify fails immediately after apply, wait ~10s and re-run.
