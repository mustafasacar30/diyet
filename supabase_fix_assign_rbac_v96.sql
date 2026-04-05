-- SUPABASE RBAC ASSIGN FIX - v96
-- Admin rolüne ek olarak, is_global_access (Doktor 1 gibi süper yetkililere) yetkisi bulunanların da atama yapabilmesini sağlar.

DO $$ 
BEGIN
    -- DROP EXISTING POLICIES
    DROP POLICY IF EXISTS "Supervisors can manage their team" ON public.team_members;
    DROP POLICY IF EXISTS "Staff manage team" ON public.team_members;
    
    -- team_members update (Add is_global_access)
    CREATE POLICY "Staff manage team v96" ON public.team_members
    FOR ALL TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR (auth.jwt() -> 'user_metadata' ->> 'is_global_access')::boolean = true
        OR auth.uid() = supervisor_id
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR (auth.jwt() -> 'user_metadata' ->> 'is_global_access')::boolean = true
        OR auth.uid() = supervisor_id
    );

    -- DROP EXISTING POLICIES
    DROP POLICY IF EXISTS "Dietitians can manage assignments" ON public.patient_assignments;
    DROP POLICY IF EXISTS "Staff manage assignments" ON public.patient_assignments;

    -- patient_assignments update (Add is_global_access)
    CREATE POLICY "Staff manage assignments v96" ON public.patient_assignments
    FOR ALL TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR (auth.jwt() -> 'user_metadata' ->> 'is_global_access')::boolean = true
        OR auth.uid() = dietitian_id
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR (auth.jwt() -> 'user_metadata' ->> 'is_global_access')::boolean = true
        OR auth.uid() = dietitian_id
    );

    RAISE NOTICE 'v96 RBAC Assignment Fix Tamamlandı. Süper yetkili Doktorlar da artık atama yapabilir.';
END $$;
