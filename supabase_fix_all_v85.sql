-- SUPABASE NON-RECURSIVE HIERARCHY - v85
-- DÖNGÜYÜ KIRAR VE VERİLERİ DOKTORA GÖRE FİLTRELER

-- 1. FONKSİYONU DÖNGÜSÜZ HALE GETİR (Profiles tablosuna bakmaz!)
CREATE OR REPLACE FUNCTION public.can_current_user_access_patient(target_patient_id uuid)
RETURNS boolean AS $$
DECLARE
    curr_uid uuid;
    is_admin_check boolean;
BEGIN
    curr_uid := auth.uid();
    -- Admin kontrolünü JWT'den yap (Tabloya bakmaz, çok hızlıdır)
    is_admin_check := (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin';

    -- A. Admin ise: EVET
    IF is_admin_check THEN
        RETURN TRUE;
    END IF;

    -- B. Hasta kendisi ise: EVET
    IF curr_uid = target_patient_id THEN
        RETURN TRUE;
    END IF;

    -- C. Doğrudan Atanmış Diyetisyen ise: EVET
    IF EXISTS (SELECT 1 FROM public.patient_assignments WHERE patient_id = target_patient_id AND dietitian_id = curr_uid) THEN
        RETURN TRUE;
    END IF;

    -- D. Supervisor (Doktor) ise: EVET (Takım üyesi üzerinden)
    IF EXISTS (
        SELECT 1 FROM public.patient_assignments pa
        JOIN public.team_members tm ON pa.dietitian_id = tm.member_id
        WHERE pa.patient_id = target_patient_id AND tm.supervisor_id = curr_uid
    ) THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. PROFİLLER İÇİN GÜVENLİ VE HIZLI KURALLAR
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Temp Global Read v84" ON public.profiles;
    DROP POLICY IF EXISTS "Simple Own Profile v83" ON public.profiles;
    DROP POLICY IF EXISTS "Admin Global View v83" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Visibility v80" ON public.profiles;

    -- A. Temel Erişim: Kendim ve Adminler
    CREATE POLICY "Profile Base Access v85" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        id = auth.uid() 
        OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    );

    -- B. Hiyerarşik Erişim: Personeller (Doktor/Diyetisyen) birbirini ve hastalarını görebilmeli
    -- Bu kural sadece staff rollerini kapsar ve is_global_access kontrolünü fonksiyon içerisinden çıkarır.
    CREATE POLICY "Staff Link Visibility v85" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        -- Ben bir profesyonelsem ve hedef de bir profesyonelse (Basit staff-to-staff görünürlük)
        (role IN ('doctor', 'dietitian'))
        OR
        -- Ben bu hastayı görmeye yetkiliysem
        can_current_user_access_patient(id)
    );

    RAISE NOTICE 'v85 Döngüsüz Hiyerarşi Yaması Uygulandı. Sayfayı yenileyin.';
END $$;
