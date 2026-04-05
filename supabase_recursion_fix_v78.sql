-- SUPABASE RECURSION FIX - v78 (GÜNCELLENDİ)
-- SAYFALARIN AÇILMASINI ENGELLEYEN SONSUZ DÖNGÜYÜ VE "ALREADY EXISTS" HATASINI ÇÖZER

DO $$ 
BEGIN
    -- 1. TÜM POTANSİYEL ÇAKIŞAN KURALLARI TEMİZLE (Nuke Conflicting Policies)
    DROP POLICY IF EXISTS "Admin Global Profile View" ON public.profiles;
    DROP POLICY IF EXISTS "Assignment Linked Visibility" ON public.profiles;
    DROP POLICY IF EXISTS "Team Member Visibility" ON public.profiles;
    DROP POLICY IF EXISTS "Profile Patient Team View" ON public.profiles;
    DROP POLICY IF EXISTS "Patient Profile Visibility" ON public.profiles;
    DROP POLICY IF EXISTS "Profile Admin Full View" ON public.profiles;
    DROP POLICY IF EXISTS "Team Visibility" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Visibility" ON public.profiles;

    -- 2. PROFİLLER İÇİN GÜVENLİ VE DİREKT KURALLAR (Döngü Yok)
    
    -- A. Adminler her şeyi görsün (Direct JWT Check)
    CREATE POLICY "Admin Global Profile View" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    );

    -- B. Profesyoneller Birbirini Görsün (Staff Visibility)
    CREATE POLICY "Staff Visibility v78" ON public.profiles
    FOR SELECT TO authenticated
    USING (role IN ('doctor', 'dietitian'));

    -- C. Kendi Profilime Erişim
    CREATE POLICY "Self Profile View v78" ON public.profiles
    FOR SELECT TO authenticated
    USING (auth.uid() = id);

    -- D. Hastaları Gör (Sadece ekipteysen)
    CREATE POLICY "Patient List View v78" ON public.profiles
    FOR SELECT TO authenticated
    USING (role = 'patient' AND can_current_user_access_patient(id));

    RAISE NOTICE 'v78 Güncellenmiş Kurtarma Yaması Uygulandı. Sayfalar açılmalı.';
END $$;
