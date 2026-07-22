-- Persist PDF storage path on assistant messages so GET /chats/:id can re-sign a view URL.
-- REQUIRED: run in Supabase Dashboard → SQL Editor (View PDF after hard refresh depends on this).
alter table messages
  add column if not exists pdf_storage_path text,
  add column if not exists pdf_filename text;
