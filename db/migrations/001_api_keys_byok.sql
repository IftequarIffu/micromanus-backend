-- Migrate api_keys to BYOK (AGENTS.md §8 / §16)
-- Run in Supabase Dashboard → SQL Editor if GET/POST /api-keys returns 500 / schema_outdated.
-- Safe to re-run: drops and recreates api_keys only (no other tables).

drop table if exists api_keys;

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  provider llm_provider not null,
  encrypted_key text not null,
  iv text not null,
  auth_tag text not null,
  last_four text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint api_keys_user_provider_unique unique (user_id, provider)
);

create index if not exists api_keys_user_id_idx on api_keys (user_id);

alter table api_keys enable row level security;

grant select, insert, update, delete on table api_keys to service_role;
revoke all on table api_keys from anon, authenticated;

-- Credit ledger RPC (needed for chat completion; harmless if already present)
create or replace function record_credit_usage_and_decrement(
  p_user_id uuid,
  p_chat_id uuid,
  p_model_name text,
  p_provider llm_provider,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cached_tokens integer,
  p_credits_charged integer
)
returns credit_usage
language plpgsql
security invoker
set search_path = public
as $$
declare
  usage_row credit_usage;
  updated_count integer;
begin
  if p_credits_charged < 0 then
    raise exception 'credits_charged must be non-negative';
  end if;

  insert into credit_usage (
    user_id, chat_id, model_name, provider,
    input_tokens, output_tokens, cached_tokens, credits_charged
  )
  values (
    p_user_id, p_chat_id, p_model_name, p_provider,
    p_input_tokens, p_output_tokens, p_cached_tokens, p_credits_charged
  )
  returning * into usage_row;

  update credit_balances
  set balance = balance - p_credits_charged, updated_at = now()
  where user_id = p_user_id
    and balance >= p_credits_charged;

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'insufficient_credits';
  end if;

  return usage_row;
end;
$$;

revoke all on function record_credit_usage_and_decrement(
  uuid, uuid, text, llm_provider, integer, integer, integer, integer
) from public;
grant execute on function record_credit_usage_and_decrement(
  uuid, uuid, text, llm_provider, integer, integer, integer, integer
) to service_role;
