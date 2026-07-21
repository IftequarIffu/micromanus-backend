-- Idempotent complete of a Stripe credit purchase + balance increment.
-- Apply in Supabase Dashboard → SQL Editor after 001_api_keys_byok.sql.

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
      -- Race: another worker completed it
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
      -- fall through to balance increment (we just flipped pending → completed)
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
