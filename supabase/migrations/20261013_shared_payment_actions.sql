-- Permite que uma pessoa convidada marque sua parcela ou toda a dívida de
-- uma despesa como paga, sem dar UPDATE direto nas demais colunas da divisão.
begin;

create or replace function public.mark_shared_expense_paid(
  p_expense_id uuid,
  p_installment_number smallint default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_updated integer;
begin
  if v_user_id is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;
  if p_installment_number is not null and p_installment_number not between 1 and 48 then
    raise exception 'Número de parcela inválido.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.expense_splits s
    join public.expense_installments i on i.id = s.installment_id
    join public.friendships f on f.id = s.friendship_id
    where i.expense_id = p_expense_id
      and s.profile_id = v_user_id
      and f.friend_profile_id = v_user_id
      and f.status = 'accepted'
  ) then
    raise exception 'Esta despesa não foi compartilhada com sua conta.' using errcode = '42501';
  end if;

  update public.expense_splits s
  set is_paid = true, paid_at = now()
  from public.expense_installments i, public.friendships f
  where s.installment_id = i.id
    and f.id = s.friendship_id
    and i.expense_id = p_expense_id
    and (p_installment_number is null or i.installment_number = p_installment_number)
    and s.profile_id = v_user_id
    and f.friend_profile_id = v_user_id
    and f.status = 'accepted'
    and not s.is_paid;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.mark_shared_expense_paid(uuid, smallint) from public, anon;
grant execute on function public.mark_shared_expense_paid(uuid, smallint) to authenticated;

commit;
