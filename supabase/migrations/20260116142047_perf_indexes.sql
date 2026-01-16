-- Performance indexes to speed up Workout tab load (routine preview + last performed)
-- SAFE: adds indexes only, no data changes.

CREATE INDEX IF NOT EXISTS idx_routine_day_exercises_day_order
  ON public.routine_day_exercises (routine_day_id, order_index);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_day_started
  ON public.workout_sessions (routine_day_id, started_at DESC);
