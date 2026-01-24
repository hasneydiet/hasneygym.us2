/*
  Persist technique selection changes from an active workout session back to the routine template.

  - Adds technique_tags to routine_day_exercises so each routine-day exercise can have its own default technique.
  - Adds routine_day_exercise_id to workout_exercises so session rows can reliably map back to their origin template
    even after reordering.
*/

-- 1) Routine template default technique per exercise entry
ALTER TABLE routine_day_exercises
ADD COLUMN IF NOT EXISTS technique_tags text[] DEFAULT ARRAY['Normal-Sets']::text[];

-- Ensure existing rows have a sane default
UPDATE routine_day_exercises
SET technique_tags = ARRAY['Normal-Sets']::text[]
WHERE technique_tags IS NULL OR coalesce(array_length(technique_tags, 1), 0) = 0;

-- 2) Link each workout_exercise back to the template row that seeded it
ALTER TABLE workout_exercises
ADD COLUMN IF NOT EXISTS routine_day_exercise_id uuid REFERENCES routine_day_exercises(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workout_exercises_rde_id ON workout_exercises(routine_day_exercise_id);
