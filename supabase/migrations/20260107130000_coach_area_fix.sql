/*
  # Coach Area Fixes

  - Fixes "structure of query does not match function result type" by ensuring
    coach_list_users() returns a minimal, stable shape that matches the query.

  Safe to run after the initial coach migration.
*/

-- Postgres treats return-type changes as different signatures, so drop first.
DROP FUNCTION IF EXISTS public.coach_list_users();

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
  SELECT p.id, u.email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.coach_list_users() TO authenticated;
