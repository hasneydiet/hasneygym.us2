'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';

type WorkoutDay = {
  id: string;
  day_letter: string;
  day_name: string;
  order_index: number;
};

export default function WorkoutStartPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<WorkoutDay[]>([]);

  useEffect(() => {
    loadWorkoutDays();
  }, []);

  const loadWorkoutDays = async () => {
    setLoading(true);
    setError(null);

    /** 1️⃣ Load ACTIVE PROGRAM */
    const { data: program, error: programErr } = await supabase
      .from('programs')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (programErr || !program) {
      setError('Failed to load program');
      setLoading(false);
      return;
    }

    /** 2️⃣ Load workout days by program_id (THIS WAS THE BUG) */
    const { data: daysData, error: daysErr } = await supabase
      .from('workout_days')
      .select('*')
      .eq('program_id', program.id)
      .order('order_index', { ascending: true });

    if (daysErr) {
      setError('Failed to load workout days');
    } else {
      setDays(daysData || []);
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-black text-white pb-28">
      <Navigation />

      <div className="max-w-3xl mx-auto px-4 pt-6">
        <h1 className="text-3xl font-bold mb-4">Workout</h1>

        {error && (
          <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-red-300">
            {error}
          </div>
        )}

        {loading && (
          <div className="text-gray-400">Loading workout days…</div>
        )}

        {!loading && days.length === 0 && (
          <div className="text-gray-400">No workout days found.</div>
        )}

        <div className="space-y-4">
          {days.map((day) => (
            <div
              key={day.id}
              className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-5 shadow-lg"
            >
              <h2 className="text-xl font-semibold">
                {day.day_name}
              </h2>
              <p className="text-sm text-gray-400 mb-4">
                Day {day.day_letter}
              </p>

              <button
                onClick={() => router.push(`/workout/${day.id}`)}
                className="w-full rounded-xl bg-sky-500 py-4 text-lg font-semibold text-black hover:bg-sky-400 transition"
              >
                Start Workout
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
