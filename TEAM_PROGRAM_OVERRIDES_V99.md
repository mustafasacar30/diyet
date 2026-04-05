# Team Program Overrides v99

Bu migration, global `program_templates` verisini bozmadan, takım bazlı program override altyapısı ekler.

## Eklenen tablolar

- `team_program_overrides`
  - `(team_owner_id, program_template_id)` için tek kayıt
  - Program başlık/açıklama/aktivite/is_active override alanları
- `team_program_override_weeks`
  - Seçilen override kaydı için hafta-diyet eşleşmeleri
- `team_program_override_restrictions`
  - Seçilen override kaydı için program yasakları

## Güvenlik

- RLS aktif.
- `is_current_user_in_team(team_owner_id)` fonksiyonu ile:
  - admin / global-access kullanıcılar
  - takım sahibi doktor
  - takım içindeki aktif diyetisyen
  erişebilir.

## Çalıştırma sırası

1. `npm run backup:db`
2. Supabase SQL Editor:
   - `supabase_program_templates_team_overrides_v99.sql`
3. Şema yenileme:
   - migration sonunda `NOTIFY pgrst, 'reload schema';` zaten var.

## Hızlı doğrulama SQL

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'team_program_overrides',
    'team_program_override_weeks',
    'team_program_override_restrictions'
  )
order by table_name;
```

```sql
-- Team owner ile override test insert (örnek)
insert into team_program_overrides (team_owner_id, program_template_id, created_by)
values ('<TEAM_OWNER_UUID>', '<PROGRAM_TEMPLATE_UUID>', auth.uid())
returning *;
```

## Rollback

Sorun olursa:
- `supabase_program_templates_team_overrides_rollback_v99.sql`
