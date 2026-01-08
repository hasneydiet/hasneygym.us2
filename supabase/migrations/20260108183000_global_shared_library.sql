/*
  20260108183000_global_shared_library.sql (FIXED v4)

  Fixes:
  - Removes invalid ''public'' quoting
  - Dedupe exercises without MIN(uuid)
  - Repoints FK references before deleting duplicates
  - No routine_days.day_number assumption
  - Admin export/import that does not assume extra routine_days columns
*/

BEGIN;

-- ============================================================
-- 0) Drop existing policies on target tables (defensive)
-- ============================================================
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('exercises','routines','routine_days','routine_day_exercises')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- ============================================================
-- 1) EXERCISES: user-scoped -> global shared
-- ============================================================

-- Rename user_id -> created_by if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='exercises' AND column_name='user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='exercises' AND column_name='created_by'
  ) THEN
    EXECUTE 'ALTER TABLE public.exercises RENAME COLUMN user_id TO created_by';
  END IF;
END $$;

-- created_by nullable + default auth.uid()
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='exercises' AND column_name='created_by'
  ) THEN
    EXECUTE 'ALTER TABLE public.exercises ALTER COLUMN created_by DROP NOT NULL';
    EXECUTE 'ALTER TABLE public.exercises ALTER COLUMN created_by SET DEFAULT auth.uid()';
  END IF;
END $$;

-- Add muscle_section
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS muscle_section TEXT NOT NULL DEFAULT '';

-- Normalize values
UPDATE public.exercises
SET
  name = trim(coalesce(name,'')),
  muscle_group = trim(coalesce(muscle_group,'')),
  muscle_section = trim(coalesce(muscle_section,'')),
  equipment = lower(trim(coalesce(equipment,'')));

-- SAFE DEDUPE: repoint FKs first, then delete dupes
CREATE TEMP TABLE IF NOT EXISTS tmp_exercise_dedupe_map (
  dup_id uuid PRIMARY KEY,
  canonical_id uuid NOT NULL
) ON COMMIT DROP;

TRUNCATE TABLE tmp_exercise_dedupe_map;

WITH ranked AS (
  SELECT
    id,
    name,
    muscle_group,
    muscle_section,
    equipment,
    ROW_NUMBER() OVER (
      PARTITION BY name, muscle_group, muscle_section, equipment
      ORDER BY id::text
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY name, muscle_group, muscle_section, equipment
      ORDER BY id::text
    ) AS canonical_id
  FROM public.exercises
)
INSERT INTO tmp_exercise_dedupe_map (dup_id, canonical_id)
SELECT id, canonical_id
FROM ranked
WHERE rn > 1;

-- Repoint routine_day_exercises.exercise_id -> canonical
UPDATE public.routine_day_exercises rde
SET exercise_id = m.canonical_id
FROM tmp_exercise_dedupe_map m
WHERE rde.exercise_id = m.dup_id;

-- Repoint workout_exercises.exercise_id -> canonical (only if table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='workout_exercises'
  ) THEN
    EXECUTE '
      UPDATE public.workout_exercises we
      SET exercise_id = m.canonical_id
      FROM tmp_exercise_dedupe_map m
      WHERE we.exercise_id = m.dup_id
    ';
  END IF;
END $$;

-- Delete duplicate exercises
DELETE FROM public.exercises e
USING tmp_exercise_dedupe_map m
WHERE e.id = m.dup_id;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_exercises_muscle_group ON public.exercises (muscle_group);
CREATE INDEX IF NOT EXISTS idx_exercises_muscle_section ON public.exercises (muscle_section);
CREATE INDEX IF NOT EXISTS idx_exercises_equipment ON public.exercises (equipment);
CREATE INDEX IF NOT EXISTS idx_exercises_created_by ON public.exercises (created_by);

-- Unique constraint for safe upserts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exercises_unique_key'
      AND conrelid = 'public.exercises'::regclass
  ) THEN
    EXECUTE '
      ALTER TABLE public.exercises
      ADD CONSTRAINT exercises_unique_key
      UNIQUE (name, muscle_group, muscle_section, equipment)
    ';
  END IF;
END $$;

-- ============================================================
-- 2) ROUTINES: user-scoped -> global shared
-- ============================================================

-- Rename user_id -> created_by if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='routines' AND column_name='user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='routines' AND column_name='created_by'
  ) THEN
    EXECUTE 'ALTER TABLE public.routines RENAME COLUMN user_id TO created_by';
  END IF;
END $$;

-- created_by nullable + default auth.uid()
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='routines' AND column_name='created_by'
  ) THEN
    EXECUTE 'ALTER TABLE public.routines ALTER COLUMN created_by DROP NOT NULL';
    EXECUTE 'ALTER TABLE public.routines ALTER COLUMN created_by SET DEFAULT auth.uid()';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_routines_created_by ON public.routines (created_by);

-- ============================================================
-- 3) RLS: Global shared library policies
-- ============================================================

ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_day_exercises ENABLE ROW LEVEL SECURITY;

-- Exercises
CREATE POLICY exercises_read_all
ON public.exercises
FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY exercises_insert_auth
ON public.exercises
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY exercises_update_owner_or_coach
ON public.exercises
FOR UPDATE
USING (created_by = auth.uid() OR public.is_coach())
WITH CHECK (created_by = auth.uid() OR public.is_coach());

CREATE POLICY exercises_delete_owner_or_coach
ON public.exercises
FOR DELETE
USING (created_by = auth.uid() OR public.is_coach());

-- Routines
CREATE POLICY routines_read_all
ON public.routines
FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY routines_insert_auth
ON public.routines
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY routines_update_owner_or_coach
ON public.routines
FOR UPDATE
USING (created_by = auth.uid() OR public.is_coach())
WITH CHECK (created_by = auth.uid() OR public.is_coach());

CREATE POLICY routines_delete_owner_or_coach
ON public.routines
FOR DELETE
USING (created_by = auth.uid() OR public.is_coach());

-- routine_days: read all, write if parent routine editable
CREATE POLICY routine_days_read_all
ON public.routine_days
FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY routine_days_insert_owner_or_coach
ON public.routine_days
FOR INSERT
WITH CHECK (
  auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1
    FROM public.routines r
    WHERE r.id = routine_days.routine_id
      AND (r.created_by = auth.uid() OR public.is_coach())
  )
);

CREATE POLICY routine_days_update_owner_or_coach
ON public.routine_days
FOR UPDATE
USING (
  auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1
    FROM public.routines r
    WHERE r.id = routine_days.routine_id
      AND (r.created_by = auth.uid() OR public.is_coach())
  )
)
WITH CHECK (
  auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1
    FROM public.routines r
    WHERE r.id = routine_days.routine_id
      AND (r.created_by = auth.uid() OR public.is_coach())
  )
);

CREATE POLICY routine_days_delete_owner_or_coach
ON public.routine_days
FOR DELETE
USING (
  auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1
    FROM public.routines r
    WHERE r.id = routine_days.routine_id
      AND (r.created_by = auth.uid() OR public.is_coach())
  )
);

-- routine_day_exercises: read all, write if parent routine editable
CREATE POLICY routine_day_exercises_read_all
ON public.routine_day_exercises
FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY routine_day_exercises_insert_owner_or_coach
ON public.routine_day_exercises
FOR INSERT
WITH CHECK (
  auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1
    FROM public.routine_days rd
    JOIN public.routines r ON r.id = rd.routine_id
    WHERE rd.id = routine_day_exercises.routine_day_id
      AND (r.created_by = auth.uid() OR public.is_coach())
  )
);

CREATE POLICY routine_day_exercises_update_owner_or_coach
ON public.routine_day_exercises
FOR UPDATE
USING (
  auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1
    FROM public.routine_days rd
    JOIN public.routines r ON r.id = rd.routine_id
    WHERE rd.id = routine_day_exercises.routine_day_id
      AND (r.created_by = auth.uid() OR public.is_coach())
  )
)
WITH CHECK (
  auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1
    FROM public.routine_days rd
    JOIN public.routines r ON r.id = rd.routine_id
    WHERE rd.id = routine_day_exercises.routine_day_id
      AND (r.created_by = auth.uid() OR public.is_coach())
  )
);

CREATE POLICY routine_day_exercises_delete_owner_or_coach
ON public.routine_day_exercises
FOR DELETE
USING (
  auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1
    FROM public.routine_days rd
    JOIN public.routines r ON r.id = rd.routine_id
    WHERE rd.id = routine_day_exercises.routine_day_id
      AND (r.created_by = auth.uid() OR public.is_coach())
  )
);

-- ============================================================
-- 4) Admin RPCs (service_role only) - EXPORT / IMPORT
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_export_library()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'version', 1,
    'exported_at', now(),
    'exercises', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.muscle_group, e.muscle_section, e.name) FROM public.exercises e), '[]'::jsonb),
    'routines', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.name) FROM public.routines r), '[]'::jsonb),
    'routine_days', COALESCE((SELECT jsonb_agg(to_jsonb(rd) ORDER BY rd.routine_id, rd.id::text) FROM public.routine_days rd), '[]'::jsonb),
    'routine_day_exercises', COALESCE((SELECT jsonb_agg(to_jsonb(rde) ORDER BY rde.routine_day_id, rde.id::text) FROM public.routine_day_exercises rde), '[]'::jsonb)
  );
$$;

-- Import: upsert exercises by unique key; upsert routines/days/rde by id.
-- NOTE: For routine_days and routine_day_exercises we upsert ONLY required columns to avoid guessing schema.
CREATE OR REPLACE FUNCTION public.admin_import_library(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ex_count int := 0;
  v_r_count int := 0;
  v_rd_count int := 0;
  v_rde_count int := 0;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Payload must be a JSON object';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS exercise_id_map (
    payload_id uuid PRIMARY KEY,
    actual_id  uuid NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE exercise_id_map;

  -- Exercises upsert by unique key
  WITH incoming AS (
    SELECT
      (e->>'id')::uuid AS payload_id,
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

  -- Map payload exercise IDs to actual IDs by unique key
  INSERT INTO exercise_id_map (payload_id, actual_id)
  SELECT i.payload_id, e.id
  FROM (
    SELECT
      (x->>'id')::uuid AS payload_id,
      trim(coalesce(x->>'name','')) AS name,
      trim(coalesce(x->>'muscle_group','')) AS muscle_group,
      trim(coalesce(x->>'muscle_section','')) AS muscle_section,
      lower(trim(coalesce(x->>'equipment',''))) AS equipment
    FROM jsonb_array_elements(COALESCE(p_payload->'exercises','[]'::jsonb)) x
  ) i
  JOIN public.exercises e
    ON e.name = i.name
   AND e.muscle_group = i.muscle_group
   AND e.muscle_section = i.muscle_section
   AND e.equipment = i.equipment
  ON CONFLICT (payload_id) DO UPDATE SET actual_id = EXCLUDED.actual_id;

  -- Routines upsert by id
  WITH incoming AS (
    SELECT
      (r->>'id')::uuid AS id,
      r->>'name' AS name,
      NULLIF(r->>'created_by','')::uuid AS created_by
    FROM jsonb_array_elements(COALESCE(p_payload->'routines','[]'::jsonb)) r
  ),
  upserted AS (
    INSERT INTO public.routines (id, name, created_by)
    SELECT i.id, i.name, i.created_by
    FROM incoming i
    WHERE i.id IS NOT NULL AND coalesce(i.name,'') <> ''
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      created_by = EXCLUDED.created_by
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_r_count FROM upserted;

  -- routine_days: upsert only (id, routine_id)
  WITH incoming AS (
    SELECT
      (rd->>'id')::uuid AS id,
      (rd->>'routine_id')::uuid AS routine_id
    FROM jsonb_array_elements(COALESCE(p_payload->'routine_days','[]'::jsonb)) rd
  ),
  upserted AS (
    INSERT INTO public.routine_days (id, routine_id)
    SELECT i.id, i.routine_id
    FROM incoming i
    WHERE i.id IS NOT NULL AND i.routine_id IS NOT NULL
    ON CONFLICT (id) DO UPDATE SET
      routine_id = EXCLUDED.routine_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rd_count FROM upserted;

  -- routine_day_exercises: upsert only required columns (id, routine_day_id, exercise_id)
  WITH incoming AS (
    SELECT
      (rde->>'id')::uuid AS id,
      (rde->>'routine_day_id')::uuid AS routine_day_id,
      (rde->>'exercise_id')::uuid AS payload_exercise_id
    FROM jsonb_array_elements(COALESCE(p_payload->'routine_day_exercises','[]'::jsonb)) rde
  ),
  mapped AS (
    SELECT
      i.id,
      i.routine_day_id,
      COALESCE(m.actual_id, i.payload_exercise_id) AS exercise_id
    FROM incoming i
    LEFT JOIN exercise_id_map m ON m.payload_id = i.payload_exercise_id
  ),
  upserted AS (
    INSERT INTO public.routine_day_exercises (id, routine_day_id, exercise_id)
    SELECT id, routine_day_id, exercise_id
    FROM mapped
    WHERE id IS NOT NULL AND routine_day_id IS NOT NULL AND exercise_id IS NOT NULL
    ON CONFLICT (id) DO UPDATE SET
      routine_day_id = EXCLUDED.routine_day_id,
      exercise_id = EXCLUDED.exercise_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rde_count FROM upserted;

  RETURN jsonb_build_object(
    'ok', true,
    'exercises_upserted', v_ex_count,
    'routines_upserted', v_r_count,
    'routine_days_upserted', v_rd_count,
    'routine_day_exercises_upserted', v_rde_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_export_library() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_import_library(jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_export_library() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_import_library(jsonb) TO service_role;

COMMIT;
