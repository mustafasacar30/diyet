-- SUPABASE ADMIN VISIBILITY SYNC - v82
-- KULLANICI LİSTESİNDE KALKANIN GÖRÜNMESİNİ VE YETKİLERİN SENKRONİZE OLMASINI SAĞLAR

DO $$ 
BEGIN
    -- 1. KULLANICI YÖNETİM GÖRÜNÜMÜNÜ GÜNCELLE (Add is_global_access to View)
    -- Mevcut view'i siliyor ve is_global_access sütununu içerecek şekilde yeniden oluşturuyoruz.
    DROP VIEW IF EXISTS public.user_management_view;
    
    CREATE VIEW public.user_management_view AS
    SELECT 
        p.id,
        p.full_name,
        p.role,
        p.title,
        p.is_global_access,
        p.created_at,
        p.valid_until,
        u.email
    FROM public.profiles p
    LEFT JOIN auth.users u ON p.id = u.id;

    -- View yetkilerini ver
    GRANT SELECT ON public.user_management_view TO authenticated;

    RAISE NOTICE 'v82 Senkronizasyon Tamamlandı. Kalkanlar artık görünmeli.';
END $$;
