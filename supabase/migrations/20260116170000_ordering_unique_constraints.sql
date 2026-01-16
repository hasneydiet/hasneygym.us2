/*
  # Ordering integrity constraints

  Adds uniqueness constraints to prevent duplicate ordering indexes.

  IMPORTANT: If duplicates already exist, this migration will fail.
*/

-- Routine day order within a routine
CREATE UNIQUE INDEX IF NOT EXISTS uq_routine_days_routine_id_day_index
  ON public.routine_days (routine_id, day_index);

-- Exercise order within a routine day
CREATE UNIQUE INDEX IF NOT EXISTS uq_routine_day_exercises_day_id_order_index
  ON public.routine_day_exercises (routine_day_id, order_index);

-- Exercise order within a workout session
CREATE UNIQUE INDEX IF NOT EXISTS uq_workout_exercises_session_id_order_index
  ON public.workout_exercises (workout_session_id, order_index);

-- Set order within a workout exercise
CREATE UNIQUE INDEX IF NOT EXISTS uq_workout_sets_workout_exercise_id_set_index
  ON public.workout_sets (workout_exercise_id, set_index);
