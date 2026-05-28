-- Security hotfix v1 (minimum-break strategy)
-- Date: 2026-05-13
-- Scope (today):
-- 1) Lock user_management_view
-- 2) Enable RLS on sensitive patient tables
-- 3) Remove anon access from sensitive tables
-- 4) Revoke anon EXECUTE on sensitive functions
--
-- Apply on staging first, then production.

begin;

-- 1) Lock user_management_view
revoke all on table public.user_management_view from anon;
revoke all on table public.user_management_view from authenticated;

-- 2) Enable RLS on critical tables
alter table if exists public.diet_days enable row level security;
alter table if exists public.diet_weeks enable row level security;
alter table if exists public.diet_meals enable row level security;
alter table if exists public.diet_plans enable row level security;
alter table if exists public.patient_meal_choices enable row level security;
alter table if exists public.patient_meal_settings enable row level security;
alter table if exists public.patient_measurements enable row level security;
alter table if exists public.planner_settings_scope_checkpoint_v97 enable row level security;
alter table if exists public.team_pdf_branding enable row level security;

-- 3) Remove anon table privileges on sensitive data
revoke all on table public.diet_days from anon;
revoke all on table public.diet_weeks from anon;
revoke all on table public.diet_meals from anon;
revoke all on table public.diet_plans from anon;
revoke all on table public.patient_meal_choices from anon;
revoke all on table public.patient_meal_settings from anon;
revoke all on table public.patient_measurements from anon;
revoke all on table public.planner_settings_scope_checkpoint_v97 from anon;
revoke all on table public.team_pdf_branding from anon;

-- 4) Revoke anon execute on sensitive functions (all overloads in public schema)
do $$
declare
  fn record;
begin
  for fn in
    select n.nspname as schema_name, p.proname as function_name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'admin_create_user',
        'admin_reset_devices',
        'admin_update_user_email',
        'admin_update_user_password',
        'delete_user_by_admin',
        'add_group_members',
        'create_group_conversation',
        'delete_group_conversation',
        'get_or_create_conversation',
        'get_unread_counts',
        'get_total_unread_count',
        'handle_new_user',
        'handle_new_message',
        'handle_profile_patient_sync',
        'is_admin',
        'can_view_patient',
        'can_current_user_access_patient',
        'is_assigned_dietitian',
        'is_patient_owner',
        'register_device',
        'sync_patient_food_usage_from_meals'
      )
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from anon',
      fn.schema_name,
      fn.function_name,
      fn.args
    );
  end loop;
end $$;

commit;

