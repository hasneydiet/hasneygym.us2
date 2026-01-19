/**
 * Tiny browser-storage cache used to reduce repeat network work on mobile.
 *
 * Security notes:
 * - Callers MUST include auth scope in keys (effective user id + coach impersonation mode).
 * - Values are short-lived (TTL enforced) and contain only non-sensitive UI data.
 */

export type CacheEnvelope<T> = {
  v: T;
  exp: number; // epoch ms
};

const PREFIX = 'gym:cache:';

function now() {
  return Date.now();
}

export function cacheGet<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    // Prefer localStorage so fast-path works even after the app is backgrounded/closed.
    // Fall back to sessionStorage if localStorage is unavailable.
    const raw =
      window.localStorage.getItem(PREFIX + key) ?? window.sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.exp !== 'number' || parsed.exp <= now()) {
      window.localStorage.removeItem(PREFIX + key);
      window.sessionStorage.removeItem(PREFIX + key);
      return null;
    }
    return (parsed.v ?? null) as T | null;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, value: T, ttlMs: number) {
  if (typeof window === 'undefined') return;
  try {
    const env: CacheEnvelope<T> = { v: value, exp: now() + Math.max(0, ttlMs) };
    // Write-through to both, best-effort.
    const raw = JSON.stringify(env);
    window.localStorage.setItem(PREFIX + key, raw);
    window.sessionStorage.setItem(PREFIX + key, raw);
  } catch {
    // Ignore (storage full / private mode)
  }
}

export function cacheDel(key: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PREFIX + key);
    window.sessionStorage.removeItem(PREFIX + key);
  } catch {
    // Ignore
  }
}
