'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import type { RoutineDay } from '@/lib/types';

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

export default function WorkoutStartPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [days, setDays] = useState<RoutineDayCard[]>([]);
  const [startingId, setStartingId] = useState<string | null>(null);

  const dayIds = useMemo(() => days.map((d) => d.id), [days]);

  const safeGetUser = async () => {
    const res = await supabase.auth.getUser();
    const user = res.data?.user ?? null;
    const userErr = res.error as any;

    // Some browsers/environments can return "Auth session missing!".
    // Treat as logged-out and redirect (prevents desktop from showing the error banner).
    if (userErr) {
      const name = userErr?.name;
      const msg = userErr?.message;

      if (
        name === 'AuthSessionMissingError' ||
        msg === 'Auth session missing!' ||
        /Auth session missing/i.test(String(msg))
      ) {
        return { user: null, isMissingSession: true } as const;
      }

      return { user: null, error: userErr, isMissingSession: false } as const;
    }

    return { user, isMissingSession: false } as const;
  };

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const { user, error: userErr, isMissingSession } = await safeGetUser();
        if (isMissingSession || !user) {
          router.push('/login');
          return;
        }

        if (userErr) throw userErr;

        // Load routine days + routine name
        const { data: dayRows, error: daysErr } = await supabase
          .from('routine_days')
          .select('id, routine_id, day_index, name, created_at, routines(name)')
          .order('created_at', { ascending: true })
          .order('day_index', { ascending: true });

        if (daysErr) throw daysErr;

        const baseDays: RoutineDayCard[] = (dayRows || []).map((r: any) => ({
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

        // Build preview with ONE query
        const ids = baseDays.map((d) => d.id);
        if (ids.length > 0) {
          const { data: exRows, error: exErr } = await supabase
            .from('routine_day_exercises')
            .select('routine_day_id, order_index, exercises(name)')
            .in('routine_day_id', ids)
            .order('routine_day_id', { ascending: true })
            .order('order_index', { ascending: true });

          if (exErr) throw exErr;

          const byDay: Record<string, string[]> = {};
          for (const row of exRows || []) {
            const did = (row as any).routine_day_id as string;
            const nm = (row as any).exercises?.name as string | undefined;
            if (!did) continue;
            if (!byDay[did]) byDay[did] = [];
            if (nm) byDay[did].push(nm);
          }

          for (const d of baseDays) {
            const list = byDay[d.id] || [];
            d.exerciseCount = list.length;
            d.preview = list.length ? list.slice(0, 6).join(' • ') : 'No exercises added yet';
          }

          // Last performed date per day (use latest started_at)
          const { data: sessRows, error: sessErr } = await supabase
            .from('workout_sessions')
            .select('routine_day_id, started_at')
            .in('routine_day_id', ids)
            .order('started_at', { ascending: false })
            .limit(500);

          if (sessErr) throw sessErr;

          const lastByDay: Record<string, string> = {};
          for (const s of sessRows || []) {
            const did = (s as any).routine_day_id as string | null;
            const started = (s as any).started_at as string | null;
            if (!did || !started) continue;
            if (!lastByDay[did]) lastByDay[did] = started; // newest due to desc
          }

          for (const d of baseDays) {
            d.lastPerformed = lastByDay[d.id] || null;
          }
        }

        if (!mounted) return;
        setDays(baseDays);
      } catch (e: any) {
        console.error(e);
        if (!mounted) return;
        setError(e?.message || 'Failed to load routines.');
        setDays([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [router]);

  const startRoutineDay = async (day: RoutineDayCard) => {
    try {
      setStartingId(day.id);
      setError(null);

      const { user, error: userErr, isMissingSession } = await safeGetUser();
      if (isMissingSession || !user) {
        router.push('/login');
        return;
      }

      if (userErr) throw userErr;

      // 1) Create session
      const { data: session, error: sessErr } = await supabase
        .from('workout_sessions')
        .insert({
          user_id: user.id,
          routine_id: day.routine_id,
          routine_day_id: day.id,
          started_at: new Date().toISOString(),
          ended_at: null,
          notes: '',
        })
        .select()
        .single();

      if (sessErr) throw sessErr;
      if (!session?.id) throw new Error('Failed to create workout session.');

      // 2) Pull routine_day_exercises
      const { data: rdeRows, error: rdeErr } = await supabase
        .from('routine_day_exercises')
        .select('exercise_id, order_index')
        .eq('routine_day_id', day.id)
        .order('order_index', { ascending: true });

      if (rdeErr) throw rdeErr;

      const exercisesToInsert =
        (rdeRows || [])
          .filter((r: any) => r.exercise_id)
          .map((r: any) => ({
            workout_session_id: session.id,
            exercise_id: r.exercise_id,
            order_index: r.order_index ?? 0,
            technique_tags: [],
          })) || [];

      if (exercisesToInsert.length > 0) {
        // 3) Insert workout_exercises
        const { data: weRows, error: weErr } = await supabase
          .from('workout_exercises')
          .insert(exercisesToInsert)
          .select('id');

        if (weErr) throw weErr;

        // 4) Insert one starter set per workout_exercise
        const setsToInsert =
          (weRows || []).map((we: any) => ({
            workout_exercise_id: we.id,
            set_index: 0,
            reps: 0,
            weight: 0,
            rpe: null,
            is_completed: false,
          })) || [];

        if (setsToInsert.length > 0) {
          const { error: wsErr } = await supabase.from('workout_sets').insert(setsToInsert);
          if (wsErr) throw wsErr;
        }
      }

      router.push(`/workout/${session.id}`);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to start routine.');
    } finally {
      setStartingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      <Navigation />

      <div className="max-w-3xl mx-auto px-4 pt-6">
        <h1 className="text-3xl font-bold mb-4">Workout</h1>

        {error && <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-red-300">{error}</div>}

        {loading && <div className="text-gray-400">Loading routines…</div>}

        {!loading && days.length === 0 && (
          <div className="text-gray-400">No routine days found. Create a routine first.</div>
        )}

        <div className="space-y-4">
          {days.map((day) => (
            <div key={day.id} className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-5 shadow-lg">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold truncate">{day.routineName}</h2>
                  <p className="text-sm text-gray-300">{day.name}</p>

                  <p className="text-sm text-gray-400 mt-2 line-clamp-2">{day.preview}</p>

                  <p className="text-sm text-gray-400 mt-2">Last performed: {formatDate(day.lastPerformed)}</p>
                </div>
              </div>

              <button
                disabled={startingId === day.id}
                onClick={() => startRoutineDay(day)}
                className="mt-4 w-full rounded-xl bg-sky-500 py-4 text-lg font-semibold text-black hover:bg-sky-400 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {startingId === day.id ? 'Starting…' : 'Start Routine'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
