# Vercel deploy readiness (backend + frontend) + Stripe test mode in production

## Goal

Make **micromanus-backend** and **micromanus-frontend** deployable as **two separate Vercel projects**, with cross-origin API calls working in production, long-running chat SSE streaming viable on Vercel Fluid compute, and **Stripe kept in Test mode** on the production deployment so dummy cards (e.g. `4242…`) work.

**Out of scope:** migrating to live Stripe keys, changing credit pricing, Supabase schema changes, implementing new product features, combining repos into a monorepo.

## Skills read

- `.agents/skills/stripe-best-practices/SKILL.md` (+ payments/security references as needed)
- Vercel Express guide: https://vercel.com/kb/guide/ship-a-express-app-on-vercel
- `AGENTS.md` §5–6 (Express layers), §12 (streaming), §16–17 (secrets / Stripe), §20 (env)
- `FRONTEND_AGENTS.md` §3 (proxy/CORS note), credits/checkout contract

## Existing code inspected

**Backend (`micromanus-backend`):**

- `src/index.ts` — `createApp()` + `app.listen` only; **no default export** for Vercel
- `src/app.ts` — Express app; Stripe raw body mount correct; **no CORS**
- `src/config/env.ts` / `.env.example` — Stripe + checkout URLs; no `CORS_ORIGINS` / frontend origin
- `src/billing/stripe.ts` — Checkout Sessions + webhook verify via `constructEventAsync`; mode is whatever `STRIPE_SECRET_KEY` is (`sk_test_` vs `sk_live_`)
- `package.json` — Bun scripts (`dev`/`build`/`start`); Express 5; no `cors` package; no `vercel.json`
- Local `.env` already uses `sk_test_…` and localhost checkout URLs

**Frontend (`micromanus-frontend`, sibling repo):**

- Vite React SPA; `vite.config.ts` proxies API in **dev only** (backend has no CORS)
- `src/lib/api.ts` — `VITE_API_URL` optional; empty = same-origin (proxy). Production **must** set absolute API URL
- `src/lib/supabase.ts` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Auth `redirectTo: window.location.origin` — fine once Supabase allow-lists the Vercel frontend URL
- No `vercel.json`, no `.env.example`, README is still the Vite template stub

## Decisions / assumptions

1. **Two Vercel projects** (separate Git repos): one for backend, one for frontend. Do not merge into one project unless the user later asks.
2. **Backend runtime: Node on Vercel** (default Express runtime). Do **not** set `bunVersion` — Bun on Vercel fails with empty `ResolveMessage` for this repo’s `.ts` imports. Enable experimental Express build via `VERCEL_EXPERIMENTAL_BACKENDS=1` and `VERCEL_ENABLE_EXPERIMENTAL_BUILD_MODE=1` in `vercel.json` `env`. Keep Fluid compute; set `maxDuration` to **300** (document Pro can raise to 800). Local `bun run dev` is unchanged.
3. **Vercel entry:** export the Express app as **default export** from `src/index.ts` (recognized entry). Call `app.listen` only when **not** running on Vercel (`!process.env.VERCEL`), so local `bun run dev` / `start` still works.
4. **CORS is required for production.** Add middleware (prefer `cors` package) driven by env:
   - `CORS_ORIGINS` — comma-separated absolute origins (e.g. `https://micromanus.vercel.app,https://micromanus-git-main-….vercel.app`)
   - Allow methods needed by the API; allow headers `Authorization`, `Content-Type`, `Accept`
   - Do **not** enable CORS for everything with `*`; reject missing/unknown origins
   - Webhooks (`POST /webhooks/stripe`) are server-to-server from Stripe — no browser CORS needed there
5. **Stripe Test mode in Vercel Production is intentional.** Mode is determined solely by key prefix:
   - Production backend env must use **`STRIPE_SECRET_KEY=sk_test_…`** (Dashboard → **Test mode** → API keys)
   - Create a **Test mode** webhook endpoint pointing at `https://<backend-vercel-host>/webhooks/stripe` for `checkout.session.completed`; set `STRIPE_WEBHOOK_SECRET` to that endpoint’s **whsec_…** (not the local Stripe CLI secret)
   - Set `CHECKOUT_SUCCESS_URL` / `CHECKOUT_CANCEL_URL` to the **production frontend** URLs (with `{CHECKOUT_SESSION_ID}` on success)
   - Frontend never needs a Stripe publishable key (hosted Checkout redirect)
   - **Safety:** at Stripe client init, if the secret key starts with `sk_live_`, throw / refuse to start billing unless `ALLOW_LIVE_STRIPE=true` is set. Log clearly when running in test mode (`sk_test_`). This locks the soft-launch to dummy cards unless explicitly overridden.
6. **Frontend Vite on Vercel:** static build (`bun run build` or `npm run build`), output `dist`. Add `vercel.json` SPA rewrite: all non-file routes → `/index.html` so React Router and Stripe return to `/credits?…` work.
7. **Frontend env (Vercel Production):**
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (anon/publishable only)
   - `VITE_API_URL=https://<backend-vercel-host>` (no trailing slash)
8. **Post-deploy checklist (document, not code):** Supabase Auth → URL configuration: add production frontend origin to Site URL / Redirect URLs; Google/GitHub OAuth apps if they restrict redirect URIs.
9. **Do not commit secrets.** Update `.env.example` / frontend `.env.example` only. Never copy real keys from local `.env` into git.
10. **Docs:** Backend `README.md` + frontend `README.md` get a short “Deploy to Vercel” section (env tables, Stripe Test webhook, dummy card note). Update `FRONTEND_AGENTS.md` CORS/proxy note: local still uses Vite proxy; production uses CORS + `VITE_API_URL`.

## Files likely to change

**Backend:**

```
package.json / bun.lock          # add cors (+ @types if needed)
vercel.json                      # bunVersion, maxDuration
.env.example                     # CORS_ORIGINS, ALLOW_LIVE_STRIPE, deploy notes for Stripe test
src/config/env.ts                # CORS_ORIGINS, ALLOW_LIVE_STRIPE
src/index.ts                     # default export + conditional listen
src/app.ts                       # CORS middleware
src/billing/stripe.ts            # refuse live keys unless ALLOW_LIVE_STRIPE; log test mode
README.md                        # Vercel + Stripe Test production setup
FRONTEND_AGENTS.md               # CORS / VITE_API_URL production note
prompts/vercel-deploy-stripe-test.md  # this file
```

**Frontend (`../micromanus-frontend`):**

```
vercel.json                      # SPA rewrites to index.html
.env.example                     # VITE_* vars
README.md                        # deploy + env
package.json                     # optional: engines / vercel-friendly build note only if needed
```

## Implementation requirements

### Backend

1. Add `vercel.json`:
   - `"$schema": "https://openapi.vercel.sh/vercel.json"`
   - `"framework": "express"`, `"fluid": true`, `"maxDuration": 300`
   - **No** `bunVersion` (Node runtime)
   - `env.VERCEL_EXPERIMENTAL_BACKENDS=1` and `env.VERCEL_ENABLE_EXPERIMENTAL_BUILD_MODE=1` (fixes TS `.ts` import resolution / empty `ResolveMessage`)
2. `src/index.ts`: create app, `export default app`, listen only when `process.env.VERCEL` is unset.
3. CORS middleware from `CORS_ORIGINS` (split on comma, trim). If unset in production, log a clear warning; requests from browsers with no matching origin fail CORS (expected until env is set). Locally, either leave unset (same-origin via proxy) or allow `http://localhost:5173`.
4. Stripe live-key guard as in decision 5.
5. Keep webhook raw-body path unchanged and working on Vercel (no extra body parsers that stringify the webhook body).

### Frontend

1. `vercel.json` SPA fallback rewrite.
2. `.env.example` documenting the three `VITE_*` vars and that `VITE_API_URL` is required on Vercel.
3. README deploy steps: import Git repo → set env → deploy → point `VITE_API_URL` at backend URL → re-deploy frontend if backend URL changes.

### Stripe Test-on-Production (operator steps — document in README)

1. Stripe Dashboard: stay in **Test mode**.
2. Copy Test secret key → Vercel backend `STRIPE_SECRET_KEY`.
3. Developers → Webhooks → Add endpoint → URL `https://<api>/webhooks/stripe` → event `checkout.session.completed` → copy signing secret → `STRIPE_WEBHOOK_SECRET`.
4. Set checkout success/cancel URLs to production frontend.
5. Buy credits on production site with [test card](https://docs.stripe.com/testing#cards) `4242 4242 4242 4242`, any future expiry, any CVC.

## Security requirements

- Never expose service role, `ENCRYPTION_KEY`, Stripe secret, webhook secret, or Tavily key to the frontend or `VITE_*` vars.
- CORS allowlist only configured frontend origins (include preview origins only if intentionally needed).
- Live Stripe keys blocked by default (`ALLOW_LIVE_STRIPE` required).
- Do not log decrypted keys, ciphertext, or full Stripe secrets.

## Acceptance criteria

- [ ] Backend deploys on Vercel (Bun) and `GET /health` returns OK on the production API host.
- [ ] Frontend deploys on Vercel; deep links / Stripe return to `/credits?…` do not 404.
- [ ] Browser on frontend origin can call backend with `Authorization` (CORS preflight + actual request succeed).
- [ ] Chat SSE still streams (within `maxDuration`).
- [ ] With `sk_test_` + Test webhook configured, Checkout on production accepts dummy card `4242…` and webhook credits the user.
- [ ] Setting `sk_live_` without `ALLOW_LIVE_STRIPE=true` fails billing clearly.
- [ ] `.env.example` files and READMEs document all required Vercel env vars; no secrets committed.

## Checks to run

**Backend:**

```bash
npm run typecheck   # or bun run typecheck
npm run lint
npm run build
```

**Frontend:**

```bash
bun run typecheck
bun run lint
bun run build
```

## Exact manual test steps (after deploy)

Replace hosts with real Vercel URLs.

```bash
# Backend health
curl -sS https://<backend>.vercel.app/health

# CORS preflight (expect Allow-Origin = frontend)
curl -sSI -X OPTIONS https://<backend>.vercel.app/models \
  -H "Origin: https://<frontend>.vercel.app" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization"

# Authenticated smoke (use a real Supabase access token from the browser session)
curl -sS https://<backend>.vercel.app/credits \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

**Stripe Test checkout (browser):**

1. Open `https://<frontend>.vercel.app`, sign in.
2. Credits → buy ≥ 5 credits → complete Checkout with `4242 4242 4242 4242`.
3. Land on `/credits?checkout=success&session_id=…`; balance increases after webhook (watch Vercel backend logs + Stripe Test → Webhooks delivery).
4. Confirm Stripe Dashboard **Test mode** Payments shows the charge (not Live).
