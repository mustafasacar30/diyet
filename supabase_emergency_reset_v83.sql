-- SUPABASE EMERGENCY RLS RESET - v83
-- YÜZDE 94 TAKILMA SORUNUNU ÇÖZMEK İÇİN PROFİL KURALLARINI SADELEŞTİRİR

DO $$ 
BEGIN
    -- 1. PROFİL TABLOSUNDAKİ TÜM KARMAŞIK KURALLARI TEMİZLE
    -- Döngüye sebep olabilecek personeller arası görünürlük kurallarını siliyoruz.
    DROP POLICY IF EXISTS "Staff Visibility v80" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Visibility v78" ON public.profiles;
    DROP POLICY IF EXISTS "Global Profile View" ON public.profiles;
    DROP POLICY IF EXISTS "Admin Global Profile View" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Identity Visibility v79" ON public.profiles;

    -- 2. EN BASİT VE GÜVENLİ KURALI EKLE
    -- "Herkes sadece kendi profilini görebilir" - Bu kural asla döngüye girmez ve en hızlısıdır.
    CREATE POLICY "Simple Own Profile v83" ON public.profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid());

    -- 3. EKSTRA: ADMİNLER HERKESİ GÖREBİLMELİ (Ama basit bir yöntemle)
    -- Role bazlı basit kontrol (Sorgu içinde sorgu yapmaz)
    CREATE POLICY "Admin Global View v83" ON public.profiles
    FOR SELECT TO authenticated
    USING ( (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' );

    RAISE NOTICE 'v83 Acil Durum Yaması Uygulandı. Sayfayı yenileyin.';
END $$;
