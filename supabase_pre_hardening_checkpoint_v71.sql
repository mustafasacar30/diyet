-- SUPABASE SECURITY ROLLBACK - v71
-- ACİL DURUM: TÜM SİSTEMİ AÇIK ERİŞİME DÖNDÜRÜR

DO $$ 
BEGIN
    -- 1. Patients: Herkes görsün (authenticated)
    DROP POLICY IF EXISTS "Restricted Access" ON public.patients;
    DROP POLICY IF EXISTS "Public Access" ON public.patients;
    CREATE POLICY "Public Access" ON public.patients FOR ALL TO authenticated USING (true);

    -- 2. Profiles: Herkes görsün
    DROP POLICY IF EXISTS "Profiles are readable by authenticated" ON public.profiles;
    CREATE POLICY "Public Access" ON public.profiles FOR ALL TO authenticated USING (true);

    -- 3. Assignments: Herkes görsün
    DROP POLICY IF EXISTS "Admins can manage all assignments" ON public.patient_assignments;
    CREATE POLICY "Public Access" ON public.patient_assignments FOR ALL TO authenticated USING (true);

    RAISE NOTICE 'Sistem başarıyla AÇIK ERİŞİM moduna döndürüldü.';
END $$;
