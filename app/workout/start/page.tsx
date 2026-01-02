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

  // per-card menu open state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    loadRoutineDays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRoutineDays = async () => {
    setLoading(true);

    // Load routine days + routine names
    const { data: daysData, error: daysErr } = await supabase
      .from('routine_days')
      .select('id, routine_id, name, order_index')
      .order('order_index', { ascending: true });

    if (daysErr) console.error('Failed to load routine days:', daysErr);

    const { data: routinesData } = await supabase.from('routines').select('id, name');

    const routineNameById: Record<string, string> = {};
    for (const r of routinesData || []) {
      routineNameById[r.id] = r.name;
    }

    const daysList = (daysData || []) as RoutineDay[];
    const daysWithNames: RoutineDayCard[] = daysList.map((d: any) => ({
      ...d,
      routineName: routineNameById[d.routine_id] || 'Routine',
    }));

    // Build exercise preview from routine_day_exercises (correct source)
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

        const preview =
          names.length > 0 ? names.join(' • ') : 'No exercises added yet';

        // last performed
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
    // 1) Create workout session
    const { data: session, error: sessionErr } = await supabase
      .from('workout_sessions')
      .insert({
        routine_id: routineDay.routine_id,
        routine_day_id: routineDay.id,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (sessionErr || !session?.id) {
      console.error('Failed to create workout session:', sessionErr);
      return;
    }

    // 2) Load exercises for this routine day from routine_day_exercises
    const { data: dayExercises, error: dayExErr } = await supabase
      .from('routine_day_exercises')
      .select('exercise_id, order_index')
      .eq('routine_day_id', routineDay.id)
      .order('order_index', { ascending: true });

    if (dayExErr) {
      console.error('Failed to load day exercises:', dayExErr);
    }

    const rows = (dayExercises || []) as any[];

    // 3) Insert workout_exercises for this session (bulk)
    if (rows.length > 0) {
      const payload = rows.map((r, idx) => ({
        workout_session_id: session.id,
        exercise_id: r.exercise_id,
        order_index: idx,
      }));

      const { error: insertErr } = await supabase.from('workout_exercises').insert(payload);

      if (insertErr) {
        console.error('Failed to insert workout exercises:', insertErr);
      }
    }

    // 4) Navigate immediately
    router.push(`/workout/${session.id}`);
  };

  const sortedDays = useMemo(() => routineDays, [routineDays]);

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      <div className="max-w-3xl mx-auto px-4 pt-6">
        <h1 className="text-4xl font-extrabold tracking-tight mb-4">Workout</h1>

        {loading ? (
          <div className="text-white/70">Loading routines…</div>
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

                {/* Menu (placeholder actions) */}
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
