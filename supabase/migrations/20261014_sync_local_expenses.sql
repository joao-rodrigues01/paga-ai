-- Publica despesas locais atomicamente e permite reexecução sem duplicar dados.
begin;

create or replace function public.sync_local_expense(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_expense jsonb := p_data->'expense';
  v_expense_id uuid;
  v_existing_owner uuid;
  v_installment_count integer;
  v_split_count integer;
  v_valid_split_count integer;
  v_inserted_count integer;
  v_card_id uuid;
  v_total numeric(12, 2);
begin
  if v_user_id is null then raise exception 'Autenticação necessária.' using errcode = '42501'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 1048576
    or jsonb_typeof(v_expense) <> 'object'
    or jsonb_typeof(p_data->'installments') <> 'array'
    or jsonb_typeof(p_data->'splits') <> 'array' then
    raise exception 'Dados da despesa inválidos ou maiores que 1 MB.' using errcode = '22023';
  end if;

  v_expense_id := (v_expense->>'id')::uuid;
  v_total := (v_expense->>'totalAmount')::numeric(12, 2);
  select e.created_by into v_existing_owner from public.expenses e where e.id = v_expense_id;
  if found then
    if v_existing_owner <> v_user_id then raise exception 'Este identificador pertence a outra conta.' using errcode = '42501'; end if;
    return jsonb_build_object('alreadySynced', true, 'expenseId', v_expense_id);
  end if;

  if v_total <= 0 or (v_expense->>'installmentsCount')::integer not between 1 and 48
    or jsonb_array_length(p_data->'installments') <> (v_expense->>'installmentsCount')::integer then
    raise exception 'Total ou quantidade de parcelas inválidos.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_user_id) then
    raise exception 'Perfil não encontrado; entre novamente.' using errcode = '23503';
  end if;
  v_card_id := nullif(v_expense->>'creditCardId', '')::uuid;
  if v_card_id is not null then
    if jsonb_typeof(p_data->'creditCard') is distinct from 'object'
      or (p_data->'creditCard'->>'id')::uuid is distinct from v_card_id then
      raise exception 'Dados do cartão desta despesa ausentes ou inválidos.' using errcode = '22023';
    end if;
    insert into public.credit_cards (id, owner_profile_id, group_id, name, closing_day, due_day)
    values (v_card_id, v_user_id, null, p_data->'creditCard'->>'name',
      (p_data->'creditCard'->>'closingDay')::smallint, (p_data->'creditCard'->>'dueDay')::smallint)
    on conflict (id) do update set
      name = excluded.name, closing_day = excluded.closing_day, due_day = excluded.due_day, updated_at = now()
    where credit_cards.owner_profile_id = v_user_id and credit_cards.group_id is null;
    get diagnostics v_inserted_count = row_count;
    if v_inserted_count <> 1 then
      raise exception 'O cartão existente não pertence a esta conta.' using errcode = '42501';
    end if;
  end if;

  select count(*) into v_installment_count from jsonb_array_elements(p_data->'installments');
  select count(*) into v_split_count from jsonb_array_elements(p_data->'splits');
  if v_split_count = 0 then raise exception 'A despesa precisa ter ao menos uma divisão.' using errcode = '22023'; end if;
  if (select coalesce(sum((row_data.value->>'amount')::numeric), 0)
      from jsonb_array_elements(p_data->'installments') as row_data(value)) <> v_total then
    raise exception 'A soma das parcelas precisa ser igual ao total da despesa.' using errcode = '22023';
  end if;

  select count(*) into v_valid_split_count
  from jsonb_to_recordset(p_data->'splits') as s("friendId" uuid, "dependentId" uuid, "isMe" boolean)
  left join public.friendships f on not coalesce(s."isMe", false)
    and f.id = s."friendId" and f.user_id = v_user_id
  left join public.dependents d on d.id = s."dependentId"
    and ((coalesce(s."isMe", false) and d.profile_id = v_user_id)
      or (not coalesce(s."isMe", false) and d.contact_id = s."friendId"))
  where (coalesce(s."isMe", false) and (s."dependentId" is null or d.id is not null))
    or (not coalesce(s."isMe", false) and f.id is not null
      and exists (select 1 from public.contacts c where c.id = s."friendId"
        and c.owner_profile_id = v_user_id and c.group_id is null)
      and (s."dependentId" is null or d.id is not null));
  if v_valid_split_count <> v_split_count then
    raise exception 'Sincronize os amigos e dependentes desta conta antes da despesa.' using errcode = '42501';
  end if;

  insert into public.expenses (id, title, total_amount, date, group_id, created_by,
    credit_card_id, payment_method, installments_count, created_at)
  values (v_expense_id, v_expense->>'title', v_total, (v_expense->>'date')::date,
    null, v_user_id, v_card_id,
    case when v_card_id is null then 'pix' else 'credit_card' end,
    (v_expense->>'installmentsCount')::smallint,
    coalesce(nullif(v_expense->>'createdAt', '')::timestamptz, now()));

  insert into public.expense_installments (id, expense_id, installment_number, amount, due_date)
  select i.id, v_expense_id, i."installmentNumber", i.amount, i."dueDate"::date
  from jsonb_to_recordset(p_data->'installments') as i(id uuid, "installmentNumber" smallint, amount numeric, "dueDate" text);

  if exists (
    select 1 from public.expense_installments i
    cross join lateral (
      select coalesce(sum((row_data.value->>'amountOwed')::numeric), 0) as shares_total,
        count(*) as shares_count
      from jsonb_array_elements(p_data->'splits') as row_data(value)
      where (row_data.value->>'expenseInstallmentId')::uuid = i.id
    ) totals
    where i.expense_id = v_expense_id and (totals.shares_count = 0 or totals.shares_total <> i.amount)
  ) then raise exception 'As divisões de cada parcela precisam fechar com o valor da parcela.' using errcode = '22023'; end if;

  insert into public.expense_splits (id, installment_id, payer_profile_id, payer_contact_id,
    friendship_id, profile_id, dependent_id, amount_owed, is_paid, paid_at)
  select s.id, s."expenseInstallmentId",
    case when coalesce(s."isMe", false) then v_user_id else null end,
    case when coalesce(s."isMe", false) then null else s."friendId" end,
    case when coalesce(s."isMe", false) then null else f.id end,
    case when coalesce(s."isMe", false) then v_user_id else f.friend_profile_id end,
    s."dependentId", s."amountOwed", coalesce(s."isPaid", false), nullif(s."paidAt", '')::timestamptz
  from jsonb_to_recordset(p_data->'splits') as s(id uuid, "expenseInstallmentId" uuid,
    "friendId" uuid, "dependentId" uuid, "amountOwed" numeric, "isPaid" boolean,
    "paidAt" text, "isMe" boolean)
  left join public.friendships f on not coalesce(s."isMe", false)
    and f.id = s."friendId" and f.user_id = v_user_id;
  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> v_split_count then raise exception 'Não foi possível salvar todas as divisões.' using errcode = '22023'; end if;

  return jsonb_build_object('alreadySynced', false, 'expenseId', v_expense_id);
end;
$$;

revoke all on function public.sync_local_expense(jsonb) from public, anon;
grant execute on function public.sync_local_expense(jsonb) to authenticated;
commit;
