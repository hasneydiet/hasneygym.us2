DROP FUNCTION IF EXISTS public.coach_list_users() CASCADE;

CREATE OR REPLACE FUNCTION public.coach_list_users()
RETURNS TABLE(id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_coach() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::text
  FROM auth.users u
  WHERE u.email IS NOT NULL
  ORDER BY u.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.coach_list_users() TO authenticated;
