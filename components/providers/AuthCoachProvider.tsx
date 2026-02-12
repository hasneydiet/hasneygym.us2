'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { COACH_IMPERSONATE_EMAIL_KEY, COACH_IMPERSONATE_KEY } from '@/lib/coach';

// NOTE: This provider centralizes auth + coach/impersonation state so we do NOT
// repeatedly call supabase.auth.getUser()/getSession() on every tab/page.

type UserShape = { id: string; email?: string | null };

type CoachState = {
  loading: boolean;
  user: UserShape | null;
  isCoach: boolean;
  impersonateUserId: string | null;
  effectiveUserId: string | null;
  setImpersonateUserId: (id: string | null) => void;
};

const AuthCoachContext = createContext<CoachState | null>(null);

// Cross-route/mobile performance: cache coach status for a short TTL to avoid
// repeating the RPC when auth state changes frequently (e.g., hot reload).
const COACH_CACHE_KEY = 'HCORE_COACH_CACHE_V1';
const COACH_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

type CoachCache = { userId: string; isCoach: boolean; ts: number };

let memCoachCache: CoachCache | null = null;

function readCoachCache(userId: string): boolean | null {
  const now = Date.now();
  if (memCoachCache && memCoachCache.userId === userId && now - memCoachCache.ts < COACH_CACHE_TTL_MS) {
    return memCoachCache.isCoach;
  }
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(COACH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CoachCache;
    if (!parsed || parsed.userId !== userId) return null;
    if (now - parsed.ts >= COACH_CACHE_TTL_MS) return null;
    memCoachCache = parsed;
    return parsed.isCoach;
  } catch {
    return null;
  }
}

function writeCoachCache(userId: string, isCoach: boolean) {
  const entry: CoachCache = { userId, isCoach, ts: Date.now() };
  memCoachCache = entry;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COACH_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore
  }
}

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

async function resolveCoach(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const cached = readCoachCache(userId);
  if (cached !== null) return cached;
  try {
    const coachRes = await supabase.rpc('is_coach');
    const isCoach = !coachRes.error && Boolean(coachRes.data);
    writeCoachCache(userId, isCoach);
    return isCoach;
  } catch {
    return false;
  }
}

export function AuthCoachProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserShape | null>(null);
  const [isCoach, setIsCoach] = useState(false);
  const [impersonateUserId, setImpersonateUserIdState] = useState<string | null>(null);

  // Initial auth + coach determination.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        // getSession is cheap and avoids an extra network hop in many cases.
        const { data } = await supabase.auth.getSession();
        const u = (data.session?.user ?? null) as any;
        const nextUser: UserShape | null = u ? { id: u.id, email: u.email ?? null } : null;

        let nextImpersonate: string | null = null;
        if (typeof window !== 'undefined') {
          nextImpersonate = sanitizeImpersonation(window.localStorage.getItem(COACH_IMPERSONATE_KEY));
          if (!nextImpersonate) window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
        }

        const nextIsCoach = await resolveCoach(nextUser?.id ?? null);

        // If not coach, ensure impersonation is cleared.
        if (!nextIsCoach && typeof window !== 'undefined') {
          window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
          window.localStorage.removeItem(COACH_IMPERSONATE_EMAIL_KEY);
          nextImpersonate = null;
        }

        if (!cancelled) {
          setUser(nextUser);
          setIsCoach(nextIsCoach);
          setImpersonateUserIdState(nextImpersonate);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          setIsCoach(false);
          setImpersonateUserIdState(null);
          setLoading(false);
        }
      }
    };

    load();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = (session?.user ?? null) as any;
      const nextUser: UserShape | null = u ? { id: u.id, email: u.email ?? null } : null;
      const nextIsCoach = await resolveCoach(nextUser?.id ?? null);

      let nextImpersonate: string | null = null;
      if (typeof window !== 'undefined') {
        nextImpersonate = sanitizeImpersonation(window.localStorage.getItem(COACH_IMPERSONATE_KEY));
        if (!nextImpersonate) window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
        if (!nextIsCoach) {
          window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
          window.localStorage.removeItem(COACH_IMPERSONATE_EMAIL_KEY);
          nextImpersonate = null;
        }
      }

      setUser(nextUser);
      setIsCoach(nextIsCoach);
      setImpersonateUserIdState(nextImpersonate);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  const setImpersonateUserId = (id: string | null) => {
    if (typeof window === 'undefined') return;

    if (!isCoach) {
      window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
      window.localStorage.removeItem(COACH_IMPERSONATE_EMAIL_KEY);
      setImpersonateUserIdState(null);
      return;
    }

    if (!id) {
      window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
      window.localStorage.removeItem(COACH_IMPERSONATE_EMAIL_KEY);
      setImpersonateUserIdState(null);
      return;
    }

    // Safety: only allow valid UUIDs to be persisted/used.
    if (!isValidUuid(id)) {
      window.localStorage.removeItem(COACH_IMPERSONATE_KEY);
      window.localStorage.removeItem(COACH_IMPERSONATE_EMAIL_KEY);
      setImpersonateUserIdState(null);
      return;
    }

    window.localStorage.setItem(COACH_IMPERSONATE_KEY, id);
    setImpersonateUserIdState(id);
  };

  const effectiveUserId = useMemo(() => {
    if (!user?.id) return null;
    if (isCoach && impersonateUserId) return impersonateUserId;
    return user.id;
  }, [user?.id, isCoach, impersonateUserId]);

  const value: CoachState = {
    loading,
    user,
    isCoach,
    impersonateUserId,
    effectiveUserId,
    setImpersonateUserId,
  };

  return <AuthCoachContext.Provider value={value}>{children}</AuthCoachContext.Provider>;
}

export function useAuthCoach() {
  const ctx = useContext(AuthCoachContext);
  if (!ctx) throw new Error('useAuthCoach must be used within AuthCoachProvider');
  return ctx;
}
