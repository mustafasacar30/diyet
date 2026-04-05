-- SUPABASE HIERARCHY REPAIR - v80
-- KESİN ÇÖZÜM: KAYIP HASTALAR VE BOŞ DİYETİSYEN İSİMLERİ İÇİN

-- 1. Hiyerarşi Fonksiyonunu Yeniden Yaz (Supervisor -> Member -> Patient)
CREATE OR REPLACE FUNCTION public.can_current_user_access_patient(target_patient_id uuid)
RETURNS boolean AS $$
DECLARE
    curr_uid uuid;
    curr_role text;
    curr_is_global boolean;
BEGIN
    curr_uid := auth.uid();
    
    -- Kullanıcı profilini al
    SELECT role, is_global_access INTO curr_role, curr_is_global 
    FROM public.profiles WHERE id = curr_uid;

    -- A. Admin veya Global Erişim: HER ŞEYE İZİN VER
    IF curr_role = 'admin' OR curr_is_global = TRUE THEN
        RETURN TRUE;
    END IF;

    -- B. Hasta Kendisi: İZİN VER
    IF curr_uid = target_patient_id THEN
        RETURN TRUE;
    END IF;

    -- C. Diyetisyen: Kendisine Atanan Hastayı Görsün
    IF EXISTS (SELECT 1 FROM public.patient_assignments WHERE patient_id = target_patient_id AND dietitian_id = curr_uid) THEN
        RETURN TRUE;
    END IF;

    -- D. Doktor (Supervisor): Kendisine bağlı diyetisyenlerin hastalarını görsün
    -- "Doktor -> Takım Üyesi Diyetisyen -> Atanan Hasta" bağı burada kurulur.
    IF EXISTS (
        SELECT 1 FROM public.patient_assignments pa
        JOIN public.team_members tm ON pa.dietitian_id = tm.member_id
        WHERE pa.patient_id = target_patient_id AND tm.supervisor_id = curr_uid
    ) THEN
        RETURN TRUE;
    END IF;

    -- Varsayılan: ERİŞİM YOK
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. POLİTİKALARI YETERLİ HALE GETİR
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Staff Visibility v78" ON public.profiles;
    DROP POLICY IF EXISTS "Assignment Visibility v79" ON public.patient_assignments;
    DROP POLICY IF EXISTS "Staff Identity Visibility v79" ON public.profiles;

    -- A. Profesyonel Profil Görünürlüğü (İsimlerin dolması için)
    -- Tüm doktorlar ve diyetisyenler birbirinin profilini (isimlerini) her zaman görebilmeli.
    CREATE POLICY "Staff Visibility v80" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        role IN ('doctor', 'dietitian')
        OR id = auth.uid()
    );

    -- B. Atama Görünürlüğü (Diyetisyen sütununun dolması için)
    -- Ben hastayı görmeye yetkili isem, kimin atandığını da görmeliyim.
    CREATE POLICY "Assignment Visibility v80" ON public.patient_assignments
    FOR SELECT TO authenticated
    USING (
        can_current_user_access_patient(patient_id)
    );

    RAISE NOTICE 'v80 Hiyerarşi Onarımı Tamamlandı. Lütfen sayfayı yenileyip kontrol edin.';
END $$;
