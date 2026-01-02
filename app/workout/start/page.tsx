'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Navigation from '@/components/Navigation';

type WorkoutDay = {
  id: string;
  day_letter: string;
  day_name: string;
  order_index: number;
};

export default function WorkoutStartPage() {
  const router = useRouter();
  const [days, setDays] = useState<WorkoutDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * IMPORTANT:
   * You only have ONE program (single-user app)
   * We fetch the latest program and its workout_days
   */
  useEffect(() => {
    loadWorkoutDays();
  }, []);

  const loadWorkoutDays = async () => {
    setLoading(true);
    setError(null);

    // 1️⃣ Get latest program
    const { data: program, error: programErr } = await supabase
      .from('programs')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (programErr || !program) {
      setError('Failed to load program.');
      setLoading(false);
      return;
    }

    // 2️⃣ Get workout days for that program
    const { data: daysData, error: daysErr } = await supabase
      .from('workout_days')
      .select('*')
      .eq('program_id', program.id)
      .order('order_index', { ascending: true });

    if (daysErr) {
      setError('Failed to load workout days.');
      setLoading(false);
      return;
    }

    setDays(daysData || []);
    setLoading(false);
  };

  const startWorkout = async (day: WorkoutDay) => {
    // Create workout session
    const { data: session, error } = await supabase
      .from('workout_sessions')
      .insert({
        workout_day_id: day.id,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !session) {
      alert('Failed to start workout');
      return;
    }

    router.push(`/workout/${session.id}`);
  };

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      <Navigation />

      <div className="max-w-5xl mx-auto px-4 pt-6">
        <h1 className="text-3xl font-bold mb-6">Workout</h1>

        {loading && <p className="text-gray-400">Loading…</p>}
        {error && <p className="text-red-500">{error}</p>}

        {!loading && days.length === 0 && (
          <p className="text-gray-400">No workout days found.</p>
        )}

        <div className="space-y-5">
          {days.map((day) => (
            <div
              key={day.id}
              className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-6 shadow-lg"
            >
              <h2 className="text-xl font-bold">{day.day_name}</h2>
              <p className="text-sm text-gray-400 mb-4">
                Day {day.day_letter}
              </p>

              <button
                onClick={() => startWorkout(day)}
                className="w-full rounded-xl bg-sky-500 py-3 text-lg font-semibold text-white hover:bg-sky-400 active:bg-sky-600"
              >
                Start Routine
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
