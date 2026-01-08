import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Coach-only server-side endpoint.
// Requires SUPABASE_SERVICE_ROLE_KEY set in the environment.
// Never expose the service role key to the browser.

const COACH_EMAIL = 'hasneybravim@gmail.com';

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

function extractLibraryPayload(body: any): any | null {
  if (!body || typeof body !== 'object') return null;
  const lib = body.library && typeof body.library === 'object' ? body.library : body;
  if (!lib || typeof lib !== 'object') return null;

  if (!Array.isArray((lib as any).exercises)) return null;
  return { exercises: (lib as any).exercises };
}

export async function POST(req: Request) {
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
  if (email !== COACH_EMAIL.toLowerCase()) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const library = extractLibraryPayload(body);
  if (!library) {
    return NextResponse.json(
      { error: 'Malformed payload. Expected JSON with an exercises array.' },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc('admin_import_exercise_library', { p_payload: library });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ result: data });
}
