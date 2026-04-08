alter table public.profiles
add column if not exists pdf_footer_text text;

create table if not exists public.team_pdf_branding (
    supervisor_id uuid primary key references public.profiles(id) on delete cascade,
    footer_text text,
    updated_at timestamptz not null default now()
);

