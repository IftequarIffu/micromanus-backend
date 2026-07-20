# micromanus-backend

AI chat platform backend: multi-model LLM chat with streaming, tool use, source citations, credits, and Stripe billing.

This repo is **backend only** (Express + TypeScript on Bun). No frontend.

## Setup

```bash
bun install
cp .env.example .env
# Fill at least: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
```

### Supabase schema

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**.
2. Paste the contents of `db/schema.sql` and **Run**.
3. Verify from the repo:

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

## Smoke test

```bash
bun run dev
```

```bash
curl -sS http://localhost:4000/health
# {"ok":true}

curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:4000/me
# 401

curl -sS http://localhost:4000/me \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>"
# {"id":"...","name":"...","email":"...","created_at":"..."}
```

Protected feature routes still return `501` until those features land. `POST /webhooks/stripe` stays unauthenticated (Stripe signature later).

## API surface

| Method | Path | Auth |
|---|---|---|
| `GET` | `/health` | no |
| `GET` | `/me` | yes |
| `POST` | `/chats` | yes |
| `GET` | `/chats/:chatId` | yes |
| `POST` | `/chats/:chatId/messages` | yes |
| `GET` | `/credits` | yes |
| `POST` | `/credits/checkout` | yes |
| `POST` | `/credits/redeem` | yes |
| `GET` | `/models` | yes |
| `POST` | `/webhooks/stripe` | Stripe signature (later) |

Note: chat creation is `POST /chats` (not `GET /chats/new`).
