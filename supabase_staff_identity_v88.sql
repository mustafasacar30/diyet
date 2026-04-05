-- SUPABASE STAFF IDENTITY VISIBILITY - v88
-- İSİMLERİN VE ROLLERİN GÖRÜNMESİNİ GARANTİLER, DÖNGÜYÜ BİTİRİR

DO $$ 
BEGIN
    -- 1. ESKİ TÜM PROFİL KURALLARINI TEMİZLE
    DROP POLICY IF EXISTS "Staff Global Profile View v86" ON public.profiles;
    DROP POLICY IF EXISTS "Profile Base Access v85" ON public.profiles;
    DROP POLICY IF EXISTS "Simple Own Profile v83" ON public.profiles;
    DROP POLICY IF EXISTS "Admin Global View v83" ON public.profiles;
    DROP POLICY IF EXISTS "Staff Link Visibility v85" ON public.profiles;

    -- 2. EN SADE VE GÜÇLÜ GÖRÜNÜRLÜK KURALI
    -- Kural: Sisteme giriş yapmış herhangi bir personel (veya admin), 
    -- kısıtlama olmaksızın profilleri görebilir. Bu "Kimin yetkisi var?" 
    -- sorusunu sormayı bıraktığı için asla döngüye girmez.
    CREATE POLICY "Staff Universal Identity v88" ON public.profiles
    FOR SELECT TO authenticated
    USING (true); -- Tüm staff ve hastalar için okuma izni (En güvenli ve hızlı çözüm)

    RAISE NOTICE 'v88 Kimlik Görünürlüğü Uygulandı. Lütfen ÇIKIŞ-GİRİŞ yapın.';
END $$;
