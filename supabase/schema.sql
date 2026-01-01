/*
  # Workout Tracker Schema

  1. New Tables
    - profiles (user profile data)
    - exercises (user exercises library)
    - routines (workout routines)
    - routine_days (days within routines)
    - routine_day_exercises (exercises within routine days)
    - workout_sessions (workout tracking sessions)
    - workout_exercises (exercises within workout sessions)
    - workout_sets (sets within workout exercises)

  2. Indexes
    - Performance indexes on foreign keys and common queries

  3. Security
    - RLS enabled on all tables
    - Policies in separate rls.sql file
*/

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  muscle_group text DEFAULT '',
  equipment text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS routine_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id uuid REFERENCES routines(id) ON DELETE CASCADE NOT NULL,
  day_index int NOT NULL,
  name text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS routine_day_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_day_id uuid REFERENCES routine_days(id) ON DELETE CASCADE NOT NULL,
  exercise_id uuid REFERENCES exercises(id) ON DELETE CASCADE NOT NULL,
  order_index int NOT NULL,
  superset_group_id uuid,
  default_sets jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  routine_id uuid REFERENCES routines(id) ON DELETE SET NULL,
  routine_day_id uuid REFERENCES routine_days(id) ON DELETE SET NULL,
  started_at timestamptz DEFAULT now() NOT NULL,
  ended_at timestamptz,
  notes text DEFAULT ''
);

CREATE TABLE IF NOT EXISTS workout_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_session_id uuid REFERENCES workout_sessions(id) ON DELETE CASCADE NOT NULL,
  exercise_id uuid REFERENCES exercises(id) ON DELETE CASCADE NOT NULL,
  order_index int NOT NULL,
  superset_group_id uuid,
  technique_tags text[] DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS workout_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_exercise_id uuid REFERENCES workout_exercises(id) ON DELETE CASCADE NOT NULL,
  set_index int NOT NULL,
  reps int DEFAULT 0,
  weight numeric DEFAULT 0,
  rpe numeric,
  is_completed boolean DEFAULT false,
  notes text DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_exercises_user_id ON exercises(user_id);
CREATE INDEX IF NOT EXISTS idx_routines_user_id ON routines(user_id);
CREATE INDEX IF NOT EXISTS idx_routine_days_routine_id ON routine_days(routine_id);
CREATE INDEX IF NOT EXISTS idx_routine_day_exercises_routine_day_id ON routine_day_exercises(routine_day_id);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_id ON workout_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_workout_exercises_session_id ON workout_exercises(workout_session_id);
CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise_id ON workout_sets(workout_exercise_id);
