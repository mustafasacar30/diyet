-- SUPABASE ADMIN REFRESH - v87
-- DOKTOR 1 YÖNETİCİ YETKİSİNİ TAZELER

DO $$ 
DECLARE
    target_id uuid;
BEGIN
    -- 1. Hedef Doktorun ID'sini bul (Örn: doktor1@demo.com)
    SELECT id INTO target_id FROM auth.users WHERE email = 'doktor1@demo.com';

    IF target_id IS NOT NULL THEN
        -- 2. Yetkiyi Kesinleştir
        UPDATE public.profiles 
        SET is_global_access = true,
            role = 'doctor'
        WHERE id = target_id;
        
        RAISE NOTICE 'Doktor 1 Admin Yetkisi (is_global_access) Verildi.';
    ELSE
        RAISE NOTICE 'Doktor 1 bulunamadı. Lütfen e-postayı kontrol edin.';
    END IF;

    -- 3. Görünümü GÜNCELLE
    DROP VIEW IF EXISTS public.user_management_view;
    CREATE VIEW public.user_management_view AS
    SELECT p.id, p.full_name, p.role, p.title, p.is_global_access, p.created_at, p.valid_until, u.email
    FROM public.profiles p
    LEFT JOIN auth.users u ON p.id = u.id;
    GRANT SELECT ON public.user_management_view TO authenticated;
END $$;
