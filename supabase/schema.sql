-- PagaAí — schema inicial para Supabase/PostgreSQL.
-- Execute em projeto novo. Não contém chaves, URLs ou credenciais.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  avatar_url text,
  pix_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Contatos preservam amigos locais que ainda não possuem uma conta autenticada.
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  avatar text not null default '',
  pix_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_profile_id is not null) <> (group_id is not null))
);

create table public.dependents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete restrict,
  contact_id uuid references public.contacts(id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((profile_id is not null) <> (contact_id is not null)),
  unique (id, profile_id),
  unique (id, contact_id)
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, profile_id)
);

create table public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  closing_day smallint not null check (closing_day between 1 and 31),
  due_day smallint not null check (due_day between 1 and 31),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_profile_id is not null) <> (group_id is not null))
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  total_amount numeric(12, 2) not null check (total_amount > 0),
  date date not null,
  group_id uuid references public.groups(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  credit_card_id uuid references public.credit_cards(id) on delete restrict,
  payment_method text not null check (payment_method in ('pix', 'credit_card')),
  installments_count smallint not null check (installments_count between 1 and 48),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((payment_method = 'pix' and credit_card_id is null) or
         (payment_method = 'credit_card' and credit_card_id is not null))
);

create table public.expense_installments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  installment_number smallint not null check (installment_number between 1 and 48),
  amount numeric(12, 2) not null check (amount > 0),
  due_date date not null,
  unique (expense_id, installment_number),
  unique (id, expense_id)
);

create table public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  installment_id uuid not null references public.expense_installments(id) on delete cascade,
  payer_profile_id uuid references public.profiles(id) on delete restrict,
  payer_contact_id uuid references public.contacts(id) on delete restrict,
  dependent_id uuid,
  amount_owed numeric(12, 2) not null check (amount_owed >= 0),
  is_paid boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((payer_profile_id is not null) <> (payer_contact_id is not null)),
  foreign key (dependent_id, payer_profile_id)
    references public.dependents(id, profile_id) on delete restrict,
  foreign key (dependent_id, payer_contact_id)
    references public.dependents(id, contact_id) on delete restrict,
  check ((is_paid and paid_at is not null) or (not is_paid and paid_at is null))
);

-- NULL em dependent_id representa a própria pessoa; coalesce evita duplicatas
-- que a unicidade padrão do PostgreSQL permitiria para valores NULL.
create unique index expense_splits_participant_unique
  on public.expense_splits (installment_id,
    coalesce(payer_profile_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(payer_contact_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(dependent_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index dependents_profile_id_idx on public.dependents (profile_id);
create index dependents_contact_id_idx on public.dependents (contact_id) where contact_id is not null;
create index contacts_owner_profile_id_idx on public.contacts (owner_profile_id) where owner_profile_id is not null;
create index contacts_group_id_idx on public.contacts (group_id) where group_id is not null;
create index group_members_profile_id_idx on public.group_members (profile_id, group_id);
create index credit_cards_group_id_idx on public.credit_cards (group_id) where group_id is not null;
create index credit_cards_owner_id_idx on public.credit_cards (owner_profile_id) where owner_profile_id is not null;
create index expenses_group_due_lookup_idx on public.expenses (group_id, date);
create index expenses_created_by_idx on public.expenses (created_by);
create index expenses_credit_card_id_idx on public.expenses (credit_card_id) where credit_card_id is not null;
create index expense_installments_due_date_idx on public.expense_installments (due_date, expense_id);
create index expense_splits_payer_status_idx on public.expense_splits (payer_profile_id, is_paid, installment_id);
create index expense_splits_contact_status_idx on public.expense_splits (payer_contact_id, is_paid, installment_id) where payer_contact_id is not null;
create index expense_splits_dependent_idx on public.expense_splits (dependent_id) where dependent_id is not null;

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger dependents_touch_updated_at before update on public.dependents
  for each row execute function private.touch_updated_at();
create trigger contacts_touch_updated_at before update on public.contacts
  for each row execute function private.touch_updated_at();
create trigger groups_touch_updated_at before update on public.groups
  for each row execute function private.touch_updated_at();
create trigger credit_cards_touch_updated_at before update on public.credit_cards
  for each row execute function private.touch_updated_at();
create trigger expenses_touch_updated_at before update on public.expenses
  for each row execute function private.touch_updated_at();
create trigger expense_splits_touch_updated_at before update on public.expense_splits
  for each row execute function private.touch_updated_at();

-- O perfil é criado junto com auth.users; conflitos preservam os dados já editados.
create or replace function private.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.create_profile_for_auth_user();

-- O criador do grupo sempre recebe o papel owner.
create or replace function private.add_group_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.group_members (group_id, profile_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create trigger groups_add_owner after insert on public.groups
  for each row execute function private.add_group_owner();

create or replace function private.keep_group_creator()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.created_by <> old.created_by then
    raise exception 'O criador do grupo não pode ser alterado.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger groups_creator_immutable before update on public.groups
  for each row execute function private.keep_group_creator();

-- Funções SECURITY DEFINER isolam a consulta de membership e evitam RLS recursiva.
create or replace function private.is_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.profile_id = (select auth.uid())
  );
$$;

create or replace function private.has_group_role(p_group_id uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id
      and gm.profile_id = (select auth.uid())
      and gm.role = any (p_roles)
  );
$$;

create or replace function private.can_read_expense(p_expense_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.expenses e
    where e.id = p_expense_id
      and ((e.group_id is null and e.created_by = (select auth.uid())
            and e.created_by is not null)
        or (e.group_id is not null and private.is_group_member(e.group_id)))
  );
$$;

create or replace function private.can_write_expense(p_expense_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.expenses e
    where e.id = p_expense_id
      and ((e.group_id is null and e.created_by = (select auth.uid()))
        or (e.group_id is not null and private.is_group_member(e.group_id)
            and (e.created_by = (select auth.uid()) or private.has_group_role(e.group_id, array['owner', 'admin']::text[]))))
  );
$$;

create or replace function private.expense_id_for_installment(p_installment_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select ei.expense_id from public.expense_installments ei where ei.id = p_installment_id;
$$;

create or replace function private.can_view_profile(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile_id = (select auth.uid()) or exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.profile_id = (select auth.uid()) and theirs.profile_id = p_profile_id
  );
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.is_group_member(uuid) to authenticated;
grant execute on function private.has_group_role(uuid, text[]) to authenticated;
grant execute on function private.can_read_expense(uuid) to authenticated;
grant execute on function private.can_write_expense(uuid) to authenticated;
grant execute on function private.expense_id_for_installment(uuid) to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;

-- Somente o responsável pelo split ou administrador do grupo pode registrar a baixa.
-- Os clientes não recebem UPDATE direto em expense_splits; isso impede alterar valor/IDs.
create or replace function public.mark_expense_split_paid(p_split_id uuid)
returns public.expense_splits
language plpgsql security definer set search_path = '' as $$
declare
  v_split public.expense_splits;
  v_expense public.expenses;
begin
  if (select auth.uid()) is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;

  select s.* into v_split
  from public.expense_splits s
  where s.id = p_split_id
  for update;
  if not found then raise exception 'Divisão não encontrada.' using errcode = 'P0002'; end if;

  select e.* into v_expense
  from public.expense_installments i
  join public.expenses e on e.id = i.expense_id
  where i.id = v_split.installment_id;

  if v_split.payer_profile_id is distinct from (select auth.uid())
     and not ((v_expense.group_id is not null and private.has_group_role(v_expense.group_id, array['owner', 'admin']::text[]))
       or (v_expense.group_id is null and v_expense.created_by = (select auth.uid()))) then
    raise exception 'Sem permissão para registrar este pagamento.' using errcode = '42501';
  end if;

  if not v_split.is_paid then
    update public.expense_splits
      set is_paid = true, paid_at = now()
      where id = p_split_id
      returning * into v_split;
  end if;
  return v_split;
end;
$$;
revoke all on function public.mark_expense_split_paid(uuid) from public, anon;
grant execute on function public.mark_expense_split_paid(uuid) to authenticated;

-- pix_key é dado pessoal e não fica disponível para leitura dos demais membros.
create or replace function public.get_own_pix_key()
returns text language sql stable security definer set search_path = '' as $$
  select p.pix_key from public.profiles p where p.id = (select auth.uid());
$$;
revoke all on function public.get_own_pix_key() from public, anon;
grant execute on function public.get_own_pix_key() to authenticated;

-- Valida totais da compra, contagem das parcelas e soma das cotas por fatura
-- no commit. Criação/edição dos registros relacionados deve ocorrer em uma
-- única transação (futura RPC), nunca em chamadas independentes do navegador.
create or replace function private.validate_expense_totals(p_expense_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_expense public.expenses;
  v_installment_count integer;
begin
  select e.* into v_expense from public.expenses e where e.id = p_expense_id;
  if not found then return; end if;

  if v_expense.payment_method = 'credit_card' and not exists (
    select 1 from public.credit_cards c
    where c.id = v_expense.credit_card_id
      and c.group_id is not distinct from v_expense.group_id
      and (v_expense.group_id is not null or c.owner_profile_id = v_expense.created_by)
  ) then
    raise exception 'O cartão precisa pertencer ao mesmo perfil ou grupo da despesa.' using errcode = '23514';
  end if;

  select count(*) into v_installment_count
    from public.expense_installments i where i.expense_id = p_expense_id;
  if v_installment_count <> v_expense.installments_count then
    raise exception 'A quantidade de parcelas deve corresponder ao cadastro da despesa.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.expense_installments i where i.expense_id = p_expense_id
    having min(i.installment_number) <> 1 or max(i.installment_number) <> v_expense.installments_count
  ) then
    raise exception 'A numeração das parcelas deve ser sequencial e completa.' using errcode = '23514';
  end if;
  if coalesce((select sum(i.amount) from public.expense_installments i where i.expense_id = p_expense_id), 0) <> v_expense.total_amount then
    raise exception 'A soma das parcelas deve corresponder ao total da despesa.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.expense_installments i
    left join public.expense_splits s on s.installment_id = i.id
    where i.expense_id = p_expense_id
    group by i.id, i.amount
    having count(s.id) = 0 or coalesce(sum(s.amount_owed), 0) <> i.amount
  ) then
    raise exception 'A soma das divisões deve corresponder ao valor de cada parcela.' using errcode = '23514';
  end if;
  if v_expense.group_id is not null and exists (
    select 1 from public.expense_installments i
    join public.expense_splits s on s.installment_id = i.id
    left join public.group_members gm on gm.group_id = v_expense.group_id and gm.profile_id = s.payer_profile_id
    left join public.contacts c on c.id = s.payer_contact_id and c.group_id = v_expense.group_id
    where i.expense_id = p_expense_id and gm.profile_id is null and c.id is null
  ) then
    raise exception 'Responsáveis de conta devem pertencer ao grupo; contatos devem pertencer ao mesmo grupo.' using errcode = '23514';
  end if;
  if v_expense.group_id is null and exists (
    select 1 from public.expense_installments i
    join public.expense_splits s on s.installment_id = i.id
    left join public.contacts c on c.id = s.payer_contact_id and c.owner_profile_id = v_expense.created_by
    where i.expense_id = p_expense_id and s.payer_contact_id is not null and c.id is null
  ) then
    raise exception 'Contato deve pertencer ao perfil que administra a despesa.' using errcode = '23514';
  end if;
  if v_expense.group_id is null and exists (
    select 1 from public.expense_installments i
    join public.expense_splits s on s.installment_id = i.id
    where i.expense_id = p_expense_id
      and s.payer_profile_id is not null
      and s.payer_profile_id <> v_expense.created_by
  ) then
    raise exception 'Despesas pessoais só podem atribuir cotas ao próprio perfil ou a contatos locais.' using errcode = '23514';
  end if;
end;
$$;

create or replace function private.check_expense_totals_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_expense_id uuid;
begin
  if tg_table_name = 'expenses' then
    v_expense_id := case when tg_op = 'DELETE' then old.id else new.id end;
  elsif tg_table_name = 'expense_installments' then
    v_expense_id := case when tg_op = 'DELETE' then old.expense_id else new.expense_id end;
  else
    v_expense_id := private.expense_id_for_installment(case when tg_op = 'DELETE' then old.installment_id else new.installment_id end);
  end if;
  if v_expense_id is not null then perform private.validate_expense_totals(v_expense_id); end if;
  return null;
end;
$$;

create constraint trigger expenses_totals_valid
  after insert or update on public.expenses deferrable initially deferred
  for each row execute function private.check_expense_totals_trigger();
create constraint trigger installments_totals_valid
  after insert or update or delete on public.expense_installments deferrable initially deferred
  for each row execute function private.check_expense_totals_trigger();
create constraint trigger splits_totals_valid
  after insert or update or delete on public.expense_splits deferrable initially deferred
  for each row execute function private.check_expense_totals_trigger();

-- Mantém a proteção do MVP: uma despesa com baixa externa não pode ser editada/removida.
create or replace function private.prevent_paid_expense_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.created_by <> old.created_by or new.group_id is distinct from old.group_id) then
    raise exception 'O responsável e o escopo da despesa não podem ser alterados.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.expense_installments i
    join public.expense_splits s on s.installment_id = i.id
    where i.expense_id = old.id and s.is_paid and s.payer_profile_id is distinct from old.created_by
  ) then
    raise exception 'Despesa com pagamentos registrados não pode ser alterada ou excluída.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger expenses_protect_paid before update or delete on public.expenses
  for each row execute function private.prevent_paid_expense_mutation();

alter table public.profiles enable row level security;
alter table public.dependents enable row level security;
alter table public.contacts enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.credit_cards enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_installments enable row level security;
alter table public.expense_splits enable row level security;

revoke all on public.profiles, public.dependents, public.groups, public.group_members,
  public.contacts, public.credit_cards, public.expenses, public.expense_installments, public.expense_splits
  from anon;
grant select (id, name, avatar_url, created_at, updated_at) on public.profiles to authenticated;
grant update (name, avatar_url, pix_key) on public.profiles to authenticated;
grant select, insert, update, delete on public.dependents, public.groups, public.group_members, public.contacts,
  public.credit_cards, public.expenses, public.expense_installments, public.expense_splits
  to authenticated;
revoke update, delete on public.expense_splits from authenticated;

create policy profiles_read_visible on public.profiles for select to authenticated
  using (private.can_view_profile(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy dependents_read_owner_or_group on public.dependents for select to authenticated
  using ((profile_id = (select auth.uid()) or (profile_id is not null and private.can_view_profile(profile_id)))
    or exists (select 1 from public.contacts c where c.id = contact_id and
      (c.owner_profile_id = (select auth.uid()) or (c.group_id is not null and private.is_group_member(c.group_id)))));
create policy dependents_insert_owner on public.dependents for insert to authenticated
  with check ((profile_id = (select auth.uid()) and contact_id is null) or exists (
    select 1 from public.contacts c where c.id = contact_id and
      ((c.owner_profile_id = (select auth.uid()) and profile_id is null) or
       (c.group_id is not null and profile_id is null and private.has_group_role(c.group_id, array['owner', 'admin']::text[])))
  ));
create policy dependents_update_owner on public.dependents for update to authenticated
  using (profile_id = (select auth.uid()) or exists (select 1 from public.contacts c where c.id = contact_id and
    (c.owner_profile_id = (select auth.uid()) or (c.group_id is not null and private.has_group_role(c.group_id, array['owner', 'admin']::text[])))))
  with check ((profile_id = (select auth.uid()) and contact_id is null) or exists (select 1 from public.contacts c where c.id = contact_id and
    ((c.owner_profile_id = (select auth.uid()) and profile_id is null) or
      (c.group_id is not null and profile_id is null and private.has_group_role(c.group_id, array['owner', 'admin']::text[])))));
create policy dependents_delete_owner on public.dependents for delete to authenticated
  using (profile_id = (select auth.uid()) or exists (select 1 from public.contacts c where c.id = contact_id and
    (c.owner_profile_id = (select auth.uid()) or (c.group_id is not null and private.has_group_role(c.group_id, array['owner', 'admin']::text[])))));

create policy contacts_read_scope on public.contacts for select to authenticated
  using (owner_profile_id = (select auth.uid()) or (group_id is not null and private.is_group_member(group_id)));
create policy contacts_insert_scope on public.contacts for insert to authenticated
  with check ((owner_profile_id = (select auth.uid()) and group_id is null) or
    (owner_profile_id is null and group_id is not null and private.has_group_role(group_id, array['owner', 'admin']::text[])));
create policy contacts_update_scope on public.contacts for update to authenticated
  using (owner_profile_id = (select auth.uid()) or (group_id is not null and private.has_group_role(group_id, array['owner', 'admin']::text[])))
  with check ((owner_profile_id = (select auth.uid()) and group_id is null) or
    (owner_profile_id is null and group_id is not null and private.has_group_role(group_id, array['owner', 'admin']::text[])));
create policy contacts_delete_scope on public.contacts for delete to authenticated
  using (owner_profile_id = (select auth.uid()) or (group_id is not null and private.has_group_role(group_id, array['owner', 'admin']::text[])));

create policy groups_read_members on public.groups for select to authenticated
  using (private.is_group_member(id));
create policy groups_create_self on public.groups for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy groups_update_managers on public.groups for update to authenticated
  using (private.has_group_role(id, array['owner', 'admin']::text[]))
  with check (private.has_group_role(id, array['owner', 'admin']::text[]));
create policy groups_delete_owner on public.groups for delete to authenticated
  using (private.has_group_role(id, array['owner']::text[]));

create policy group_members_read_members on public.group_members for select to authenticated
  using (private.is_group_member(group_id));
create policy group_members_add_members on public.group_members for insert to authenticated
  with check (role = 'member' and private.has_group_role(group_id, array['owner', 'admin']::text[]));
create policy group_members_promote_members on public.group_members for update to authenticated
  using (role <> 'owner' and private.has_group_role(group_id, array['owner']::text[]))
  with check (role in ('member', 'admin') and private.has_group_role(group_id, array['owner']::text[]));
create policy group_members_remove_non_owner on public.group_members for delete to authenticated
  using (role <> 'owner' and private.has_group_role(group_id, array['owner', 'admin']::text[]));

create policy credit_cards_read_scope on public.credit_cards for select to authenticated
  using ((owner_profile_id = (select auth.uid())) or (group_id is not null and private.is_group_member(group_id)));
create policy credit_cards_insert_scope on public.credit_cards for insert to authenticated
  with check ((owner_profile_id = (select auth.uid()) and group_id is null)
    or (owner_profile_id is null and group_id is not null and private.has_group_role(group_id, array['owner', 'admin']::text[])));
create policy credit_cards_update_scope on public.credit_cards for update to authenticated
  using ((owner_profile_id = (select auth.uid())) or (group_id is not null and private.has_group_role(group_id, array['owner', 'admin']::text[])))
  with check ((owner_profile_id = (select auth.uid()) and group_id is null)
    or (owner_profile_id is null and group_id is not null and private.has_group_role(group_id, array['owner', 'admin']::text[])));
create policy credit_cards_delete_scope on public.credit_cards for delete to authenticated
  using ((owner_profile_id = (select auth.uid())) or (group_id is not null and private.has_group_role(group_id, array['owner', 'admin']::text[])));

create policy expenses_read_scope on public.expenses for select to authenticated
  using (private.can_read_expense(id));
create policy expenses_insert_scope on public.expenses for insert to authenticated
  with check (created_by = (select auth.uid()) and
    ((group_id is null) or private.is_group_member(group_id)));
create policy expenses_update_scope on public.expenses for update to authenticated
  using (private.can_write_expense(id))
  with check ((group_id is null and created_by = (select auth.uid())) or
    (group_id is not null and private.is_group_member(group_id) and
      (created_by = (select auth.uid()) or private.has_group_role(group_id, array['owner', 'admin']::text[]))));
create policy expenses_delete_scope on public.expenses for delete to authenticated
  using (private.can_write_expense(id));

create policy installments_read_scope on public.expense_installments for select to authenticated
  using (private.can_read_expense(expense_id));
create policy installments_insert_scope on public.expense_installments for insert to authenticated
  with check (private.can_write_expense(expense_id));
create policy installments_update_scope on public.expense_installments for update to authenticated
  using (private.can_write_expense(expense_id)) with check (private.can_write_expense(expense_id));
create policy installments_delete_scope on public.expense_installments for delete to authenticated
  using (private.can_write_expense(expense_id));

create policy splits_read_scope on public.expense_splits for select to authenticated
  using (private.can_read_expense(private.expense_id_for_installment(installment_id)));
create policy splits_insert_scope on public.expense_splits for insert to authenticated
  with check (private.can_write_expense(private.expense_id_for_installment(installment_id)));
-- Baixas são feitas exclusivamente por public.mark_expense_split_paid(uuid).
