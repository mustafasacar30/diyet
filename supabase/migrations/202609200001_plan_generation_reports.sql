-- ═══════════════════════════════════════════════
-- plan_generation_reports: Otomatik plan üretim raporlarını kalıcı kaydet
-- ═══════════════════════════════════════════════
-- Hem hasta paneli hem diyetisyen paneli otomatik plan ürettiğinde
-- (karar raporu + planner logs + plan snapshot + hedef makrolar) buraya kaydeder.
-- Diyetisyen daha sonra hastanın "Planlama Geçmişi" sekmesinden raporu görebilir.

create table if not exists public.plan_generation_reports (
    id uuid primary key default gen_random_uuid(),
    patient_id uuid not null references public.patients(id) on delete cascade,
    diet_plan_id uuid references public.diet_plans(id) on delete set null,
    week_id uuid,
    week_number int,
    generated_at timestamptz not null default now(),
    generated_by_user_id uuid references auth.users(id) on delete set null,
    source text not null check (source in ('patient','dietitian','system')) default 'system',
    target_macros jsonb,
    weekly_totals jsonb,
    active_rules_summary jsonb,
    logs jsonb,
    plan_snapshot jsonb,
    label text
);

create index if not exists idx_plan_gen_reports_patient on public.plan_generation_reports (patient_id, generated_at desc);
create index if not exists idx_plan_gen_reports_diet_plan on public.plan_generation_reports (diet_plan_id);

-- RLS: hasta kendi raporlarını görebilir; diyetisyen kendisine atanan hastaların raporlarını görebilir.
alter table public.plan_generation_reports enable row level security;

do $$ begin
    if not exists (
        select 1 from pg_policies
        where schemaname='public' and tablename='plan_generation_reports' and policyname='patient_read_own'
    ) then
        create policy patient_read_own on public.plan_generation_reports
        for select
        using (
            exists (
                select 1 from public.patients p
                where p.id = plan_generation_reports.patient_id
                  and p.user_id = auth.uid()
            )
        );
    end if;
end $$;

do $$ begin
    if not exists (
        select 1 from pg_policies
        where schemaname='public' and tablename='plan_generation_reports' and policyname='dietitian_read_assigned'
    ) then
        create policy dietitian_read_assigned on public.plan_generation_reports
        for select
        using (
            exists (
                select 1 from public.patient_assignments pa
                where pa.patient_id = plan_generation_reports.patient_id
                  and pa.dietitian_id = auth.uid()
            )
            or exists (
                select 1 from public.profiles pr
                where pr.id = auth.uid()
                  and pr.role in ('admin','doctor','dietitian')
            )
        );
    end if;
end $$;

do $$ begin
    if not exists (
        select 1 from pg_policies
        where schemaname='public' and tablename='plan_generation_reports' and policyname='authenticated_insert'
    ) then
        create policy authenticated_insert on public.plan_generation_reports
        for insert
        with check (auth.uid() is not null);
    end if;
end $$;

comment on table public.plan_generation_reports is 'Otomatik plan üretimi karar raporları (planner logs, plan snapshot, hedef makrolar). UI: Diyetisyen paneli → hasta detay → Planlama Geçmişi sekmesi.';
