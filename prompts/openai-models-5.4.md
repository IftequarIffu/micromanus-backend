# Update OpenAI models to GPT-5.4 Mini and Nano

## Goal

Replace the curated OpenAI entries in the model catalog with **GPT-5.4 Mini** (`gpt-5.4-mini`) and **GPT-5.4 Nano** (`gpt-5.4-nano`), so `GET /models` and chat `resolveModel` accept these IDs.

## Skills read

- `.agents/skills/ai-sdk/SKILL.md` — verify model IDs against current provider/gateway lists (do not invent IDs)
- `AGENTS.md` §15 (`GET /models`), §6 (AI SDK providers)

## Existing code inspected

- `src/orchestration/models.ts` — `AVAILABLE_MODELS` currently has:
  - `gpt-5-mini` / GPT-5 Mini
  - `gpt-4.1-mini` / GPT-4.1 Mini
  - plus Claude and Gemini entries (unchanged)
- `src/routes/models.ts` — thin `GET /models` over `listModels()`
- `src/orchestration/chat.ts` — `resolveModel(modelId)` then `createOpenAI({ apiKey })(modelId)`
- `README.md` — curl examples use `gpt-5-mini`
- `FRONTEND_AGENTS.md` §9.3 — documents the same catalog for the frontend contract

Verified via AI Gateway: `openai/gpt-5.4-mini` and `openai/gpt-5.4-nano` exist. BYOK path uses bare ids (`gpt-5.4-mini`, `gpt-5.4-nano`) with `@ai-sdk/openai`.

## Decisions / assumptions

1. **Replace, do not add.** OpenAI slots become exactly these two; remove `gpt-5-mini` and `gpt-4.1-mini`. Requests with the old ids will correctly fail with `unknown_model`.
2. **Labels:** `"GPT-5.4 Mini"` and `"GPT-5.4 Nano"` (match user wording / OpenAI naming).
3. **Ids:** `gpt-5.4-mini`, `gpt-5.4-nano` (alias form, not dated snapshots).
4. **Claude / Gemini unchanged.** Platform credit rates stay provider-level (`lib/billing/rates.ts`); no per-model rate change.
5. **Docs sync:** Update `FRONTEND_AGENTS.md` catalog + example body, and `README.md` curl `model` values, so the API contract stays accurate. No frontend app code in this repo.

## Files likely to change

```
src/orchestration/models.ts
FRONTEND_AGENTS.md
README.md
prompts/openai-models-5.4.md   # this file
```

## Implementation requirements

1. In `AVAILABLE_MODELS`, set OpenAI entries to:
   - `{ id: "gpt-5.4-mini", provider: "openai", label: "GPT-5.4 Mini" }`
   - `{ id: "gpt-5.4-nano", provider: "openai", label: "GPT-5.4 Nano" }`
2. Keep Claude and Gemini entries as-is.
3. Update documented catalogs / curl examples that still reference `gpt-5-mini` or `gpt-4.1-mini` to the new default (`gpt-5.4-mini` for examples).

## Security requirements

- No secrets, env, or key-vault changes.
- Do not log or expose provider API keys.
- Model list remains auth-gated as today (no widening of access).

## Acceptance criteria

- `GET /models` returns OpenAI models `gpt-5.4-mini` and `gpt-5.4-nano` with the labels above.
- `gpt-5-mini` and `gpt-4.1-mini` are no longer resolvable (`unknown_model`).
- Claude and Gemini catalog entries unchanged.
- Docs (`FRONTEND_AGENTS.md`, `README.md`) match the new catalog.

## Checks to run

- `npm run typecheck`
- `npm run lint`

## Exact manual test steps

With the API running and a valid Bearer token:

```bash
# List models — expect gpt-5.4-mini and gpt-5.4-nano under openai
curl -sS http://localhost:3000/models \
  -H "Authorization: Bearer $TOKEN" | jq .

# Old id should fail validation / unknown_model on message send
curl -sS -X POST http://localhost:3000/chats/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"ping","model":"gpt-5-mini"}'

# New id accepted (requires openai BYOK key + credits)
curl -sS -N -X POST http://localhost:3000/chats/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Say hello in one sentence.","model":"gpt-5.4-mini"}'
```

Watch the dev-server terminal for LLM start/complete logs; never expect decrypted keys in logs.
