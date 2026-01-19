/*
  # Fix profiles RLS + add weight/body fat fields + dashboard perf indexes

  This migration addresses:
  - "new row violates row-level security policy" when saving the dashboard Profile card
  - Adds optional body metrics fields to profiles
  - Adds safe indexes to reduce dashboard first-load latency
*/

BEGIN;

-- 1) Extend profiles table (optional body metrics)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS weight_lbs numeric,
  ADD COLUMN IF NOT EXISTS body_fat_percent numeric;

-- Optional sanity checks (allow NULL)
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_weight_lbs_nonnegative;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_weight_lbs_nonnegative
  CHECK (weight_lbs IS NULL OR weight_lbs >= 0);

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_body_fat_percent_range;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_body_fat_percent_range
  CHECK (body_fat_percent IS NULL OR (body_fat_percent >= 0 AND body_fat_percent <= 100));

-- 2) Ensure RLS is enabled and policies allow profile edits.
-- Coaches are allowed via public.is_coach() for coaching/impersonation flows.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Read own profile (or any profile if coach)
  BEGIN
    CREATE POLICY "Profiles are readable by owner or coach"
      ON public.profiles FOR SELECT
      TO authenticated
      USING (id = auth.uid() OR public.is_coach());
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Insert own profile row (or any profile if coach)
  BEGIN
    CREATE POLICY "Profiles can be inserted by owner or coach"
      ON public.profiles FOR INSERT
      TO authenticated
      WITH CHECK (id = auth.uid() OR public.is_coach());
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Update own profile row (or any profile if coach)
  BEGIN
    CREATE POLICY "Profiles can be updated by owner or coach"
      ON public.profiles FOR UPDATE
      TO authenticated
      USING (id = auth.uid() OR public.is_coach())
      WITH CHECK (id = auth.uid() OR public.is_coach());
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- 3) Safe performance indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_routines_user_id
  ON public.routines (user_id);

CREATE INDEX IF NOT EXISTS idx_routine_days_routine_dayindex
  ON public.routine_days (routine_id, day_index);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_started
  ON public.workout_sessions (user_id, started_at DESC);

COMMIT;
