-- Security hardening phase plan (DRAFT)
-- Date: 2026-05-13
-- IMPORTANT:
-- 1) Run inventory queries first (see security_hardening_report_2026-05-13.md)
-- 2) Apply first on staging, not directly on production.
-- 3) This file is intentionally conservative and idempotent where possible.

begin;

-- =========================================================
-- PHASE 2 - Immediate risk reduction
-- =========================================================

-- 2.1 Lock down exposed user_management_view
-- RISK: admin users/doctors/dietitians pages currently read this view from client.
revoke all on table public.user_management_view from anon;
revoke all on table public.user_management_view from authenticated;

-- Optional stronger action after app refactor:
-- drop view if exists public.user_management_view;

-- 2.2 Revoke execute from anon/authenticated for sensitive SECURITY DEFINER/admin functions
-- NOTE: keep service_role execute. add signatures from inventory output if overloaded.
do $$
declare
  fn text;
begin
  foreach fn in array[
    'public.admin_create_user',
    'public.admin_reset_devices',
    'public.admin_update_user_email',
    'public.admin_update_user_password',
    'public.delete_user_by_admin',
    'public.add_group_members',
    'public.create_group_conversation',
    'public.delete_group_conversation',
    'public.get_or_create_conversation',
    'public.get_unread_counts',
    'public.get_total_unread_count',
    'public.handle_new_user',
    'public.handle_new_message',
    'public.handle_profile_patient_sync',
    'public.is_admin',
    'public.can_view_patient',
    'public.can_current_user_access_patient',
    'public.is_assigned_dietitian',
    'public.is_patient_owner',
    'public.register_device',
    'public.sync_patient_food_usage_from_meals'
  ]
  loop
    execute format('revoke execute on all functions in schema public from anon');
    execute format('revoke execute on all functions in schema public from authenticated');
    -- blanket revoke above is intentional for immediate lock-down;
    -- re-grant only verified safe functions afterwards.
    exit;
  end loop;
end$$;

-- =========================================================
-- PHASE 3 - Enable RLS on sensitive patient data tables
-- =========================================================

alter table if exists public.diet_plans enable row level security;
alter table if exists public.diet_days enable row level security;
alter table if exists public.diet_weeks enable row level security;
alter table if exists public.diet_meals enable row level security;
alter table if exists public.patient_meal_choices enable row level security;
alter table if exists public.patient_meal_settings enable row level security;
alter table if exists public.patient_measurements enable row level security;
alter table if exists public.planner_settings_scope_checkpoint_v97 enable row level security;
alter table if exists public.team_pdf_branding enable row level security;

-- Optional hard mode after verifying all queries:
-- alter table ... force row level security;

-- Helper: role check from profiles (avoid user_metadata dependency)
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

-- Helper: central patient access check using DB relations
create or replace function public.can_current_user_access_patient_secure(target_patient_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r text;
begin
  if auth.uid() is null then
    return false;
  end if;

  r := public.current_user_role();

  if r = 'admin' then
    return true;
  end if;

  if r = 'patient' then
    return exists (
      select 1 from public.patients p
      where p.id = target_patient_id
        and (p.id = auth.uid() or p.user_id = auth.uid())
    );
  end if;

  if r in ('dietitian','doctor','staff') then
    return exists (
      select 1
      from public.patient_assignments pa
      where pa.patient_id = target_patient_id
        and pa.dietitian_id = auth.uid()
    );
  end if;

  return false;
end
$$;

revoke execute on function public.current_user_role() from public;
revoke execute on function public.current_user_role() from anon;
revoke execute on function public.current_user_role() from authenticated;
grant execute on function public.current_user_role() to service_role;

revoke execute on function public.can_current_user_access_patient_secure(uuid) from public;
revoke execute on function public.can_current_user_access_patient_secure(uuid) from anon;
revoke execute on function public.can_current_user_access_patient_secure(uuid) from authenticated;
grant execute on function public.can_current_user_access_patient_secure(uuid) to service_role;

-- 3.x Replace permissive policies with strict table policies.
-- NOTE: names are new to avoid unknown old-name conflicts; clean old policies after inventory.

-- diet_plans
drop policy if exists "secure_select_diet_plans" on public.diet_plans;
create policy "secure_select_diet_plans"
on public.diet_plans
for select
to authenticated
using (public.can_current_user_access_patient_secure(patient_id));

drop policy if exists "secure_write_diet_plans" on public.diet_plans;
create policy "secure_write_diet_plans"
on public.diet_plans
for all
to authenticated
using (public.can_current_user_access_patient_secure(patient_id))
with check (public.can_current_user_access_patient_secure(patient_id));

-- diet_weeks
drop policy if exists "secure_access_diet_weeks" on public.diet_weeks;
create policy "secure_access_diet_weeks"
on public.diet_weeks
for all
to authenticated
using (
  exists (
    select 1 from public.diet_plans dp
    where dp.id = diet_weeks.diet_plan_id
      and public.can_current_user_access_patient_secure(dp.patient_id)
  )
)
with check (
  exists (
    select 1 from public.diet_plans dp
    where dp.id = diet_weeks.diet_plan_id
      and public.can_current_user_access_patient_secure(dp.patient_id)
  )
);

-- diet_days
drop policy if exists "secure_access_diet_days" on public.diet_days;
create policy "secure_access_diet_days"
on public.diet_days
for all
to authenticated
using (
  exists (
    select 1
    from public.diet_weeks dw
    join public.diet_plans dp on dp.id = dw.diet_plan_id
    where dw.id = diet_days.diet_week_id
      and public.can_current_user_access_patient_secure(dp.patient_id)
  )
)
with check (
  exists (
    select 1
    from public.diet_weeks dw
    join public.diet_plans dp on dp.id = dw.diet_plan_id
    where dw.id = diet_days.diet_week_id
      and public.can_current_user_access_patient_secure(dp.patient_id)
  )
);

-- diet_meals
drop policy if exists "secure_access_diet_meals" on public.diet_meals;
create policy "secure_access_diet_meals"
on public.diet_meals
for all
to authenticated
using (
  exists (
    select 1
    from public.diet_days dd
    join public.diet_weeks dw on dw.id = dd.diet_week_id
    join public.diet_plans dp on dp.id = dw.diet_plan_id
    where dd.id = diet_meals.diet_day_id
      and public.can_current_user_access_patient_secure(dp.patient_id)
  )
)
with check (
  exists (
    select 1
    from public.diet_days dd
    join public.diet_weeks dw on dw.id = dd.diet_week_id
    join public.diet_plans dp on dp.id = dw.diet_plan_id
    where dd.id = diet_meals.diet_day_id
      and public.can_current_user_access_patient_secure(dp.patient_id)
  )
);

-- patient_meal_choices/settings/measurements
drop policy if exists "secure_access_patient_meal_choices" on public.patient_meal_choices;
create policy "secure_access_patient_meal_choices"
on public.patient_meal_choices
for all
to authenticated
using (public.can_current_user_access_patient_secure(patient_id))
with check (public.can_current_user_access_patient_secure(patient_id));

drop policy if exists "secure_access_patient_meal_settings" on public.patient_meal_settings;
create policy "secure_access_patient_meal_settings"
on public.patient_meal_settings
for all
to authenticated
using (public.can_current_user_access_patient_secure(patient_id))
with check (public.can_current_user_access_patient_secure(patient_id));

drop policy if exists "secure_access_patient_measurements" on public.patient_measurements;
create policy "secure_access_patient_measurements"
on public.patient_measurements
for all
to authenticated
using (public.can_current_user_access_patient_secure(patient_id))
with check (public.can_current_user_access_patient_secure(patient_id));

-- planner_settings_scope_checkpoint_v97
drop policy if exists "secure_access_planner_settings_scope_checkpoint_v97" on public.planner_settings_scope_checkpoint_v97;
create policy "secure_access_planner_settings_scope_checkpoint_v97"
on public.planner_settings_scope_checkpoint_v97
for all
to authenticated
using (public.can_current_user_access_patient_secure(patient_id))
with check (public.can_current_user_access_patient_secure(patient_id));

-- team_pdf_branding: doctor(owner) + admin only
drop policy if exists "secure_select_team_pdf_branding" on public.team_pdf_branding;
create policy "secure_select_team_pdf_branding"
on public.team_pdf_branding
for select
to authenticated
using (
  public.current_user_role() = 'admin'
  or supervisor_id = auth.uid()
);

drop policy if exists "secure_write_team_pdf_branding" on public.team_pdf_branding;
create policy "secure_write_team_pdf_branding"
on public.team_pdf_branding
for all
to authenticated
using (
  public.current_user_role() = 'admin'
  or supervisor_id = auth.uid()
)
with check (
  public.current_user_role() = 'admin'
  or supervisor_id = auth.uid()
);

-- explicit anon lock on sensitive tables
revoke all on table public.diet_plans from anon;
revoke all on table public.diet_days from anon;
revoke all on table public.diet_weeks from anon;
revoke all on table public.diet_meals from anon;
revoke all on table public.patient_meal_choices from anon;
revoke all on table public.patient_meal_settings from anon;
revoke all on table public.patient_measurements from anon;
revoke all on table public.planner_settings_scope_checkpoint_v97 from anon;
revoke all on table public.team_pdf_branding from anon;

-- =========================================================
-- PHASE 4 - Remove user_metadata dependence (starter)
-- =========================================================
-- Action item: replace remaining policies/functions that use:
-- auth.jwt()->'user_metadata'->>'role'
-- with public.current_user_role() / table-based checks.
-- (Do this after policy inventory export to avoid accidental regression.)

-- =========================================================
-- PHASE 5 - Public reference tables (SELECT-only for anon)
-- =========================================================
-- Example pattern (apply table-by-table after inventory confirms names):
-- revoke insert, update, delete on table public.foods from anon;
-- grant select on table public.foods to anon;
-- drop overly broad ALL policies and keep explicit SELECT policy only.

-- =========================================================
-- PHASE 6 - Storage listing tighten (manual review required)
-- =========================================================
-- Review storage.objects policies:
-- - keep public object access only where required (meal-photos/staff-logos/team-logos)
-- - block broad bucket listing for anon.

commit;

