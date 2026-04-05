-- SUPABASE SECURITY PATCH - v74
-- FIX: HASTA ATAMA HATASINI VE GÖRÜNÜRLÜK SORUNUNU GİDERİR

DO $$ 
BEGIN
    -- 1. ESKİ ATAMA POLİTİKASINI SİL
    DROP POLICY IF EXISTS "Admin/Supervisor Management" ON public.patient_assignments;
    DROP POLICY IF EXISTS "Public Access" ON public.patient_assignments;

    -- 2. YENİ, DAHA SAĞLAM ATAMA POLİTİKASI (Supervisor ve Admin yetkisi)
    -- Bu kural hem INSERT hem UPDATE hem SELECT için geçerlidir
    CREATE POLICY "Patient Assignment Management v74" ON public.patient_assignments
    FOR ALL TO authenticated
    USING (
        -- Admin ise her şeyi yapabilsin
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
        OR
        -- Doktor (Supervisor) ise, sadece KENDİ ekibindeki diyetisyeni atayabilsin
        EXISTS (
            SELECT 1 FROM public.team_members 
            WHERE supervisor_id = auth.uid() 
            AND member_id = dietitian_id
        )
        OR
        -- Diyetisyen ise, sadece KENDİSİNİN atandığı satırları görebilsin/güncelleyebilsin
        (dietitian_id = auth.uid())
    );

    -- 3. HASTALAR TABLOSU İÇİN EK KONTROL (Erişim kuralını tazele)
    DROP POLICY IF EXISTS "Strict Hierarchy View" ON public.patients;
    CREATE POLICY "Strict Hierarchy View v74" ON public.patients
    FOR ALL TO authenticated
    USING (can_current_user_access_patient(id));

    RAISE NOTICE 'v74 Güvenlik Yaması Başarıyla Uygulandı.';
END $$;
