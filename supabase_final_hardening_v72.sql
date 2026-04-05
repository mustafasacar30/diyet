-- SUPABASE FINAL SECURITY HARDENING - v72
-- TÜM AÇIKLARI KAPATAN VE HİYERARŞİYİ ZORUNLU KILAN FİNAL SÜRÜM

DO $$ 
BEGIN
    -- 1. ESKİ TÜM AÇIK POLİTİKALARI TEMİZLE (Nuke Old Policies)
    DROP POLICY IF EXISTS "Public Access" ON public.patients;
    DROP POLICY IF EXISTS "Restricted Access" ON public.patients;
    DROP POLICY IF EXISTS "Public Access" ON public.profiles;
    DROP POLICY IF EXISTS "Public Access" ON public.patient_assignments;

    -- 2. PATIENTS: SIKILAŞTIRMA
    ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Hierarchy Access" ON public.patients
    FOR ALL TO authenticated
    USING (can_current_user_access_patient(id));

    -- 3. PROFILES: SIKILAŞTIRMA (Dashboard sayıları için profesyonellere okuma izni)
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    
    -- Herkes kendi profilini görebilir
    CREATE POLICY "Own Profile" ON public.profiles 
    FOR SELECT TO authenticated 
    USING (auth.uid() = id);

    -- Profesyoneller (Admin, Doctor, Dietitian) tüm profilleri (Sadece SELECT) görebilir (Sayılar için şart)
    CREATE POLICY "Professional View" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'doctor', 'dietitian')
    );

    -- 4. ASSIGNMENTS: SIKILAŞTIRMA
    ALTER TABLE public.patient_assignments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Admin/Supervisor Management" ON public.patient_assignments
    FOR ALL TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' OR
        EXISTS (SELECT 1 FROM public.team_members WHERE supervisor_id = auth.uid() AND member_id = dietitian_id)
    );

    -- 5. DOKTOR 2 GÜVENLİK KONTROLÜ (Global yetkisi varsa geri alalım)
    UPDATE public.profiles SET is_global_access = false WHERE full_name ILIKE '%doktor2%';

    RAISE NOTICE 'Sistem başarıyla TAM KORUMA (Hardening) moduna alındı.';
END $$;
