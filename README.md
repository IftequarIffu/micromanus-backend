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

Optional: to apply schema via the Management API instead, set a personal access token as `SUPABASE_ACCESS_TOKEN` in `.env` (never commit it) and use the migrations endpoint — the runtime app does not need this token.

### Auth providers (Dashboard)

Supabase Auth owns Google/GitHub OAuth. In the Dashboard:

1. **Authentication** → **Providers**
2. Enable **Google** and **GitHub** (add client IDs/secrets from each provider console)
3. OAuth redirect URLs belong to the **frontend** when it exists — this backend only verifies Supabase-issued JWTs

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
curl -sS http://localhost:3000/health
# {"ok":true}
```

Authenticated routes require `Authorization: Bearer <token>` and currently return `501` until feature work lands. `POST /webhooks/stripe` is unauthenticated (Stripe signature verification comes later).

## API surface (stubs)

| Method | Path | Auth |
|---|---|---|
| `GET` | `/health` | no |
| `POST` | `/chats` | yes |
| `GET` | `/chats/:chatId` | yes |
| `POST` | `/chats/:chatId/messages` | yes |
| `GET` | `/credits` | yes |
| `POST` | `/credits/checkout` | yes |
| `POST` | `/credits/redeem` | yes |
| `GET` | `/models` | yes |
| `POST` | `/webhooks/stripe` | Stripe signature (later) |

Note: chat creation is `POST /chats` (not `GET /chats/new`).
