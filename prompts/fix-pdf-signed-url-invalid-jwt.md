# Fix PDF open-in-new-tab InvalidJWT

## Goal

Stop `InvalidJWT` / `signature verification failed` when users open a generated PDF in a new tab.

## Skills read

- `.agents/skills/supabase/SKILL.md` — Storage signed URLs
- `.agents/skills/ai-sdk/SKILL.md` — tool calling / `toModelOutput` (verified against installed `ai@7`)

## Existing code inspected

- `src/lib/storage/pdfs.ts` — `createSignedUrl` (24h); live test with service-role key returns **HTTP 200** for intact tokens
- `src/tools/pdf.ts` — tool `execute` returns full `url` to the model
- `src/orchestration/chat.ts` — instructions tell the model to “include the download URL”; SSE `pdf_ready` already carries the pristine URL
- Frontend `chat-thread.tsx` — **Download PDF** uses `message.pdf.url` from SSE (correct); assistant markdown can also render a separate link from message text

## Root cause / decisions

Supabase Storage signed URLs are JWTs in the query string. Intact URLs from `createSignedUrl` work. Corrupting the signature (truncate last char, flip a char, tamper payload while keeping 3 JWT parts) reproduces exactly:

`{"statusCode":"400","error":"InvalidJWT","message":"signature verification failed"}`

The `create_pdf` tool currently returns the long signed `url` in the tool result the **model** sees. Instructions also ask it to paste that URL into the final reply. LLMs routinely mangle long JWTs → users click the **broken markdown link** and see InvalidJWT. The Download PDF control (SSE URL) is fine when used.

**Decisions:**

1. Keep returning `{ url, filename, path, bytes, pages }` from `execute` for orchestration / SSE / caching.
2. Add AI SDK `toModelOutput` so the **model** only sees filename, pages, bytes, and a short “use Download PDF — do not invent or paste a URL” note — **no signed URL**.
3. Update system `instructions`: do not paste storage/download URLs; tell the user the report is ready via **Download PDF**.
4. Defense in depth: before persisting assistant `content`, strip any `…/storage/v1/object/sign/…` URLs (replace with a short note). Do not fail the chat if scrubbing finds nothing.
5. When creating signed URLs for the client (`uploadChatPdf` / `createChatPdfSignedUrl`), pass `{ download: filename }` so the Download control triggers a download with the right filename (optional UX; does not fix JWT by itself).
6. Out of scope: authenticated backend PDF proxy (Bearer tokens do not attach on bare new-tab navigations; signed URLs remain the right open-in-tab mechanism). Frontend-only changes only if needed for copy — prefer backend so markdown never gets a breakable URL.

## Files likely to change

- `src/tools/pdf.ts` — `toModelOutput`; tool description tweak
- `src/orchestration/chat.ts` — instructions; scrub assistant content before `addAssistantMessage`
- `src/lib/storage/pdfs.ts` — `createSignedUrl(..., { download: filename })` (upload + re-sign helpers need filename where available)
- `README.md` / `FRONTEND_AGENTS.md` — one-line note: download via UI control; do not rely on pasted storage URLs

## Implementation requirements

1. `toModelOutput` returns `{ type: "json", value: { filename, pages, bytes, note } }` without `url` or `path`.
2. Instructions and tool description align: never paste signed/storage URLs.
3. Helper e.g. `scrubStorageSignedUrls(text: string): string` used once when saving the assistant message (orchestration or chats service).
4. Signed URLs emitted on SSE / `done.pdf` / `GET /chats/:id` `message.pdf` remain the real Storage URLs (with `download` option when filename known).
5. No secrets in logs; continue logging path/bytes/pages only.

## Security requirements

- Do not expose service-role key or master encryption key.
- Signed URLs stay time-limited; scrubbing must not introduce open redirects.
- Storage paths remain server-composed.

## Acceptance criteria

- [ ] Model tool result visible to the LLM does not include a Storage signed URL
- [ ] Assistant reply does not need a raw signed URL for the user to download
- [ ] SSE `pdf_ready` / `done.pdf` / hydrate `message.pdf` still provide a working URL
- [ ] Opening **Download PDF** in a new tab returns the PDF (HTTP 200), not InvalidJWT
- [ ] If a model still emits a storage sign URL, persisted content has it scrubbed
- [ ] `npm run typecheck` and `npm run lint` pass

## Checks to run

```bash
npm run typecheck
npm run lint
```

## Manual test steps

1. Restart API (`npm run dev`).
2. Ask for a PDF report in the UI (or curl `POST /chats/messages` with a PDF prompt).
3. Confirm server log: one `pdf tool invoked`; SSE includes `pdf_ready` with a long `url`.
4. Click **Download PDF** (new tab) — PDF opens/downloads; no JSON error.
5. Confirm assistant text does **not** contain a `supabase.co/storage/v1/object/sign/...` link (or only a scrubbed note).
6. Optional: paste the SSE `url` into a browser — still works (proves Storage signing is healthy).
