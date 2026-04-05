-- SUPABASE FINAL STABILIZATION - v86
-- TÜM TAKILMALARI GİDERİR VE KLİNİK GENELİ GÖRÜNÜRLÜK SAĞLAR

DO $$ 
BEGIN
    -- 1. ESKİ KURALLARI TEMİZLE
    -- Profil
    DROP POLICY IF EXISTS "Simple Own Profile v83" ON public.profiles;
    DROP POLICY IF EXISTS "Admin Global View v83" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Link Visibility v85" ON public.profiles;
    DROP POLICY IF EXISTS "Profile Base Access v85" ON public.profiles;
    DROP POLICY IF EXISTS "Temp Global Read v84" ON public.profiles;

    -- Hasta
    DROP POLICY IF EXISTS "Professionals View Patients v73" ON public.patients;
    DROP POLICY IF EXISTS "Professionals View Patients v69" ON public.patients;
    DROP POLICY IF EXISTS "Doctors View Team Patients v70" ON public.patients;
    DROP POLICY IF EXISTS "Professionals Access Scoped Patients v74" ON public.patients;
    DROP POLICY IF EXISTS "Professionals Access Scoped Patients v77" ON public.patients;

    -- Atama
    DROP POLICY IF EXISTS "Assignment Visibility v80" ON public.patient_assignments;
    DROP POLICY IF EXISTS "Assignment Visibility v79" ON public.patient_assignments;
    DROP POLICY IF EXISTS "Patient Assignment Management v74" ON public.patient_assignments;

    -- 2. YENİ SADE VE GÜÇLÜ KURALLAR (Döngü Sıfır)
    
    -- A. PROFİLLER: Personel HERKESİ Görebilir, Hasta KENDİNİ Görebilir.
    CREATE POLICY "Staff Global Profile View v86" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'doctor', 'dietitian')
        OR id = auth.uid()
    );

    -- B. HASTALAR: Personel HERKESİ Görebilir. (Klinik geneli context için)
    CREATE POLICY "Staff Global Patient View v86" ON public.patients
    FOR SELECT TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'doctor', 'dietitian')
        OR id = auth.uid()
        OR user_id = auth.uid() -- Backwards compatibility
    );

    -- C. ATAMALAR: Personel tüm atamaları görebilmeli. (Sorumluluk rozeti için gerekli)
    CREATE POLICY "Staff Global Assignment View v86" ON public.patient_assignments
    FOR SELECT TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'doctor', 'dietitian')
    );

    RAISE NOTICE 'v86 Sabitleme Uygulandı. Sayfayı yenileyin.';
END $$;
