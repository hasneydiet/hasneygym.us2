'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { MoreHorizontal } from 'lucide-react';

type Routine = any;
type RoutineDay = any;

type RoutineDayCard = RoutineDay & {
  routineName?: string;
  exercisePreview?: string;
  exerciseCount?: number;
  lastPerformed?: string | null;
};

export default function WorkoutStartPage() {
  const router = useRouter();

  const [routineDays, setRoutineDays] = useState<RoutineDayCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Helpful debug (shows if RLS/auth is the issue)
  const [debugMsg, setDebugMsg] = useState<string>('');

  useEffect(() => {
    loadRoutineDays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRoutineDays = async () => {
    setLoading(true);
    setDebugMsg('');

    // 1) Ensure we have an authenticated user (RLS-safe)
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    const user = userRes?.user;

    if (userErr) {
      console.error('auth.getUser error:', userErr);
    }
    if (!user) {
      // If not logged in, redirect to login (or show message)
      setDebugMsg('Not logged in. Please log in again.');
      setLoading(false);
      router.push('/login');
      return;
    }

    // 2) Load user routines (RLS typically expects user_id = auth.uid())
    const { data: routinesData, error: routinesErr } = await supabase
      .from('routines')
      .select('id, name')
      // IMPORTANT: if your routines table uses a different owner field,
      // change user_id to that column name.
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (routinesErr) {
      console.error('Failed to load routines:', routinesErr);
      setDebugMsg('Failed to load routines (check RLS / user_id column).');
    }

    const routinesList = (routinesData || []) as Routine[];
    const routineNameById: Record<string, string> = {};
    const routineIds = routinesList.map((r: any) => r.id);

    for (const r of routinesList) routineNameById[r.id] = r.name;

    if (routineIds.length === 0) {
      setRoutineDays([]);
      setDebugMsg('No routines found for this user.');
      setLoading(false);
      return;
    }

    // 3) Load routine days for those routines
    const { data: daysData, error: daysErr } = await supabase
      .from('routine_days')
      .select('id, routine_id, name, order_index')
      .in('routine_id', routineIds)
      .order('order_index', { ascending: true });

    if (daysErr) {
      console.error('Failed to load routine days:', daysErr);
      setDebugMsg('Failed to load routine days (check RLS / routine_id).');
    }

    const daysList = (daysData || []) as RoutineDay[];

    // Attach routine name
    const daysWithNames: RoutineDayCard[] = daysList.map((d: any) => ({
      ...d,
      routineName: routineNameById[d.routine_id] || 'Routine',
    }));

    // 4) Build preview from routine_day_exercises (correct table)
    const withPreview = await Promise.all(
      daysWithNames.map(async (d: any) => {
        const { data: exRows, error: exErr } = await supabase
          .from('routine_day_exercises')
          .select('exercise_id, order_index, exercises(name)')
          .eq('routine_day_id', d.id)
          .order('order_index', { ascending: true })
          .limit(6);

        if (exErr) console.error('Failed to load day exercises:', exErr);

        const names =
          (exRows || [])
            .map((x: any) => x.exercises?.name)
            .filter(Boolean) as string[];

        const preview = names.length > 0 ? names.join(' • ') : 'No exercises added yet';

        // Last performed
        const { data: lastSession } = await supabase
          .from('workout_sessions')
          .select('started_at')
          .eq('routine_day_id', d.id)
          .not('ended_at', 'is', null)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const lastPerformed = lastSession?.started_at
          ? new Date(lastSession.started_at).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })
          : null;

        return {
          ...d,
          exerciseCount: names.length,
          exercisePreview: preview,
          lastPerformed,
        } as RoutineDayCard;
      })
    );

    setRoutineDays(withPreview);
    setLoading(false);
  };

  const startRoutineDay = async (routineDay: RoutineDayCard) => {
    setDebugMsg('');

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      router.push('/login');
      return;
    }

    // Create session
    const { data: session, error: sessionErr } = await supabase
      .from('workout_sessions')
      .insert({
        routine_id: routineDay.routine_id,
        routine_day_id: routineDay.id,
        started_at: new Date().toISOString(),
        // If your workout_sessions has user_id, keep it consistent with RLS
        user_id: user.id,
      })
      .select()
      .single();

    if (sessionErr || !session?.id) {
      console.error('Failed to create workout session:', sessionErr);
      setDebugMsg('Failed to start workout session.');
      return;
    }

    // Load day exercises (source of truth)
    const { data: dayExercises, error: dayExErr } = await supabase
      .from('routine_day_exercises')
      .select('exercise_id, order_index')
      .eq('routine_day_id', routineDay.id)
      .order('order_index', { ascending: true });

    if (dayExErr) {
      console.error('Failed to load day exercises:', dayExErr);
      setDebugMsg('Session created but failed to load day exercises.');
    }

    const rows = (dayExercises || []) as any[];

    // Insert workout_exercises for session
    if (rows.length > 0) {
      const payload = rows.map((r, idx) => ({
        workout_session_id: session.id,
        exercise_id: r.exercise_id,
        order_index: idx,
      }));

      const { error: insertErr } = await supabase.from('workout_exercises').insert(payload);

      if (insertErr) {
        console.error('Failed to insert workout exercises:', insertErr);
        setDebugMsg('Session created but failed to insert workout exercises.');
      }
    }

    router.push(`/workout/${session.id}`);
  };

  const sortedDays = useMemo(() => routineDays, [routineDays]);

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      <div className="max-w-3xl mx-auto px-4 pt-6">
        <h1 className="text-4xl font-extrabold tracking-tight mb-4">Workout</h1>

        {!!debugMsg && (
          <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3 text-white/80 text-sm">
            {debugMsg}
          </div>
        )}

        {loading ? (
          <div className="text-white/70">Loading…</div>
        ) : (
          <div className="space-y-4">
            {sortedDays.map((d: any) => (
              <div
                key={d.id}
                className="relative rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-2xl font-bold truncate">{d.routineName || 'Routine'}</div>
                    <div className="text-sm text-white/70 mt-1">{d.name || ''}</div>

                    <div className="text-sm text-white/60 mt-3 line-clamp-2">
                      {d.exercisePreview}
                    </div>

                    <div className="text-sm text-white/55 mt-3">
                      Last performed: {d.lastPerformed || '—'}
                    </div>
                  </div>

                  <button
                    onClick={() => setOpenMenuId(openMenuId === d.id ? null : d.id)}
                    className="p-2 rounded-lg hover:bg-white/10"
                    aria-label="Menu"
                  >
                    <MoreHorizontal className="w-6 h-6" />
                  </button>
                </div>

                {/* Menu placeholder (kept minimal to avoid breaking your actions) */}
                {openMenuId === d.id && (
                  <div className="absolute right-4 top-14 z-20 w-44 rounded-xl border border-white/10 bg-black/90 backdrop-blur p-2">
                    <button className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10">
                      Duplicate
                    </button>
                    <button className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10">
                      Rename
                    </button>
                    <button className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 text-red-300">
                      Delete
                    </button>
                  </div>
                )}

                <button
                  onClick={() => startRoutineDay(d)}
                  className="mt-5 w-full rounded-xl bg-sky-500 py-4 text-lg font-bold"
                >
                  Start Routine
                </button>
              </div>
            ))}

            {sortedDays.length === 0 && (
              <div className="text-white/70">No routine days found.</div>
            )}
          </div>
        )}
      </div>

      <Navigation />
    </div>
  );
}
