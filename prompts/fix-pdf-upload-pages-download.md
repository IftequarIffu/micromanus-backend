# Fix PDF double-upload, empty pages, and download affordance

## Goal

Fix three PDF-tool bugs:

1. **Double storage** — each PDF request creates two objects in the `chat-pdfs` Supabase bucket.
2. **Empty trailing pages** — generated PDFs end with many blank pages.
3. **Download UI** — frontend never shows a usable “Download PDF” control after `create_pdf` succeeds.

## Skills read

- `.agents/skills/ai-sdk/SKILL.md` (tool calling / `streamText` loop)
- Existing PDF/storage code (no new skills invented)

## Existing code inspected

- `src/tools/pdf.ts` — PDFKit render + `createPdfTool` execute/upload
- `src/lib/storage/pdfs.ts` — sanitize filename, bucket ensure, upload, signed URL
- `src/orchestration/chat.ts` — registers tools, SSE `pdf_ready` / `done.pdf`, `stopWhen: isStepCount(8)`
- `FRONTEND_AGENTS.md` + sibling `micromanus-frontend`:
  - `src/providers/chat-stream-provider.tsx` (handles `pdf_ready` / `done.pdf`)
  - `src/components/chat-thread.tsx` (renders Tool chip when `message.pdf` is set)
  - `src/pages/chat-page.tsx` (hydrate from `GET /chats/:id` — **no pdf fields**)

## Root cause analysis / decisions

### 1. Double upload

`create_pdf` uploads to a **new** path every call (`{userId}/{chatId}/{uuid}-{filename}`). The agent loop allows up to 8 steps (`isStepCount(8)`), so the model often calls `create_pdf` twice (e.g. “improve” the report). Each call stores another object.

**Decision:** Enforce **at most one successful upload per chat completion request**:

- Memoize the first successful `CreatePdfOutput` inside `createPdfTool`’s closure.
- On a second `execute`, return the cached result and log a skip — do **not** render or upload again.
- Tighten system instructions: “Call `create_pdf` at most once per reply.”
- Optional hardening: after first success, `prepareStep` can omit `create_pdf` from available tools (only if easy with installed AI SDK; memoization alone is sufficient).

### 2. Empty pages

Classic PDFKit bug: with `bufferPages: true`, writing footer text at `page.height - 36` while `margins.bottom` is still `54` makes PDFKit think content overflows and **auto-adds blank pages** for each footer write.

**Decision:** When stamping page numbers:

- Save `doc.page.margins.bottom`, set it to `0`, write the footer in the margin band, restore the margin (Stack Overflow / PDFKit issue #953 pattern).
- Use `lineBreak: false` (already present).
- Capture `bufferedPageRange()` **once** before the footer loop; do not re-count after footers.
- Do **not** change the overall report structure (title / TOC / sections / sources) beyond the footer fix unless empty pages remain.

### 3. Download button not showing

Backend already emits:

- SSE `pdf_ready` `{ chatId, url, filename }` mid-stream via `onCreated`
- `done.pdf` `{ url, filename }` when `lastPdf` is set

Frontend wires those into `message.pdf` and renders a Tool chip with a link. Gaps:

1. **Live stream reliability:** Prefer driving the agent loop via `fullStream` (or keep `textStream` but ensure `pdf_ready` is written and the response is flushed) so tool completion is not lost; after `writeSse(..., "pdf_ready", ...)`, call `res.flush?.()` if available (Bun/Express).
2. **Hydrate wipe / no persistence:** `GET /chats/:id` returns messages/sources only — no PDF metadata. Reloading or hydrating a chat cannot restore `message.pdf`. For a durable download button without a large schema redesign: store `pdf_storage_path` + `pdf_filename` on the assistant `messages` row when a PDF was created for that reply; on `GET /chats/:id`, re-sign a fresh URL (24h) and return `pdf?: { url, filename }` on that message.
3. **Frontend label:** Sibling `micromanus-frontend` chip shows the filename, not “Download PDF”. Update the chip to an explicit **Download PDF** control wired to `message.pdf.url`, and map `pdf` from chat detail hydrate.

**Decision:** Implement (1)+(2) in this backend repo; also patch the sibling frontend for (3) + hydrate mapping, since the user reported a UI failure. Schema change is small and justified.

## Files likely to change

**Backend (this repo)**

- `src/tools/pdf.ts` — once-guard; footer margin fix
- `src/orchestration/chat.ts` — instructions; flush after `pdf_ready`; persist PDF meta on assistant message; optionally `fullStream` for tokens + tool timing
- `src/services/chats.ts` (or equivalent) — update message with pdf path/filename; include re-signed pdf on chat detail
- `db/schema.sql`, `db/types.ts`, new migration under `db/migrations/` — `messages.pdf_storage_path`, `messages.pdf_filename` (nullable)
- `src/lib/storage/pdfs.ts` — export a `createChatPdfSignedUrl(path)` helper for re-sign on read
- `README.md` / `FRONTEND_AGENTS.md` — document message-level `pdf` on `GET /chats/:id`

**Frontend (sibling `/home/iftequar/iffu-dev-env/micromanus-frontend`)**

- `src/lib/types.ts` — message/`GET` chat types include optional `pdf`
- `src/pages/chat-page.tsx` — hydrate `pdf` onto `UiMessage`
- `src/components/chat-thread.tsx` — explicit “Download PDF” button/link

## Implementation requirements

1. **Once per request:** First successful `create_pdf` wins; subsequent calls return cache, no second upload.
2. **Footer fix:** Zero bottom margin while writing page numbers; no blank trailing pages from footer loop.
3. **Persist PDF on assistant message** after stream completes when `lastPdf` / storage path is known:
   - Tool return already has `path`; extend `PdfCreatedMeta` (or parallel field) to include `path` so orchestration can store it.
   - Columns: `pdf_storage_path text null`, `pdf_filename text null` on `messages`.
4. **`GET /chats/:id`:** For each assistant message with `pdf_storage_path`, attach `pdf: { url, filename }` using a freshly signed URL. If signing fails, omit `pdf` (do not fail the whole chat).
5. **SSE unchanged in shape:** Keep `pdf_ready` and `done.pdf` as `{ chatId?, url, filename }` (chatId required on `pdf_ready` as today).
6. **Frontend:** Show a clear Download PDF control when `message.pdf` is present (stream or hydrate).
7. No plaintext secrets in logs; continue logging path/bytes/pages only.

## Security requirements

- Storage paths remain server-composed; never accept client-supplied storage paths for signing without ownership checks (sign only paths loaded from the user’s own message rows).
- Signed URLs stay time-limited (24h).
- Do not return storage paths to the client if avoidable — prefer `{ url, filename }` only (path stays DB-internal).

## Acceptance criteria

- [ ] One user PDF request → **one** object under `chat-pdfs/{userId}/{chatId}/…`
- [ ] Generated PDF has no long run of blank pages after content (footers on real pages only)
- [ ] During stream: `pdf_ready` arrives; UI shows **Download PDF**
- [ ] After reload / hydrate: `GET /chats/:id` includes `pdf` on the assistant message; UI still shows **Download PDF**
- [ ] Second `create_pdf` in the same completion does not upload again
- [ ] `npm run typecheck` and `npm run lint` pass (backend); frontend typechecks if touched

## Checks to run

Backend:

```bash
npm run typecheck
npm run lint
```

Frontend (if patched):

```bash
cd ../micromanus-frontend && npm run typecheck
```

## Manual test steps (after implementation)

1. Apply migration SQL for `messages.pdf_*` in Supabase SQL Editor.
2. Start backend + frontend; sign in with a model key and positive credits.
3. Ask: `Create a detailed PDF briefing report about <topic>`.
4. Watch server logs: exactly **one** `pdf tool invoked` upload line (or a second call logged as cache hit / skipped upload).
5. In Supabase Storage → `chat-pdfs` → `{userId}/{chatId}/`: **one** new object.
6. Open the PDF: content pages + sources; **no** large blank tail.
7. UI: **Download PDF** appears during/after stream; click opens/downloads the file.
8. Refresh `/chat/{chatId}`: button still present (fresh signed URL).
9. Curl check (optional):

```bash
# Stream (look for pdf_ready + done.pdf)
curl -N -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"Create a PDF report on renewable energy","model":"gpt-5.4-mini"}' \
  http://localhost:3000/chats/messages

# Hydrate
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/chats/$CHAT_ID
# Expect assistant message with "pdf": { "url": "...", "filename": "..." }
```
