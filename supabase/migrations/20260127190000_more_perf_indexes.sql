-- Additional performance indexes (history/session load + previous sets)
-- SAFE: adds indexes only.

CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_started
  ON public.workout_sessions (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_workout_exercises_session_order
  ON public.workout_exercises (workout_session_id, order_index);

CREATE INDEX IF NOT EXISTS idx_workout_exercises_exercise_session
  ON public.workout_exercises (exercise_id, workout_session_id);

CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise_setindex
  ON public.workout_sets (workout_exercise_id, set_index);
