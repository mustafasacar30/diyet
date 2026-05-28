-- Warning cleanup phase 2 (search_path + RLS always-true narrowing)
-- Date: 2026-05-13
-- Strategy: idempotent, low-risk, no function-body changes

begin;

-- -------------------------------------------------------------------
-- 1) Function Search Path Mutable
-- -------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'set_team_food_overrides_updated_at',
        'set_team_program_overrides_updated_at',
        'set_team_diet_type_overrides_updated_at',
        'set_team_food_micro_overrides_updated_at',
        'set_program_diet_type_overrides_updated_at',
        'can_current_user_access_patient'
      )
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = public, pg_temp',
      fn.schema_name,
      fn.function_name,
      fn.args
    );
  end loop;
end $$;

-- -------------------------------------------------------------------
-- Helpers for policy predicates
-- -------------------------------------------------------------------
create or replace function public.is_staff_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'staff', 'dietitian', 'doctor')
  );
$$;

create or replace function public.can_access_patient_fallback(target_patient_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  role_name text;
begin
  if auth.uid() is null then
    return false;
  end if;

  select p.role into role_name
  from public.profiles p
  where p.id = auth.uid()
  limit 1;

  if role_name = 'admin' then
    return true;
  end if;

  if role_name = 'patient' then
    return exists (
      select 1
      from public.patients pt
      where pt.id = target_patient_id
        and (pt.id = auth.uid() or pt.user_id = auth.uid())
    );
  end if;

  if role_name in ('staff', 'dietitian', 'doctor') then
    return exists (
      select 1
      from public.patient_assignments pa
      where pa.patient_id = target_patient_id
        and pa.dietitian_id = auth.uid()
    );
  end if;

  return false;
end;
$$;

create or replace function public.effective_can_access_patient(target_patient_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  has_primary boolean;
  allowed boolean;
begin
  select exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'can_current_user_access_patient'
      and p.pronargs = 1
      and p.proargtypes[0] = 'uuid'::regtype
  ) into has_primary;

  if has_primary then
    execute 'select public.can_current_user_access_patient($1)' into allowed using target_patient_id;
    return coalesce(allowed, false);
  end if;

  return public.can_access_patient_fallback(target_patient_id);
end;
$$;

-- -------------------------------------------------------------------
-- 2) Reference tables: remove always-true policies, add narrow policies
-- -------------------------------------------------------------------
do $$
declare
  t text;
  pol record;
  ref_tables text[] := array[
    'app_settings',
    'diet_types',
    'disease_rules',
    'diseases',
    'food_micronutrients',
    'foods',
    'meal_templates',
    'micronutrients'
  ];
begin
  foreach t in array ref_tables loop
    execute format('alter table if exists public.%I enable row level security', t);

    for pol in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = t
        and (
          coalesce(qual, '') ~* '^\(?true\)?$'
          or coalesce(with_check, '') ~* '^\(?true\)?$'
        )
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;

    execute format('drop policy if exists %I on public.%I', t || '_anon_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_admin_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_admin_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_admin_delete', t);

    execute format(
      'create policy %I on public.%I for select to anon using (auth.role() = ''anon'')',
      t || '_anon_select',
      t
    );
    execute format(
      'create policy %I on public.%I for select to authenticated using (auth.role() = ''authenticated'')',
      t || '_authenticated_select',
      t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_staff_or_admin())',
      t || '_staff_admin_insert',
      t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_staff_or_admin()) with check (public.is_staff_or_admin())',
      t || '_staff_admin_update',
      t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_staff_or_admin())',
      t || '_staff_admin_delete',
      t
    );
  end loop;
end $$;

-- -------------------------------------------------------------------
-- 3) Patient tables: no anon, scoped authenticated access only
-- -------------------------------------------------------------------
do $$
declare
  t text;
  pol record;
  patient_tables text[] := array[
    'patient_ai_reports',
    'patient_diseases',
    'patient_imaging',
    'patient_lab_results',
    'patient_observations'
  ];
begin
  foreach t in array patient_tables loop
    execute format('alter table if exists public.%I enable row level security', t);

    for pol in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = t
        and (
          coalesce(qual, '') ~* '^\(?true\)?$'
          or coalesce(with_check, '') ~* '^\(?true\)?$'
        )
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;

    execute format('drop policy if exists %I on public.%I', t || '_authenticated_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_delete', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.effective_can_access_patient(patient_id))',
      t || '_authenticated_select',
      t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.effective_can_access_patient(patient_id))',
      t || '_authenticated_insert',
      t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.effective_can_access_patient(patient_id)) with check (public.effective_can_access_patient(patient_id))',
      t || '_authenticated_update',
      t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.effective_can_access_patient(patient_id))',
      t || '_authenticated_delete',
      t
    );
  end loop;
end $$;

commit;
