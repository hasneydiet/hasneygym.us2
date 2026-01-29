import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Server-side endpoint used by Coach UI.
//
// Primary path: uses SUPABASE_SERVICE_ROLE_KEY (admin API).
// Fallback path (when service role is not configured):
//   - validates caller via Bearer token
//   - authorizes via public.is_coach()
//   - returns users via public.coach_list_users() RPC

type PublicUser = { id: string; email: string | null };

function getSupabaseUrl(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || null;
}

function getAnonKey(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || null;
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
  if (!supabaseUrl) {
    return NextResponse.json(
      { error: 'Server not configured. Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL.' },
      { status: 500 }
    );
  }

  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: 'Missing Authorization header.' }, { status: 401 });
  }

  const anonKey = getAnonKey();
  if (!anonKey) {
    return NextResponse.json(
      { error: 'Server not configured. Missing NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY.' },
      { status: 500 }
    );
  }

  // Always validate & authorize using the caller's JWT context.
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 });
  }

  const { data: isCoach, error: coachErr } = await userClient.rpc('is_coach');
  if (coachErr) {
    return NextResponse.json({ error: coachErr.message }, { status: 500 });
  }
  if (!isCoach) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  const serviceKey = getServiceRoleKey();

  // Preferred (admin API) path when service role is available.
  if (serviceKey) {
    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const all: Array<{ id: string; email?: string | null }> = [];
    const perPage = 200;

    for (let page = 1; page <= 50; page++) {
      const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage });
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

    users.sort((a, b) => (a.email || '').localeCompare(b.email || ''));

    return NextResponse.json({ users });
  }

  // Fallback path: use the existing coach_list_users() RPC.
  const { data, error } = await userClient.rpc('coach_list_users');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const users: PublicUser[] = (Array.isArray(data) ? data : [])
    .map((u: any) => ({ id: String(u.id), email: u.email ?? null }))
    .filter((u) => u.id);

  // Keep stable ordering.
  users.sort((a, b) => (a.email || '').localeCompare(b.email || ''));

  return NextResponse.json({ users });
}
