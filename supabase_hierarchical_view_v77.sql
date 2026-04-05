-- SUPABASE HIERARCHICAL VIEW - v77
-- DİYETİSYEN İSİMLERİNİN GÖRÜNMESİNİ SAĞLAR VE EKİP BAĞINI GÜÇLENDİRİR

DO $$ 
BEGIN
    -- 1. ESKİ YETERSİZ POLİTİKALARI TEMİZLE
    DROP POLICY IF EXISTS "Doctor Team View" ON public.profiles;
    DROP POLICY IF EXISTS "Dietitian Supervisor View" ON public.profiles;
    DROP POLICY IF EXISTS "Profile Patient Team View" ON public.profiles;
    DROP POLICY IF EXISTS "Profile Global View" ON public.profiles;

    -- 2. PROFİLLER: AKILLI GÖRÜNÜRLÜK (Smart Visibility)

    -- A. Admin/Global: Her şeyi görsün
    CREATE POLICY "Profile Admin Full View" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role = 'admin' OR is_global_access = true))
    );

    -- B. Ekip İçi Görünürlük: Doktor diyetisyenini, Diyetisyen doktorunu görsün
    CREATE POLICY "Team Member Visibility" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        id = auth.uid() OR
        EXISTS (SELECT 1 FROM public.team_members WHERE (supervisor_id = auth.uid() AND member_id = public.profiles.id) OR (member_id = auth.uid() AND supervisor_id = public.profiles.id))
    );

    -- C. Atama Bazlı Görünürlük: (KRİTİK)
    -- Bir hasta listesinde diyetisyen isminin görünmesi için:
    -- Eğer ben o hastayı görmeye yetkili biriysem (Doktor/Diyetisyen), o hastaya atanmış diyetisyenin PROFİLİNİ (İsim/Avatar) görebilmeliyim.
    CREATE POLICY "Assignment Linked Visibility" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.patient_assignments pa
            WHERE (pa.dietitian_id = public.profiles.id) -- Hedef profil bir diyetisyen ise
            AND can_current_user_access_patient(pa.patient_id) -- Ve ben o hastayı görebiliyorsam
        )
    );

    -- D. Hasta Görünürlüğü (Kendi takımımdaki hastaları görreyim)
    CREATE POLICY "Patient Profile Visibility" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        role = 'patient' AND can_current_user_access_patient(id)
    );

    RAISE NOTICE 'v77 Hiyerarşik Görünürlük Tamamlandı. İsimler artık görünür olmalı.';
END $$;
