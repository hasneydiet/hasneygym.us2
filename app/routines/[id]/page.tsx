'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { Routine, RoutineDay, RoutineDayExercise, Exercise } from '@/lib/types';
import { Plus, Trash2, ChevronUp, ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default function RoutineEditorPage() {
  const params = useParams();
  const router = useRouter();
  const routineId = params.id as string;

  const [routine, setRoutine] = useState<Routine | null>(null);
  const [days, setDays] = useState<RoutineDay[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [dayExercises, setDayExercises] = useState<{ [dayId: string]: RoutineDayExercise[] }>({});
  const [showAddDay, setShowAddDay] = useState(false);
  const [showAddExercise, setShowAddExercise] = useState<string | null>(null);
  const [newDayName, setNewDayName] = useState('');
  const [selectedExerciseId, setSelectedExerciseId] = useState('');

  useEffect(() => {
    loadRoutine();
    loadExercises();
  }, [routineId]);

  const loadRoutine = async () => {
    const { data: routineData } = await supabase
      .from('routines')
      .select('*')
      .eq('id', routineId)
      .single();

    if (routineData) {
      setRoutine(routineData);

      const { data: daysData } = await supabase
        .from('routine_days')
        .select('*')
        .eq('routine_id', routineId)
        .order('day_index');

      if (daysData) {
        setDays(daysData);

        const exMap: { [dayId: string]: RoutineDayExercise[] } = {};
        for (const day of daysData) {
          const { data: exData } = await supabase
            .from('routine_day_exercises')
            .select('*, exercises(*)')
            .eq('routine_day_id', day.id)
            .order('order_index');

          exMap[day.id] = exData || [];
        }
        setDayExercises(exMap);
      }
    }
  };

  const loadExercises = async () => {
    const { data } = await supabase
      .from('exercises')
      .select('*')
      .order('name');

    if (data) setExercises(data);
  };

  const addDay = async () => {
    if (!newDayName.trim()) return;

    const nextIndex = days.length;
    const { data } = await supabase
      .from('routine_days')
      .insert({
        routine_id: routineId,
        day_index: nextIndex,
        name: newDayName,
      })
      .select()
      .single();

    if (data) {
      setDays([...days, data]);
      setDayExercises({ ...dayExercises, [data.id]: [] });
      setNewDayName('');
      setShowAddDay(false);
    }
  };

  const deleteDay = async (dayId: string) => {
    if (confirm('Delete this day?')) {
      await supabase.from('routine_days').delete().eq('id', dayId);
      loadRoutine();
    }
  };

  const addExerciseToDayHandler = async (dayId: string) => {
    if (!selectedExerciseId) return;

    const currentExercises = dayExercises[dayId] || [];
    const nextIndex = currentExercises.length;

    const { data } = await supabase
      .from('routine_day_exercises')
      .insert({
        routine_day_id: dayId,
        exercise_id: selectedExerciseId,
        order_index: nextIndex,
      })
      .select()
      .single();

    if (data) {
      loadRoutine();
      setShowAddExercise(null);
      setSelectedExerciseId('');
    }
  };

  const deleteExerciseFromDay = async (exerciseId: string) => {
    await supabase.from('routine_day_exercises').delete().eq('id', exerciseId);
    loadRoutine();
  };

  const moveExercise = async (dayId: string, exerciseId: string, direction: 'up' | 'down') => {
    const exs = [...(dayExercises[dayId] || [])];
    const idx = exs.findIndex((e) => e.id === exerciseId);
    if (idx === -1) return;

    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === exs.length - 1) return;

    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    [exs[idx], exs[newIdx]] = [exs[newIdx], exs[idx]];

    for (let i = 0; i < exs.length; i++) {
      await supabase
        .from('routine_day_exercises')
        .update({ order_index: i })
        .eq('id', exs[i].id);
    }

    loadRoutine();
  };

  const toggleSuperset = async (dayId: string, exerciseId: string) => {
    const exs = dayExercises[dayId] || [];
    const ex = exs.find((e) => e.id === exerciseId);
    if (!ex) return;

    const newGroupId = ex.superset_group_id ? null : crypto.randomUUID();

    await supabase
      .from('routine_day_exercises')
      .update({ superset_group_id: newGroupId })
      .eq('id', exerciseId);

    loadRoutine();
  };

  const groupBySupersets = (exs: RoutineDayExercise[]) => {
    const groups: { superset_group_id: string | null; items: RoutineDayExercise[] }[] = [];
    const seen = new Set<string | null>();

    exs.forEach((ex) => {
      if (ex.superset_group_id && !seen.has(ex.superset_group_id)) {
        seen.add(ex.superset_group_id);
        groups.push({
          superset_group_id: ex.superset_group_id,
          items: exs.filter((e) => e.superset_group_id === ex.superset_group_id),
        });
      } else if (!ex.superset_group_id) {
        groups.push({ superset_group_id: null, items: [ex] });
      }
    });

    return groups;
  };

  return (
    <AuthGuard>
      <div className="app-shell">
        <Navigation />
        <div className="page">
          <div className="mb-6">
            <Button onClick={() => router.push('/routines')} variant="ghost" className="h-10 px-0 text-[hsl(var(--muted))] hover:text-[hsl(var(--fg))]">
              ← Back to Routines
            </Button>
            <h1 className="page-title">{routine?.name}</h1>
          </div>

          <div className="space-y-6">
            {days.map((day) => {
              const exs = dayExercises[day.id] || [];
              const grouped = groupBySupersets(exs);

              return (
                <div key={day.id} className="surface p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{day.name}</h2>
                    <button
                      onClick={() => deleteDay(day.id)}
                      className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="space-y-2 mb-4">
                    {grouped.map((group, gIdx) => {
                      if (group.superset_group_id) {
                        return (
                          <div key={gIdx} className="border-l-4 border-gray-900 dark:border-gray-100 pl-4 bg-gray-50 dark:bg-gray-800 py-2">
                            <p className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">SUPERSET</p>
                            {group.items.map((ex) => (
                              <div key={ex.id} className="flex items-center justify-between py-2">
                                <span className="font-medium text-gray-900 dark:text-gray-100">{ex.exercises?.name}</span>
                                <div className="flex items-center space-x-2">
                                  <button
                                    onClick={() => moveExercise(day.id, ex.id, 'up')}
                                    className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                                  >
                                    <ChevronUp className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => moveExercise(day.id, ex.id, 'down')}
                                    className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                                  >
                                    <ChevronDown className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => toggleSuperset(day.id, ex.id)}
                                    className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-xs px-2 py-1 border border-gray-300 dark:border-gray-700 rounded"
                                  >
                                    Ungroup
                                  </button>
                                  <button
                                    onClick={() => deleteExerciseFromDay(ex.id)}
                                    className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      } else {
                        const ex = group.items[0];
                        return (
                          <div key={ex.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                            <span className="font-medium text-gray-900 dark:text-gray-100">{ex.exercises?.name}</span>
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => moveExercise(day.id, ex.id, 'up')}
                                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                              >
                                <ChevronUp className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => moveExercise(day.id, ex.id, 'down')}
                                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                              >
                                <ChevronDown className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => toggleSuperset(day.id, ex.id)}
                                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-xs px-2 py-1 border border-gray-300 dark:border-gray-700 rounded"
                              >
                                Superset
                              </button>
                              <button
                                onClick={() => deleteExerciseFromDay(ex.id)}
                                className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      }
                    })}
                  </div>

                  {showAddExercise === day.id ? (
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                      <select
                        value={selectedExerciseId}
                        onChange={(e) => setSelectedExerciseId(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg mb-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      >
                        <option value="">Select Exercise</option>
                        {exercises.map((ex) => (
                          <option key={ex.id} value={ex.id}>
                            {ex.name}
                          </option>
                        ))}
                      </select>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => addExerciseToDayHandler(day.id)}
                          className="flex-1 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 py-2 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200"
                        >
                          Add
                        </button>
                        <button
                          onClick={() => setShowAddExercise(null)}
                          className="flex-1 bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 py-2 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowAddExercise(day.id)}
                      className="w-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center justify-center space-x-2"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add Exercise</span>
                    </button>
                  )}
                </div>
              );
            })}

            {showAddDay ? (
              <div className="surface p-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Add Day</h2>
                <Input type="text" value={newDayName}
                  onChange={(e) => setNewDayName(e.target.value)}
                  placeholder="Day name (e.g., Push Day, Leg Day)"
                  className="h-11" />
                <div className="flex space-x-2">
                  <button
                    onClick={addDay}
                    className="flex-1 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 py-2 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => setShowAddDay(false)}
                    className="flex-1 bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 py-2 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddDay(true)}
                className="w-full bg-white dark:bg-gray-900 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg py-6 hover:border-gray-900 dark:hover:border-gray-100 flex items-center justify-center space-x-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
              >
                <Plus className="w-5 h-5" />
                <span>Add Day</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
