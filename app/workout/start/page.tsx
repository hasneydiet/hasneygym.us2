'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import type { RoutineDay } from '@/lib/types';

type RoutineDayCard = RoutineDay & {
  preview: string;
  exerciseCount: number;
  lastPerformed: string | null;
};

function formatDate(d: string | null) {
  if (!d) return 'Never';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return 'Never';
  return dt.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function WorkoutStartPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<RoutineDayCard[]>([]);
  const [startingId, setStartingId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.push('/login');
          return;
        }

        const { data: dayRows, error: daysErr } = await supabase
          .from('routine_days')
          .select('id, routine_id, day_index, name, created_at')
          .order('day_index', { ascending: true });

        if (daysErr) throw daysErr;

        const baseDays: RoutineDayCard[] = (dayRows || []).map((d: any) => ({
          ...d,
          preview: 'No exercises added yet',
          exerciseCount: 0,
          lastPerformed: null,
        }));

        const dayIds = baseDays.map((d) => d.id);

        if (dayIds.length > 0) {
          const { data: exRows } = await supabase
            .from('routine_day_exercises')
            .select('routine_day_id, order_index, exercises(name)')
            .in('routine_day_id', dayIds)
            .order('order_index', { ascending: true });

          const map: Record<string, string[]> = {};
          for (const row of exRows || []) {
            const id = row.routine_day_id;
            if (!map[id]) map[id] = [];
            if (row.exercises?.name) map[id].push(row.exercises.name);
          }

          for (const d of baseDays) {
            const list = map[d.id] || [];
            d.exerciseCount = list.length;
            d.preview = list.length ? list.slice(0, 6).join(' • ') : 'No exercises added yet';
          }

          const { data: sessions } = await supabase
            .from('workout_sessions')
            .select('routine_day_id, started_at')
            .in('routine_day_id', dayIds)
            .order('started_at', { ascending: false });

          const lastMap: Record<string, string> = {};
          for (const s of sessions || []) {
            if (!lastMap[s.routine_day_id]) {
              lastMap[s.routine_day_id] = s.started_at;
            }
          }

          for (const d of baseDays) {
            d.lastPerformed = lastMap[d.id] || null;
          }
        }

        if (mounted) setDays(baseDays);
      } catch (e: any) {
        if (mounted) setError(e.message || 'Failed to load workouts');
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
    setStartingId(day.id);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: session } = await supabase
      .from('workout_sessions')
      .insert({
        user_id: user.id,
        routine_id: day.routine_id,
        routine_day_id: day.id,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (session?.id) {
      router.push(`/workout/${session.id}`);
    }

    setStartingId(null);
  };

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      <Navigation />

      <div className="max-w-3xl mx-auto px-4 pt-6">
        <h1 className="text-3xl font-bold mb-4">Workout</h1>

        {error && <div className="text-red-400 mb-4">{error}</div>}
        {loading && <div className="text-gray-400">Loading…</div>}

        <div className="space-y-4">
          {days.map((day) => (
            <div
              key={day.id}
              className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-5 shadow-lg"
            >
              {/* ✅ DAY NAME ONLY */}
              <h2 className="text-xl font-semibold">{day.name}</h2>

              <p className="text-sm text-gray-400 mt-2 line-clamp-2">{day.preview}</p>

              <p className="text-sm text-gray-500 mt-2">
                Last performed: {formatDate(day.lastPerformed)}
              </p>

              <button
                disabled={startingId === day.id}
                onClick={() => startRoutineDay(day)}
                className="mt-4 w-full rounded-xl bg-sky-500 py-4 text-lg font-semibold text-black"
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
