-- SUPABASE NİHAİ SABİTLEME - v94
-- TAKILMALARI VE YETKİ KARIŞIKLIĞINI KÖKTEN BİTİRİR

DO $$ 
DECLARE
    doc1_id uuid;
    doc2_id uuid;
BEGIN
    -- 1. ESKİ TÜM POLİTİKALARI TEMİZLE
    -- Profil
    DROP POLICY IF EXISTS "Staff Identity Full Access v93" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Universal Identity v91" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Universal Identity v92" ON public.profiles;
    
    -- Hasta
    DROP POLICY IF EXISTS "Scoped Patient Access v93" ON public.patients;
    DROP POLICY IF EXISTS "Staff Scoped Patient View v90" ON public.patients;
    DROP POLICY IF EXISTS "Staff Scoped Patient View v91" ON public.patients;
    DROP POLICY IF EXISTS "Staff Scoped Patient View v92" ON public.patients;

    -- 2. YENİ, DÜŞÜK MALİYETLİ VE DÖNGÜSÜZ POLİTİKALAR

    -- A. PROFİLLER: Personel HERKESİN sadece ismini ve rolünü okuyabilir (Hata vermez, takılmaz).
    CREATE POLICY "Staff Identity Reader v94" ON public.profiles
    FOR SELECT TO authenticated
    USING (true);

    -- B. HASTALAR: Admin HERKESİ, Doktor sadece KENDİ TAKIMINI görür.
    -- (auth.jwt() metadata kontrolü ile en hızlı sonuç)
    CREATE POLICY "Staff Scoped Patient Access v94" ON public.patients
    FOR SELECT TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_global_access')::boolean = true
        OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR id IN (
            SELECT patient_id FROM public.patient_assignments 
            WHERE dietitian_id = auth.uid() 
            OR dietitian_id IN (SELECT member_id FROM public.team_members WHERE supervisor_id = auth.uid())
        )
    );

    -- 3. KULLANICI METADATALARINI (YETKİ ANAHTARLARI) TAM İSTEDİĞİMİZ HALE GETİR
    SELECT id INTO doc1_id FROM auth.users WHERE email = 'doktor1@demo.com';
    SELECT id INTO doc2_id FROM auth.users WHERE email = 'doktor2@demo.com';

    -- Doktor 1: FULL ADMİN / GLOBAL ACCESS
    IF doc1_id IS NOT NULL THEN
        UPDATE auth.users SET raw_user_meta_data = 
            jsonb_set(
                jsonb_set(COALESCE(raw_user_meta_data, '{}'::jsonb), '{role}', '"doctor"'),
                '{is_global_access}', 'true'
            )
        WHERE id = doc1_id;
        
        UPDATE public.profiles SET is_global_access = true, role = 'doctor' WHERE id = doc1_id;
    END IF;

    -- Doktor 2: SADECE KENDİ HASTALARI (is_global_access = FALSE)
    IF doc2_id IS NOT NULL THEN
        UPDATE auth.users SET raw_user_meta_data = 
            jsonb_set(
                jsonb_set(COALESCE(raw_user_meta_data, '{}'::jsonb), '{role}', '"doctor"'),
                '{is_global_access}', 'false'
            )
        WHERE id = doc2_id;
        
        UPDATE public.profiles SET is_global_access = false, role = 'doctor' WHERE id = doc2_id;
    END IF;

    RAISE NOTICE 'v94 Nihai Sabitleme Uygulandı. Lütfen ÇIKIŞ yapıp tekrar GİRİN.';
END $$;
