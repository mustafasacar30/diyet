-- SUPABASE PERFORMANCE & RELIABILITY - v92 (Final Fix)
-- DOKTOR 2 TAKILMALARINI VE SQL HATASINI BİTİRİR

DO $$ 
BEGIN
    -- 1. ESKİ TÜM POLİTİKALARI TEMİZLE
    DROP POLICY IF EXISTS "Staff Scoped Patient View v91" ON public.patients;
    DROP POLICY IF EXISTS "Staff Scoped Patient View v90" ON public.patients;
    DROP POLICY IF EXISTS "Staff Universal Identity v91" ON public.profiles;

    -- 2. HATA ALAN FONKSİYONU SİL VE YENİDEN OLUŞTUR (target_patient_id hatasını çözer)
    -- Politika bağımlılıkları varsa diye politikayı önce uçurduk.
    DROP FUNCTION IF EXISTS public.can_current_user_access_patient(uuid);
    
    CREATE OR REPLACE FUNCTION public.can_current_user_access_patient(target_patient_id uuid)
    RETURNS boolean AS $inner$
    BEGIN
        RETURN EXISTS (
            SELECT 1 FROM public.patient_assignments pa
            WHERE pa.patient_id = target_patient_id
            AND (
                pa.dietitian_id = auth.uid()
                OR pa.dietitian_id IN (
                    SELECT member_id FROM public.team_members WHERE supervisor_id = auth.uid()
                )
            )
        );
    END;
    $inner$ LANGUAGE plpgsql SECURITY DEFINER;

    -- 3. HIZLANDIRICILAR (İndeksler)
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_patient_assignments_dietitian') THEN
        CREATE INDEX idx_patient_assignments_dietitian ON public.patient_assignments(dietitian_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_team_members_supervisor') THEN
        CREATE INDEX idx_team_members_supervisor ON public.team_members(supervisor_id);
    END IF;

    -- 4. YENİ POLİTİKALARI UYGULA
    -- Profiles: Tüm staff birbirinin ismini ve rolünü görebilir (Döngüsüz).
    CREATE POLICY "Staff Universal Identity v92" ON public.profiles
    FOR SELECT TO authenticated
    USING (true);

    -- Patients: Seçici ve hızlı erişim.
    CREATE POLICY "Staff Scoped Patient View v92" ON public.patients
    FOR SELECT TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_global_access')::boolean = true
        OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR can_current_user_access_patient(id)
    );

    RAISE NOTICE 'v92 Uygulandı. Doktor 2 artık sorunsuz açılacak.';
END $$;
