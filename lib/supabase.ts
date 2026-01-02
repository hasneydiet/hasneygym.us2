import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

let hasWarned = false;

function warnIfMissingConfig() {
  if (hasWarned) return;
  if (!supabaseUrl || !supabaseAnonKey) {
    hasWarned = true;
    // Keep behavior (client still created), but make misconfig obvious during dev/test.
    // eslint-disable-next-line no-console
    console.error(
      '[supabase] Missing NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Authentication and data loading will fail until these are configured.'
    );
  }
}

warnIfMissingConfig();

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
