import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Coach-only server-side endpoint.
// Requires SUPABASE_SERVICE_ROLE_KEY set in the environment.
// Never expose the service role key to the browser.

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

  // Validate user session + coach email
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

  // Use RPC so the export structure remains stable across schema evolution.
  const { data, error } = await supabase.rpc('admin_export_exercise_library');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ library: data });
}
