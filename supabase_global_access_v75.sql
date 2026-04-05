-- SUPABASE STICK TEAM HIERARCHY - v75
-- NORMAL DOKTORLARIN DİĞER EKİPLERİ GÖRMESİNİ ENGELLER

DO $$ 
BEGIN
    -- 1. ESKİ STAFF GÖRÜNÜRLÜĞÜNÜ SİL (Nuke Staff Visibility)
    DROP POLICY IF EXISTS "Staff Visibility" ON public.profiles;
    DROP POLICY IF EXISTS "Professional View" ON public.profiles;
    DROP POLICY IF EXISTS "Professional Restricted Profile View" ON public.profiles;
    DROP POLICY IF EXISTS "Profiles Own Access" ON public.profiles;
    DROP POLICY IF EXISTS "Admin Global Profile View" ON public.profiles;
    DROP POLICY IF EXISTS "Team Visibility" ON public.profiles;

    -- 2. PROFİLLER: YENİ SIKI HİYERARŞİ (Profiles Hierarchy)
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

    -- A. Herkes Kendi Profilini Görsün
    CREATE POLICY "Profile Self View" ON public.profiles
    FOR SELECT TO authenticated
    USING (auth.uid() = id);

    -- B. Adminler ve Global Yetkili Doktorlar HER ŞEYİ Görsün
    CREATE POLICY "Profile Global View" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() 
            AND (role = 'admin' OR is_global_access = true)
        )
    );

    -- C. Normal Doktor/Diyetisyen Sadece KENDİ EKİBİNİ Görsün
    -- Doktor, kendi ekibindeki diyetisyenleri görebilir
    CREATE POLICY "Doctor Team View" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.team_members 
            WHERE supervisor_id = auth.uid() 
            AND member_id = public.profiles.id
        )
    );

    -- Diyetisyen, kendi bağlı olduğu doktoru (supervisor) görebilir
    CREATE POLICY "Dietitian Supervisor View" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.team_members 
            WHERE member_id = auth.uid() 
            AND supervisor_id = public.profiles.id
        )
    );

    -- D. Profesyoneller Kendi Yetkili Oldukları HASTALARI Görsün
    -- can_current_user_access_patient fonksiyonunu kullanarak hastaları görebilirler
    CREATE POLICY "Profile Patient Team View" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        role = 'patient' AND can_current_user_access_patient(id)
    );

    RAISE NOTICE 'v75 Takım Hiyerarşisi Kilidi Başarıyla Uygulandı.';
END $$;
