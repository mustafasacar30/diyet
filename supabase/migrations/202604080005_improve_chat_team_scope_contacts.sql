-- Improve contact scope resolution for messaging.
-- Fixes cases where team members are not listed consistently
-- (especially mixed doctor/dietitian mappings).

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

  if v_role in ('doctor', 'dietitian') then
    return query
    with team_doctors as (
      -- Doctor of current dietitian
      select distinct tm.supervisor_id as id
      from public.team_members tm
      where tm.member_id = _user_id
        and coalesce(tm.status, 'active') = 'active'
        and tm.supervisor_id is not null

      union

      -- Self when user is doctor, or acts as team supervisor
      select _user_id
      where v_role = 'doctor'
         or exists (
           select 1
           from public.team_members tm2
           where tm2.supervisor_id = _user_id
             and coalesce(tm2.status, 'active') = 'active'
         )
    ),
    team_staff as (
      -- Doctors in same team scope
      select td.id
      from team_doctors td

      union

      -- Dietitians in those doctor teams
      select distinct tm.member_id as id
      from public.team_members tm
      where tm.supervisor_id in (select id from team_doctors)
        and coalesce(tm.status, 'active') = 'active'
        and tm.member_id is not null

      union

      select _user_id
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
    team_doctors as (
      -- Doctors supervising assigned dietitians
      select distinct tm.supervisor_id as id
      from public.team_members tm
      where tm.member_id in (select id from assigned_staff)
        and coalesce(tm.status, 'active') = 'active'
        and tm.supervisor_id is not null

      union

      -- If assigned directly to doctor id, include that doctor
      select asf.id
      from assigned_staff asf
      join public.profiles p on p.id = asf.id
      where p.role = 'doctor'
    ),
    team_dietitians as (
      -- Dietitians under those doctors
      select distinct tm.member_id as id
      from public.team_members tm
      where tm.supervisor_id in (select id from team_doctors)
        and coalesce(tm.status, 'active') = 'active'
        and tm.member_id is not null

      union

      -- Include directly assigned dietitian
      select asf.id
      from assigned_staff asf
      join public.profiles p on p.id = asf.id
      where p.role = 'dietitian'
    )
    select distinct x.id
    from (
      select id from team_doctors
      union
      select id from team_dietitians
    ) as x
    where x.id is not null and x.id <> _user_id;
    return;
  end if;
end;
$$;

grant execute on function public.get_chat_allowed_contacts(uuid) to authenticated, service_role;
