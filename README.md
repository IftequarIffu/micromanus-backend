# micromanus-backend

AI chat platform backend: multi-model LLM chat with streaming, tool use, source citations, credits, and Stripe billing.

This repo is **backend only** (Express + TypeScript on Bun). No frontend.

## Setup

```bash
bun install
cp .env.example .env
# Fill secrets as you implement features; empty .env is fine for the scaffold.
```

Apply the schema in Supabase Dashboard → SQL Editor:

- `db/schema.sql`

## Scripts

| Command | Purpose |
|---|---|
| `bun run dev` | Dev server with watch reload |
| `bun run typecheck` | TypeScript (`tsc --noEmit`) |
| `bun run lint` | ESLint |
| `bun run build` | Bundle to `dist/` |
| `bun run start` | Run production bundle |

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
