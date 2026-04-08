-- Harden messaging scope rules according to team hierarchy:
-- - Admin: can chat with everyone
-- - Doctor/Dietitian: can chat with admins + their own team staff + team patients
-- - Patient: can chat only with assigned dietitian(s) and supervising doctor(s)
-- - Patients cannot chat with other patients

-- 1) Helpers
create or replace function public.get_chat_allowed_contacts(_user_id uuid)
returns table(user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = _user_id;

  if v_role is null then
    return;
  end if;

  if v_role = 'admin' then
    return query
    select p.id
    from public.profiles p
    where p.id <> _user_id;
    return;
  end if;

  if v_role = 'doctor' then
    return query
    with team_staff as (
      -- doctor + active dietitians under doctor
      select _user_id as id
      union
      select tm.member_id as id
      from public.team_members tm
      where tm.supervisor_id = _user_id
        and coalesce(tm.status, 'active') = 'active'
        and tm.member_id is not null
    ),
    team_patients as (
      select distinct pa.patient_id as id
      from public.patient_assignments pa
      where pa.dietitian_id in (select id from team_staff)
    )
    select distinct x.id
    from (
      select p.id
      from public.profiles p
      where p.role = 'admin'
      union
      select ts.id from team_staff ts
      union
      select tp.id from team_patients tp
    ) as x
    where x.id is not null and x.id <> _user_id;
    return;
  end if;

  if v_role = 'dietitian' then
    return query
    with my_team as (
      select tm.supervisor_id
      from public.team_members tm
      where tm.member_id = _user_id
        and coalesce(tm.status, 'active') = 'active'
      limit 1
    ),
    team_staff as (
      -- supervisor doctor
      select mt.supervisor_id as id
      from my_team mt
      where mt.supervisor_id is not null
      union
      -- all active dietitians in same team (including self)
      select tm.member_id as id
      from public.team_members tm
      join my_team mt on mt.supervisor_id = tm.supervisor_id
      where coalesce(tm.status, 'active') = 'active'
        and tm.member_id is not null
      union
      select _user_id as id
    ),
    team_patients as (
      select distinct pa.patient_id as id
      from public.patient_assignments pa
      where pa.dietitian_id in (select id from team_staff)
    )
    select distinct x.id
    from (
      select p.id
      from public.profiles p
      where p.role = 'admin'
      union
      select ts.id from team_staff ts
      union
      select tp.id from team_patients tp
    ) as x
    where x.id is not null and x.id <> _user_id;
    return;
  end if;

  if v_role = 'patient' then
    return query
    with assigned_staff as (
      select distinct pa.dietitian_id as id
      from public.patient_assignments pa
      where pa.patient_id = _user_id
        and pa.dietitian_id is not null
    ),
    doctors as (
      select distinct tm.supervisor_id as id
      from public.team_members tm
      where tm.member_id in (select id from assigned_staff)
        and tm.supervisor_id is not null
      union
      select asf.id
      from assigned_staff asf
      join public.profiles p on p.id = asf.id
      where p.role = 'doctor'
    )
    select distinct x.id
    from (
      select id from assigned_staff
      union
      select id from doctors
    ) as x
    where x.id is not null and x.id <> _user_id;
    return;
  end if;
end;
$$;

grant execute on function public.get_chat_allowed_contacts(uuid) to authenticated, service_role;

create or replace function public.can_users_chat(user_a uuid, user_b uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.get_chat_allowed_contacts(user_a) c
    where c.user_id = user_b
  )
  and exists (
    select 1
    from public.get_chat_allowed_contacts(user_b) c
    where c.user_id = user_a
  );
$$;

grant execute on function public.can_users_chat(uuid, uuid) to authenticated, service_role;

-- 2) Harden direct conversation creation
alter table public.conversations
add column if not exists owner_id uuid references auth.users(id);

create or replace function public.get_or_create_conversation(user_a uuid, user_b uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
  caller uuid;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'Unauthorized';
  end if;

  if user_a is null or user_b is null or user_a = user_b then
    raise exception 'Invalid users';
  end if;

  if caller <> user_a and caller <> user_b then
    raise exception 'Access denied';
  end if;

  if not public.can_users_chat(user_a, user_b) then
    raise exception 'Chat not allowed by scope rules';
  end if;

  select p1.conversation_id into conv_id
  from public.participants p1
  join public.participants p2 on p1.conversation_id = p2.conversation_id
  join public.conversations c on c.id = p1.conversation_id
  where p1.user_id = user_a
    and p2.user_id = user_b
    and c.type = 'direct'
  limit 1;

  if conv_id is not null then
    return conv_id;
  end if;

  insert into public.conversations (type)
  values ('direct')
  returning id into conv_id;

  insert into public.participants (conversation_id, user_id)
  values (conv_id, user_a), (conv_id, user_b);

  return conv_id;
end;
$$;

grant execute on function public.get_or_create_conversation(uuid, uuid) to authenticated, service_role;

-- 3) Harden group RPCs with same scope checks
create or replace function public.create_group_conversation(
  creator_id uuid,
  member_ids uuid[],
  group_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
  mid uuid;
  creator_role text;
begin
  if auth.uid() is distinct from creator_id then
    raise exception 'Access denied';
  end if;

  select role into creator_role from public.profiles where id = creator_id;
  if creator_role not in ('admin', 'doctor', 'dietitian') then
    raise exception 'Only admin/doctor/dietitian can create group chats';
  end if;

  foreach mid in array member_ids
  loop
    if mid is not null and mid <> creator_id and not public.can_users_chat(creator_id, mid) then
      raise exception 'Member % is outside allowed chat scope', mid;
    end if;
  end loop;

  insert into public.conversations (type, title, owner_id)
  values ('group', group_title, creator_id)
  returning id into conv_id;

  insert into public.participants (conversation_id, user_id)
  values (conv_id, creator_id);

  foreach mid in array member_ids
  loop
    if mid is not null and mid <> creator_id then
      insert into public.participants (conversation_id, user_id)
      values (conv_id, mid)
      on conflict do nothing;
    end if;
  end loop;

  return conv_id;
end;
$$;

grant execute on function public.create_group_conversation(uuid, uuid[], text) to authenticated, service_role;

create or replace function public.add_group_members(
  target_conversation_id uuid,
  new_member_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid;
  caller_is_member boolean;
  caller_is_admin boolean;
  mid uuid;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'Unauthorized';
  end if;

  select exists (
    select 1 from public.participants p
    where p.conversation_id = target_conversation_id and p.user_id = caller
  ) into caller_is_member;

  select exists (
    select 1 from public.profiles p where p.id = caller and p.role = 'admin'
  ) into caller_is_admin;

  if not caller_is_member and not caller_is_admin then
    raise exception 'Access denied';
  end if;

  foreach mid in array new_member_ids
  loop
    if mid is null then
      continue;
    end if;
    if not public.can_users_chat(caller, mid) then
      raise exception 'Member % is outside allowed chat scope', mid;
    end if;
    insert into public.participants (conversation_id, user_id)
    values (target_conversation_id, mid)
    on conflict do nothing;
  end loop;
end;
$$;

grant execute on function public.add_group_members(uuid, uuid[]) to authenticated, service_role;

create or replace function public.remove_group_member(
  target_conversation_id uuid,
  target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid;
  is_owner boolean;
  is_admin boolean;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'Unauthorized';
  end if;

  select (c.owner_id = caller) into is_owner
  from public.conversations c
  where c.id = target_conversation_id;

  select exists (
    select 1 from public.profiles p where p.id = caller and p.role = 'admin'
  ) into is_admin;

  if caller <> target_user_id and not is_owner and not is_admin then
    raise exception 'Access denied';
  end if;

  delete from public.participants
  where conversation_id = target_conversation_id
    and user_id = target_user_id;
end;
$$;

grant execute on function public.remove_group_member(uuid, uuid) to authenticated, service_role;

create or replace function public.delete_group_conversation(
  target_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid;
  is_owner boolean;
  is_admin boolean;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'Unauthorized';
  end if;

  select (c.owner_id = caller) into is_owner
  from public.conversations c
  where c.id = target_conversation_id;

  select exists (
    select 1 from public.profiles p where p.id = caller and p.role = 'admin'
  ) into is_admin;

  if not is_owner and not is_admin then
    raise exception 'Access denied';
  end if;

  delete from public.conversations where id = target_conversation_id;
end;
$$;

grant execute on function public.delete_group_conversation(uuid) to authenticated, service_role;

-- 4) Tighten RLS from previous "Open Gates"
alter table public.conversations enable row level security;
alter table public.participants enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Auth: Full Access Conversations" on public.conversations;
drop policy if exists "Auth: Full Access Participants" on public.participants;
drop policy if exists "Auth: Full Access Messages" on public.messages;

drop policy if exists "Users can view conversations they are participating in" on public.conversations;
create policy "Users can view conversations they are participating in"
on public.conversations for select
to authenticated
using (
  exists (
    select 1 from public.participants p
    where p.conversation_id = public.conversations.id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "Participants can update conversation preview metadata" on public.conversations;
create policy "Participants can update conversation preview metadata"
on public.conversations for update
to authenticated
using (
  exists (
    select 1 from public.participants p
    where p.conversation_id = public.conversations.id
      and p.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.participants p
    where p.conversation_id = public.conversations.id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "Users can view participants of their conversations" on public.participants;
create policy "Users can view participants of their conversations"
on public.participants for select
to authenticated
using (
  exists (
    select 1 from public.participants p
    where p.conversation_id = public.participants.conversation_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "Users can update own participant read marker" on public.participants;
create policy "Users can update own participant read marker"
on public.participants for update
to authenticated
using (public.participants.user_id = auth.uid())
with check (public.participants.user_id = auth.uid());

drop policy if exists "Users can leave conversations" on public.participants;
create policy "Users can leave conversations"
on public.participants for delete
to authenticated
using (public.participants.user_id = auth.uid());

drop policy if exists "Users can view messages in their conversations" on public.messages;
create policy "Users can view messages in their conversations"
on public.messages for select
to authenticated
using (
  exists (
    select 1 from public.participants p
    where p.conversation_id = public.messages.conversation_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert messages in their conversations" on public.messages;
create policy "Users can insert messages in their conversations"
on public.messages for insert
to authenticated
with check (
  public.messages.sender_id = auth.uid()
  and exists (
    select 1 from public.participants p
    where p.conversation_id = public.messages.conversation_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "Users can edit their own messages" on public.messages;
create policy "Users can edit their own messages"
on public.messages for update
to authenticated
using (public.messages.sender_id = auth.uid())
with check (public.messages.sender_id = auth.uid());
