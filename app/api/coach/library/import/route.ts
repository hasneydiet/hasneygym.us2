import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Coach-only server-side endpoint.
// Primary path: uses SUPABASE_SERVICE_ROLE_KEY (service role RPCs).
// Fallback path: uses the caller's JWT + RLS (coach policies) to upsert the
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

export async function POST(req: Request) {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) {
    return NextResponse.json({ error: 'Server not configured. Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL.' }, { status: 500 });
  }

  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: 'Missing Authorization header.' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const anonKey = getAnonKey();
  const serviceKey = getServiceRoleKey();
  if (!anonKey && !serviceKey) {
    return NextResponse.json(
      { error: 'Server not configured. Missing NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 500 }
    );
  }

  // User-context client for authorization checks.
  const userClient = createClient(supabaseUrl, anonKey || serviceKey!, {
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

  const payloadExercises = Array.isArray((body as any).exercises) ? (body as any).exercises : [];

  // Normalize + keep only fields that exist in the schema.
  const normalizeEquipment = (v: any) => String(v ?? '').trim().toLowerCase();
  const toInt = (v: any) => {
    const n = parseInt(String(v ?? '').trim(), 10);
    return Number.isFinite(n) ? n : null;
  };

  const upsertRows = payloadExercises
    .map((e: any) => {
      const name = String(e?.name ?? '').trim();
      const muscle_group = String(e?.muscle_group ?? '').trim();
      const muscle_section = String(e?.muscle_section ?? '').trim();
      const equipment = normalizeEquipment(e?.equipment);
      if (!name || !muscle_group || !equipment) return null;

      const rest_seconds = toInt(e?.rest_seconds);

      const tags = Array.isArray(e?.default_technique_tags)
        ? e.default_technique_tags
        : typeof e?.default_technique_tags === 'string'
          ? String(e.default_technique_tags)
              .split(';')
              .map((t) => t.trim())
              .filter(Boolean)
          : [];

      const scheme = e?.default_set_scheme && typeof e.default_set_scheme === 'object' ? e.default_set_scheme : null;
      const normScheme = scheme && (scheme.sets || scheme.reps || scheme.restSeconds || scheme.notes)
        ? {
            sets: toInt(scheme.sets) ?? undefined,
            reps: toInt(scheme.reps) ?? undefined,
            restSeconds: toInt(scheme.restSeconds) ?? undefined,
            notes: scheme.notes ? String(scheme.notes) : undefined,
          }
        : null;

      return {
        name,
        muscle_group,
        muscle_section,
        equipment,
        notes: e?.notes ? String(e.notes) : '',
        rest_seconds: rest_seconds ?? 60,
        default_technique_tags: tags,
        default_set_scheme: normScheme,
      };
    })
    .filter(Boolean) as any[];

  // Upsert exercises. Service role bypasses RLS; otherwise coach policies allow it.
  const dbClient = serviceKey
    ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : userClient;

  const { error } = await dbClient
    .from('exercises')
    .upsert(upsertRows, { onConflict: 'name,muscle_group,muscle_section,equipment' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, exercises_upserted: upsertRows.length });
}
