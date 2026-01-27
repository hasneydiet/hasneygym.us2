import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const _missingEnvMessage =
  'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your platform env/secret manager (and locally in .env.local).';

// During container image builds, some platforms do not pass build args/env into
// the build step. Avoid failing the *image build* in that case; instead, throw
// on first client usage at runtime if still misconfigured.
const _isBuildStep = process.env.npm_lifecycle_event === 'build';

// Explicit browser-auth config for session stability.
// IMPORTANT: do NOT set a custom storageKey (it can break existing sessions across devices).
export const supabase: ReturnType<typeof createClient> = (() => {
  if (!supabaseUrl || !supabaseAnonKey) {
    if (!_isBuildStep) {
      // eslint-disable-next-line no-console
      console.error(_missingEnvMessage);
    }

    // Stub that throws if anything tries to use it.
    return new Proxy(
      {},
      {
        get() {
          throw new Error('Supabase is not configured (missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).');
        },
      }
    ) as any;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
})();
