-- micromanus schema (AGENTS.md §8)
-- Apply in Supabase Dashboard → SQL Editor.
-- The API uses the service-role client and bypasses RLS.
-- RLS is enabled; anon/authenticated have no table privileges (backend-only).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type message_role as enum ('user', 'assistant');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type llm_provider as enum ('openai', 'claude', 'gemini');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type purchase_status as enum ('pending', 'completed', 'failed');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

-- If users already existed without the auth.users FK, add it idempotently.
do $$ begin
  alter table users
    add constraint users_id_fkey
    foreign key (id) references auth.users (id) on delete cascade;
exception
  when duplicate_object then null;
  when undefined_table then null;
end $$;

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now()
);

create index if not exists chats_user_id_idx on chats (user_id);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats (id) on delete cascade,
  role message_role not null,
  content text not null,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists messages_chat_id_created_at_idx on messages (chat_id, created_at);

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats (id) on delete cascade,
  message_id uuid not null references messages (id) on delete cascade,
  source_link text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists sources_message_id_idx on sources (message_id);
create index if not exists sources_chat_id_idx on sources (chat_id);

-- Usage ledger (originally "Credits" in the product spec)
create table if not exists credit_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  chat_id uuid not null references chats (id) on delete cascade,
  model_name text not null,
  provider llm_provider not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  credits_charged integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists credit_usage_user_id_idx on credit_usage (user_id);
create index if not exists credit_usage_chat_id_idx on credit_usage (chat_id);

create table if not exists credit_balances (
  user_id uuid primary key references users (id) on delete cascade,
  balance integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint credit_balances_balance_non_negative check (balance >= 0)
);

create table if not exists credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  stripe_session_id text not null,
  amount_paid_cents integer not null,
  credits_granted integer not null,
  status purchase_status not null default 'pending',
  created_at timestamptz not null default now(),
  constraint credit_purchases_stripe_session_id_unique unique (stripe_session_id)
);

create index if not exists credit_purchases_user_id_idx on credit_purchases (user_id);

create table if not exists coupons (
  code text primary key,
  credits_value integer not null,
  max_redemptions integer not null,
  redemptions_count integer not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  constraint coupons_credits_value_positive check (credits_value > 0),
  constraint coupons_max_redemptions_positive check (max_redemptions > 0),
  constraint coupons_redemptions_within_max check (redemptions_count <= max_redemptions)
);

create table if not exists coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_code text not null references coupons (code) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  constraint coupon_redemptions_coupon_user_unique unique (coupon_code, user_id)
);

-- ---------------------------------------------------------------------------
-- BYOK api_keys (AGENTS.md §8 / §16)
-- Replaces older system-wide api_keys shape if present.
-- ---------------------------------------------------------------------------

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

-- Optional: drop unused legacy enum if it exists (safe if nothing depends on it)
do $$ begin
  drop type if exists api_key_provider;
exception when dependent_objects_still_exist then null;
end $$;

-- ---------------------------------------------------------------------------
-- Credit usage + balance decrement (single transaction via RPC)
-- ---------------------------------------------------------------------------

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
    user_id,
    chat_id,
    model_name,
    provider,
    input_tokens,
    output_tokens,
    cached_tokens,
    credits_charged
  )
  values (
    p_user_id,
    p_chat_id,
    p_model_name,
    p_provider,
    p_input_tokens,
    p_output_tokens,
    p_cached_tokens,
    p_credits_charged
  )
  returning * into usage_row;

  update credit_balances
  set
    balance = balance - p_credits_charged,
    updated_at = now()
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

-- ---------------------------------------------------------------------------
-- Complete Stripe purchase + balance increment (single transaction via RPC)
-- ---------------------------------------------------------------------------

create or replace function complete_credit_purchase(
  p_stripe_session_id text,
  p_user_id uuid,
  p_amount_paid_cents integer,
  p_credits_granted integer
)
returns credit_purchases
language plpgsql
security invoker
set search_path = public
as $$
declare
  purchase_row credit_purchases;
  updated_count integer;
begin
  if p_credits_granted <= 0 then
    raise exception 'credits_granted must be positive';
  end if;
  if p_amount_paid_cents < 0 then
    raise exception 'amount_paid_cents must be non-negative';
  end if;

  select * into purchase_row
  from credit_purchases
  where stripe_session_id = p_stripe_session_id
  for update;

  if found then
    if purchase_row.user_id <> p_user_id then
      raise exception 'purchase_user_mismatch';
    end if;

    if purchase_row.status = 'completed' then
      return purchase_row;
    end if;

    update credit_purchases
    set status = 'completed'
    where id = purchase_row.id
      and status = 'pending'
    returning * into purchase_row;

    get diagnostics updated_count = row_count;
    if updated_count = 0 then
      select * into purchase_row
      from credit_purchases
      where stripe_session_id = p_stripe_session_id;
      return purchase_row;
    end if;
  else
    insert into credit_purchases (
      user_id,
      stripe_session_id,
      amount_paid_cents,
      credits_granted,
      status
    )
    values (
      p_user_id,
      p_stripe_session_id,
      p_amount_paid_cents,
      p_credits_granted,
      'completed'
    )
    on conflict (stripe_session_id) do nothing
    returning * into purchase_row;

    if not found then
      select * into purchase_row
      from credit_purchases
      where stripe_session_id = p_stripe_session_id
      for update;

      if purchase_row.user_id <> p_user_id then
        raise exception 'purchase_user_mismatch';
      end if;

      if purchase_row.status = 'completed' then
        return purchase_row;
      end if;

      update credit_purchases
      set status = 'completed'
      where id = purchase_row.id
        and status = 'pending'
      returning * into purchase_row;

      get diagnostics updated_count = row_count;
      if updated_count = 0 then
        select * into purchase_row
        from credit_purchases
        where stripe_session_id = p_stripe_session_id;
        return purchase_row;
      end if;
    end if;
  end if;

  insert into credit_balances (user_id, balance, updated_at)
  values (p_user_id, p_credits_granted, now())
  on conflict (user_id) do update
  set
    balance = credit_balances.balance + excluded.balance,
    updated_at = now();

  return purchase_row;
end;
$$;

revoke all on function complete_credit_purchase(text, uuid, integer, integer) from public;
grant execute on function complete_credit_purchase(text, uuid, integer, integer) to service_role;

-- Atomic coupon redemption: insert redemption, bump count, increment balance.
create or replace function redeem_coupon(
  p_user_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  normalized_code text;
  coupon_row coupons;
  redemption_row coupon_redemptions;
  new_balance integer;
begin
  normalized_code := upper(trim(p_code));
  if normalized_code is null or normalized_code = '' then
    raise exception 'coupon_not_found';
  end if;

  select * into coupon_row
  from coupons
  where code = normalized_code
  for update;

  if not found then
    raise exception 'coupon_not_found';
  end if;

  if not coupon_row.active then
    raise exception 'coupon_inactive';
  end if;

  if coupon_row.expires_at is not null and coupon_row.expires_at <= now() then
    raise exception 'coupon_expired';
  end if;

  if coupon_row.redemptions_count >= coupon_row.max_redemptions then
    raise exception 'coupon_exhausted';
  end if;

  begin
    insert into coupon_redemptions (coupon_code, user_id)
    values (normalized_code, p_user_id)
    returning * into redemption_row;
  exception
    when unique_violation then
      raise exception 'coupon_already_redeemed';
  end;

  update coupons
  set redemptions_count = redemptions_count + 1
  where code = normalized_code
    and redemptions_count < max_redemptions
  returning * into coupon_row;

  if not found then
    raise exception 'coupon_exhausted';
  end if;

  insert into credit_balances (user_id, balance, updated_at)
  values (p_user_id, coupon_row.credits_value, now())
  on conflict (user_id) do update
  set
    balance = credit_balances.balance + excluded.balance,
    updated_at = now()
  returning balance into new_balance;

  return jsonb_build_object(
    'coupon_code', normalized_code,
    'credits_granted', coupon_row.credits_value,
    'balance', new_balance,
    'redemption_id', redemption_row.id
  );
end;
$$;

revoke all on function redeem_coupon(uuid, text) from public;
grant execute on function redeem_coupon(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- RLS (deny-by-default for Data API roles; backend uses service role)
-- ---------------------------------------------------------------------------

alter table users enable row level security;
alter table chats enable row level security;
alter table messages enable row level security;
alter table sources enable row level security;
alter table credit_usage enable row level security;
alter table credit_balances enable row level security;
alter table credit_purchases enable row level security;
alter table coupons enable row level security;
alter table coupon_redemptions enable row level security;
alter table api_keys enable row level security;

-- ---------------------------------------------------------------------------
-- Privileges: service_role only (backend). Revoke Data API roles.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on table
  users,
  chats,
  messages,
  sources,
  credit_usage,
  credit_balances,
  credit_purchases,
  coupons,
  coupon_redemptions,
  api_keys
to service_role;

revoke all on table
  users,
  chats,
  messages,
  sources,
  credit_usage,
  credit_balances,
  credit_purchases,
  coupons,
  coupon_redemptions,
  api_keys
from anon, authenticated;
