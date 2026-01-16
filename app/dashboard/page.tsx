'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import AuthGuard from '@/components/AuthGuard';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import { sortRoutineDays } from '@/lib/routineDaySort';
import { cacheGet, cacheSet } from '@/lib/perfCache';
import { startWorkoutForDay } from '@/lib/startWorkout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Play, History, Dumbbell, Calendar } from 'lucide-react';

export const dynamic = 'force-dynamic';

type DashboardDay = {
  id: string;
  routine_id: string;
  day_index: number;
  name: string;
  created_at: string;
  routineName: string;
};

type LastWorkout = {
  id: string;
  started_at: string;
  routine_day_id: string | null;
  routine_id: string | null;
  routineName: string;
  dayName: string | null;
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function getAuthedUser() {
  const { data: sessData } = await supabase.auth.getSession();
  const session = sessData?.session ?? null;
  if (session?.user) return session.user;
  try {
    const res = await supabase.auth.getUser();
    if (res.error) return null;
    return res.data?.user ?? null;
  } catch {
    return null;
  }
}

export default function DashboardPage() {
  const router = useRouter();
  const { effectiveUserId } = useCoach();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [days, setDays] = useState<DashboardDay[]>([]);
  const [lastWorkout, setLastWorkout] = useState<LastWorkout | null>(null);
  const [starting, setStarting] = useState(false);

  const cacheKey = useMemo(() => {
    return effectiveUserId ? `dashboard:${effectiveUserId}:v1` : null;
  }, [effectiveUserId]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const user = await getAuthedUser();
        if (!user) {
          router.replace('/login');
          return;
        }
        const uid = effectiveUserId ?? user.id;

        // 1) Load ordered routine days (lightweight) so we can suggest the next workout.
        const { data: dayRows, error: daysErr } = await supabase
          .from('routine_days')
          .select('id, routine_id, day_index, name, created_at, routines!inner(name, user_id)')
          .eq('routines.user_id', uid)
          .order('day_index', { ascending: true })
          .order('created_at', { ascending: true });

        if (daysErr) throw daysErr;

        const baseDays = sortRoutineDays(
          (dayRows || []).map((r: any) => ({
            id: r.id,
            routine_id: r.routine_id,
            day_index: r.day_index,
            name: r.name,
            created_at: r.created_at,
            routineName: r.routines?.name || 'Routine',
          }))
        ) as DashboardDay[];

        // 2) Load last workout (single row) to show history + determine next day.
        const { data: lastRow, error: lastErr } = await supabase
          .from('workout_sessions')
          .select('id, started_at, routine_day_id, routine_id, routines(name), routine_days(name)')
          .eq('user_id', uid)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastErr) throw lastErr;

        const last: LastWorkout | null = lastRow
          ? {
              id: (lastRow as any).id,
              started_at: (lastRow as any).started_at,
              routine_day_id: (lastRow as any).routine_day_id ?? null,
              routine_id: (lastRow as any).routine_id ?? null,
              routineName: (lastRow as any).routines?.name || 'Workout',
              dayName: (lastRow as any).routine_days?.name ?? null,
            }
          : null;

        if (!mounted) return;
        setDays(baseDays);
        setLastWorkout(last);
        if (cacheKey) cacheSet(cacheKey, { days: baseDays, lastWorkout: last }, 60 * 1000);
      } catch (e: any) {
        console.error(e);
        if (!mounted) return;
        setError(e?.message || 'Failed to load dashboard.');
        setDays([]);
        setLastWorkout(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    // Fast path: show cached data immediately, then revalidate.
    if (cacheKey) {
      const cached = cacheGet<{ days: DashboardDay[]; lastWorkout: LastWorkout | null }>(cacheKey);
      if (cached && cached.days) {
        setDays(cached.days || []);
        setLastWorkout(cached.lastWorkout ?? null);
        setLoading(false);
        setTimeout(() => mounted && load(), 200);
      } else {
        load();
      }
    } else {
      load();
    }

    return () => {
      mounted = false;
    };
  }, [router, effectiveUserId, cacheKey]);

  const nextDay = useMemo(() => {
    if (!days.length) return null;
    if (!lastWorkout?.routine_day_id) return days[0];
    const idx = days.findIndex((d) => d.id === lastWorkout.routine_day_id);
    if (idx === -1) return days[0];
    return days[(idx + 1) % days.length];
  }, [days, lastWorkout]);

  const startNext = async () => {
    if (!nextDay) return;
    try {
      setStarting(true);
      setError(null);

      const user = await getAuthedUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      const uid = effectiveUserId ?? user.id;
      const sessionId = await startWorkoutForDay({
        userId: uid,
        routineId: nextDay.routine_id,
        routineDayId: nextDay.id,
      });
      router.push(`/workout/${sessionId}`);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to start workout.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <AuthGuard>
      <div className="app-shell pb-24">
        <Navigation />

        <div className="page max-w-3xl">
          <h1 className="page-title mb-2">Dashboard</h1>
          <p className="page-subtitle mb-6">Your last workout and the next suggested day.</p>

          {error && (
            <div className="mb-4 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-muted-foreground">Loading…</div>
          ) : (
            <div className="space-y-4">
              <Card className="shadow-lg shadow-black/5">
                <CardContent className="p-6">
                  <h2 className="text-lg font-semibold tracking-tight mb-3">Last workout</h2>
                  {lastWorkout ? (
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{lastWorkout.routineName}</div>
                        {lastWorkout.dayName ? <div className="text-sm text-muted-foreground">{lastWorkout.dayName}</div> : null}
                        <div className="text-sm text-muted-foreground mt-2">{formatDateTime(lastWorkout.started_at)}</div>
                      </div>
                      <Button variant="outline" onClick={() => router.push('/history')} className="shrink-0">
                        <History className="w-4 h-4 mr-2" />
                        History
                      </Button>
                    </div>
                  ) : (
                    <div className="text-muted-foreground">No workouts yet. Start your first workout below.</div>
                  )}
                </CardContent>
              </Card>

              <div className="tile relative overflow-hidden p-5 sm:p-6">
                <div className="pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(50%_60%_at_20%_10%,black,transparent)]">
                  <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-primary/20 blur-2xl" />
                  <div className="absolute -right-24 -bottom-24 h-64 w-64 rounded-full bg-emerald-500/15 blur-2xl" />
                </div>

                <div className="relative">
                  <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Next suggested workout</h2>
                  {nextDay ? (
                    <>
                      <p className="text-sm text-muted-foreground mt-1">{nextDay.routineName}</p>
                      <p className="text-sm text-muted-foreground">{nextDay.name}</p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-1">Create routines first to see a suggestion.</p>
                  )}

                  <Button
                    disabled={!nextDay || starting}
                    onClick={startNext}
                    className="mt-4 w-full h-12 text-base font-semibold"
                  >
                    {starting ? 'Starting…' : 'Start Workout'}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Button variant="outline" onClick={() => router.push('/workout/start')} className="h-12">
                  <Play className="w-4 h-4 mr-2" /> Workout
                </Button>
                <Button variant="outline" onClick={() => router.push('/exercises')} className="h-12">
                  <Dumbbell className="w-4 h-4 mr-2" /> Exercises
                </Button>
                <Button variant="outline" onClick={() => router.push('/routines')} className="h-12">
                  <Calendar className="w-4 h-4 mr-2" /> Routines
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
