# Team Scope Smoke Test Script (Diet Types + Rules + Foods + Patients)

Bu script, 4 katman mantiginda (global/team/program/patient) team override davranisini hizli ve tekrar edilebilir sekilde test etmek icindir.

## 0) Hazirlik

1. Supabase SQL Editor'de `Role = postgres` sec.
2. Asagidaki ID'leri secip not al:
`DOCTOR1_ID` (global access doctor), `DOCTOR2_ID` (normal doctor), `BASE_DIET_TYPE_ID`, `GLOBAL_RULE_ID`, `BASE_FOOD_ID`, `MICRO_ID_1`, `MICRO_ID_2`.

```sql
-- Doktorlar
select id, full_name, role, is_global_access
from profiles
where role = 'doctor'
order by full_name;

-- Global diyet turleri
select id, name
from diet_types
where patient_id is null
order by created_at desc
limit 20;

-- Global kurallar
select id, name, scope, team_owner_id
from planning_rules
where scope is null or scope = 'global'
order by updated_at desc nulls last, created_at desc nulls last
limit 20;

-- Yemekler
select id, name, calories, created_at
from foods
order by created_at desc nulls last
limit 20;

-- Mikrobesinler
select id, name
from micronutrients
order by name
limit 30;
```

## 1) Patients Team Visibility Smoke

`DOCTOR2_ID` icin UI'da gorunen hasta sayisinin SQL ile ayni oldugunu kontrol et.

```sql
with params as (
  select '<DOCTOR2_ID>'::uuid as doctor_id
),
scope_users as (
  select doctor_id as user_id from params
  union
  select tm.member_id
  from team_members tm
  join params p on p.doctor_id = tm.supervisor_id
  where tm.status = 'active'
),
expected_patients as (
  select p.id, p.full_name
  from patients p
  where p.gender is not null
    and (
      p.dietitian_id in (select user_id from scope_users)
      or exists (
        select 1
        from patient_assignments pa
        where pa.patient_id = p.id
          and pa.dietitian_id in (select user_id from scope_users)
      )
    )
)
select count(*) as expected_count
from expected_patients;
```

Beklenen:
- `doktor2` ile `/patients` ekranindaki satir sayisi = `expected_count`
- `Takimim` etiketi sadece bu kapsamdaki hastalarda gorunmeli

`DOCTOR1_ID` icin:
- Team Modda ayni query ile sadece kendi takim kapsami gorunmeli
- Global Modda ise tum `gender is not null` hastalar gorunmeli

```sql
select count(*) as global_count
from patients
where gender is not null;
```

## 2) Diet Types Team Override Smoke

```sql
-- Team override yaz
insert into team_diet_type_overrides (
  team_owner_id,
  base_diet_type_id,
  name,
  carb_factor,
  protein_factor,
  fat_factor,
  created_by
)
values (
  '<DOCTOR2_ID>'::uuid,
  '<BASE_DIET_TYPE_ID>'::uuid,
  '[TEAM TEST] DIYET TURU',
  1.7,
  1.3,
  0.9,
  '<DOCTOR2_ID>'::uuid
)
on conflict (team_owner_id, base_diet_type_id)
do update set
  name = excluded.name,
  carb_factor = excluded.carb_factor,
  protein_factor = excluded.protein_factor,
  fat_factor = excluded.fat_factor,
  updated_at = now()
returning *;
```

```sql
-- Effective gorunum (global + team merge kontrolu)
select
  dt.id as base_id,
  dt.name as global_name,
  tdo.name as team_name,
  coalesce(tdo.name, dt.name) as effective_name,
  dt.carb_factor as global_carb,
  coalesce(tdo.carb_factor, dt.carb_factor) as effective_carb
from diet_types dt
left join team_diet_type_overrides tdo
  on tdo.base_diet_type_id = dt.id
 and tdo.team_owner_id = '<DOCTOR2_ID>'::uuid
where dt.id = '<BASE_DIET_TYPE_ID>'::uuid;
```

```sql
-- Global kayit kirlenmedi mi?
select id, name, carb_factor, protein_factor, fat_factor
from diet_types
where id = '<BASE_DIET_TYPE_ID>'::uuid;
```

```sql
-- Cleanup
delete from team_diet_type_overrides
where team_owner_id = '<DOCTOR2_ID>'::uuid
  and base_diet_type_id = '<BASE_DIET_TYPE_ID>'::uuid;
```

## 3) Rules Team Override Smoke

```sql
-- Global kuraldan team override olustur
insert into planning_rules (
  name,
  description,
  rule_type,
  priority,
  sort_order,
  is_active,
  definition,
  scope,
  team_owner_id,
  user_id,
  source_rule_id,
  pending_global_approval
)
select
  name || ' [TEAM TEST]',
  description,
  rule_type,
  priority,
  sort_order,
  is_active,
  definition,
  'team',
  '<DOCTOR2_ID>'::uuid,
  '<DOCTOR2_ID>'::uuid,
  id,
  false
from planning_rules
where id = '<GLOBAL_RULE_ID>'::uuid
returning id, name, scope, team_owner_id, source_rule_id;
```

```sql
-- Effective ad kontrolu
with g as (
  select id, name
  from planning_rules
  where id = '<GLOBAL_RULE_ID>'::uuid
),
t as (
  select id, name, source_rule_id
  from planning_rules
  where scope = 'team'
    and team_owner_id = '<DOCTOR2_ID>'::uuid
    and source_rule_id = '<GLOBAL_RULE_ID>'::uuid
  order by updated_at desc nulls last
  limit 1
)
select
  g.id as global_rule_id,
  g.name as global_name,
  t.name as team_name,
  coalesce(t.name, g.name) as effective_name
from g
left join t on t.source_rule_id = g.id;
```

```sql
-- Cleanup
delete from planning_rules
where scope = 'team'
  and team_owner_id = '<DOCTOR2_ID>'::uuid
  and source_rule_id = '<GLOBAL_RULE_ID>'::uuid;
```

## 4) Foods Team Override Smoke

```sql
-- Team food override yaz
insert into team_food_overrides (
  team_owner_id,
  base_food_id,
  name,
  calories,
  priority_score,
  created_by
)
values (
  '<DOCTOR2_ID>'::uuid,
  '<BASE_FOOD_ID>'::uuid,
  '[TEAM TEST] YEMEK ADI',
  333,
  8,
  '<DOCTOR2_ID>'::uuid
)
on conflict (team_owner_id, base_food_id)
do update set
  name = excluded.name,
  calories = excluded.calories,
  priority_score = excluded.priority_score,
  updated_at = now()
returning *;
```

```sql
-- Effective gorunum
select
  f.id as base_food_id,
  f.name as global_name,
  tfo.name as team_name,
  coalesce(tfo.name, f.name) as effective_name,
  f.calories as global_calories,
  coalesce(tfo.calories, f.calories) as effective_calories
from foods f
left join team_food_overrides tfo
  on tfo.base_food_id = f.id
 and tfo.team_owner_id = '<DOCTOR2_ID>'::uuid
where f.id = '<BASE_FOOD_ID>'::uuid;
```

```sql
-- Global kayit degismedi mi?
select id, name, calories, priority_score
from foods
where id = '<BASE_FOOD_ID>'::uuid;
```

```sql
-- Cleanup
delete from team_food_overrides
where team_owner_id = '<DOCTOR2_ID>'::uuid
  and base_food_id = '<BASE_FOOD_ID>'::uuid;
```

## 5) Food Micronutrient Team Override Smoke

```sql
-- Team mikrobesin override yaz
insert into team_food_micronutrient_overrides (
  team_owner_id,
  base_food_id,
  micronutrient_ids,
  created_by
)
values (
  '<DOCTOR2_ID>'::uuid,
  '<BASE_FOOD_ID>'::uuid,
  array['<MICRO_ID_1>'::uuid, '<MICRO_ID_2>'::uuid],
  '<DOCTOR2_ID>'::uuid
)
on conflict (team_owner_id, base_food_id)
do update set
  micronutrient_ids = excluded.micronutrient_ids,
  updated_at = now()
returning *;
```

```sql
-- Team map kaydi gorunmeli
select team_owner_id, base_food_id, micronutrient_ids, updated_at
from team_food_micronutrient_overrides
where team_owner_id = '<DOCTOR2_ID>'::uuid
  and base_food_id = '<BASE_FOOD_ID>'::uuid;
```

```sql
-- Global mapping oldugu gibi kaliyor mu?
select count(*) as global_food_micro_count
from food_micronutrients
where food_id = '<BASE_FOOD_ID>'::uuid;
```

```sql
-- Cleanup
delete from team_food_micronutrient_overrides
where team_owner_id = '<DOCTOR2_ID>'::uuid
  and base_food_id = '<BASE_FOOD_ID>'::uuid;
```

## 6) Son Kontrol (Temiz Bitis)

```sql
select 'team_diet_type_overrides' as table_name, count(*) as row_count
from team_diet_type_overrides
where team_owner_id = '<DOCTOR2_ID>'::uuid
union all
select 'team_food_overrides' as table_name, count(*)
from team_food_overrides
where team_owner_id = '<DOCTOR2_ID>'::uuid
union all
select 'team_food_micronutrient_overrides' as table_name, count(*)
from team_food_micronutrient_overrides
where team_owner_id = '<DOCTOR2_ID>'::uuid
union all
select 'planning_rules_team_rows' as table_name, count(*)
from planning_rules
where scope = 'team'
  and team_owner_id = '<DOCTOR2_ID>'::uuid;
```

Bu satirlar test sonunda beklenen sekilde artip azalmalidir (yazdiginda artar, cleanup sonrasi duser).
