-- Persist PDF storage path on assistant messages so GET /chats/:id can re-sign a download URL.
alter table messages
  add column if not exists pdf_storage_path text,
  add column if not exists pdf_filename text;
