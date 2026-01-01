'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { Routine, RoutineDay } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default function StartWorkoutPage() {
  const router = useRouter();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [selectedRoutineId, setSelectedRoutineId] = useState('');
  const [days, setDays] = useState<RoutineDay[]>([]);
  const [selectedDayId, setSelectedDayId] = useState('');

  useEffect(() => {
    loadRoutines();
  }, []);

  useEffect(() => {
    if (selectedRoutineId) {
      loadDays();
    } else {
      setDays([]);
      setSelectedDayId('');
    }
  }, [selectedRoutineId]);

  const loadRoutines = async () => {
    const { data } = await supabase
      .from('routines')
      .select('*')
      .order('name');

    if (data) setRoutines(data);
  };

  const loadDays = async () => {
    const { data } = await supabase
      .from('routine_days')
      .select('*')
      .eq('routine_id', selectedRoutineId)
      .order('day_index');

    if (data) setDays(data);
  };

  const startWorkout = async () => {
    if (!selectedDayId) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: session } = await supabase
      .from('workout_sessions')
      .insert({
        user_id: user.id,
        routine_id: selectedRoutineId,
        routine_day_id: selectedDayId,
      })
      .select()
      .single();

    if (session) {
      const { data: routineExercises } = await supabase
        .from('routine_day_exercises')
        .select('*, exercises(*)')
        .eq('routine_day_id', selectedDayId)
        .order('order_index');

      if (routineExercises) {
        for (const ex of routineExercises) {
          const techniqueTags = ex.exercises?.default_technique_tags || [];

          const { data: workoutExercise } = await supabase
            .from('workout_exercises')
            .insert({
              workout_session_id: session.id,
              exercise_id: ex.exercise_id,
              order_index: ex.order_index,
              superset_group_id: ex.superset_group_id,
              technique_tags: techniqueTags,
            })
            .select()
            .single();

          if (workoutExercise) {
            let setsToCreate = 0;
            let defaultReps = 0;

            if (ex.default_sets && ex.default_sets.length > 0) {
              setsToCreate = ex.default_sets.length;
            } else if (ex.exercises?.default_set_scheme?.sets) {
              setsToCreate = ex.exercises.default_set_scheme.sets;
              defaultReps = ex.exercises.default_set_scheme.reps || 0;
            }

            if (setsToCreate > 0) {
              const setsToInsert = [];
              for (let i = 0; i < setsToCreate; i++) {
                setsToInsert.push({
                  workout_exercise_id: workoutExercise.id,
                  set_index: i,
                  reps: ex.default_sets?.[i]?.reps || defaultReps,
                  weight: 0,
                  rpe: null,
                  is_completed: false,
                  notes: '',
                });
              }
              await supabase.from('workout_sets').insert(setsToInsert);
            }
          }
        }
      }

      router.push(`/workout/${session.id}`);
    }
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <Navigation />
        <div className="max-w-2xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-6">Start Workout</h1>

          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm p-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Select Routine
              </label>
              <select
                value={selectedRoutineId}
                onChange={(e) => setSelectedRoutineId(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                <option value="">Choose a routine</option>
                {routines.map((routine) => (
                  <option key={routine.id} value={routine.id}>
                    {routine.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedRoutineId && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Select Day
                </label>
                <select
                  value={selectedDayId}
                  onChange={(e) => setSelectedDayId(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  <option value="">Choose a day</option>
                  {days.map((day) => (
                    <option key={day.id} value={day.id}>
                      {day.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={startWorkout}
              disabled={!selectedDayId}
              className="w-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 py-3 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              Start Workout
            </button>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
