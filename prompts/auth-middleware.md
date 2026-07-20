# Auth middleware (Supabase Google / GitHub OAuth)

## Goal

Implement **backend** authentication for micromanus: verify Supabase-issued JWTs on protected routes, attach `userId` from the token `sub` claim, and upsert `public.users` on first authenticated request. Document Dashboard setup for **Google** and **GitHub** OAuth (Supabase Auth owns the OAuth redirect / token exchange — this backend must not implement those).

## Skills read

- `.agents/skills/supabase/SKILL.md` — JWT/`user_metadata` security checklist; service-role boundary
- Docs: [JWTs](https://supabase.com/docs/guides/auth/jwts.md), [Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google.md), [Login with GitHub](https://supabase.com/docs/guides/auth/social-login/auth-github.md)
- `AGENTS.md` §9 (Auth), §15 (secrets), §17 (logging)

## Existing code inspected

- `src/middleware/auth.ts` — stub: requires Bearer, sets `userId = "unverified"`, no JWT verify
- `src/db/client.ts` — service-role Supabase client
- `src/db/repositories/index.ts` — empty stub
- `src/config/env.ts` — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` optional
- `src/routes/*` — protected routes use `requireAuth` then `501`
- `db/schema.sql` — `users(id → auth.users, name, email, created_at)`; service-role grants only
- No frontend in this repo

## Decisions / assumptions

1. **OAuth lives in Supabase + future frontend.** Backend never redirects to Google/GitHub, never exchanges OAuth codes, never sets session cookies for end users. Document provider setup (callback URL = Supabase `…/auth/v1/callback`) in README.
2. **Verification strategy (prefer local crypto, no Auth round-trip on every request):**
   - Use `jose` to verify access tokens.
   - Prefer asymmetric keys via remote JWKS: `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` when keys exist.
   - Fall back to HS256 with `SUPABASE_JWT_SECRET` when JWKS is empty (legacy shared-secret projects — matches current `.env`).
   - Require claim `role === "authenticated"` (or accept only user access tokens with a `sub` UUID). Reject expired / bad signature with `401`.
   - Do **not** use `user_metadata` for authorization. `userId` = JWT `sub` only.
3. **User upsert:** After valid JWT, ensure a `public.users` row exists (`id = sub`). Name/email from Auth user profile via service-role `auth.getUser(jwt)` **or** JWT claims (`email` claim + safe display name fallback). Prefer one `getUser` call only when the local users row is missing (avoid Auth round-trip every request). Never trust `user_id` from the request body.
4. **Require env at auth time:** If URL + (JWT secret or working JWKS) / service role needed for upsert are missing when `requireAuth` runs, return `503` with a clear code (misconfigured server), not a false `401`.
5. **Add `GET /me`** (auth-protected) returning `{ id, name, email, created_at }` for the upserted user — thin route → users service/repo. Lets curl-test auth without implementing chats. Other routes stay `501` for now.
6. **No password auth, no custom JWT signing, no admin secret on auth routes.**
7. **Logging:** log auth success (user id only) and auth failure reason codes — never log the raw Bearer token.

## Files likely to change

```
package.json                         # add jose (pin version)
src/middleware/auth.ts               # real JWT verify + attach userId
src/db/repositories/users.ts         # upsert / getById via service role
src/db/repositories/index.ts         # export
src/services/users.ts                # thin service over repo (ensureUser)
src/routes/me.ts or auth.ts          # GET /me
src/app.ts                           # mount GET /me
src/config/env.ts                    # document required vars for auth; keep boot optional
README.md                            # Google/GitHub Dashboard steps + curl tests
.env.example                         # note JWT secret / publishable key if any
prompts/auth-middleware.md           # this file
```

## Implementation requirements

1. Install and pin `jose` (lockfile update).
2. Implement JWT verification helper (e.g. `src/lib/auth/verify-supabase-jwt.ts`) used by middleware.
3. Replace stub `requireAuth` with async middleware: extract Bearer → verify → set `req.userId` → `ensureUser` → `next()`. On failure: `401` `{ error, code: "unauthorized" }`.
4. `users` repository: `getById`, `upsert({ id, name, email })` using service-role client; typed with `db/types.ts`.
5. `GET /me` returns the current user row; `401` without/invalid token.
6. README: Dashboard steps for Google + GitHub (OAuth app creation, Supabase callback URL, enable providers). Note that `signInWithOAuth` runs in a **frontend** (or temporary test script), not this API. Document how to obtain an access token for curl (Dashboard user / Auth API / future frontend).
7. Keep layers: routes → services → repositories; no Supabase calls inside route handlers beyond calling services.

## Security requirements

- Never trust body `user_id`.
- Never log tokens or secrets.
- Service-role key server-only.
- Do not authorize from `user_metadata` / editable claims.
- Webhook routes remain without JWT middleware.
- Reject tokens that fail signature, expiry, or missing `sub`.

## Acceptance criteria

- [ ] Missing/invalid Bearer → `401` on protected routes including `GET /me`
- [ ] Valid Supabase user access token → `GET /me` returns upserted user; second call does not duplicate row
- [ ] `req.userId` is the JWT `sub` (real UUID), never `"unverified"`
- [ ] README documents Google + GitHub provider Dashboard setup and callback URL
- [ ] No OAuth redirect/code-exchange endpoints added to this backend
- [ ] `bun run typecheck` and `bun run lint` pass

## Checks to run

```bash
bun run typecheck
bun run lint
bun run db:verify   # still green
```

## Manual test steps (after implementation)

```bash
# Terminal A
bun run dev

# Terminal B — no token
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:4000/me
# expect: 401

curl -sS -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer junk" http://localhost:4000/me
# expect: 401

# Obtain a real access_token after enabling Google/GitHub in Dashboard and signing in
# (frontend, or Supabase Dashboard → Authentication → Users → generate / use a session).
# Then:
curl -sS http://localhost:4000/me \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"
# expect: 200 { "id": "...", "name": "...", "email": "...", "created_at": "..." }

# Confirm user row:
bun run db:verify
# users count should be >= 1 after first successful /me
```

Watch the dev-server terminal for auth success/failure logs (user id only, no token).
