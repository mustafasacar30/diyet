-- SUPABASE RBAC ASSIGN FIX - v95
-- ATAMA EKRANINDAKI (team_members VE patient_assignments) RLS (403) HATALARINI ÇÖZER

DO $$ 
BEGIN
    -- team_members update
    DROP POLICY IF EXISTS "Supervisors can manage their team" ON public.team_members;
    DROP POLICY IF EXISTS "Staff manage team" ON public.team_members;
    
    CREATE POLICY "Staff manage team" ON public.team_members
    FOR ALL TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR auth.uid() = supervisor_id
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR auth.uid() = supervisor_id
    );

    -- patient_assignments update
    DROP POLICY IF EXISTS "Dietitians can manage assignments" ON public.patient_assignments;
    DROP POLICY IF EXISTS "Staff manage assignments" ON public.patient_assignments;

    CREATE POLICY "Staff manage assignments" ON public.patient_assignments
    FOR ALL TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR auth.uid() = dietitian_id
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR auth.uid() = dietitian_id
    );

    RAISE NOTICE 'v95 RBAC Assignment Fix Tamamlandı. Atamalar artık başarılı şekilde çalışacaktır.';
END $$;
