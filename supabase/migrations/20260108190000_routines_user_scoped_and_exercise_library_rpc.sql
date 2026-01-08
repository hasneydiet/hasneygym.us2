BEGIN;

-- ============================================================
-- 1) Restore routines to user-scoped ownership (user_id)
-- ============================================================

ALTER TABLE public.routines
  ADD COLUMN IF NOT EXISTS user_id uuid;

-- Backfill from created_by if present
UPDATE public.routines
SET user_id = created_by
WHERE user_id IS NULL AND created_by IS NOT NULL;

-- Default for new routines
ALTER TABLE public.routines
  ALTER COLUMN user_id SET DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS idx_routines_user_id ON public.routines(user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'routines_user_id_fkey'
  ) THEN
    ALTER TABLE public.routines
      ADD CONSTRAINT routines_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- 2) RLS: routines back to per-user (coach can see all)
-- ============================================================

-- Drop global routine policies
DROP POLICY IF EXISTS routines_read_all ON public.routines;
DROP POLICY IF EXISTS routines_insert_auth ON public.routines;
DROP POLICY IF EXISTS routines_update_owner_or_coach ON public.routines;
DROP POLICY IF EXISTS routines_delete_owner_or_coach ON public.routines;

CREATE POLICY routines_read_own
ON public.routines
FOR SELECT
USING (
  user_id = auth.uid()
  OR public.is_coach()
);

CREATE POLICY routines_insert_own
ON public.routines
FOR INSERT
WITH CHECK (
  (user_id = auth.uid() AND auth.role() = 'authenticated')
  OR public.is_coach()
);

CREATE POLICY routines_update_own
ON public.routines
FOR UPDATE
USING (user_id = auth.uid() OR public.is_coach())
WITH CHECK (user_id = auth.uid() OR public.is_coach());

CREATE POLICY routines_delete_own
ON public.routines
FOR DELETE
USING (user_id = auth.uid() OR public.is_coach());

-- ============================================================
-- 3) RLS: routine_days + routine_day_exercises follow routine ownership
-- ============================================================

-- Drop the global policies added in the global-library migration
DROP POLICY IF EXISTS routine_days_read_all ON public.routine_days;
DROP POLICY IF EXISTS routine_days_insert_owner_or_coach ON public.routine_days;
DROP POLICY IF EXISTS routine_days_update_owner_or_coach ON public.routine_days;
DROP POLICY IF EXISTS routine_days_delete_owner_or_coach ON public.routine_days;

DROP POLICY IF EXISTS routine_day_exercises_read_all ON public.routine_day_exercises;
DROP POLICY IF EXISTS routine_day_exercises_insert_owner_or_coach ON public.routine_day_exercises;
DROP POLICY IF EXISTS routine_day_exercises_update_owner_or_coach ON public.routine_day_exercises;
DROP POLICY IF EXISTS routine_day_exercises_delete_owner_or_coach ON public.routine_day_exercises;

-- routine_days
CREATE POLICY routine_days_read_own
ON public.routine_days
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.routines r
    WHERE r.id = routine_days.routine_id
      AND (r.user_id = auth.uid() OR public.is_coach())
  )
);

CREATE POLICY routine_days_insert_own
ON public.routine_days
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.routines r
    WHERE r.id = routine_days.routine_id
      AND (r.user_id = auth.uid() OR public.is_coach())
  )
);

CREATE POLICY routine_days_update_own
ON public.routine_days
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.routines r
    WHERE r.id = routine_days.routine_id
      AND (r.user_id = auth.uid() OR public.is_coach())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.routines r
    WHERE r.id = routine_days.routine_id
      AND (r.user_id = auth.uid() OR public.is_coach())
  )
);

CREATE POLICY routine_days_delete_own
ON public.routine_days
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.routines r
    WHERE r.id = routine_days.routine_id
      AND (r.user_id = auth.uid() OR public.is_coach())
  )
);

-- routine_day_exercises
CREATE POLICY routine_day_exercises_read_own
ON public.routine_day_exercises
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.routine_days rd
    JOIN public.routines r ON r.id = rd.routine_id
    WHERE rd.id = routine_day_exercises.routine_day_id
      AND (r.user_id = auth.uid() OR public.is_coach())
  )
);

CREATE POLICY routine_day_exercises_insert_own
ON public.routine_day_exercises
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.routine_days rd
    JOIN public.routines r ON r.id = rd.routine_id
    WHERE rd.id = routine_day_exercises.routine_day_id
      AND (r.user_id = auth.uid() OR public.is_coach())
  )
);

CREATE POLICY routine_day_exercises_update_own
ON public.routine_day_exercises
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.routine_days rd
    JOIN public.routines r ON r.id = rd.routine_id
    WHERE rd.id = routine_day_exercises.routine_day_id
      AND (r.user_id = auth.uid() OR public.is_coach())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.routine_days rd
    JOIN public.routines r ON r.id = rd.routine_id
    WHERE rd.id = routine_day_exercises.routine_day_id
      AND (r.user_id = auth.uid() OR public.is_coach())
  )
);

CREATE POLICY routine_day_exercises_delete_own
ON public.routine_day_exercises
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.routine_days rd
    JOIN public.routines r ON r.id = rd.routine_id
    WHERE rd.id = routine_day_exercises.routine_day_id
      AND (r.user_id = auth.uid() OR public.is_coach())
  )
);

-- ============================================================
-- 4) Coach import/export should target ONLY the shared exercise library
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_export_exercise_library()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'version', 1,
    'exported_at', now(),
    'exercises', COALESCE(
      (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.muscle_group, e.muscle_section, e.name)
       FROM public.exercises e),
      '[]'::jsonb
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_import_exercise_library(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ex_count int := 0;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Payload must be a JSON object';
  END IF;

  IF jsonb_typeof(COALESCE(p_payload->'exercises','[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Payload.exercises must be an array';
  END IF;

  WITH incoming AS (
    SELECT
      trim(coalesce(e->>'name','')) AS name,
      trim(coalesce(e->>'muscle_group','')) AS muscle_group,
      trim(coalesce(e->>'muscle_section','')) AS muscle_section,
      lower(trim(coalesce(e->>'equipment',''))) AS equipment,
      NULLIF(e->>'created_by','')::uuid AS created_by
    FROM jsonb_array_elements(COALESCE(p_payload->'exercises','[]'::jsonb)) e
  ),
  upserted AS (
    INSERT INTO public.exercises (name, muscle_group, muscle_section, equipment, created_by)
    SELECT i.name, i.muscle_group, i.muscle_section, i.equipment, i.created_by
    FROM incoming i
    WHERE i.name <> '' AND i.muscle_group <> '' AND i.equipment <> ''
    ON CONFLICT ON CONSTRAINT exercises_unique_key
    DO UPDATE SET
      name = EXCLUDED.name,
      muscle_group = EXCLUDED.muscle_group,
      muscle_section = EXCLUDED.muscle_section,
      equipment = EXCLUDED.equipment
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_ex_count FROM upserted;

  RETURN jsonb_build_object(
    'ok', true,
    'exercises_upserted', v_ex_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_export_exercise_library() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_import_exercise_library(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_export_exercise_library() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_import_exercise_library(jsonb) TO service_role;

COMMIT;
