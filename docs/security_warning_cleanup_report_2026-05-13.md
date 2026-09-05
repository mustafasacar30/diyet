# Security Advisor Warning Cleanup Report (2026-05-13)

Bu rapor, **Error=0** sonrası yalnızca Warning temizliğini hedefleyen, düşük kırılma riskli migration planını özetler.

## 1) Function Search Path Mutable

Migration, aşağıdaki fonksiyonlarda gövdeye dokunmadan yalnızca `search_path` sabitler:

- `public.set_team_food_overrides_updated_at`
- `public.set_team_program_overrides_updated_at`
- `public.set_team_diet_type_overrides_updated_at`
- `public.set_team_food_micro_overrides_updated_at`
- `public.set_program_diet_type_overrides_updated_at`
- `public.can_current_user_access_patient`

Uygulama:

- `ALTER FUNCTION ... SET search_path = public, pg_temp`
- İmza farklarına karşı `pg_proc` üzerinden dinamik ve overload-safe uygulanır.

## 2) RLS Policy Always True (Referans Tablolar)

Hedef referans tablolar:

- `app_settings`
- `diet_types`
- `disease_rules`
- `diseases`
- `food_micronutrients`
- `foods`
- `meal_templates`
- `micronutrients`

Plan:

- Bu tablolardaki `USING (true)` / `WITH CHECK (true)` ve özellikle `FOR ALL ... true` tarzı policy’ler drop edilir.
- Yerine daha dar ve amaç bazlı policy seti eklenir:
  - `anon SELECT`
  - `authenticated SELECT`
  - `staff/admin INSERT`
  - `staff/admin UPDATE`
  - `staff/admin DELETE`

Not:

- `SELECT` erişimi referans veriler için korunur.
- Yazma/silme anon için kapatılır.

## 3) Patient Verisi İçeren Tablolar

Hedef tablolar:

- `patient_ai_reports`
- `patient_diseases`
- `patient_imaging`
- `patient_lab_results`
- `patient_observations`

Plan:

- Bu tablolarda anon erişim bırakılmaz.
- `FOR ALL true` veya benzeri geniş policy’ler drop edilir.
- Yeni policy seti:
  - `authenticated SELECT` sadece erişilebilir patient kayıtları
  - `authenticated INSERT/UPDATE/DELETE` sadece erişilebilir patient kayıtları

Erişim kontrolü:

- `public.can_current_user_access_patient(patient_id)` varsa doğrudan o kullanılır.
- Bu fonksiyon yoksa güvenli fallback:
  - admin: tümü
  - patient: kendi kaydı (`patients.id = auth.uid()` veya `patients.user_id = auth.uid()`)
  - staff/dietitian/doctor: `patient_assignments` üzerinden bağlı hastalar

## 4) Uygulama Kırılma Riski ve Test Checklist

Warning temizliği sonrası özellikle şu akışlar doğrulanmalı:

1. Admin paneli:
   - kullanıcı/patient listeleme
   - hasta detayına girme
2. Hasta paneli:
   - kendi ölçüm/lab/observation kayıtlarını görme
3. Yemek planı oluşturma:
   - `foods`, `diet_types`, `meal_templates`, `micronutrients` okuma
4. Ölçüm ekleme:
   - patient kayıtlarına insert/update
5. Tarif/food listesi ekranları:
   - anon ve authenticated read davranışı

## 5) Operasyon Notu

- Migration idempotent tasarlanmıştır.
- Önce staging’de çalıştırın.
- Security Advisor’ı tekrar çalıştırıp kalan Warning listesini snapshot alın.
