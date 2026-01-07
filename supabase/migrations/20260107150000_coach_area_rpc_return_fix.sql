/*
  # Coach Area RPC Return Fix

  Fixes: "structure of query does not match function result type"

  Some Supabase/PostgREST environments are strict about matching the declared
  return column types (e.g., auth.users.email is varchar). This migration
  recreates coach_list_users() with explicit casting to match the declared
  RETURNS TABLE types.

  Safe to run multiple times.
*/

-- Ensure we replace any existing version of the function.
DROP FUNCTION IF EXISTS public.coach_list_users() CASCADE;

CREATE OR REPLACE FUNCTION public.coach_list_users()
RETURNS TABLE (
  id uuid,
  email text
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
  SELECT
    p.id,
    u.email::text
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.coach_list_users() TO authenticated;
