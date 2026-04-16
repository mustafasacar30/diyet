create table if not exists public.menu_import_pool (
    id uuid primary key default gen_random_uuid(),
    week_id uuid null references public.diet_weeks(id) on delete set null,
    patient_id uuid null references public.patients(id) on delete set null,
    program_template_id uuid null references public.program_templates(id) on delete set null,
    week_number integer null,
    source_type text not null default 'google_sheets',
    source_file_id text null,
    source_file_name text null,
    source_tab_name text null,
    source_patient_name text null,
    raw_text text not null,
    parsed_days jsonb not null default '[]'::jsonb,
    dedupe_hash text not null unique,
    repeat_count integer not null default 1,
    created_by uuid null references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_menu_import_pool_program_week
on public.menu_import_pool(program_template_id, week_number);

create index if not exists idx_menu_import_pool_week_id
on public.menu_import_pool(week_id);

create index if not exists idx_menu_import_pool_source_tab
on public.menu_import_pool(source_tab_name);

alter table public.menu_import_pool enable row level security;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'menu_import_pool'
          and policyname = 'Admins can read menu import pool'
    ) then
        create policy "Admins can read menu import pool"
        on public.menu_import_pool
        for select
        to authenticated
        using (
            exists (
                select 1
                from public.profiles p
                where p.id = auth.uid()
                  and p.role = 'admin'
            )
        );
    end if;
end $$;
