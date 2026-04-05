-- rollback v105: remove program-scoped diet type override layer

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.program_diet_type_overrides') IS NOT NULL THEN
        EXECUTE 'DROP TRIGGER IF EXISTS trg_program_diet_type_overrides_updated_at ON public.program_diet_type_overrides';
    END IF;
END $$;

DROP FUNCTION IF EXISTS public.set_program_diet_type_overrides_updated_at();

DROP TABLE IF EXISTS public.program_diet_type_overrides CASCADE;

COMMIT;

NOTIFY pgrst, 'reload schema';
