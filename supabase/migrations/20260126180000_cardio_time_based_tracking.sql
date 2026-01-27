-- Cardio time-based tracking (Hevy-style)
-- Cardio is time-based; strength is set-based.
-- Adds exercise_type to exercises and duration_seconds to workout_exercises.

DO $$
BEGIN
  -- exercise_type on exercises
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='exercises' AND column_name='exercise_type'
  ) THEN
    ALTER TABLE public.exercises
      ADD COLUMN exercise_type text NOT NULL DEFAULT 'strength';
    ALTER TABLE public.exercises
      ADD CONSTRAINT exercises_exercise_type_check
      CHECK (exercise_type IN ('strength','cardio'));
  END IF;

  -- duration_seconds on workout_exercises
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='workout_exercises' AND column_name='duration_seconds'
  ) THEN
    ALTER TABLE public.workout_exercises
      ADD COLUMN duration_seconds integer NOT NULL DEFAULT 0;
    ALTER TABLE public.workout_exercises
      ADD CONSTRAINT workout_exercises_duration_seconds_check
      CHECK (duration_seconds >= 0);
  END IF;
END $$;

-- Backfill cardio based on canonical muscle group
UPDATE public.exercises
SET exercise_type = 'cardio'
WHERE muscle_group = 'Cardio';

-- Keep exercise_type aligned with muscle_group to avoid requiring UI changes.
CREATE OR REPLACE FUNCTION public.set_exercise_type_from_muscle_group()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.muscle_group = 'Cardio' THEN
    NEW.exercise_type := 'cardio';
  ELSE
    NEW.exercise_type := 'strength';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_exercise_type_from_muscle_group ON public.exercises;
CREATE TRIGGER trg_set_exercise_type_from_muscle_group
BEFORE INSERT OR UPDATE OF muscle_group ON public.exercises
FOR EACH ROW
EXECUTE FUNCTION public.set_exercise_type_from_muscle_group();
