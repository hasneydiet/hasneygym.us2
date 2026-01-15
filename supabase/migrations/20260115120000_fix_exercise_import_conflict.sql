BEGIN;

-- Fix: admin_import_exercise_library referenced a non-existent constraint name.
-- Use the actual unique constraint created for the global exercise library.

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
    ON CONFLICT ON CONSTRAINT exercises_unique_name_group_section_equipment
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

COMMIT;
