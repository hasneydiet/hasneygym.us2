-- Add per-exercise notes to workout_exercises so users can store notes under Technique in active workout.
ALTER TABLE IF EXISTS workout_exercises
ADD COLUMN IF NOT EXISTS notes text DEFAULT '';

-- Backfill nulls (safety)
UPDATE workout_exercises SET notes = '' WHERE notes IS NULL;
