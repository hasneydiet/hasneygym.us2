'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { getSupabaseClient } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import type { RoutineDay } from '@/lib/types';
import { sortRoutineDays } from '@/lib/routineDaySort';
import { Button } from '@/components/ui/button';
import { cacheGet, cacheSet } from '@/lib/perfCache';
import { startWorkoutForDay } from '@/lib/startWorkout';

export const dynamic = 'force-dynamic';

type RoutineDayCard = RoutineDay & {
  routineName: string;
  preview: string;
  exerciseCount: number;
  lastPerformed: string | null;
};

function formatDate(d: string | null) {
  if (!d) return 'Never';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return 'Never';
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

async function getAuthedUser() {
  const supabase = await getSupabaseClient();
// Prefer session (fast + avoids AuthSessionMissingError edge cases)
  const { data: sessData } = await supabase.auth.getSession();
  const session = sessData?.session ?? null;
  if (session?.user) return session.user;

  // Fallback to getUser (can throw "Auth session missing" in some environments)
  try {
    const res = await supabase.auth.getUser();
    if (res.error) {
      const msg = (res.error as any)?.message;
      const name = (res.error as any)?.name;
      if (name === 'AuthSessionMissingError' || (msg && /auth session missing/i.test(String(msg)))) return null;
      throw res.error;
    }
    return res.data?.user ?? null;
  } catch (e: any) {
    const msg = e?.message;
    const name = e?.name;
    if (name === 'AuthSessionMissingError' || (msg && /auth session missing/i.test(String(msg)))) return null;
    throw e;
  }
}

export default function WorkoutStartPage() {
  const router = useRouter();
  const { effectiveUserId } = useCoach();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [days, setDays] = useState<RoutineDayCard[]>([]);
  const [startingId, setStartingId] = useState<string | null>(null);

  // Mobile performance: cache the assembled cards for a short time so switching
  // tabs doesn't re-run 3 network queries every time.
  const daysCacheKey = useMemo(() => {
    return effectiveUserId ? `workout:start:days:${effectiveUserId}:v2` : null;
  }, [effectiveUserId]);

  const dayIds = useMemo(() => days.map((d) => d.id), [days]);

  useEffect(() => {
    let mounted = true;

    const loadFresh = async () => {
      setLoading(true);
      setError(null);

      try {
        const user = await getAuthedUser();
        if (!user) {
          router.push('/login');
          return;
        }

        const uid = effectiveUserId ?? user.id;

        // Load routine days + routine name (scoped to the effective user)
        const { data: dayRows, error: daysErr } = await supabase
          .from('routine_days')
          // Force inner join so the foreign-table filter is enforced
          .select('id, routine_id, day_index, name, created_at, routines!inner(name, user_id)')
          .eq('routines.user_id', uid)
          // Primary ordering must follow Day 1, Day 2, ...
          .order('day_index', { ascending: true })
          // Secondary tie-breaker for deterministic results
          .order('created_at', { ascending: true });

        if (daysErr) throw daysErr;

        const baseDaysUnsorted: RoutineDayCard[] = (dayRows || []).map((r: any) => ({
          id: r.id,
          routine_id: r.routine_id,
          day_index: r.day_index,
          name: r.name,
          created_at: r.created_at,
          routineName: r.routines?.name || 'Routine',
          preview: 'No exercises added yet',
          exerciseCount: 0,
          lastPerformed: null,
        }));

        // Enforce UI ordering by the day label (e.g., "Day 10" after "Day 2").
        // This is independent of routine names so routine renames cannot affect day mapping.
        const baseDays = sortRoutineDays(baseDaysUnsorted);

        // Mobile perf: show the list immediately after the first lightweight query.
        // The heavier preview/last-performed queries will update cards in the background.
        if (mounted) {
          setDays(baseDays);
          setLoading(false);
        }

        // Build preview with ONE query
        const ids = baseDays.map((d) => d.id);
        if (ids.length > 0) {
          // Run preview + last-performed queries in parallel for faster mobile loads
          const [exRes, sessRes] = await Promise.all([
            supabase
              .from('routine_day_exercises')
              .select('routine_day_id, order_index, exercises(name)')
              .in('routine_day_id', ids)
              .order('routine_day_id', { ascending: true })
              .order('order_index', { ascending: true }),
            supabase
              .from('workout_sessions')
              .select('routine_day_id, started_at')
              .in('routine_day_id', ids)
              .order('started_at', { ascending: false })
              .limit(500),
          ]);

          const { data: exRows, error: exErr } = exRes as any;
          if (exErr) throw exErr;

          const { data: sessRows, error: sessErr } = sessRes as any;
          if (sessErr) throw sessErr;

          const byDay: Record<string, string[]> = {};
          for (const row of exRows || []) {
            const did = (row as any).routine_day_id as string;
            const nm = (row as any).exercises?.name as string | undefined;
            if (!did) continue;
            (byDay[did] ||= []);
            if (nm) byDay[did].push(nm);
          }

          const lastByDay: Record<string, string> = {};
          for (const s of sessRows || []) {
            const did = (s as any).routine_day_id as string | null;
            const started = (s as any).started_at as string | null;
            if (!did || !started) continue;
            if (!lastByDay[did]) lastByDay[did] = started; // newest first due to order desc
          }

          // IMPORTANT: create a NEW array/object references so React rerenders (avoid mutating baseDays)
          const hydratedDays: RoutineDayCard[] = baseDays.map((d) => {
            const list = byDay[d.id] || [];
            return {
              ...d,
              exerciseCount: list.length,
              preview: list.length ? list.slice(0, 6).join(' • ') : 'No exercises added yet',
              lastPerformed: lastByDay[d.id] || null,
            };
          });

          if (!mounted) return;
          setDays(hydratedDays);
          setLoading(false);
          return;
        }

        if (!mounted) return;
        setDays(baseDays);
        if (daysCacheKey) cacheSet(daysCacheKey, baseDays, 90 * 1000);
      } catch (e: any) {
        console.error(e);
        if (!mounted) return;
        setError(e?.message || 'Failed to load routines.');
        setDays([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    // Fast path: show cached cards immediately (if present), then revalidate in background.
    if (daysCacheKey) {
      const cached = cacheGet<RoutineDayCard[]>(daysCacheKey);
      if (cached && Array.isArray(cached) && cached.length) {
        setDays(cached);
        setLoading(false);
        // Background refresh (best-effort) so the list stays current.
        const w = typeof window !== 'undefined' ? (window as any) : null;
        if (w && typeof w.requestIdleCallback === 'function') {
          w.requestIdleCallback(() => {
            if (mounted) loadFresh();
          }, { timeout: 1200 });
        } else {
          setTimeout(() => {
            if (mounted) loadFresh();
          }, 250);
        }
      } else {
        loadFresh();
      }
    } else {
      loadFresh();
    }

    const refreshOnReturn = () => {
      // Reload when the tab/window regains focus to avoid stale routine lists after coach updates.
      if (!mounted) return;
      loadFresh();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshOnReturn();
    };

    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mounted = false;
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', onVisibility);
    };

  }, [router, effectiveUserId, daysCacheKey]);

  const startRoutineDay = async (day: RoutineDayCard) => {
    try {
      setStartingId(day.id);
      setError(null);

      const user = await getAuthedUser();
      if (!user) {
        router.push('/login');
        return;
      }

      const uid = effectiveUserId ?? user.id;

      const sessionId = await startWorkoutForDay({
        userId: uid,
        routineId: day.routine_id,
        routineDayId: day.id,
      });

      router.push(`/workout/${sessionId}`);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to start routine.');
    } finally {
      setStartingId(null);
    }
  };

  return (
    <div className="app-shell pb-24">
      <Navigation />

      <div className="page max-w-3xl">
        <h1 className="page-title mb-2">Workout</h1>
        <p className="page-subtitle mb-6">Pick a day to start, or create routines first.</p>

        {error && (
          <div className="mb-4 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            {error}
          </div>
        )}

        {loading && <div className="text-muted-foreground">Loading routines…</div>}

        {!loading && days.length === 0 && (
          <div className="surface p-10 text-center text-muted-foreground">No routine days found. Create a routine first.</div>
        )}

        <div className="space-y-4">
          {days.map((day) => (
            <div key={day.id} className="tile relative overflow-hidden p-5 sm:p-6">
              <div className="pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(50%_60%_at_20%_10%,black,transparent)]">
                <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-primary/20 blur-2xl" />
                <div className="absolute -right-24 -bottom-24 h-64 w-64 rounded-full bg-emerald-500/15 blur-2xl" />
              </div>

              <div className="relative flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-xl font-semibold tracking-tight truncate">{day.routineName}</h2>
                  <p className="text-sm text-muted-foreground">{day.name}</p>

                  <p className="text-sm text-muted-foreground mt-2 max-h-[2.75rem] overflow-hidden">
                    {day.preview}
                  </p>

                  <p className="text-xs text-muted-foreground/80 mt-3">Last performed: {formatDate(day.lastPerformed)}</p>
                </div>
              </div>

              <Button
                disabled={startingId === day.id}
                onClick={() => startRoutineDay(day)}
                className="mt-4 w-full h-12 text-base font-semibold"
              >
                {startingId === day.id ? 'Starting…' : 'Start Routine'}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
