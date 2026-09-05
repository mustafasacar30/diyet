-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Foods Table
create table if not exists foods (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category text,
  calories numeric default 0,
  protein numeric default 0,
  carbs numeric default 0,
  fat numeric default 0,
  portion_unit text default 'porsiyon',
  standard_amount numeric default 1,
  tags text[],
  meta jsonb default '{}'::jsonb,
  -- Search tokens for fuzzy search
  search_tokens tsvector generated always as (to_tsvector('turkish', name || ' ' || coalesce(category, ''))) stored,
  created_at timestamp with time zone default now()
);

-- Index for search
create index if not exists foods_search_idx on foods using gin (search_tokens);

-- 2. Patients Table
create table if not exists patients (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  notes text,
  created_at timestamp with time zone default now()
);

-- 3. Diet Plans Table
create table if not exists diet_plans (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid references patients(id) on delete cascade,
  title text not null,
  status text default 'active',
  created_at timestamp with time zone default now()
);

-- 4. Diet Weeks Table
create table if not exists diet_weeks (
  id uuid primary key default uuid_generate_v4(),
  diet_plan_id uuid references diet_plans(id) on delete cascade,
  week_number integer not null,
  title text,
  created_at timestamp with time zone default now()
);

-- 5. Diet Days Table
create table if not exists diet_days (
  id uuid primary key default uuid_generate_v4(),
  diet_week_id uuid references diet_weeks(id) on delete cascade,
  day_number integer not null,
  notes text,
  created_at timestamp with time zone default now()
);

-- 6. Diet Meals Table
create table if not exists diet_meals (
  id uuid primary key default uuid_generate_v4(),
  diet_day_id uuid references diet_days(id) on delete cascade,
  food_id uuid references foods(id) on delete set null,
  meal_time text not null,
  portion_multiplier numeric default 1,
  custom_notes text,
  created_at timestamp with time zone default now()
);

-- 7. ENABLE RLS (Row Level Security)
alter table foods enable row level security;
alter table patients enable row level security;
alter table diet_plans enable row level security;
alter table diet_weeks enable row level security;
alter table diet_days enable row level security;
alter table diet_meals enable row level security;

-- 8. POLICIES
-- WARNING: These policies are permissive for initial setup. 
-- In production, you should lock these down to authenticated users only.

-- Allow PUBLIC read/write to foods (for import script and easy viewing)
create policy "Enable all for public" on foods for all using (true);

-- Allow Authenticated full access to other tables
create policy "Enable all for authenticated" on patients for all using (auth.role() = 'authenticated');
create policy "Enable all for authenticated" on diet_plans for all using (auth.role() = 'authenticated');
create policy "Enable all for authenticated" on diet_weeks for all using (auth.role() = 'authenticated');
create policy "Enable all for authenticated" on diet_days for all using (auth.role() = 'authenticated');
create policy "Enable all for authenticated" on diet_meals for all using (auth.role() = 'authenticated');
