# Team Scope Rollout v98 (Planner Settings)

Bu adimlar planner ayarlarinda yeni katmani aktif eder:

- global -> team -> program -> patient

## 1) On kosul (zaten yapildiysa atla)

1. Kod yedegi: Git commit alin.
2. JSON backup alin:
   - `npm run backup:db`
3. Planner checkpoint alin:
   - `supabase_planner_settings_scope_checkpoint_v97.sql` calistir.

## 2) Team scope migration calistir

Supabase SQL Editor'da:

- `supabase_planner_settings_team_scope_v98.sql`

## 3) Hizli dogrulama sorgulari

```sql
select scope, count(*) 
from planner_settings
group by scope
order by scope;
```

```sql
select id, scope, team_owner_id, program_template_id, patient_id, updated_at
from planner_settings
order by updated_at desc
limit 20;
```

Beklenen:

1. `team_owner_id` kolonu var.
2. Uygulamada doktor/diyetisyen contextinde ana ayarlar team katmanina yazilir.
3. Program kayitlari `scope='program'` + dogru `team_owner_id` ile gider.
4. Patient kayitlari `scope='patient'` + dogru `team_owner_id` ile gider.

## 4) Geri donus (gerekirse)

1. Uygulama kodunu geri al.
2. Gerekirse `supabase_planner_settings_scope_rollback_v97.sql` calistir.
3. Scope constraint rollback gerekiyorsa:
   - `supabase_planner_settings_team_scope_rollback_v98.sql`
