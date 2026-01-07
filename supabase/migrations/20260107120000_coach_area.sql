/*
  # Coach Area

  Adds coach-only capabilities to list users and manage all workout/routine data.

  Security model:
  - Coach is identified by email from JWT claims (no secrets stored client-side).
  - Server-side enforcement is via RLS policies + a coach-only RPC.

  NOTE: This migration does NOT modify existing user policies; it only adds additional
  allow rules for the coach user.
*/

-- Helper: identify coach by email claim in the JWT.
CREATE OR REPLACE FUNCTION public.is_coach()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(auth.jwt() ->> 'email', '') = 'hasneybravim@gmail.com';
$$;

-- Coach-only RPC: list users (profiles + auth email).
CREATE OR REPLACE FUNCTION public.coach_list_users()
RETURNS TABLE (
  id uuid,
  email text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_coach() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT p.id, u.email, p.created_at
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.coach_list_users() TO authenticated;

-- =========================
-- RLS: Coach access policies
-- =========================

-- Profiles
CREATE POLICY "Coach can select profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.is_coach());

CREATE POLICY "Coach can update profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.is_coach())
  WITH CHECK (public.is_coach());

-- Exercises
CREATE POLICY "Coach can select exercises"
  ON public.exercises FOR SELECT
  TO authenticated
  USING (public.is_coach());

CREATE POLICY "Coach can insert exercises"
  ON public.exercises FOR INSERT
  TO authenticated
  WITH CHECK (public.is_coach());

CREATE POLICY "Coach can update exercises"
  ON public.exercises FOR UPDATE
  TO authenticated
  USING (public.is_coach())
  WITH CHECK (public.is_coach());

CREATE POLICY "Coach can delete exercises"
  ON public.exercises FOR DELETE
  TO authenticated
  USING (public.is_coach());

-- Routines
CREATE POLICY "Coach can select routines"
  ON public.routines FOR SELECT
  TO authenticated
  USING (public.is_coach());

CREATE POLICY "Coach can insert routines"
  ON public.routines FOR INSERT
  TO authenticated
  WITH CHECK (public.is_coach());

CREATE POLICY "Coach can update routines"
  ON public.routines FOR UPDATE
  TO authenticated
  USING (public.is_coach())
  WITH CHECK (public.is_coach());

CREATE POLICY "Coach can delete routines"
  ON public.routines FOR DELETE
  TO authenticated
  USING (public.is_coach());

-- Routine days
CREATE POLICY "Coach can select routine days"
  ON public.routine_days FOR SELECT
  TO authenticated
  USING (public.is_coach());

CREATE POLICY "Coach can insert routine days"
  ON public.routine_days FOR INSERT
  TO authenticated
  WITH CHECK (public.is_coach());

CREATE POLICY "Coach can update routine days"
  ON public.routine_days FOR UPDATE
  TO authenticated
  USING (public.is_coach())
  WITH CHECK (public.is_coach());

CREATE POLICY "Coach can delete routine days"
  ON public.routine_days FOR DELETE
  TO authenticated
  USING (public.is_coach());

-- Routine day exercises
CREATE POLICY "Coach can select routine day exercises"
  ON public.routine_day_exercises FOR SELECT
  TO authenticated
  USING (public.is_coach());

CREATE POLICY "Coach can insert routine day exercises"
  ON public.routine_day_exercises FOR INSERT
  TO authenticated
  WITH CHECK (public.is_coach());

CREATE POLICY "Coach can update routine day exercises"
  ON public.routine_day_exercises FOR UPDATE
  TO authenticated
  USING (public.is_coach())
  WITH CHECK (public.is_coach());

CREATE POLICY "Coach can delete routine day exercises"
  ON public.routine_day_exercises FOR DELETE
  TO authenticated
  USING (public.is_coach());

-- Workout sessions
CREATE POLICY "Coach can select workout sessions"
  ON public.workout_sessions FOR SELECT
  TO authenticated
  USING (public.is_coach());

CREATE POLICY "Coach can insert workout sessions"
  ON public.workout_sessions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_coach());

CREATE POLICY "Coach can update workout sessions"
  ON public.workout_sessions FOR UPDATE
  TO authenticated
  USING (public.is_coach())
  WITH CHECK (public.is_coach());

CREATE POLICY "Coach can delete workout sessions"
  ON public.workout_sessions FOR DELETE
  TO authenticated
  USING (public.is_coach());

-- Workout exercises
CREATE POLICY "Coach can select workout exercises"
  ON public.workout_exercises FOR SELECT
  TO authenticated
  USING (public.is_coach());

CREATE POLICY "Coach can insert workout exercises"
  ON public.workout_exercises FOR INSERT
  TO authenticated
  WITH CHECK (public.is_coach());

CREATE POLICY "Coach can update workout exercises"
  ON public.workout_exercises FOR UPDATE
  TO authenticated
  USING (public.is_coach())
  WITH CHECK (public.is_coach());

CREATE POLICY "Coach can delete workout exercises"
  ON public.workout_exercises FOR DELETE
  TO authenticated
  USING (public.is_coach());

-- Workout sets
CREATE POLICY "Coach can select workout sets"
  ON public.workout_sets FOR SELECT
  TO authenticated
  USING (public.is_coach());

CREATE POLICY "Coach can insert workout sets"
  ON public.workout_sets FOR INSERT
  TO authenticated
  WITH CHECK (public.is_coach());

CREATE POLICY "Coach can update workout sets"
  ON public.workout_sets FOR UPDATE
  TO authenticated
  USING (public.is_coach())
  WITH CHECK (public.is_coach());

CREATE POLICY "Coach can delete workout sets"
  ON public.workout_sets FOR DELETE
  TO authenticated
  USING (public.is_coach());
