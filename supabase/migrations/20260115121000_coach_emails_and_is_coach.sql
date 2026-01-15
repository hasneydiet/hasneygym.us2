BEGIN;

-- Replace hard-coded coach email checks with a database-managed allowlist.
-- Keeps RLS and admin RPCs aligned, and allows rotating/adding coaches without code changes.

CREATE TABLE IF NOT EXISTS public.coach_emails (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.coach_emails ENABLE ROW LEVEL SECURITY;

-- Do not expose the allowlist to normal roles.
REVOKE ALL ON TABLE public.coach_emails FROM anon, authenticated;

-- Seed current coach email (can be changed later via SQL).
INSERT INTO public.coach_emails (email)
VALUES ('hasneybravim@gmail.com')
ON CONFLICT (email) DO NOTHING;

-- SECURITY DEFINER membership check used across RLS + server endpoints.
CREATE OR REPLACE FUNCTION public.is_coach()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.coach_emails ce
    WHERE lower(ce.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_coach() TO authenticated;

COMMIT;
