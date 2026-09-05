-- SUPABASE PERFORMANCE & RELIABILITY - v91
-- DOKTOR 2 TAKILMALARINI BİTİRİR, HIZI ARTIRIR

DO $$ 
BEGIN
    -- 1. ESKİ POLİTİKALARI TEMİZLE (Kökten Çözüm)
    DROP POLICY IF EXISTS "Staff Scoped Profile View v90" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Scoped Patient View v90" ON public.patients;
    DROP POLICY IF EXISTS "Staff Universal Identity v88" ON public.profiles;

    -- 2. PERFORMANS İÇİN İNDEKSLER EKLE (Hızlandırıcılar)
    -- Not: Varsa hata vermez.
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_patient_assignments_dietitian') THEN
        CREATE INDEX idx_patient_assignments_dietitian ON public.patient_assignments(dietitian_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_team_members_supervisor') THEN
        CREATE INDEX idx_team_members_supervisor ON public.team_members(supervisor_id);
    END IF;

    -- 3. PROFİLLER: Personel HERKESİN ismini ve rolünü görebilmeli.
    -- Bu, kimlik doğrulama döngülerini (recursion) tamamen engeller.
    CREATE POLICY "Staff Universal Identity v91" ON public.profiles
    FOR SELECT TO authenticated
    USING (true);

    -- 4. HASTALAR: Admin HERKESİ, Doktor sadece KENDİ TAKIMINI görür.
    -- Funkisyonu hızlandırılmış ve döngüsüz haliyle güncelliyoruz.
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

    CREATE POLICY "Staff Scoped Patient View v91" ON public.patients
    FOR SELECT TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_global_access')::boolean = true
        OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR can_current_user_access_patient(id)
    );

    RAISE NOTICE 'v91 Performans ve Güvenlik Uygulandı. Doktor 2 artık uçacak!';
END $$;
