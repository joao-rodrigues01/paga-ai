-- Adiciona amizades e compartilhamento por despesa sobre o schema existente.
-- Não remove groups/contacts nem apaga dados. Execute uma vez no SQL Editor.
begin;

create table if not exists public.friendships (
  id uuid primary key references public.contacts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_profile_id uuid references public.profiles(id) on delete set null,
  friend_name text not null check (length(trim(friend_name)) > 0),
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  invite_token_hash text,
  invite_expires_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'pending' and friend_profile_id is null) or
         (status = 'accepted' and friend_profile_id is not null)),
  check (friend_profile_id is null or friend_profile_id <> user_id)
);

create index if not exists friendships_user_id_idx on public.friendships (user_id, created_at);
create index if not exists friendships_friend_profile_id_idx
  on public.friendships (friend_profile_id) where friend_profile_id is not null;
create index if not exists friendships_invite_expiry_idx
  on public.friendships (invite_expires_at) where invite_token_hash is not null;

alter table public.expense_splits
  add column if not exists friendship_id uuid references public.friendships(id) on delete restrict,
  add column if not exists profile_id uuid references public.profiles(id) on delete restrict;

create index if not exists expense_splits_profile_access_idx
  on public.expense_splits (profile_id, installment_id) where profile_id is not null;
create index if not exists expense_splits_friendship_idx
  on public.expense_splits (friendship_id, installment_id) where friendship_id is not null;

-- Converte contatos locais já existentes em amizades pendentes, mantendo os IDs.
insert into public.friendships (id, user_id, friend_name, status)
select c.id, c.owner_profile_id, c.name, 'pending'
from public.contacts c
where c.owner_profile_id is not null and c.group_id is null
on conflict (id) do nothing;

update public.expense_splits s
set friendship_id = s.payer_contact_id
where s.friendship_id is null
  and s.payer_contact_id is not null
  and exists (select 1 from public.friendships f where f.id = s.payer_contact_id);

create table if not exists private.local_backup_imports (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  imported_at timestamptz not null default now(),
  row_counts jsonb not null default '{}'::jsonb
);
revoke all on table private.local_backup_imports from public, anon, authenticated;

drop trigger if exists friendships_touch_updated_at on public.friendships;
create trigger friendships_touch_updated_at before update on public.friendships
  for each row execute function private.touch_updated_at();

-- Se a conta convidada for removida, a relação volta a ficar pendente sem
-- deixar a linha inválida perante a constraint de status/perfil.
create or replace function private.reset_deleted_friend_profile()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.friend_profile_id is not null and new.friend_profile_id is null then
    new.status := 'pending';
    new.accepted_at := null;
    new.invite_token_hash := null;
    new.invite_expires_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists friendships_reset_deleted_friend_profile on public.friendships;
create trigger friendships_reset_deleted_friend_profile
  before update of friend_profile_id on public.friendships
  for each row execute function private.reset_deleted_friend_profile();

-- Convite é um token aleatório de uso único; o UUID da amizade não é credencial.
create or replace function public.create_friend_invite(p_friendship_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
begin
  if (select auth.uid()) is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;
  perform 1 from public.friendships f
    where f.id = p_friendship_id and f.user_id = (select auth.uid())
      and f.status = 'pending' and f.friend_profile_id is null
    for update;
  if not found then raise exception 'Amizade pendente não encontrada.' using errcode = 'P0002'; end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  update public.friendships
    set invite_token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex'),
        invite_expires_at = now() + interval '7 days'
    where id = p_friendship_id;
  return v_token;
end;
$$;

create or replace function public.accept_friend_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_friendship public.friendships;
begin
  if (select auth.uid()) is null then
    raise exception 'Faça login para aceitar o convite.' using errcode = '42501';
  end if;
  if p_token is null or length(p_token) <> 64 then
    raise exception 'Convite inválido ou expirado.' using errcode = '22023';
  end if;

  select f.* into v_friendship
  from public.friendships f
  where f.invite_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and f.status = 'pending' and f.friend_profile_id is null
    and f.invite_expires_at > now()
  for update;
  if not found then raise exception 'Convite inválido, expirado ou já utilizado.' using errcode = 'P0002'; end if;
  if v_friendship.user_id = (select auth.uid()) then
    raise exception 'Você não pode aceitar seu próprio convite.' using errcode = '42501';
  end if;

  update public.friendships
    set friend_profile_id = (select auth.uid()), status = 'accepted', accepted_at = now(),
        invite_token_hash = null, invite_expires_at = null
    where id = v_friendship.id;

  update public.expense_splits
    set profile_id = (select auth.uid())
    where friendship_id = v_friendship.id and profile_id is null;
  return v_friendship.id;
end;
$$;

-- Lê o backup do Zustand e importa todas as entidades numa transação. IDs locais
-- são preservados; conflito ou erro de integridade aborta tudo antes do marcador.
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

-- Só perfis autenticados podem consultar os campos públicos de qualquer perfil.
drop policy if exists profiles_read_visible on public.profiles;
create policy profiles_read_visible on public.profiles for select to authenticated using (true);

alter table public.friendships enable row level security;
revoke all on public.friendships from anon, authenticated;
grant select (id, user_id, friend_profile_id, friend_name, status, accepted_at, created_at, updated_at)
  on public.friendships to authenticated;
grant insert (id, user_id, friend_name, status) on public.friendships to authenticated;
grant update (friend_name) on public.friendships to authenticated;
grant delete on public.friendships to authenticated;

drop policy if exists friendships_read_participants on public.friendships;
create policy friendships_read_participants on public.friendships for select to authenticated
  using (user_id = (select auth.uid()) or friend_profile_id = (select auth.uid()));
drop policy if exists friendships_insert_owner on public.friendships;
create policy friendships_insert_owner on public.friendships for insert to authenticated
  with check (user_id = (select auth.uid()) and friend_profile_id is null and status = 'pending'
    and exists (select 1 from public.contacts c where c.id = friendships.id
      and c.owner_profile_id = (select auth.uid()) and c.group_id is null));
drop policy if exists friendships_rename_owner on public.friendships;
create policy friendships_rename_owner on public.friendships for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists friendships_delete_owner on public.friendships;
create policy friendships_delete_owner on public.friendships for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function private.can_read_expense(p_expense_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.expenses e
    where e.id = p_expense_id and (
      (e.group_id is null and e.created_by = (select auth.uid()))
      or (e.group_id is not null and private.is_group_member(e.group_id))
      or exists (
        select 1 from public.expense_installments i
        join public.expense_splits s on s.installment_id = i.id
        where i.expense_id = e.id and s.profile_id = (select auth.uid())
      )
    )
  );
$$;

-- Quem recebe acesso por amizade enxerga somente as próprias divisões.
drop policy if exists splits_read_scope on public.expense_splits;
create policy splits_read_scope on public.expense_splits for select to authenticated
  using (private.can_write_expense(private.expense_id_for_installment(installment_id))
    or profile_id = (select auth.uid()));
drop policy if exists splits_update_creator on public.expense_splits;
drop policy if exists splits_delete_creator on public.expense_splits;
-- Toda baixa passa pela RPC mark_expense_split_paid; cliente não altera os demais campos.
revoke update, delete on public.expense_splits from authenticated;

drop policy if exists dependents_read_assigned_split on public.dependents;
create policy dependents_read_assigned_split on public.dependents for select to authenticated
  using (exists (
    select 1 from public.expense_splits s
    where s.dependent_id = dependents.id and s.profile_id = (select auth.uid())
  ));

drop policy if exists credit_cards_read_shared_expense on public.credit_cards;
create policy credit_cards_read_shared_expense on public.credit_cards for select to authenticated
  using (exists (
    select 1 from public.expenses e
    where e.credit_card_id = credit_cards.id and private.can_read_expense(e.id)
  ));

create or replace function public.mark_expense_split_paid(p_split_id uuid)
returns public.expense_splits
language plpgsql security definer set search_path = '' as $$
declare
  v_split public.expense_splits;
  v_expense public.expenses;
begin
  if (select auth.uid()) is null then raise exception 'Autenticação necessária.' using errcode = '42501'; end if;
  select s.* into v_split from public.expense_splits s where s.id = p_split_id for update;
  if not found then raise exception 'Divisão não encontrada.' using errcode = 'P0002'; end if;
  select e.* into v_expense from public.expense_installments i
    join public.expenses e on e.id = i.expense_id where i.id = v_split.installment_id;
  if v_split.profile_id is distinct from (select auth.uid())
    and v_split.payer_profile_id is distinct from (select auth.uid())
    and not private.can_write_expense(v_expense.id) then
    raise exception 'Sem permissão para registrar este pagamento.' using errcode = '42501';
  end if;
  if not v_split.is_paid then
    update public.expense_splits set is_paid = true, paid_at = now()
      where id = p_split_id returning * into v_split;
  end if;
  return v_split;
end;
$$;

revoke all on function public.create_friend_invite(uuid) from public, anon;
revoke all on function public.accept_friend_invite(text) from public, anon;
revoke all on function public.import_local_backup(jsonb) from public, anon;
revoke all on function public.mark_expense_split_paid(uuid) from public, anon;
grant execute on function public.create_friend_invite(uuid) to authenticated;
grant execute on function public.accept_friend_invite(text) to authenticated;
grant execute on function public.import_local_backup(jsonb) to authenticated;
grant execute on function public.mark_expense_split_paid(uuid) to authenticated;

commit;
