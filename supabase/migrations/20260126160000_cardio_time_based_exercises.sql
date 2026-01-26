/*
  Cardio time-based tracking

  Adds:
  - public.exercises.exercise_type ('strength' | 'cardio')
  - public.workout_exercises.duration_seconds (int)

  Behavior:
  - Existing exercises with muscle_group='Cardio' are set to exercise_type='cardio'
  - A trigger keeps exercise_type in sync with muscle_group (Cardio => cardio, otherwise strength)
*/

BEGIN;

-- 1) exercises.exercise_type
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS exercise_type text NOT NULL DEFAULT 'strength';

-- Constrain allowed values (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'exercises_exercise_type_check'
      AND conrelid = 'public.exercises'::regclass
  ) THEN
    ALTER TABLE public.exercises
      ADD CONSTRAINT exercises_exercise_type_check
      CHECK (exercise_type IN ('strength','cardio'));
  END IF;
END $$;

-- Backfill cardio based on muscle_group
UPDATE public.exercises
SET exercise_type = 'cardio'
WHERE coalesce(nullif(trim(muscle_group),''), '') = 'Cardio';

-- 2) workout_exercises.duration_seconds
ALTER TABLE public.workout_exercises
  ADD COLUMN IF NOT EXISTS duration_seconds int NOT NULL DEFAULT 0;

-- 3) Keep exercise_type aligned with muscle_group (minimal UI changes)
CREATE OR REPLACE FUNCTION public.sync_exercise_type_from_muscle_group()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.muscle_group IS NOT NULL AND trim(NEW.muscle_group) = 'Cardio' THEN
    NEW.exercise_type := 'cardio';
  ELSE
    NEW.exercise_type := 'strength';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_exercise_type_from_muscle_group'
  ) THEN
    CREATE TRIGGER trg_sync_exercise_type_from_muscle_group
    BEFORE INSERT OR UPDATE OF muscle_group ON public.exercises
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_exercise_type_from_muscle_group();
  END IF;
END $$;

COMMIT;
