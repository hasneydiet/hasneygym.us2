import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Coach-only server-side endpoint.
// Primary path: uses SUPABASE_SERVICE_ROLE_KEY (service role RPCs).
// Fallback path: uses the caller's JWT + RLS (coach policies) to read the
// shared library directly.

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
    return NextResponse.json({ error: 'Server not configured. Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL.' }, { status: 500 });
  }

  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: 'Missing Authorization header.' }, { status: 401 });
  }

  const anonKey = getAnonKey();
  if (!anonKey && !getServiceRoleKey()) {
    return NextResponse.json(
      { error: 'Server not configured. Missing SUPABASE_ANON_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 500 }
    );
  }

  // User-scoped client (authorizes via RLS + is_coach()).
  const userClient = createClient(supabaseUrl, anonKey || 'anon-key-missing', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Validate session.
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 });
  }

  // Authorize coach.
  const { data: isCoach, error: coachErr } = await userClient.rpc('is_coach');
  if (coachErr) {
    return NextResponse.json({ error: coachErr.message }, { status: 500 });
  }
  if (!isCoach) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  const serviceKey = getServiceRoleKey();

  // Preferred path: existing RPC restricted to service role.
  if (serviceKey) {
    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await serviceClient.rpc('admin_export_exercise_library');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ library: data });
  }

  // Fallback path: export directly from the exercises table (RLS allows coach).
  const { data: exercises, error } = await userClient
    .from('exercises')
    .select('*')
    .order('muscle_group')
    .order('muscle_section')
    .order('name');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const library = {
    version: 1,
    exported_at: new Date().toISOString(),
    exercises: exercises || [],
  };

  return NextResponse.json({ library });
}
