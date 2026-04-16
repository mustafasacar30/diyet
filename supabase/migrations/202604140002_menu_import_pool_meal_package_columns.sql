alter table public.menu_import_pool
    add column if not exists day_name text null,
    add column if not exists meal_name text null,
    add column if not exists food_count integer not null default 0,
    add column if not exists unknown_count integer not null default 0,
    add column if not exists unknown_food_names text[] not null default '{}'::text[],
    add column if not exists matched_food_ids uuid[] not null default '{}'::uuid[],
    add column if not exists meal_signature text null;

create index if not exists idx_menu_import_pool_created_at
on public.menu_import_pool(created_at desc);

create index if not exists idx_menu_import_pool_day_meal
on public.menu_import_pool(day_name, meal_name);

create index if not exists idx_menu_import_pool_unknown_count
on public.menu_import_pool(unknown_count);
