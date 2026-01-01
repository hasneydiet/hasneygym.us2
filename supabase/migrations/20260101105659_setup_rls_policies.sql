/*
  # Row Level Security Policies

  1. Enable RLS
    - Enable RLS on all tables

  2. Profiles Policies
    - Users can read/update their own profile

  3. Exercises Policies
    - Users can manage their own exercises

  4. Routines Policies
    - Users can manage their own routines

  5. Routine Days Policies
    - Users can manage days in their routines

  6. Routine Day Exercises Policies
    - Users can manage exercises in their routine days

  7. Workout Sessions Policies
    - Users can manage their own workout sessions

  8. Workout Exercises Policies
    - Users can manage exercises in their workout sessions

  9. Workout Sets Policies
    - Users can manage sets in their workout exercises
*/

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE routine_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE routine_day_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can view own exercises"
  ON exercises FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own exercises"
  ON exercises FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own exercises"
  ON exercises FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own exercises"
  ON exercises FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own routines"
  ON routines FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own routines"
  ON routines FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own routines"
  ON routines FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own routines"
  ON routines FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view routine days"
  ON routine_days FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM routines
      WHERE routines.id = routine_days.routine_id
      AND routines.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert routine days"
  ON routine_days FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM routines
      WHERE routines.id = routine_days.routine_id
      AND routines.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update routine days"
  ON routine_days FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM routines
      WHERE routines.id = routine_days.routine_id
      AND routines.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM routines
      WHERE routines.id = routine_days.routine_id
      AND routines.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete routine days"
  ON routine_days FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM routines
      WHERE routines.id = routine_days.routine_id
      AND routines.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view routine day exercises"
  ON routine_day_exercises FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM routine_days
      JOIN routines ON routines.id = routine_days.routine_id
      WHERE routine_days.id = routine_day_exercises.routine_day_id
      AND routines.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert routine day exercises"
  ON routine_day_exercises FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM routine_days
      JOIN routines ON routines.id = routine_days.routine_id
      WHERE routine_days.id = routine_day_exercises.routine_day_id
      AND routines.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update routine day exercises"
  ON routine_day_exercises FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM routine_days
      JOIN routines ON routines.id = routine_days.routine_id
      WHERE routine_days.id = routine_day_exercises.routine_day_id
      AND routines.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM routine_days
      JOIN routines ON routines.id = routine_days.routine_id
      WHERE routine_days.id = routine_day_exercises.routine_day_id
      AND routines.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete routine day exercises"
  ON routine_day_exercises FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM routine_days
      JOIN routines ON routines.id = routine_days.routine_id
      WHERE routine_days.id = routine_day_exercises.routine_day_id
      AND routines.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view own workout sessions"
  ON workout_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own workout sessions"
  ON workout_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workout sessions"
  ON workout_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own workout sessions"
  ON workout_sessions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view workout exercises"
  ON workout_exercises FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workout_sessions
      WHERE workout_sessions.id = workout_exercises.workout_session_id
      AND workout_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert workout exercises"
  ON workout_exercises FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workout_sessions
      WHERE workout_sessions.id = workout_exercises.workout_session_id
      AND workout_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update workout exercises"
  ON workout_exercises FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workout_sessions
      WHERE workout_sessions.id = workout_exercises.workout_session_id
      AND workout_sessions.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workout_sessions
      WHERE workout_sessions.id = workout_exercises.workout_session_id
      AND workout_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete workout exercises"
  ON workout_exercises FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workout_sessions
      WHERE workout_sessions.id = workout_exercises.workout_session_id
      AND workout_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view workout sets"
  ON workout_sets FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workout_exercises
      JOIN workout_sessions ON workout_sessions.id = workout_exercises.workout_session_id
      WHERE workout_exercises.id = workout_sets.workout_exercise_id
      AND workout_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert workout sets"
  ON workout_sets FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workout_exercises
      JOIN workout_sessions ON workout_sessions.id = workout_exercises.workout_session_id
      WHERE workout_exercises.id = workout_sets.workout_exercise_id
      AND workout_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update workout sets"
  ON workout_sets FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workout_exercises
      JOIN workout_sessions ON workout_sessions.id = workout_exercises.workout_session_id
      WHERE workout_exercises.id = workout_sets.workout_exercise_id
      AND workout_sessions.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workout_exercises
      JOIN workout_sessions ON workout_sessions.id = workout_exercises.workout_session_id
      WHERE workout_exercises.id = workout_sets.workout_exercise_id
      AND workout_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete workout sets"
  ON workout_sets FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workout_exercises
      JOIN workout_sessions ON workout_sessions.id = workout_exercises.workout_session_id
      WHERE workout_exercises.id = workout_sets.workout_exercise_id
      AND workout_sessions.user_id = auth.uid()
    )
  );
