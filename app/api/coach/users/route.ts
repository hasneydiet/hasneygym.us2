import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Server-side only endpoint.
// Requires SUPABASE_SERVICE_ROLE_KEY set in the environment.
// Never expose the service role key to the browser.

type PublicUser = { id: string; email: string | null };

function getSupabaseUrl(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || null;
}

function getServiceRoleKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function GET(req: Request) {
  const supabaseUrl = getSupabaseUrl();
  const serviceKey = getServiceRoleKey();

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: 'Server not configured. Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 500 }
    );
  }

  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: 'Missing Authorization header.' }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 });
  }

  const email = (userData.user.email || '').toLowerCase();
  if (!email) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  // DB-driven coach allowlist (service role bypasses RLS).
  const { data: coachRow, error: coachErr } = await supabase
    .from('coach_emails')
    .select('email')
    .eq('email', email)
    .maybeSingle();

  if (coachErr) {
    return NextResponse.json({ error: coachErr.message }, { status: 500 });
  }
  if (!coachRow) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  // Fetch users from Supabase Auth via Admin API.
  const all: Array<{ id: string; email?: string | null; created_at?: string }> = [];
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const batch = data?.users || [];
    all.push(...batch);

    if (batch.length < perPage) break;
  }

  const users: PublicUser[] = all
    .map((u) => ({ id: u.id, email: u.email ?? null }))
    .filter((u) => u.id);

  // Keep stable ordering: newest first when possible.
  users.sort((a, b) => (a.email || '').localeCompare(b.email || ''));

  return NextResponse.json({ users });
}
