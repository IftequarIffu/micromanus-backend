-- Atomic coupon redemption: insert redemption, bump count, increment balance.
-- Apply in Supabase Dashboard → SQL Editor after 002_complete_credit_purchase.sql.

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
