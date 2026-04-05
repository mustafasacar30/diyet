-- SUPABASE NUKE & LOCK SECURITY - v73
-- TÜM GİZLİ VE ESKİ POLİTİKALARI İSİM BAĞIMSIZ SİLER VE KİLİTLER

DO $$ 
DECLARE 
    pol_record RECORD;
BEGIN
    -- 1. TÜM TABLOLARDAKİ TÜM POLİTİKALARI DİNAMİK OLARAK SİL (Nuke Everything)
    FOR pol_record IN (
        SELECT policyname, tablename 
        FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename IN ('patients', 'profiles', 'patient_assignments', 'diet_plans', 'diet_weeks')
    ) 
    LOOP 
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(pol_record.policyname) || ' ON public.' || quote_ident(pol_record.tablename); 
    END LOOP;

    -- 2. RLS'Yİ YENİDEN ZORUNLU KIL (Enforce RLS)
    ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.patient_assignments ENABLE ROW LEVEL SECURITY;

    -- 3. HASTALAR: TAM HİYERARŞİ (Görmen gerekiği kadarını gör)
    CREATE POLICY "Strict Hierarchy View" ON public.patients
    FOR ALL TO authenticated
    USING (can_current_user_access_patient(id));

    -- 4. PROFİLLER: TAM HİYERARŞİ (Dashboard istatistikleri ve isimler için)
    -- Herkes kendi profilini görebilir
    CREATE POLICY "Profiles Own Access" ON public.profiles
    FOR SELECT TO authenticated
    USING (auth.uid() = id);

    -- Adminler tüm profilleri görebilir
    CREATE POLICY "Admin Global Profile View" ON public.profiles
    FOR SELECT TO authenticated
    USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

    -- Doktorlar/Diyetisyenler sadece YETKİLİ oldukları hastaların profilini görebilir (SADECE ONLARIN SAYISI ÇIKAR)
    CREATE POLICY "Professional Restricted Profile View" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') IN ('doctor', 'dietitian') AND
        can_current_user_access_patient(id)
    );

    -- 5. DİĞER PROFESYONELLERİ GÖRME (Doktor-Diyetisyen birbirini görmeli)
    CREATE POLICY "Staff Visibility" ON public.profiles
    FOR SELECT TO authenticated
    USING (role IN ('doctor', 'dietitian'));

    -- 6. GÜVENLİK KONTROLÜ
    UPDATE public.profiles SET is_global_access = false WHERE role = 'doctor';

    RAISE NOTICE 'Sistemdeki tüm açık kapılar kapatıldı ve kilitlendi.';
END $$;
