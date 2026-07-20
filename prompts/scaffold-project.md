# Scaffold project

## Goal

Turn the empty Bun + Express starter into a runnable **micromanus-backend** skeleton that matches `AGENTS.md`: layered directories, Express app entry, route stubs for every public API, DB schema/types, env template, and npm/bun scripts (`dev`, `typecheck`, `lint`, `build`, `start`). **No feature logic** (no real JWT verification, LLM calls, Stripe, Tavily, or credit ledger writes) — stubs and placeholders only.

## Skills read

- `.agents/skills/supabase/SKILL.md` — schema/RLS awareness for `db/schema.sql`; service-role client placement
- `.agents/skills/ai-sdk/SKILL.md` — confirm AI SDK packages belong under orchestration later; do **not** wire providers in this scaffold
- `.agents/skills/stripe-best-practices/SKILL.md` — confirm Stripe belongs under billing later; do **not** implement checkout/webhooks in this scaffold
- `.agents/skills/tavily-best-practices/SKILL.md` — confirm search tool lives under `tools/` later; do **not** call Tavily in this scaffold



## Existing code inspected

- `package.json` — Bun project (`type: "module"`), Express 5 + `@types/express` / `@types/node` / `@types/bun` already present; no scripts, no app deps beyond Express
- `index.ts` — Bun hello-world only
- `tsconfig.json` — Bun bundler-mode config (`noEmit`, `types: ["bun"]`)
- `.gitignore` — ignores `.env`, `node_modules`, `dist`
- `README.md` — Bun init boilerplate
- `.env` — empty (do not commit secrets)
- No `src/`, `db/`, `prompts/` content (prompts dir created for this file), no ESLint config



## Decisions / assumptions

1. **Runtime: keep Bun.** Project was `bun init`'d with `bun.lock`. Express runs on Bun. Script names match AGENTS.md §20 (`dev`, `typecheck`, `lint`, `build`, `start`) and work with `bun run <script>`.
2. **Entry moves to** `src/index.ts`**.** Replace root `index.ts` hello-world; root may re-export or be removed. Prefer single entry at `src/index.ts`.
3. **Scaffold only — stub handlers.** Routes return `501 Not Implemented` (or a clear JSON `{ error: "not_implemented" }`) except `GET /health` which returns `200 { ok: true }`.
4. `POST /chats` **not** `GET /chats/new`**.** Flag per AGENTS.md §7 decision 4 — use `POST /chats` in route registration.
5. **Stripe webhook uses raw body.** Mount `POST /webhooks/stripe` with Express raw/buffer body parsing ready for signature verification later; other JSON routes use `express.json()`.
6. **Schema is declarative SQL + TypeScript types.** Write `db/schema.sql` and `db/types.ts` per AGENTS.md §8. Do not run migrations against a live Supabase project in this task.
7. **Dependencies to add now (scaffold-needed only):** `zod`, `dotenv` (or Bun env), `@supabase/supabase-js`, `eslint` + typescript-eslint, `typescript` as a real dependency (not only peer). Defer `ai`, `@ai-sdk/`*, `stripe`, `@tavily/core`, PDF libs until feature prompts.
8. **tsconfig:** Adjust for a Node/Bun server app under `src/` (include `src`, keep `strict`). Keep `noEmit: true` for typecheck; `build` can use `bun build` or `tsc` emit to `dist/` — prefer a simple Bun-compatible build that produces a runnable `dist` or document `bun run src/index.ts` for prod start. Choose one consistent approach and wire `build`/`start` to it.
9. **No frontend.** Backend only.



## Files likely to change / create

```
package.json
tsconfig.json
.gitignore                    # ensure dist/, coverage, etc.
.env.example
README.md
src/index.ts                 # listen / bootstrap
src/app.ts                   # Express app factory
src/config/env.ts            # Zod-validated env loader
src/middleware/auth.ts       # stub: reject missing Bearer, attach placeholder user later
src/middleware/error.ts      # centralized error handler
src/middleware/request-log.ts
src/routes/health.ts
src/routes/chats.ts
src/routes/credits.ts
src/routes/models.ts
src/routes/webhooks.ts
src/services/.gitkeep        # or thin placeholder modules
src/db/client.ts             # Supabase service-role client factory (reads env; no queries yet)
src/db/repositories/.gitkeep
src/orchestration/.gitkeep
src/tools/.gitkeep           # search + pdf come later
src/billing/.gitkeep
src/lib/billing/rates.ts     # placeholder rate table constants
src/lib/crypto/keys.ts       # placeholder encrypt/decrypt stubs (no real crypto wiring required beyond TODO)
db/schema.sql
db/types.ts
eslint.config.js             # flat config
prompts/scaffold-project.md  # this file
index.ts                     # remove or redirect to src
```



## Implementation requirements



### Package / scripts

- Add scripts:
  - `dev` — watch/reload Express server
  - `typecheck` — `tsc --noEmit`
  - `lint` — `eslint .` (or scoped to `src`/`db`)
  - `build` — production build
  - `start` — run production build
- Install scaffold dependencies listed in decisions; do not invent unrelated packages.
- Keep `"type": "module"`.



### Express app

- `createApp()` registers:
  - `GET /health`
  - Auth-protected (middleware stub):  
  `POST /chats`, `GET /chats/:chatId`, `POST /chats/:chatId/messages`,  
  `GET /credits`, `POST /credits/checkout`, `POST /credits/redeem`,  
  `GET /models`
  - `POST /webhooks/stripe` — **no** auth middleware; raw body for future Stripe signature verify
- Thin route handlers only — call into empty/stub services where a call site is needed; no LLM/Stripe/SQL in routes.
- Port from `PORT` env (default `3000`).
- JSON error shape consistent (e.g. `{ error: string, code?: string }`).



### Config / secrets

- `.env.example` lists every variable from AGENTS.md §19 (empty values / placeholders).
- `src/config/env.ts` parses with Zod; fail fast on boot if required vars missing **only when those features are used** — for scaffold, either (a) all optional with warnings, or (b) require only `PORT`-class basics and treat provider keys as optional until feature work. Prefer **optional for scaffold boot** so `bun run dev` works with empty `.env`; document required vars per feature in README.



### Database

- `db/schema.sql`: all tables from AGENTS.md §8 with sensible Postgres types (uuid PKs, timestamptz, enums or text checks for roles/providers/status), FKs, unique constraints (`credit_purchases.stripe_session_id`, `coupon_redemptions (coupon_code, user_id)`), and **RLS enabled** on exposed tables with a short comment that the API uses the service role (policies can be restrictive/deny-by-default for `anon`/`authenticated` until a later auth/RLS prompt).
- `db/types.ts`: TypeScript types mirroring the schema (no `any`).
- `src/db/client.ts`: create Supabase client with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` when present; export typed getter.



### Lib stubs

- `src/lib/billing/rates.ts`: export a typed per-provider rate table placeholder (zeros or TODO constants).
- Auth middleware: if `Authorization: Bearer <token>` missing → `401`; if present → attach `req.userId` as a TODO/placeholder without real JWT verify (comment: implement in auth-middleware prompt). **Do not** trust `user_id` from body.



### Docs

- Update `README.md`: what the backend is, how to install (`bun install`), copy `.env.example` → `.env`, run `bun run dev`, apply `db/schema.sql` in Supabase SQL Editor, list scripts. No frontend instructions.



## Security requirements

- Never commit real secrets; `.env` stays gitignored.
- No plaintext provider keys in source; `api_keys.encrypted_key` in schema only.
- Service-role key only in server env / `src/db/client.ts`.
- Webhook route must not use the auth JWT middleware.
- Admin secret pattern documented in `.env.example` (`ADMIN_SECRET`) but no admin routes required in scaffold unless a tiny stub is useful — skip admin routes for now.



## Acceptance criteria

- [ ] `bun run dev` starts and `GET /health` returns 200
- [ ] All AGENTS.md §14 routes are registered; mutating/read methods match the spec (`POST /chats`, etc.)
- [ ] Authenticated routes return 401 without Bearer token
- [ ] Authenticated routes with a dummy Bearer return 501 (or equivalent not-implemented) until features land
- [ ] `db/schema.sql` and `db/types.ts` cover all §8 tables including deviations (`credit_usage`, `credit_balances`, `credit_purchases`, `coupons`, `coupon_redemptions`)
- [ ] `.env.example` matches AGENTS.md §19 table
- [ ] `bun run typecheck` and `bun run lint` pass
- [ ] No LLM, Stripe API, or Tavily calls in the scaffold
- [ ] Layering respected: routes → services (stubs); no raw SQL in routes



## Checks to run

```bash
bun install
bun run typecheck
bun run lint
bun run build   # if build script is wired
bun run dev     # smoke: health check
```



## Manual test steps (after implementation)

```bash
# Terminal A
cp .env.example .env   # leave keys empty for scaffold
bun run dev

# Terminal B
curl -sS http://localhost:3000/health
# expect: {"ok":true} (or equivalent)

curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/chats
# expect: 401 (no auth) — or 404 if POST-only; for POST:
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/chats
# expect: 401

curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/chats \
  -H "Authorization: Bearer test" -H "Content-Type: application/json" -d '{}'
# expect: 501 (not implemented)

curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/webhooks/stripe
# expect: 501 (not 401) — webhook is unauthenticated stub
```

Watch the dev-server terminal for request logs from the request-log middleware.