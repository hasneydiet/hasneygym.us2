/*
  # Global Shared Library for Exercises & Routines

  Converts per-user libraries into a single shared global library.

  Exercises
  - Rename user_id -> created_by (nullable; default auth.uid())
  - Add muscle_section for finer filtering
  - Normalize equipment to lowercase for consistent filtering
  - Add indexes for common filters
  - Add unique constraint to prevent duplicates and enable safe upserts

  Routines
  - Rename user_id -> created_by (nullable; default auth.uid())
  - Update RLS policies for shared read / restricted write

  RLS model:
  - Any authenticated user can SELECT exercises/routines and related routine days/exercises.
  - Any authenticated user can INSERT exercises/routines and related routine days/exercises.
  - UPDATE/DELETE allowed only for (creator OR coach).
  - Coach is detected via public.is_coach().

  NOTE: This migration intentionally leaves workout_* tables user-scoped.
*/

BEGIN;

-- ----------------------------
-- Schema changes: Exercises
-- ----------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'exercises' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.exercises RENAME COLUMN user_id TO created_by;
  END IF;
END $$;

ALTER TABLE public.exercises
  ALTER COLUMN created_by DROP NOT NULL;

-- Change FK to SET NULL so global entries (or deleted users) don't cascade-delete shared data
DO $$
BEGIN
  -- Drop any existing FK on created_by (name may differ) by searching pg_constraint.
  EXECUTE (
    SELECT 'ALTER TABLE public.exercises DROP CONSTRAINT ' || quote_ident(c.conname) || ';'
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname='public' AND t.relname='exercises' AND c.contype='f'
      AND pg_get_constraintdef(c.oid) LIKE '%(created_by)%'
    LIMIT 1
  );
EXCEPTION WHEN OTHERS THEN
  -- ignore if not found
  NULL;
END $$;

ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.exercises
  ALTER COLUMN created_by SET DEFAULT auth.uid();

ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS muscle_section text NOT NULL DEFAULT '';

-- Normalize existing rows (best effort, non-breaking)
UPDATE public.exercises
SET
  name = trim(name),
  muscle_group = COALESCE(trim(muscle_group), ''),
  muscle_section = COALESCE(trim(muscle_section), ''),
  equipment = COALESCE(lower(trim(equipment)), '');

-- Deduplicate before adding unique constraint (keep oldest row by created_at then id)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY lower(name), lower(muscle_group), lower(muscle_section), lower(equipment)
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.exercises
)
DELETE FROM public.exercises e
USING ranked r
WHERE e.id = r.id AND r.rn > 1;

-- Drop old per-user index if it exists
DROP INDEX IF EXISTS public.idx_exercises_user_id;

-- Add indexes for common filters
CREATE INDEX IF NOT EXISTS idx_exercises_muscle_group ON public.exercises (muscle_group);
CREATE INDEX IF NOT EXISTS idx_exercises_muscle_section ON public.exercises (muscle_section);
CREATE INDEX IF NOT EXISTS idx_exercises_equipment ON public.exercises (equipment);
CREATE INDEX IF NOT EXISTS idx_exercises_created_by ON public.exercises (created_by);

-- Unique constraint to prevent duplicates and enable safe upsert for seed/import
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exercises_unique_name_group_section_equipment'
  ) THEN
    ALTER TABLE public.exercises
      ADD CONSTRAINT exercises_unique_name_group_section_equipment
      UNIQUE (name, muscle_group, muscle_section, equipment);
  END IF;
END $$;

-- ----------------------------
-- Schema changes: Routines
-- ----------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'routines' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.routines RENAME COLUMN user_id TO created_by;
  END IF;
END $$;

ALTER TABLE public.routines
  ALTER COLUMN created_by DROP NOT NULL;

DO $$
BEGIN
  EXECUTE (
    SELECT 'ALTER TABLE public.routines DROP CONSTRAINT ' || quote_ident(c.conname) || ';'
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname='public' AND t.relname='routines' AND c.contype='f'
      AND pg_get_constraintdef(c.oid) LIKE '%(created_by)%'
    LIMIT 1
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

ALTER TABLE public.routines
  ADD CONSTRAINT routines_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.routines
  ALTER COLUMN created_by SET DEFAULT auth.uid();

DROP INDEX IF EXISTS public.idx_routines_user_id;
CREATE INDEX IF NOT EXISTS idx_routines_created_by ON public.routines (created_by);

-- ----------------------------
-- RLS: replace per-user policies with shared-library policies
-- ----------------------------

-- Exercises: drop old user/coach policies if present
DROP POLICY IF EXISTS "Users can view own exercises" ON public.exercises;
DROP POLICY IF EXISTS "Users can insert own exercises" ON public.exercises;
DROP POLICY IF EXISTS "Users can update own exercises" ON public.exercises;
DROP POLICY IF EXISTS "Users can delete own exercises" ON public.exercises;

DROP POLICY IF EXISTS "Coach can select exercises" ON public.exercises;
DROP POLICY IF EXISTS "Coach can insert exercises" ON public.exercises;
DROP POLICY IF EXISTS "Coach can update exercises" ON public.exercises;
DROP POLICY IF EXISTS "Coach can delete exercises" ON public.exercises;

-- Routines: drop old user/coach policies if present
DROP POLICY IF EXISTS "Users can view own routines" ON public.routines;
DROP POLICY IF EXISTS "Users can insert own routines" ON public.routines;
DROP POLICY IF EXISTS "Users can update own routines" ON public.routines;
DROP POLICY IF EXISTS "Users can delete own routines" ON public.routines;

DROP POLICY IF EXISTS "Coach can select routines" ON public.routines;
DROP POLICY IF EXISTS "Coach can insert routines" ON public.routines;
DROP POLICY IF EXISTS "Coach can update routines" ON public.routines;
DROP POLICY IF EXISTS "Coach can delete routines" ON public.routines;

-- Routine days: drop old user/coach policies if present
DROP POLICY IF EXISTS "Users can view routine days" ON public.routine_days;
DROP POLICY IF EXISTS "Users can insert routine days" ON public.routine_days;
DROP POLICY IF EXISTS "Users can update routine days" ON public.routine_days;
DROP POLICY IF EXISTS "Users can delete routine days" ON public.routine_days;

DROP POLICY IF EXISTS "Coach can select routine days" ON public.routine_days;
DROP POLICY IF EXISTS "Coach can insert routine days" ON public.routine_days;
DROP POLICY IF EXISTS "Coach can update routine days" ON public.routine_days;
DROP POLICY IF EXISTS "Coach can delete routine days" ON public.routine_days;

-- Routine day exercises: drop old user/coach policies if present
DROP POLICY IF EXISTS "Users can view routine day exercises" ON public.routine_day_exercises;
DROP POLICY IF EXISTS "Users can insert routine day exercises" ON public.routine_day_exercises;
DROP POLICY IF EXISTS "Users can update routine day exercises" ON public.routine_day_exercises;
DROP POLICY IF EXISTS "Users can delete routine day exercises" ON public.routine_day_exercises;

DROP POLICY IF EXISTS "Coach can select routine day exercises" ON public.routine_day_exercises;
DROP POLICY IF EXISTS "Coach can insert routine day exercises" ON public.routine_day_exercises;
DROP POLICY IF EXISTS "Coach can update routine day exercises" ON public.routine_day_exercises;
DROP POLICY IF EXISTS "Coach can delete routine day exercises" ON public.routine_day_exercises;

-- New policies: Exercises (shared read, authenticated create, creator/coach edit)
CREATE POLICY exercises_select_all
  ON public.exercises FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY exercises_insert_authenticated
  ON public.exercises FOR INSERT
  TO authenticated
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY exercises_update_creator_or_coach
  ON public.exercises FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid() OR public.is_coach())
  WITH CHECK (created_by = auth.uid() OR public.is_coach());

CREATE POLICY exercises_delete_creator_or_coach
  ON public.exercises FOR DELETE
  TO authenticated
  USING (created_by = auth.uid() OR public.is_coach());

-- New policies: Routines
CREATE POLICY routines_select_all
  ON public.routines FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY routines_insert_authenticated
  ON public.routines FOR INSERT
  TO authenticated
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY routines_update_creator_or_coach
  ON public.routines FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid() OR public.is_coach())
  WITH CHECK (created_by = auth.uid() OR public.is_coach());

CREATE POLICY routines_delete_creator_or_coach
  ON public.routines FOR DELETE
  TO authenticated
  USING (created_by = auth.uid() OR public.is_coach());

-- New policies: Routine days (shared read, authenticated write only if can modify parent routine)
CREATE POLICY routine_days_select_all
  ON public.routine_days FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY routine_days_insert_if_parent_editable
  ON public.routine_days FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.routines r
      WHERE r.id = routine_days.routine_id
        AND (r.created_by = auth.uid() OR public.is_coach())
    )
  );

CREATE POLICY routine_days_update_if_parent_editable
  ON public.routine_days FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.routines r
      WHERE r.id = routine_days.routine_id
        AND (r.created_by = auth.uid() OR public.is_coach())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.routines r
      WHERE r.id = routine_days.routine_id
        AND (r.created_by = auth.uid() OR public.is_coach())
    )
  );

CREATE POLICY routine_days_delete_if_parent_editable
  ON public.routine_days FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.routines r
      WHERE r.id = routine_days.routine_id
        AND (r.created_by = auth.uid() OR public.is_coach())
    )
  );

-- New policies: Routine day exercises (shared read, authenticated write only if can modify parent routine)
CREATE POLICY routine_day_exercises_select_all
  ON public.routine_day_exercises FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY routine_day_exercises_insert_if_parent_editable
  ON public.routine_day_exercises FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.routine_days d
      JOIN public.routines r ON r.id = d.routine_id
      WHERE d.id = routine_day_exercises.routine_day_id
        AND (r.created_by = auth.uid() OR public.is_coach())
    )
  );

CREATE POLICY routine_day_exercises_update_if_parent_editable
  ON public.routine_day_exercises FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.routine_days d
      JOIN public.routines r ON r.id = d.routine_id
      WHERE d.id = routine_day_exercises.routine_day_id
        AND (r.created_by = auth.uid() OR public.is_coach())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.routine_days d
      JOIN public.routines r ON r.id = d.routine_id
      WHERE d.id = routine_day_exercises.routine_day_id
        AND (r.created_by = auth.uid() OR public.is_coach())
    )
  );

CREATE POLICY routine_day_exercises_delete_if_parent_editable
  ON public.routine_day_exercises FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.routine_days d
      JOIN public.routines r ON r.id = d.routine_id
      WHERE d.id = routine_day_exercises.routine_day_id
        AND (r.created_by = auth.uid() OR public.is_coach())
    )
  );

-- ----------------------------
-- Coach-only import/export functions (called via server using service role)
-- ----------------------------

CREATE OR REPLACE FUNCTION public.admin_export_library()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payload jsonb;
BEGIN
  IF NOT (public.is_coach() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  payload := jsonb_build_object(
    'version', 1,
    'exported_at', now(),
    'exercises', COALESCE((SELECT jsonb_agg(e ORDER BY e.name) FROM public.exercises e), '[]'::jsonb),
    'routines', COALESCE((SELECT jsonb_agg(r ORDER BY r.created_at) FROM public.routines r), '[]'::jsonb),
    'routine_days', COALESCE((SELECT jsonb_agg(d ORDER BY d.routine_id, d.day_index) FROM public.routine_days d), '[]'::jsonb),
    'routine_day_exercises', COALESCE((SELECT jsonb_agg(x ORDER BY x.routine_day_id, x.order_index) FROM public.routine_day_exercises x), '[]'::jsonb)
  );

  RETURN payload;
END;
$$;

-- Import uses a single transaction inside the function.
CREATE OR REPLACE FUNCTION public.admin_import_library(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exercises jsonb;
  v_routines jsonb;
  v_days jsonb;
  v_day_exercises jsonb;
  inserted_exercises int := 0;
  inserted_routines int := 0;
  inserted_days int := 0;
  inserted_day_exercises int := 0;
BEGIN
  IF NOT (public.is_coach() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object';
  END IF;

  v_exercises := COALESCE(p_payload->'exercises', '[]'::jsonb);
  v_routines := COALESCE(p_payload->'routines', '[]'::jsonb);
  v_days := COALESCE(p_payload->'routine_days', '[]'::jsonb);
  v_day_exercises := COALESCE(p_payload->'routine_day_exercises', '[]'::jsonb);

  IF jsonb_typeof(v_exercises) <> 'array'
    OR jsonb_typeof(v_routines) <> 'array'
    OR jsonb_typeof(v_days) <> 'array'
    OR jsonb_typeof(v_day_exercises) <> 'array'
  THEN
    RAISE EXCEPTION 'exercises/routines/routine_days/routine_day_exercises must be arrays';
  END IF;

  -- Exercises upsert by unique key (name+group+section+equipment). Keep created_by as NULL when not provided.
  WITH rows AS (
    SELECT
      COALESCE(NULLIF(trim((x->>'name')::text), ''), NULL) AS name,
      COALESCE(trim((x->>'muscle_group')::text), '') AS muscle_group,
      COALESCE(trim((x->>'muscle_section')::text), '') AS muscle_section,
      COALESCE(lower(trim((x->>'equipment')::text)), '') AS equipment,
      COALESCE((x->>'notes')::text, '') AS notes,
      (x->'default_technique_tags') AS default_technique_tags,
      (x->'default_set_scheme') AS default_set_scheme
    FROM jsonb_array_elements(v_exercises) x
  )
  INSERT INTO public.exercises (name, muscle_group, muscle_section, equipment, notes, default_technique_tags, default_set_scheme, created_by)
  SELECT
    r.name, r.muscle_group, r.muscle_section, r.equipment,
    r.notes,
    CASE WHEN jsonb_typeof(r.default_technique_tags) = 'array' THEN r.default_technique_tags ELSE '[]'::jsonb END,
    CASE WHEN jsonb_typeof(r.default_set_scheme) = 'object' THEN r.default_set_scheme ELSE NULL END,
    NULL
  FROM rows r
  WHERE r.name IS NOT NULL
  ON CONFLICT (name, muscle_group, muscle_section, equipment)
  DO UPDATE SET
    notes = EXCLUDED.notes,
    default_technique_tags = EXCLUDED.default_technique_tags,
    default_set_scheme = EXCLUDED.default_set_scheme;

  GET DIAGNOSTICS inserted_exercises = ROW_COUNT;

  -- Routines: upsert by id when provided; otherwise insert new.
  -- We do NOT attempt to merge by name to avoid clobbering user edits unexpectedly.
  WITH rows AS (
    SELECT
      NULLIF((x->>'id')::text, '')::uuid AS id,
      COALESCE(NULLIF(trim((x->>'name')::text), ''), NULL) AS name,
      COALESCE((x->>'notes')::text, '') AS notes
    FROM jsonb_array_elements(v_routines) x
  )
  INSERT INTO public.routines (id, name, notes, created_by)
  SELECT
    COALESCE(r.id, gen_random_uuid()),
    r.name,
    r.notes,
    NULL
  FROM rows r
  WHERE r.name IS NOT NULL
  ON CONFLICT (id)
  DO UPDATE SET
    name = EXCLUDED.name,
    notes = EXCLUDED.notes;

  GET DIAGNOSTICS inserted_routines = ROW_COUNT;

  -- Routine days: upsert by id when provided
  WITH rows AS (
    SELECT
      NULLIF((x->>'id')::text, '')::uuid AS id,
      NULLIF((x->>'routine_id')::text, '')::uuid AS routine_id,
      COALESCE((x->>'day_index')::int, 0) AS day_index,
      COALESCE(NULLIF(trim((x->>'name')::text), ''), 'Day') AS name
    FROM jsonb_array_elements(v_days) x
  )
  INSERT INTO public.routine_days (id, routine_id, day_index, name)
  SELECT
    COALESCE(r.id, gen_random_uuid()),
    r.routine_id,
    r.day_index,
    r.name
  FROM rows r
  WHERE r.routine_id IS NOT NULL
  ON CONFLICT (id)
  DO UPDATE SET
    routine_id = EXCLUDED.routine_id,
    day_index = EXCLUDED.day_index,
    name = EXCLUDED.name;

  GET DIAGNOSTICS inserted_days = ROW_COUNT;

  -- Routine day exercises: upsert by id when provided
  WITH rows AS (
    SELECT
      NULLIF((x->>'id')::text, '')::uuid AS id,
      NULLIF((x->>'routine_day_id')::text, '')::uuid AS routine_day_id,
      NULLIF((x->>'exercise_id')::text, '')::uuid AS exercise_id,
      COALESCE((x->>'order_index')::int, 0) AS order_index,
      NULLIF((x->>'superset_group_id')::text, '')::uuid AS superset_group_id,
      (x->'default_sets') AS default_sets
    FROM jsonb_array_elements(v_day_exercises) x
  )
  INSERT INTO public.routine_day_exercises (id, routine_day_id, exercise_id, order_index, superset_group_id, default_sets)
  SELECT
    COALESCE(r.id, gen_random_uuid()),
    r.routine_day_id,
    r.exercise_id,
    r.order_index,
    r.superset_group_id,
    CASE WHEN jsonb_typeof(r.default_sets) = 'array' THEN r.default_sets ELSE '[]'::jsonb END
  FROM rows r
  WHERE r.routine_day_id IS NOT NULL AND r.exercise_id IS NOT NULL
  ON CONFLICT (id)
  DO UPDATE SET
    routine_day_id = EXCLUDED.routine_day_id,
    exercise_id = EXCLUDED.exercise_id,
    order_index = EXCLUDED.order_index,
    superset_group_id = EXCLUDED.superset_group_id,
    default_sets = EXCLUDED.default_sets;

  GET DIAGNOSTICS inserted_day_exercises = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'exercises_upserted', inserted_exercises,
    'routines_upserted', inserted_routines,
    'routine_days_upserted', inserted_days,
    'routine_day_exercises_upserted', inserted_day_exercises
  );
END;
$$;

-- Do not expose admin functions to regular authenticated users.
REVOKE ALL ON FUNCTION public.admin_export_library() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_import_library(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_export_library() FROM authenticated;
REVOKE ALL ON FUNCTION public.admin_import_library(jsonb) FROM authenticated;

-- Allow service role (used by server-side endpoints) to execute if needed.
GRANT EXECUTE ON FUNCTION public.admin_export_library() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_import_library(jsonb) TO service_role;

COMMIT;
