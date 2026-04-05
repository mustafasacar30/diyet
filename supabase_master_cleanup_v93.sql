-- SUPABASE MASTER CLEANUP - v93
-- TÜM BAĞIMLILIK HATALARINI GİDERİR VE SİSTEMİ HIZLANDIRIR

DO $$ 
BEGIN
    -- 1. ESKİ FONKSİYONU VE ONA BAĞLI TÜM POLİTİKALARI ZİNCİRLEME SİL (CASCADE)
    -- HINT: Bu adım 'Restriction Access' gibi takılan tüm politikaları otomatik temizler.
    DROP FUNCTION IF EXISTS public.can_current_user_access_patient(uuid) CASCADE;

    -- 2. YENİ, HIZLANDIRILMIŞ VE GÜVENLİ FONKSİYONU OLUŞTUR
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

    -- 3. PERFORMANS İNDEKSLERİ (Aramayı milisaniyelere indirir)
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_patient_assignments_dietitian') THEN
        CREATE INDEX idx_patient_assignments_dietitian ON public.patient_assignments(dietitian_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_team_members_supervisor') THEN
        CREATE INDEX idx_team_members_supervisor ON public.team_members(supervisor_id);
    END IF;

    -- 4. ANA TABLOLAR İÇİN GÜVENLİK POLİTİKALARI (v93)
    
    -- Profil: Tüm staff görebilir (Döngüsüz, hızlı).
    DROP POLICY IF EXISTS "Staff Identity Full Access v93" ON public.profiles;
    CREATE POLICY "Staff Identity Full Access v93" ON public.profiles FOR SELECT TO authenticated USING (true);

    -- Hastalar: Seçici erişim (Admin=Hero, Doctor=Scoped).
    DROP POLICY IF EXISTS "Scoped Patient Access v93" ON public.patients;
    CREATE POLICY "Scoped Patient Access v93" ON public.patients FOR SELECT TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'is_global_access')::boolean = true
        OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR can_current_user_access_patient(id)
    );

    -- 5. DİĞER TABLOLARI YENİDEN KORUMA ALTINA AL (CASCADE ile silinenlerin yerine)
    -- Notlar, Ölçümler, Diyet Planları vb.
    
    -- Patient Notes
    DROP POLICY IF EXISTS "Note Security v93" ON public.patient_notes;
    CREATE POLICY "Note Security v93" ON public.patient_notes FOR ALL TO authenticated 
    USING (can_current_user_access_patient(patient_id));

    -- Patient Measurements
    DROP POLICY IF EXISTS "Measurement Security v93" ON public.patient_measurements;
    CREATE POLICY "Measurement Security v93" ON public.patient_measurements FOR ALL TO authenticated 
    USING (can_current_user_access_patient(patient_id));

    -- Diet Plans
    DROP POLICY IF EXISTS "Diet Plan Security v93" ON public.diet_plans;
    CREATE POLICY "Diet Plan Security v93" ON public.diet_plans FOR ALL TO authenticated 
    USING (can_current_user_access_patient(patient_id));

    RAISE NOTICE 'v93 Master Cleanup Tamamlandı. Sistem artık stabil ve hızlı.';
END $$;
