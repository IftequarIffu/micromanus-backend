-- Create the private Storage bucket used by the PDF tool, plus an RPC the
-- service-role API can call (Storage createBucket may be Forbidden for some keys).
-- Run in Supabase Dashboard → SQL Editor.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-pdfs',
  'chat-pdfs',
  false,
  10485760, -- 10MB
  array['application/pdf']::text[]
)
on conflict (id) do nothing;

create or replace function public.ensure_chat_pdfs_bucket()
returns jsonb
language plpgsql
security definer
set search_path = storage, public
as $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'chat-pdfs',
    'chat-pdfs',
    false,
    10485760,
    array['application/pdf']::text[]
  )
  on conflict (id) do nothing;

  return jsonb_build_object('ok', true, 'bucket', 'chat-pdfs');
end;
$$;

revoke all on function public.ensure_chat_pdfs_bucket() from public;
grant execute on function public.ensure_chat_pdfs_bucket() to service_role;
