'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { COACH_EMAIL, COACH_IMPERSONATE_KEY } from '@/lib/coach';

type CoachState = {
  isCoach: boolean;
  userId: string | null;
  email: string | null;
  impersonateUserId: string | null;
};

export function useCoach() {
  const [state, setState] = useState<CoachState>({
    isCoach: false,
    userId: null,
    email: null,
    impersonateUserId: null,
  });

  // Load initial auth state + persisted impersonation.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email ?? null;
      const userId = user?.id ?? null;

      let impersonateUserId: string | null = null;
      if (typeof window !== 'undefined') {
        impersonateUserId = window.localStorage.getItem(COACH_IMPERSONATE_KEY);
      }

      const isCoach = !!email && email.toLowerCase() === COACH_EMAIL.toLowerCase();

      // If not coach, ensure impersonation is cleared.
      if (!isCoach && typeof window !== 'undefined') {
        window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
        impersonateUserId = null;
      }

      if (!cancelled) {
        setState({ isCoach, userId, email, impersonateUserId });
      }
    };

    load();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const email = session?.user?.email ?? null;
      const userId = session?.user?.id ?? null;
      const isCoach = !!email && email.toLowerCase() === COACH_EMAIL.toLowerCase();

      let impersonateUserId: string | null = null;
      if (typeof window !== 'undefined') {
        impersonateUserId = window.localStorage.getItem(COACH_IMPERSONATE_KEY);
        if (!isCoach) {
          window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
          impersonateUserId = null;
        }
      }

      setState({ isCoach, userId, email, impersonateUserId });
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
      setState((s) => ({ ...s, impersonateUserId: null }));
      return;
    }

    if (!id) {
      window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
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
  };
}
