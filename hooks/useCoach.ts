'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { COACH_IMPERSONATE_EMAIL_KEY, COACH_IMPERSONATE_KEY } from '@/lib/coach';

// In some TS build setups, the inferred return type from supabase-js methods
// can degrade to `unknown`, which makes destructuring `{ data, error }` fail
// compilation. We use small local structural typings to keep builds stable
// without changing runtime behavior.
type UserGetResponse = { data: { user: { id: string; email?: string | null } | null }; error: unknown | null };
type RpcBoolResponse = { data: boolean | null; error: unknown | null };

type CoachState = {
  isCoach: boolean;
  userId: string | null;
  email: string | null;
  impersonateUserId: string | null;
  ready: boolean;
};

function isValidUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function sanitizeImpersonation(raw: string | null) {
  if (!raw) return null;
  const v = String(raw).trim();
  if (!v || v.toLowerCase() === 'null' || v.toLowerCase() === 'undefined') return null;
  if (!isValidUuid(v)) return null;
  return v;
}

export function useCoach() {
  const [state, setState] = useState<CoachState>({
    isCoach: false,
    userId: null,
    email: null,
    impersonateUserId: null,
    ready: false,
  });

  // Load initial auth state + persisted impersonation.
  useEffect(() => {
    let cancelled = false;

    // supabase-js query builders are PromiseLike (thenable) rather than native Promises.
    // Accept PromiseLike here so TypeScript doesn't fail builds when we wrap supabase calls.
    const withTimeout = async <T,>(p: PromiseLike<T>, ms: number): Promise<T> => {
      return await Promise.race([
        Promise.resolve(p),
        new Promise<T>((_resolve, reject) => {
          const id = setTimeout(() => {
            clearTimeout(id);
            reject(new Error('timeout'));
          }, ms);
        }),
      ]);
    };

    const load = async () => {
      try {
        const userRes = (await withTimeout(supabase.auth.getUser(), 7000)) as unknown as UserGetResponse;
        const user = userRes.data.user;
        const userErr = userRes.error;
        // If the client is misconfigured (missing env vars) or network fails,
        // ensure we still mark the hook as ready to avoid infinite "Loading..." screens.
        if (userErr) {
          if (!cancelled) {
            setState({
              isCoach: false,
              userId: null,
              email: null,
              impersonateUserId: null,
              ready: true,
            });
          }
          return;
        }

        const email = user?.email ?? null;
        const userId = user?.id ?? null;

        let impersonateUserId: string | null = null;
        if (typeof window !== 'undefined') {
          impersonateUserId = sanitizeImpersonation(window.localStorage.getItem(COACH_IMPERSONATE_KEY));
          if (!impersonateUserId) window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
        }

        let isCoach = false;

        if (userId) {
          const coachRes = (await withTimeout(supabase.rpc('is_coach'), 7000)) as unknown as RpcBoolResponse;
          isCoach = !coachRes.error && Boolean(coachRes.data);
        }

        // If not coach, ensure impersonation is cleared.
        if (!isCoach && typeof window !== 'undefined') {
          window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
          window.localStorage.removeItem(COACH_IMPERSONATE_EMAIL_KEY);
          impersonateUserId = null;
        }

        if (!cancelled) {
          setState({ isCoach, userId, email, impersonateUserId, ready: true });
        }
      } catch (e) {
        // Defensive: avoid infinite loading if anything unexpected happens.
        if (!cancelled) {
          setState({
            isCoach: false,
            userId: null,
            email: null,
            impersonateUserId: null,
            ready: true,
          });
        }
      }
    };

    load();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      try {
        const email = session?.user?.email ?? null;
        const userId = session?.user?.id ?? null;
        let isCoach = false;

        if (userId) {
          const coachRes = (await withTimeout(supabase.rpc('is_coach'), 7000)) as unknown as RpcBoolResponse;
          isCoach = !coachRes.error && Boolean(coachRes.data);
        }

        let impersonateUserId: string | null = null;
        if (typeof window !== 'undefined') {
          impersonateUserId = sanitizeImpersonation(window.localStorage.getItem(COACH_IMPERSONATE_KEY));
          if (!impersonateUserId) window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
          if (!isCoach) {
            window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
            window.localStorage.removeItem(COACH_IMPERSONATE_EMAIL_KEY);
            impersonateUserId = null;
          }
        }

        setState({ isCoach, userId, email, impersonateUserId, ready: true });
      } catch {
        setState({
          isCoach: false,
          userId: null,
          email: null,
          impersonateUserId: null,
          ready: true,
        });
      }
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  const effectiveUserId = useMemo(() => {
    if (!state.userId) return null;
    if (state.isCoach && state.impersonateUserId) return state.impersonateUserId;
    return state.userId;
  }, [state.userId, state.isCoach, state.impersonateUserId]);

  const setImpersonateUserId = (id: string | null) => {
    if (typeof window === 'undefined') return;

    if (!state.isCoach) {
      window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
      window.localStorage.removeItem(COACH_IMPERSONATE_EMAIL_KEY);
      setState((s) => ({ ...s, impersonateUserId: null }));
      return;
    }

    if (!id) {
      window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
      window.localStorage.removeItem(COACH_IMPERSONATE_EMAIL_KEY);
      setState((s) => ({ ...s, impersonateUserId: null }));
      return;
    }

    // Safety: only allow valid UUIDs to be persisted/used.
    if (!isValidUuid(id)) {
      window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
      window.localStorage.removeItem(COACH_IMPERSONATE_EMAIL_KEY);
      setState((s) => ({ ...s, impersonateUserId: null }));
      return;
    }

    window.localStorage.setItem(COACH_IMPERSONATE_KEY, id);
    setState((s) => ({ ...s, impersonateUserId: id }));
  };

  return {
    isCoach: state.isCoach,
    userId: state.userId,
    email: state.email,
    impersonateUserId: state.impersonateUserId,
    effectiveUserId,
    setImpersonateUserId,
    ready: state.ready,
  };
}
