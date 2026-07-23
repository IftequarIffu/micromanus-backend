# Update Claude catalog to Sonnet 4.5 and Haiku 4.5

## Goal

Make the Claude slots in the curated model catalog exactly **Claude Sonnet 4.5** and **Claude Haiku 4.5**, remove Claude Sonnet 4, and sync BYOK USD rate estimates to Anthropic’s published list prices.

## Skills read

- `.agents/skills/ai-sdk/SKILL.md` — verify model IDs (do not invent)
- `AGENTS.md` §15 (`GET /models`), §13 (rates centralization), §6 (AI SDK providers)

## Existing code inspected

- `src/orchestration/models.ts` — Claude entries today:
  - `claude-sonnet-4-5-20250929` / Claude Sonnet 4.5
  - `claude-sonnet-4-20250514` / Claude Sonnet 4 ← remove
- `src/lib/billing/rates.ts` — `MODEL_USD_RATES` keyed by model id (Sonnet 4.5 already present; Sonnet 4 present; Haiku missing)
- `src/routes/models.ts` — thin `GET /models` over `listModels()`
- `FRONTEND_AGENTS.md` §9.3 — API contract catalog for frontend
- `micromanus-frontend` — model picker loads from `GET /models` at runtime (`useModels`); no hardcoded Claude ids in app code. Docs in `micromanus-frontend/AGENTS.md` still list Sonnet 4 / stale OpenAI ids.

### Verified IDs

From Anthropic platform docs + AI Gateway:

| Label | Anthropic API id (BYOK) | Gateway id (reference only) |
| --- | --- | --- |
| Claude Sonnet 4.5 | `claude-sonnet-4-5-20250929` (alias `claude-sonnet-4-5`) | `anthropic/claude-sonnet-4.5` |
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` (alias `claude-haiku-4-5`) | `anthropic/claude-haiku-4.5` |

Use **dated snapshot ids** to match the existing Sonnet 4.5 entry and prior catalog style.

### Verified pricing (USD / 1M tokens)

Source: [Anthropic Claude Platform pricing](https://platform.claude.com/docs/en/about-claude/pricing) (and AI Gateway per-token rates × 1e6).

| Model | Input | Cache read (hits) | Output |
| --- | ---: | ---: | ---: |
| Claude Sonnet 4.5 | $3 | $0.30 | $15 |
| Claude Haiku 4.5 | $1 | $0.10 | $5 |

(Gateway: Sonnet input `0.000003` / output `0.000015` / cache read `0.0000003` per token; Haiku `0.000001` / `0.000005` / `0.0000001`.)

## Decisions / assumptions

1. **Replace, do not add.** Claude slots become exactly these two; remove `claude-sonnet-4-20250514`. Old id → `unknown_model`.
2. **Ids:** keep `claude-sonnet-4-5-20250929`; add `claude-haiku-4-5-20251001`.
3. **Labels:** `"Claude Sonnet 4.5"` and `"Claude Haiku 4.5"`.
4. **USD rates:** update `MODEL_USD_RATES` for both; remove Sonnet 4 row. Platform credit `PROVIDER_RATES` stay placeholder zeros (unchanged).
5. **OpenAI / Gemini unchanged.**
6. **Frontend app code:** no picker hardcoding — runtime `GET /models` is enough. Sync docs only:
   - `FRONTEND_AGENTS.md` (this repo)
   - `/home/iftequar/iffu-dev-env/micromanus-frontend/AGENTS.md` (sibling frontend contract)
7. Sonnet long-context tier (>200k) is higher on Anthropic; keep the existing simple flat rates (standard ≤200k tier), same as today’s Sonnet 4.5 row.

## Files likely to change

```
src/orchestration/models.ts
src/lib/billing/rates.ts
FRONTEND_AGENTS.md
../micromanus-frontend/AGENTS.md
prompts/claude-models-4.5.md   # this file
```

## Implementation requirements

1. In `AVAILABLE_MODELS`, set Claude entries to only:
   - `{ id: "claude-sonnet-4-5-20250929", provider: "claude", label: "Claude Sonnet 4.5" }`
   - `{ id: "claude-haiku-4-5-20251001", provider: "claude", label: "Claude Haiku 4.5" }`
2. In `MODEL_USD_RATES`:
   - `"claude-sonnet-4-5-20250929": { inputPer1M: 3, outputPer1M: 15, cachedPer1M: 0.3 }`
   - `"claude-haiku-4-5-20251001": { inputPer1M: 1, outputPer1M: 5, cachedPer1M: 0.1 }`
   - remove `"claude-sonnet-4-20250514"`
3. Update documented catalogs in `FRONTEND_AGENTS.md` and `micromanus-frontend/AGENTS.md` to match.

## Security requirements

- No secrets, env, or key-vault changes.
- Do not log or expose provider API keys.
- Model list remains auth-gated as today.

## Acceptance criteria

- `GET /models` returns Claude models only as Sonnet 4.5 and Haiku 4.5 with the ids/labels above.
- `claude-sonnet-4-20250514` is no longer resolvable (`unknown_model`).
- `MODEL_USD_RATES` matches the pricing table above for both models.
- OpenAI / Gemini catalog entries unchanged.
- Frontend + backend contract docs match the new Claude catalog.

## Checks to run

- `npm run typecheck`
- `npm run lint`

## Exact manual test steps

With the API running and a valid Bearer token:

```bash
# List models — expect only claude-sonnet-4-5-20250929 and claude-haiku-4-5-20251001 under claude
curl -sS http://localhost:3000/models \
  -H "Authorization: Bearer $TOKEN" | jq '.models | map(select(.provider=="claude"))'

# Old id should fail with unknown_model
curl -sS -X POST http://localhost:3000/chats/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"ping","model":"claude-sonnet-4-20250514"}'

# New Haiku id accepted (requires claude BYOK key + credits)
curl -sS -N -X POST http://localhost:3000/chats/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Say hello in one sentence.","model":"claude-haiku-4-5-20251001"}'
```

Watch the frontend model picker: Claude group should show Sonnet 4.5 and Haiku 4.5 only after refreshing models. Never expect decrypted keys in logs.
