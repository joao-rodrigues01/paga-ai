-- Replaces only the import RPC after correcting the JSON alias for friend dependents.
-- Safe to apply after 20261012_friendships_and_local_import.sql.

create or replace function public.import_local_backup(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_me_id uuid;
  v_me_count integer;
  v_counts jsonb;
  v_friend_count integer;
  v_card_count integer;
  v_expense_count integer;
  v_installment_count integer;
  v_split_count integer;
begin
  if v_user_id is null then raise exception 'Autenticação necessária.' using errcode = '42501'; end if;
  if p_data is null or pg_column_size(p_data) > 5242880 then
    raise exception 'Backup ausente ou maior que 5 MB.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_data->'friends') <> 'array'
    or jsonb_typeof(p_data->'creditCards') <> 'array'
    or jsonb_typeof(p_data->'expenses') <> 'array'
    or jsonb_typeof(p_data->'expenseInstallments') <> 'array'
    or jsonb_typeof(p_data->'expenseSplits') <> 'array' then
    raise exception 'Estrutura do backup PagaAí inválida.' using errcode = '22023';
  end if;

  perform 1 from public.profiles p where p.id = v_user_id for update;
  if not found then raise exception 'Perfil não encontrado; entre novamente.' using errcode = '23503'; end if;
  select count(*) into v_me_count
  from jsonb_to_recordset(p_data->'friends') as f(id uuid, "isMe" boolean)
  where coalesce(f."isMe", false);
  if v_me_count <> 1 then
    raise exception 'O backup deve conter exatamente um perfil “Eu”.' using errcode = '22023';
  end if;
  select id into v_me_id
  from jsonb_to_recordset(p_data->'friends') as f(id uuid, "isMe" boolean)
  where coalesce(f."isMe", false);
  if v_me_id is null then raise exception 'ID do perfil “Eu” inválido.' using errcode = '22023'; end if;

  -- Não permita que um payload anexe uma despesa a um cartão alheio ou omitido.
  if exists (
    select 1
    from jsonb_to_recordset(p_data->'expenses') as e("creditCardId" uuid)
    where e."creditCardId" is not null
      and not exists (
        select 1 from jsonb_to_recordset(p_data->'creditCards') as c(id uuid)
        where c.id = e."creditCardId"
      )
  ) then
    raise exception 'O backup referencia cartão ausente na própria conta.' using errcode = '22023';
  end if;

  select row_counts into v_counts from private.local_backup_imports where user_id = v_user_id;
  if found then return jsonb_build_object('alreadyImported', true, 'counts', v_counts); end if;

  -- Atualiza apenas os campos do próprio perfil vindos do registro isMe.
  update public.profiles p set
    name = coalesce(nullif(f.name, ''), p.name),
    avatar_url = nullif(f.avatar, ''),
    pix_key = nullif(f."pixKey", '')
  from jsonb_to_recordset(p_data->'friends') as f(id uuid, name text, avatar text, "pixKey" text, "isMe" boolean)
  where p.id = v_user_id and f.id = v_me_id;

  insert into public.contacts (id, owner_profile_id, group_id, name, avatar, pix_key)
  select f.id, v_user_id, null, f.name, coalesce(f.avatar, ''), nullif(f."pixKey", '')
  from jsonb_to_recordset(p_data->'friends') as f(id uuid, name text, avatar text, "pixKey" text, "isMe" boolean)
  where not coalesce(f."isMe", false);

  insert into public.friendships (id, user_id, friend_name, status)
  select f.id, v_user_id, f.name, 'pending'
  from jsonb_to_recordset(p_data->'friends') as f(id uuid, name text, "isMe" boolean)
  where not coalesce(f."isMe", false);

  insert into public.credit_cards (id, owner_profile_id, group_id, name, closing_day, due_day)
  select c.id, v_user_id, null, c.name, c."closingDay", c."dueDay"
  from jsonb_to_recordset(p_data->'creditCards') as c(id uuid, name text, "closingDay" smallint, "dueDay" smallint);

  insert into public.dependents (id, profile_id, contact_id, name)
  select d.id,
    case when coalesce((friend_row.friend_json->>'isMe')::boolean, false) then v_user_id else null end,
    case when coalesce((friend_row.friend_json->>'isMe')::boolean, false) then null
      else (friend_row.friend_json->>'id')::uuid end,
    d.name
  from jsonb_array_elements(p_data->'friends') as friend_row(friend_json)
  cross join lateral jsonb_to_recordset(coalesce(friend_row.friend_json->'dependents', '[]'::jsonb)) as d(id uuid, name text);

  insert into public.expenses (id, title, total_amount, date, group_id, created_by,
                               credit_card_id, payment_method, installments_count, created_at)
  select e.id, e.title, e."totalAmount", e.date::date, null, v_user_id,
    e."creditCardId",
    case when e."creditCardId" is null then 'pix' else 'credit_card' end,
    e."installmentsCount", coalesce(e."createdAt", now())
  from jsonb_to_recordset(p_data->'expenses') as e(
    id uuid, title text, "totalAmount" numeric, date text, "creditCardId" uuid,
    "installmentsCount" smallint, "createdAt" timestamptz);

  insert into public.expense_installments (id, expense_id, installment_number, amount, due_date)
  select i.id, i."expenseId", i."installmentNumber", i.amount, i."dueDate"::date
  from jsonb_to_recordset(p_data->'expenseInstallments') as i(
    id uuid, "expenseId" uuid, "installmentNumber" smallint, amount numeric, "dueDate" text);

  insert into public.expense_splits (id, installment_id, payer_profile_id, payer_contact_id,
                                     friendship_id, profile_id, dependent_id, amount_owed, is_paid, paid_at)
  select s.id, s."expenseInstallmentId",
    case when coalesce(f."isMe", false) then v_user_id else null end,
    case when coalesce(f."isMe", false) then null else s."friendId" end,
    case when coalesce(f."isMe", false) then null else s."friendId" end,
    case when coalesce(f."isMe", false) then v_user_id else fr.friend_profile_id end,
    s."dependentId", s."amountOwed", s."isPaid", s."paidAt"
  from jsonb_to_recordset(p_data->'expenseSplits') as s(
    id uuid, "expenseInstallmentId" uuid, "friendId" uuid, "dependentId" uuid,
    "amountOwed" numeric, "isPaid" boolean, "paidAt" timestamptz)
  join jsonb_to_recordset(p_data->'friends') as f(id uuid, "isMe" boolean) on f.id = s."friendId"
  left join public.friendships fr on fr.id = s."friendId" and fr.user_id = v_user_id;

  select count(*) into v_friend_count
  from jsonb_to_recordset(p_data->'friends') as f("isMe" boolean)
  where not coalesce(f."isMe", false);
  select count(*) into v_card_count from jsonb_array_elements(p_data->'creditCards');
  select count(*) into v_expense_count from jsonb_array_elements(p_data->'expenses');
  select count(*) into v_installment_count from jsonb_array_elements(p_data->'expenseInstallments');
  select count(*) into v_split_count from jsonb_array_elements(p_data->'expenseSplits');
  v_counts := jsonb_build_object('friendships', v_friend_count, 'creditCards', v_card_count,
    'expenses', v_expense_count, 'installments', v_installment_count, 'splits', v_split_count);
  insert into private.local_backup_imports (user_id, row_counts) values (v_user_id, v_counts);
  return jsonb_build_object('alreadyImported', false, 'counts', v_counts);
end;
$$;
