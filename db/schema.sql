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
  create type api_key_provider as enum ('openai', 'claude', 'gemini', 'tavily', 'stripe');
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

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  provider api_key_provider not null,
  encrypted_key text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists api_keys_provider_active_idx on api_keys (provider, active);

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
