'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import type { Routine, RoutineDay, RoutineDayExercise, WorkoutSession } from '@/lib/types';

export const dynamic = 'force-dynamic';

type RoutineWithDays = Routine & { routine_days: RoutineDay[] };

export default function WorkoutStartPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [startingDayId, setStartingDayId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [routines, setRoutines] = useState<RoutineWithDays[]>([]);
  const [lastPerformedByDay, setLastPerformedByDay] = useState<Record<string, string>>({});

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      setLoading(false);
      return;
    }

    // Load routines with days (single request)
    const { data: routinesData, error: routinesErr } = await supabase
      .from('routines')
      .select('*, routine_days(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (routinesErr) {
      console.error(routinesErr);
      setError('Failed to load routines');
      setLoading(false);
      return;
    }

    const normalized: RoutineWithDays[] = (routinesData || []).map((r: any) => ({
      ...r,
      routine_days: (r.routine_days || []).sort((a: any, b: any) => (a.day_index ?? 0) - (b.day_index ?? 0)),
    }));
    setRoutines(normalized);

    // Last performed per routine day (fast single query)
    const { data: sessionsData, error: sessionsErr } = await supabase
      .from('workout_sessions')
      .select('routine_day_id, started_at')
      .eq('user_id', user.id)
      .not('routine_day_id', 'is', null)
      .order('started_at', { ascending: false })
      .limit(300);

    if (!sessionsErr && sessionsData) {
      const map: Record<string, string> = {};
      for (const s of sessionsData as any[]) {
        if (!s.routine_day_id) continue;
        if (map[s.routine_day_id]) continue; // keep most recent
        map[s.routine_day_id] = s.started_at;
      }
      setLastPerformedByDay(map);
    }

    setLoading(false);
  };

  const hasAnyRoutines = routines.length > 0;

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  const startRoutineDay = async (routine: Routine, day: RoutineDay) => {
    if (startingDayId) return;
    setStartingDayId(day.id);
    setError(null);

    try {
      const { data: userRes } = await supabase.auth.getUser();
      const user = userRes?.user;
      if (!user) {
        setError('You must be logged in');
        return;
      }

      // 1) Create workout session
      const { data: session, error: sessionErr } = await supabase
        .from('workout_sessions')
        .insert({
          user_id: user.id,
          routine_id: routine.id,
          routine_day_id: day.id,
          started_at: new Date().toISOString(),
        })
        .select()
        .single<WorkoutSession>();

      if (sessionErr || !session) {
        console.error(sessionErr);
        setError('Failed to start workout');
        return;
      }

      // 2) Copy template exercises -> workout_exercises
      const { data: templateExercises, error: templateErr } = await supabase
        .from('routine_day_exercises')
        .select('id, exercise_id, order_index, superset_group_id')
        .eq('routine_day_id', day.id)
        .order('order_index', { ascending: true })
        .returns<RoutineDayExercise[]>();

      if (templateErr) {
        console.error(templateErr);
        setError('Failed to load routine exercises');
        return;
      }

      if (!templateExercises || templateExercises.length === 0) {
        // No exercises in this day yet
        router.push(`/workout/${session.id}`);
        return;
      }

      const workoutExercisesPayload = templateExercises.map((te: any, idx: number) => ({
        workout_session_id: session.id,
        exercise_id: te.exercise_id,
        order_index: te.order_index ?? idx,
        superset_group_id: te.superset_group_id ?? null,
        technique_tags: [],
      }));

      const { data: insertedWorkoutExercises, error: weErr } = await supabase
        .from('workout_exercises')
        .insert(workoutExercisesPayload)
        .select('id')
        .order('order_index', { ascending: true });

      if (weErr) {
        console.error(weErr);
        setError('Failed to create workout exercises');
        return;
      }

      // 3) Create one starter set per exercise (nice UX)
      const weIds = (insertedWorkoutExercises || []).map((r: any) => r.id);
      if (weIds.length) {
        const setsPayload = weIds.map((id: string) => ({
          workout_exercise_id: id,
          set_index: 0,
          reps: 0,
          weight: 0,
          rpe: null,
          is_completed: false,
          notes: '',
        }));

        const { error: setErr } = await supabase.from('workout_sets').insert(setsPayload);
        if (setErr) {
          // Non-fatal; workout page can still run.
          console.warn('Starter set insert failed:', setErr);
        }
      }

      router.push(`/workout/${session.id}`);
    } finally {
      setStartingDayId(null);
    }
  };

  const routineCountLabel = useMemo(() => {
    if (routines.length === 0) return '';
    return `${routines.length} routine${routines.length === 1 ? '' : 's'}`;
  }, [routines.length]);

  return (
    <AuthGuard>
      <div className="min-h-screen bg-black text-white pb-28">
        <Navigation />

        <div className="max-w-3xl mx-auto px-4 pt-6">
          <div className="flex items-end justify-between gap-4 mb-4">
            <div>
              <h1 className="text-3xl font-bold">Workout</h1>
              {routineCountLabel && <p className="text-sm text-gray-400 mt-1">{routineCountLabel}</p>}
            </div>
            <button
              onClick={() => router.push('/routines')}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
            >
              Edit Routines
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-red-300">{error}</div>
          )}

          {loading && <div className="text-gray-400">Loading routines…</div>}

          {!loading && !hasAnyRoutines && (
            <div className="rounded-2xl bg-white/5 p-5">
              <p className="text-gray-200 font-semibold mb-1">No routines yet</p>
              <p className="text-gray-400 text-sm mb-4">
                Create a routine with workout days, then come back here to start.
              </p>
              <button
                onClick={() => router.push('/routines')}
                className="w-full rounded-xl bg-sky-500 py-4 text-lg font-semibold text-black hover:bg-sky-400 transition"
              >
                Create Routine
              </button>
            </div>
          )}

          {!loading && hasAnyRoutines && (
            <div className="space-y-4">
              {routines.map((routine) => (
                <div key={routine.id} className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-5 shadow-lg">
                  <div className="mb-4">
                    <h2 className="text-xl font-semibold">{routine.name}</h2>
                    {routine.notes ? (
                      <p className="text-sm text-gray-400 mt-1">{routine.notes}</p>
                    ) : (
                      <p className="text-sm text-gray-500 mt-1">Pick a day to start</p>
                    )}
                  </div>

                  <div className="space-y-3">
                    {(routine.routine_days || []).map((day) => {
                      const last = lastPerformedByDay[day.id];
                      const isStarting = startingDayId === day.id;
                      return (
                        <button
                          key={day.id}
                          onClick={() => startRoutineDay(routine, day)}
                          disabled={!!startingDayId}
                          className="w-full rounded-xl bg-white/10 hover:bg-white/15 transition p-4 text-left disabled:opacity-60"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-lg font-semibold">{day.name}</div>
                              <div className="text-xs text-gray-400 mt-1">
                                {last ? `Last performed: ${formatDate(last)}` : 'Last performed: —'}
                              </div>
                            </div>
                            <div className="shrink-0">
                              <span className="inline-flex items-center rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-black">
                                {isStarting ? 'Starting…' : 'Start'}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}

                    {(routine.routine_days || []).length === 0 && (
                      <div className="rounded-xl bg-white/5 p-4 text-gray-300">
                        <div className="font-semibold">No workout days in this routine</div>
                        <div className="text-sm text-gray-400 mt-1">Go to Edit Routines and add days.</div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
