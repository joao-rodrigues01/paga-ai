-- Sincroniza incrementalmente amigos/dependentes locais sem repetir a carga de
-- despesas e sem alterar convites já aceitos ou pagamentos registrados.
begin;

create or replace function public.sync_local_friends(p_friends jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_me_count integer;
  v_expected_friends integer;
  v_expected_dependents integer;
  v_affected integer;
begin
  if v_user_id is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;
  if p_friends is null or jsonb_typeof(p_friends) <> 'array' or pg_column_size(p_friends) > 2097152 then
    raise exception 'Lista de amigos inválida ou maior que 2 MB.' using errcode = '22023';
  end if;

  select count(*) into v_me_count
  from jsonb_to_recordset(p_friends) as f(id uuid, "isMe" boolean)
  where coalesce(f."isMe", false);
  if v_me_count <> 1 then
    raise exception 'A lista deve conter exatamente um perfil “Eu”.' using errcode = '22023';
  end if;

  select count(*) into v_expected_friends
  from jsonb_to_recordset(p_friends) as f(id uuid, "isMe" boolean)
  where not coalesce(f."isMe", false);

  insert into public.contacts (id, owner_profile_id, group_id, name, avatar, pix_key)
  select f.id, v_user_id, null, f.name, coalesce(f.avatar, ''), nullif(f."pixKey", '')
  from jsonb_to_recordset(p_friends) as f(
    id uuid, name text, avatar text, "pixKey" text, "isMe" boolean
  )
  where not coalesce(f."isMe", false)
  on conflict (id) do update
    set name = excluded.name,
        avatar = excluded.avatar,
        pix_key = excluded.pix_key,
        updated_at = now()
    where contacts.owner_profile_id = v_user_id and contacts.group_id is null;
  get diagnostics v_affected = row_count;
  if v_affected <> v_expected_friends then
    raise exception 'Um contato existente não pertence a esta conta; nenhum amigo foi sincronizado.' using errcode = '42501';
  end if;

  insert into public.friendships (id, user_id, friend_name, status)
  select f.id, v_user_id, f.name, 'pending'
  from jsonb_to_recordset(p_friends) as f(id uuid, name text, "isMe" boolean)
  where not coalesce(f."isMe", false)
  on conflict (id) do update
    set friend_name = excluded.friend_name,
        updated_at = now()
    where friendships.user_id = v_user_id;
  get diagnostics v_affected = row_count;
  if v_affected <> v_expected_friends then
    raise exception 'Uma amizade existente não pertence a esta conta; nenhuma alteração foi salva.' using errcode = '42501';
  end if;

  select count(*) into v_expected_dependents
  from jsonb_array_elements(p_friends) as friend_row(friend_json)
  cross join lateral jsonb_array_elements(coalesce(friend_row.friend_json->'dependents', '[]'::jsonb)) as dependent_row(value);

  insert into public.dependents (id, profile_id, contact_id, name)
  select d.id,
    case when coalesce((friend_row.friend_json->>'isMe')::boolean, false) then v_user_id else null end,
    case when coalesce((friend_row.friend_json->>'isMe')::boolean, false) then null
      else (friend_row.friend_json->>'id')::uuid end,
    d.name
  from jsonb_array_elements(p_friends) as friend_row(friend_json)
  cross join lateral jsonb_to_recordset(coalesce(friend_row.friend_json->'dependents', '[]'::jsonb)) as d(id uuid, name text)
  on conflict (id) do update
    set name = excluded.name,
        updated_at = now()
    where dependents.profile_id is not distinct from excluded.profile_id
      and dependents.contact_id is not distinct from excluded.contact_id;
  get diagnostics v_affected = row_count;
  if v_affected <> v_expected_dependents then
    raise exception 'Um dependente existente não pertence ao responsável indicado; sincronização revertida.' using errcode = '42501';
  end if;

  return jsonb_build_object('friends', v_expected_friends, 'dependents', v_expected_dependents);
end;
$$;

revoke all on function public.sync_local_friends(jsonb) from public, anon;
grant execute on function public.sync_local_friends(jsonb) to authenticated;

commit;
