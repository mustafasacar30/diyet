# Supabase Security Hardening Report (2026-05-13)

Bu rapor, kod tabanı ve repodaki SQL dosyaları üzerinden çıkarılmıştır.  
Canlı veritabanına bağlanmadan üretildiği için, final uygulamadan önce SQL envanter sorguları ile doğrulanmalıdır.

## 1) Risk Raporu (Öncelik Sırasıyla)

### P0 - Kritik
- `public.user_management_view`:
  - `auth.users` verisini (özellikle e-posta) `public` şemadan expose ediyor.
  - Repoda `Create_User_View.sql` içinde `GRANT SELECT ... TO authenticated` var.
  - Admin ekranları doğrudan bu view'ı kullanıyor:
    - `src/app/admin/users/page.tsx`
    - `src/app/admin/doctors/page.tsx`
    - `src/app/admin/dietitians/page.tsx`
    - `src/app/admin/dietitians/[id]/page.tsx`

- RLS disabled + sensitive columns risk (Advisor listesi ile uyumlu):
  - `diet_plans`, `diet_days`, `diet_weeks`, `diet_meals`
  - `patient_meal_choices`, `patient_meal_settings`, `patient_measurements`
  - `planner_settings_scope_checkpoint_v97`
  - `team_pdf_branding`

- `SECURITY DEFINER` + execute yetki riski:
  - Repoda çok sayıda admin/chat/security function var.
  - Özellikle `GRANT EXECUTE ... TO authenticated` görülen fonksiyonlar mevcut (örn: chat fonksiyonları).
  - `SECURITY DEFINER` fonksiyonlarda yanlış `EXECUTE` yetkisi RLS'i by-pass etkisi yaratabilir.

### P1 - Yüksek
- Policy içinde `user_metadata` kullanımı:
  - Örnekler: `supabase_team_security_v69_fixed.sql`, `supabase_transparent_hierarchy_v79.sql`
  - `auth.jwt()->'user_metadata'` kullanıcı tarafından manipüle edilebilir kabul edildiği için rol kontrolünde tek kaynak olmamalı.

- Client tarafında kritik tablolara doğrudan erişim yoğun:
  - `diet_plans`, `diet_weeks`, `diet_days`, `diet_meals`, `patient_measurements` birçok UI akışında doğrudan çağrılıyor.
  - RLS açılınca policy eksikse ekranlar boş/403 dönebilir.

### P2 - Orta
- Güvenlik açısından tehlikeli utility route:
  - `src/app/api/runSql/route.ts` bir `GET` isteği ile DB DDL çalıştırıyor.
  - Uç nokta auth kontrolü olmadan bırakılırsa ciddi istismar yüzeyi doğurur.

## 2) Aşama-1 Envanter SQL (Önce Çalıştırılmalı)

Canlı şema doğrulama sorguları (önce staging):

```sql
-- Tables + RLS status + columns
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname in ('public')
order by 1,2;

select
  table_schema, table_name, ordinal_position, column_name, data_type
from information_schema.columns
where table_schema='public'
order by table_name, ordinal_position;

-- Policies
select
  schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname='public'
order by tablename, policyname;

-- Views + security flags
select
  n.nspname as schema_name,
  c.relname as view_name,
  coalesce((c.reloptions::text[]::text ilike '%security_invoker=true%'), false) as security_invoker
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('v','m') and n.nspname='public'
order by 1,2;

-- Functions + definer + execute grants
select
  n.nspname as schema_name,
  p.proname as function_name,
  p.prosecdef as security_definer,
  pg_get_function_identity_arguments(p.oid) as args,
  p.proconfig as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
order by 1,2;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  r.rolname as grantee
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_authid r on has_function_privilege(r.rolname, p.oid, 'EXECUTE')
where n.nspname='public' and r.rolname in ('anon','authenticated')
order by 1,2,4;
```

## 3) Client Kodda Kritik Tablo Kullanımları (Özet)

- `user_management_view`:
  - `src/app/admin/users/page.tsx`
  - `src/app/admin/doctors/page.tsx`
  - `src/app/admin/dietitians/page.tsx`
  - `src/app/admin/dietitians/[id]/page.tsx`

- `diet_plans`: patient plan ekranları + admin planner akışları.
- `diet_weeks`: ölçüm, plan, planner ayar ve week loop akışları.
- `diet_days`: patient plan ve plan kopyalama/loop akışları.
- `diet_meals`: meal edit, photo meal log, snapshots akışları.
- `patient_measurements`: measurement action/panel + AI analysis.
- `team_pdf_branding`: 
  - `src/app/api/patient/pdf-branding/route.ts`
  - `src/app/api/team-branding/route.ts`

## 4) Service Role Key Kontrolü

- Browser client (`src/lib/supabase.ts`) yalnızca `NEXT_PUBLIC_SUPABASE_ANON_KEY` kullanıyor: iyi.
- Service role sadece server/action dosyalarında:
  - `src/lib/supabase-admin.ts`
  - `src/actions/auth-actions.ts`
  - `src/actions/measurement-actions.ts`
  - `src/actions/patient-actions.ts`
  - `src/app/api/admin/recipe-sync/route.ts`
  - `src/app/api/run-setup-sql/route.ts`
- Doğrudan client bundle'a service role sızıntısı bulgusu yok; yine de `NEXT_PUBLIC_` env'lerde asla service key kullanılmamalı.

## 5) "Bu SQL uygulamayı nerede kırabilir?" (Riskli Noktalar)

- `user_management_view` revoke/drop sonrası:
  - Admin users/doctors/dietitians ekranları e-posta alanında kırılır (hemen server-route/refactor gerekir).

- RLS enable sonrası:
  - Aşağıdaki akışlar policy eksikse 403/empty data üretir:
    - patient plan ekranları (`diet_plans/weeks/days/meals`)
    - measurements (`patient_measurements`)
    - team branding (`team_pdf_branding`)

- `REVOKE EXECUTE` sonrası:
  - UI tarafı doğrudan RPC çağırıyorsa bozulur (`admin_reset_devices`, `get_total_unread_count`, chat RPC’leri).
  - Bunlar server route üzerinden çağrılacak şekilde taşınmalı.

- `user_metadata` temizlik sonrası:
  - role kontrolü sadece DB tablosuna dönerse eski token-varsayımlı policy davranışı değişir.

## 6) Test Checklist (Migration Öncesi/Sonrası)

1. Admin login ve admin panel açılışı.
2. Users/Doctors/Dietitians listeleri (özellikle email alanı).
3. Patient plan: görüntüleme, week/day/meal CRUD.
4. Patient measurements: create/update/delete/read.
5. Patient settings ve plan kopyalama/loop.
6. Chat unread RPC’leri (`get_total_unread_count` vs.).
7. Team branding + patient pdf branding route’ları.
8. Anon token ile hasta tablosu sorguları: kesinlikle erişim olmamalı.

