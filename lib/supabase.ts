'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type RuntimeConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

let cachedClient: SupabaseClient | null = null;
let inFlight: Promise<SupabaseClient> | null = null;

async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  const res = await fetch('/api/runtime-config', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load runtime config (HTTP ${res.status})`);
  }
  return (await res.json()) as RuntimeConfig;
}

/**
 * Returns a browser Supabase client configured from server-provided runtime env.
 * This avoids Next.js build-time env inlining issues in Docker/Portainer.
 */
export async function getSupabaseClient(): Promise<SupabaseClient> {
  if (cachedClient) return cachedClient;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const { supabaseUrl, supabaseAnonKey } = await fetchRuntimeConfig();

    if (!supabaseUrl || !supabaseAnonKey) {
      // eslint-disable-next-line no-console
      console.error(
        'Missing Supabase runtime config. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in the container environment.'
      );
      throw new Error(
        'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY at runtime.'
      );
    }

    // Explicit browser-auth config for session stability.
    // IMPORTANT: do NOT set a custom storageKey (it can break existing sessions across devices).
    cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    return cachedClient;
  })();

  return inFlight;
}
