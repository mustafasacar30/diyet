-- SUPABASE SECURITY ROLLBACK - v76
-- SİSTEMİ BİR ÖNCEKİ (DOKTORLARIN BİRBİRİNİ GÖRDÜĞÜ) HALİNE DÖNDÜRÜR

DO $$ 
BEGIN
    -- 1. Görünürlüğü Geri Getir (Herkes profesyonelleri görsün)
    DROP POLICY IF EXISTS "Team Visibility" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Visibility" ON public.profiles;
    
    CREATE POLICY "Staff Visibility" ON public.profiles
    FOR SELECT TO authenticated
    USING (role IN ('doctor', 'dietitian'));

    RAISE NOTICE 'Sistem bir önceki çalışan (v74/v73) haline döndürüldü.';
END $$;
