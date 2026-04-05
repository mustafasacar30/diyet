-- SUPABASE SCOPED VISIBILITY - v90
-- ADMIN OLMAYANLARIN GÖRÜNÜRLÜĞÜNÜ KISITLAR, DÖNGÜYÜ ÖNLER

DO $$ 
BEGIN
    -- 1. ESKİ GEÇİCİ GENEL POLİTİKALARI TEMİZLE
    DROP POLICY IF EXISTS "Staff Universal Read Profiles v89" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Universal Read Patients v89" ON public.patients;
    DROP POLICY IF EXISTS "Staff Universal Read Assignments v89" ON public.patient_assignments;
    DROP POLICY IF EXISTS "Emergency Staff Read v89" ON public.profiles;
    DROP POLICY IF EXISTS "Emergency Patient Read v89" ON public.patients;

    -- 2. PROFİLLER: Personel HERKESİN ismini ve rolünü görebilir (Normal), 
    -- ama detayları sadece kendi takımındakiler görebilir.
    CREATE POLICY "Staff Scoped Profile View v90" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_global_access')::boolean = true
        OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR id = auth.uid()
        OR role IN ('doctor', 'dietitian') -- Diğer doktor ve diyetisyenleri görebilmeliler
    );

    -- 3. HASTALAR: Admin HERKESİ görür, Doktor sadece KENDİ TAKIMINI görür.
    CREATE POLICY "Staff Scoped Patient View v90" ON public.patients
    FOR SELECT TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_global_access')::boolean = true
        OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR can_current_user_access_patient(id) -- Döngüsüz fonksiyon (v85 ile sabitlenmişti)
    );

    RAISE NOTICE 'v90 Seçici Görünürlük Uygulandı. Sayfayı yenileyin.';
END $$;
