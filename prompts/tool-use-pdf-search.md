# PDF generation tool (v1)

## Goal

Add an LLM-callable **`create_pdf`** tool so the assistant can turn structured report content into a downloadable PDF and mention a link in the chat reply. Research stays in the existing `web_search` tool; the PDF tool is dumb: **content in → file URL out**.

Fits `AGENTS.md` §14: PDF logic in `tools/pdf.ts`, Zod I/O, no direct DB writes inside the tool. Wire it into chat orchestration alongside `web_search`.

**Out of scope:** coupon/billing changes, rate-table finalization, Tavily extract/crawl, frontend UI, admin file management, OCR, charts/images in PDFs, authenticated download routes (v1 uses signed Storage URLs only).

## Skills read

- `.agents/skills/ai-sdk/SKILL.md` — verify `tool` / `streamText` tool registration against installed `ai` package docs (`node_modules/ai/docs/`); do not invent APIs
- `.agents/skills/supabase/SKILL.md` — Storage upload via service-role client; private bucket; signed URLs; storage upsert needs INSERT+SELECT+UPDATE if policies apply (service role bypasses RLS but bucket must exist)
- `AGENTS.md` §11–§12 (streaming / tool loop), §14 (tools), §16 (no secrets in client responses), §18 (logging), §19–§21 (tests/checks)

## Existing code inspected

- `src/tools/search.ts` — pattern: Zod schemas, `tool({ description, inputSchema, execute })`, callback for orchestration collection, no DB writes
- `src/tools/index.ts` — exports search only
- `src/orchestration/chat.ts` — `streamText` with `tools: { web_search }`, `stopWhen: isStepCount(5)`, collects sources, SSE `token` / `done` / `error`; instructions mention search only
- `src/db/client.ts` — service-role Supabase client
- `package.json` — no PDF library yet
- `db/schema.sql` — no `generated_files` / attachments table; no Storage SQL (Storage is Dashboard/API)
- README SSE docs for chat events

## Decisions / assumptions

1. **Tool name:** `create_pdf` (registered next to `web_search` on `streamText`).

2. **Tool input (Zod):**
   ```ts
   {
     title: string;                    // 1–200 chars
     sections: {                       // 1–20 items
       heading: string;                // 1–200
       body: string;                   // 1–8000
     }[];
     sources?: { title: string; url: string }[];  // max 20
     filename?: string;                // optional; sanitized server-side
   }
   ```
   Reject oversized payloads in Zod (fail the tool call with a clear error string the model can see). Cap total body text reasonably (e.g. sum of section bodies ≤ ~40k chars) if easy to enforce in `execute`.

3. **Tool output (Zod):**
   ```ts
   {
     url: string;          // signed download URL
     filename: string;     // e.g. report-2026-07-21.pdf
     path: string;         // storage object path (for logs / future re-sign)
     bytes: number;
   }
   ```
   Never return raw PDF bytes or base64 in the tool result (keeps context small).

4. **PDF renderer:** **PDFKit** (`pdfkit`). Text-only report layout:
   - Title
   - Generated-at line (UTC ISO date)
   - For each section: heading + wrapped body paragraphs
   - Optional “Sources” list with titles + URLs
   - Simple page numbers in footer if straightforward
   No images, no markdown rendering engine, no headless browser.

5. **Storage:** Supabase Storage private bucket **`chat-pdfs`**.
   - Object path: `{userId}/{chatId}/{uuid}-{safeFilename}.pdf`
   - Upload via service-role `storage.from('chat-pdfs').upload(...)`
   - Return **signed URL** with expiry **24 hours** (`createSignedUrl`)
   - Document Dashboard steps: create bucket `chat-pdfs`, **private**, no public policies needed for service-role uploads
   - Provide SQL or Dashboard notes in README / migration comment file if useful; Storage buckets are often created in Dashboard — also include a small script or documented `storage.buckets` insert if the project already uses SQL for infra (prefer Dashboard + README if simpler)

6. **Context for the tool:** `createPdfTool` factory must receive `{ userId, chatId }` (and optionally `onCreated` callback) so the path is scoped. Orchestration wires it when building tools for the request — same pattern as search’s `onResults`.

7. **Orchestration changes:**
   - Register `create_pdf` alongside `web_search`
   - Update system `instructions` to: use `web_search` for current info; when the user asks for a PDF/report/document, research first if needed, then call `create_pdf` with structured sections (never empty placeholder body); mention the returned `url` in the final reply
   - Keep `stopWhen: isStepCount(5)` (enough for ~2 searches + pdf + reply); do not raise unless testing shows failures
   - On successful PDF creation, emit SSE **`event: pdf_ready`** with `{ url, filename }` (in addition to the model mentioning it in text) so a future frontend can show a download button without parsing markdown
   - Emit `pdf_ready` as soon as the tool succeeds if the AI SDK exposes tool results mid-stream; otherwise emit after the stream when collecting tool outcomes — prefer mid-stream if `fullStream` / tool events make it easy without restructuring the whole loop. If mid-stream is awkward, emit once before `done` with the last collected PDF meta. Document which approach was chosen.
   - Collect last PDF result for `done` payload optional field: `pdf?: { url, filename }`
   - Log: `pdf tool invoked chatId=… bytes=… path=…` (never log file contents)

8. **No DB table in v1.** Persistence of the link is via assistant message text + optional `pdf` on the `done` SSE event. No `attachments` table yet (call out as follow-up if signed URLs expire).

9. **Credits:** no extra flat PDF fee in v1 — token ledger unchanged. Platform cost is Storage + CPU only.

10. **Filename sanitization:** strip path separators and non-alphanumeric (allow `-` `_`); default `report.pdf`; ensure `.pdf` suffix; max ~80 chars.

11. **Dependency:** add `pdfkit` + `@types/pdfkit` (dev) if needed; pin versions; prefer Bun-compatible usage (Buffer streams).

12. **Layering:** `tools/pdf.ts` = schema + render + upload + signed URL. Thin helper for Storage OK under `src/lib/storage/pdfs.ts` or inside the tool module if small. Routes unchanged. No PDF logic in route handlers.

## Files likely to change

```
package.json / bun.lock
src/tools/pdf.ts                 # new
src/tools/index.ts               # export createPdfTool + schemas
src/orchestration/chat.ts        # register tool, instructions, SSE pdf_ready
src/lib/storage/pdfs.ts          # optional: upload + signed URL helper
README.md                        # bucket setup + SSE event + curl example
.env.example                     # only if a new env var is needed (prefer none; reuse SUPABASE_*)
prompts/tool-use-pdf-search.md   # this file
```

Optional: `db/migrations/004_chat_pdfs_bucket.sql` **only if** inserting into `storage.buckets` via SQL is reliable for this project; otherwise Dashboard-only docs in README.

## Implementation requirements

1. Implement `createPdfTool({ userId, chatId, onCreated? })` mirroring search tool style.
2. Render PDF with PDFKit from validated input; write to a `Buffer`.
3. Upload to `chat-pdfs` and create a 24h signed URL; return Zod-validated output.
4. Wire into `streamChatCompletion`; update instructions; SSE `pdf_ready` + optional `done.pdf`.
5. Fail clearly if Supabase client missing or Storage upload fails (tool throws / returns error the model sees; chat stream should not crash the whole response if the PDF tool fails mid-loop — follow existing AI SDK tool-error behavior; if the model recovers, fine; if stream fails, existing error SSE path).
6. Update README: create private bucket `chat-pdfs`; document `pdf_ready` SSE; manual test curl for a PDF-request prompt.

## Security requirements

- Service-role only for Storage; never expose service role or bucket write to clients.
- Paths always prefixed with verified `userId` / `chatId` from auth context — never from tool input.
- Signed URLs are time-limited; do not make the bucket public.
- Do not log PDF body, decrypted keys, or Storage credentials.
- Sanitize filename; reject path traversal in any user-influenced string.

## Acceptance criteria

- [ ] `create_pdf` is available to the model during chat completion
- [ ] Tool does not write to Postgres; search sources persistence unchanged
- [ ] Valid tool call produces a PDF in Storage and a signed `url` in the tool result
- [ ] Assistant can mention the URL; SSE includes `pdf_ready` (and `done` may include `pdf`)
- [ ] Oversized / invalid tool input fails validation without crashing the server
- [ ] README documents bucket setup and a curl test for a PDF report prompt
- [ ] `npm run typecheck` and `npm run lint` pass
- [ ] Layering: no PDF/Storage code in route handlers

## Checks to run

```bash
npm run typecheck
npm run lint
npm run build
```

## Manual test steps (after implementation)

1. Supabase Dashboard → **Storage** → create bucket `chat-pdfs` → **Private**.
2. Ensure user has credits, a provider API key, and `TAVILY_API_KEY` set (for news research).
3. Start server: `bun run dev`.
4. Start a **new** chat whose first message asks for a PDF (lazy create — no prior `chatId`):

```bash
curl -N -sS http://localhost:3000/chats/messages \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"content":"Generate a short PDF report on the latest Russia-Ukraine war news with sources.","model":"gpt-4o-mini"}'
```

5. Watch the SSE stream for:
   - `event: chat_created` with `{ "chatId": "..." }` (first)
   - `event: token` (model text)
   - `event: pdf_ready` with `{ "chatId", "url", "filename" }` (once PDF is ready)
   - `event: done` with `ok: true`, `chatId`, and optional `pdf`
6. Same tools also work on an existing chat via `POST /chats/:chatId/messages`.
7. Open the signed `url` in a browser — PDF should download/open with title, sections, and sources.
8. Confirm Storage Dashboard shows an object under `{userId}/{chatId}/…`.
9. Server logs should show search (if used) and pdf tool invoked with byte size — never key material.
