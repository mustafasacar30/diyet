# Planner Settings Scope Fix Notes (2026-04-02)

Bu not, `settings-dialog.tsx` program katmani kaydetme edge-case duzeltmesi icin guvenli uygulama adimlarini listeler.

## 1) Uygulama degisikligi

- `src/components/planner/settings-dialog.tsx` icinde kaydetme scope secimi su sekilde duzeltildi:
  - `global`
  - `program`
  - `patient`
- Program context acikken yeni kayit artik `scope='program'` ve `program_template_id` ile yazilir.
- Insert oncesi ayni scope kaydi var mi kontrol edilir; varsa update edilir. Boylece duplicate riski azalir.

## 2) Kod yedegi (GitHub)

Degisiklikten once bir commit alin.

## 3) Veri yedegi (Supabase)

Iki secenek var:

1. JSON backup (mevcut script):
   - `npm run backup:db`
   - veya `npm run backup:tables`
2. SQL checkpoint (hizli geri donus):
   - `supabase_planner_settings_scope_checkpoint_v97.sql` dosyasini calistir.

## 4) Rollback (gerekiyorsa)

- `supabase_planner_settings_scope_rollback_v97.sql` dosyasini calistir.
- Bu script rollback oncesi mevcut durumu da `planner_settings_scope_before_rollback_v97` tablosuna kaydeder.

## 5) Kisa dogrulama listesi

1. Program ekraninda yeni ayar kaydi olustur.
2. `planner_settings` tablosunda satirin `scope='program'` oldugunu dogrula.
3. `program_template_id` dolu mu kontrol et.
4. Global satirin degismedigini dogrula.
