-- SUPABASE EMERGENCY ACCESS - v89
-- TÜM ENGELLERİ KALDIRIR VE OTURUM BİLGİLERİNİ (METADATA) TAZELER

DO $$ 
DECLARE
    doc1_id uuid;
    doc2_id uuid;
BEGIN
    -- 1. ESKİ TÜM POLİTİKALARI TEMİZLE (Kökten Çözüm)
    DROP POLICY IF EXISTS "Staff Universal Identity v88" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Global Profile View v86" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Global Patient View v86" ON public.patients;
    DROP POLICY IF EXISTS "Staff Global Assignment View v86" ON public.patient_assignments;
    
    -- 2. YENİ PERSONEL-DOSTU POLİTİKALAR (Döngü Yok, Takılma Yok)
    -- Profiles: Tüm staff birbirini görebilir.
    CREATE POLICY "Staff Universal Read Profiles v89" ON public.profiles
    FOR SELECT TO authenticated
    USING (true);

    -- Patients: Tüm staff hastaları görebilir.
    CREATE POLICY "Staff Universal Read Patients v89" ON public.patients
    FOR SELECT TO authenticated
    USING (true);

    -- Assignments: Tüm staff atamaları görebilir (Sorumluluk rozeti için).
    CREATE POLICY "Staff Universal Read Assignments v89" ON public.patient_assignments
    FOR SELECT TO authenticated
    USING (true);

    -- 3. OTURUM BİLGİLERİNİ (USER_METADATA) GÜNCELLE
    -- Bu adım, login olduğunuzda "Doktor 1"in direkt Admin butonlarını görmesini sağlar.
    SELECT id INTO doc1_id FROM auth.users WHERE email = 'doktor1@demo.com';
    SELECT id INTO doc2_id FROM auth.users WHERE email = 'doktor2@demo.com';

    IF doc1_id IS NOT NULL THEN
        UPDATE auth.users SET raw_user_meta_data = 
            jsonb_set(
                jsonb_set(COALESCE(raw_user_meta_data, '{}'::jsonb), '{role}', '"doctor"'),
                '{is_global_access}', 'true'
            )
        WHERE id = doc1_id;
        
        -- Profilini de güncelle
        UPDATE public.profiles SET is_global_access = true, role = 'doctor' WHERE id = doc1_id;
    END IF;

    IF doc2_id IS NOT NULL THEN
        UPDATE auth.users SET raw_user_meta_data = 
            jsonb_set(COALESCE(raw_user_meta_data, '{}'::jsonb), '{role}', '"doctor"')
        WHERE id = doc2_id;
        
        -- Profilini de güncelle
        UPDATE public.profiles SET role = 'doctor' WHERE id = doc2_id;
    END IF;

    RAISE NOTICE 'v89 Uygulandı. Lütfen ÇIKIŞ yapıp tekrar GİRİN.';
END $$;
