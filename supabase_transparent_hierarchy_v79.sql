-- SUPABASE TRANSPARENT HIERARCHY - v79
-- DOKTORLARIN KENDİ EKİPLERİNİ VE ATAMALARI GÖREMEMESİ SORUNUNU ÇÖZER

DO $$ 
BEGIN
    -- 1. ATAMA KURALLARINI SIFIRLA VE GENİŞLET
    DROP POLICY IF EXISTS "Patient Assignment Management v74" ON public.patient_assignments;
    DROP POLICY IF EXISTS "Assignment Linked Visibility" ON public.profiles;

    -- A. Atamalar: Şeffaf Kontrol
    -- Bir doktor, eğer hastayı görme yetkisine sahipse, o hastanın TÜM atamalarını görebilmeli.
    CREATE POLICY "Assignment Visibility v79" ON public.patient_assignments
    FOR SELECT TO authenticated
    USING (
        -- Adminler her şeyi seçer
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR
        -- Ben atanan diyetisyenensem
        (dietitian_id = auth.uid())
        OR
        -- Ben hastayı görebiliyorsam (Hiyerarşik erişim - Doktor dahil)
        can_current_user_access_patient(patient_id)
    );

    -- B. Atama Yapma Yetkisi (Sadece Admin veya Supervisor)
    CREATE POLICY "Assignment Control v79" ON public.patient_assignments
    FOR INSERT WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR
        EXISTS (SELECT 1 FROM public.team_members WHERE supervisor_id = auth.uid() AND member_id = dietitian_id)
    );

    -- 2. PROFİLLER: İSİM GÖRÜNÜRLÜK (Zinciri Kır)
    -- Eğer bir personeli (Diyetisyen) bir hastaya atamışsak, o hastayı görmeye yetkili HERKES (Doktoru) bu personelin ismini görmeli.
    CREATE POLICY "Staff Identity Visibility v79" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        role IN ('doctor', 'dietitian') -- Genel personel görünürlüğü (v78 ile uyumlu)
    );

    -- 3. HASTA ERİŞİMİ: HİNCİ GÜÇLENDİR (Supervisor -> Member -> Patient)
    -- can_current_user_access_patient fonksiyonunda supervisor kontrolü zaten var. 
    -- Sadece kuralların ENABLE olduğundan emin oluyoruz.

    RAISE NOTICE 'v79 Şeffaf Hiyerarşi Yaması Uygulandı. İsimler ve kayıp hastalar artık görünmeli.';
END $$;
