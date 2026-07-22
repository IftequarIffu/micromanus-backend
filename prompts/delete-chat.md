# Delete chat (messages + PDFs)

## Goal

Add `DELETE /chats/:chatId` so an authenticated owner can permanently remove a chat, its messages/sources/usage rows, and all PDFs stored for that chat in the `chat-pdfs` bucket.

## Skills / code inspected

- `db/schema.sql` — `messages`/`sources`/`credit_usage` cascade on `chats` delete
- `src/lib/storage/pdfs.ts` — paths `{userId}/{chatId}/{uuid}-{filename}`
- `src/routes/chats.ts`, `src/services/chats.ts`, `src/db/repositories/chats.ts`

## Decisions

1. Verify ownership via `getChatOwnedByUser`; missing/foreign → `404 chat_not_found` (same as GET).
2. Delete Storage objects under `{userId}/{chatId}/` **before** deleting the chat row (also remove any `pdf_storage_path` listed on messages).
3. DB delete of `chats` cascades messages, sources, credit_usage — no manual child deletes.
4. Storage failures after ownership check: log and still delete the chat (avoid stuck DB rows); return `204` when the chat row is gone.
5. Response: `204` empty body (match API-key delete).

## Files

- `src/lib/storage/pdfs.ts` — `deleteChatPdfs`
- `src/db/repositories/chats.ts` — `deleteChatOwnedByUser`
- `src/services/chats.ts` — `deleteOwnedChat`
- `src/routes/chats.ts` — `DELETE /chats/:chatId`
- Frontend sibling: sidebar delete + mutation + local list cleanup

## Acceptance

- Owner can delete; other user’s id → 404
- Messages and PDFs gone; sidebar item removed; viewing deleted chat redirects to `/new`
