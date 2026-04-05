-- SUPABASE STRONG FORCE RESET - v84
-- TÜM PROFİL KİLİTLERİNİ GEÇİCİ OLARAK AÇAR VE YÜKLEME SORUNUNU BİTİRİR

DO $$ 
BEGIN
    -- 1. TÜM MEVCUT PROFİL KURALLARINI SİL
    DROP POLICY IF EXISTS "Simple Own Profile v83" ON public.profiles;
    DROP POLICY IF EXISTS "Admin Global View v83" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Visibility v80" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Visibility v78" ON public.profiles;
    DROP POLICY IF EXISTS "Global Profile View" ON public.profiles;
    DROP POLICY IF EXISTS "Admin Global Profile View" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Identity Visibility v79" ON public.profiles;

    -- 2. GEÇİCİ OLARAK RLS'İ DURDUR (TEST AMAÇLI)
    -- VEYA HERKESE TAM OKUMA İZNİ VER (DAHA GÜVENLİ TEST)
    CREATE POLICY "Temp Global Read v84" ON public.profiles
    FOR SELECT TO authenticated
    USING (true);

    RAISE NOTICE 'v84 Kuvvetli Sıfırlama Uygulandı. Sayfayı yenileyin.';
END $$;
