'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { WorkoutSession, WorkoutExercise, WorkoutSet, TECHNIQUE_TAGS } from '@/lib/types';
import { computeExerciseMetrics } from '@/lib/progressUtils';
import { Plus, Check, Trash2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface ExerciseLastTime {
  [exerciseId: string]: {
    bestSet: string;
    volume: number;
    est1RM: number;
  };
}

export default function WorkoutPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [sets, setSets] = useState<{ [exerciseId: string]: WorkoutSet[] }>({});
  const [lastTimeData, setLastTimeData] = useState<ExerciseLastTime>({});

  useEffect(() => {
    loadWorkout();
  }, [sessionId]);

  const loadWorkout = async () => {
    const { data: sessionData } = await supabase
      .from('workout_sessions')
      .select('*, routines(name), routine_days(name)')
      .eq('id', sessionId)
      .single();

    if (sessionData) {
      setSession(sessionData);

      const { data: exData } = await supabase
        .from('workout_exercises')
        .select('*, exercises(*)')
        .eq('workout_session_id', sessionId)
        .order('order_index');

      if (exData) {
        setExercises(exData);

        const setsMap: { [exerciseId: string]: WorkoutSet[] } = {};
        for (const ex of exData) {
          const { data: setsData } = await supabase
            .from('workout_sets')
            .select('*')
            .eq('workout_exercise_id', ex.id)
            .order('set_index');

          setsMap[ex.id] = setsData || [];
        }
        setSets(setsMap);

        await loadLastTimeData(exData, sessionData.started_at);
      }
    }
  };

  const loadLastTimeData = async (exData: WorkoutExercise[], currentSessionDate: string) => {
    const exerciseIds = exData.map(e => e.exercise_id);
    if (exerciseIds.length === 0) return;

    const { data: priorWorkoutExercises } = await supabase
      .from('workout_exercises')
      .select('id, exercise_id, workout_session_id, workout_sessions!inner(started_at)')
      .in('exercise_id', exerciseIds)
      .lt('workout_sessions.started_at', currentSessionDate)
      .order('workout_sessions(started_at)', { ascending: false });

    if (!priorWorkoutExercises || priorWorkoutExercises.length === 0) return;

    const lastTimeMap: ExerciseLastTime = {};
    const processedExercises = new Set<string>();

    for (const pwe of priorWorkoutExercises) {
      if (processedExercises.has(pwe.exercise_id)) continue;

      const { data: setsData } = await supabase
        .from('workout_sets')
        .select('*')
        .eq('workout_exercise_id', pwe.id);

      if (setsData && setsData.length > 0) {
        const metrics = computeExerciseMetrics(setsData);
        lastTimeMap[pwe.exercise_id] = metrics;
        processedExercises.add(pwe.exercise_id);
      }
    }

    setLastTimeData(lastTimeMap);
  };

  const addSet = async (exerciseId: string) => {
    const currentSets = sets[exerciseId] || [];
    const lastSet = currentSets[currentSets.length - 1];

    const { data } = await supabase
      .from('workout_sets')
      .insert({
        workout_exercise_id: exerciseId,
        set_index: currentSets.length,
        reps: lastSet?.reps || 0,
        weight: lastSet?.weight || 0,
        rpe: lastSet?.rpe || null,
      })
      .select()
      .single();

    if (data) {
      loadWorkout();
    }
  };

  const updateSet = async (setId: string, field: string, value: any) => {
    await supabase
      .from('workout_sets')
      .update({ [field]: value })
      .eq('id', setId);

    loadWorkout();
  };

  const deleteSet = async (exerciseId: string, setId: string) => {
    await supabase.from('workout_sets').delete().eq('id', setId);
    loadWorkout();
  };

  const toggleTechniqueTag = async (exerciseId: string, tag: string) => {
    const ex = exercises.find((e) => e.id === exerciseId);
    if (!ex) return;

    const tags = ex.technique_tags || [];
    const newTags = tags.includes(tag)
      ? tags.filter((t) => t !== tag)
      : [...tags, tag];

    await supabase
      .from('workout_exercises')
      .update({ technique_tags: newTags })
      .eq('id', exerciseId);

    loadWorkout();
  };

  const endWorkout = async () => {
    await supabase
      .from('workout_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', sessionId);

    router.push('/history');
  };

  const groupBySupersets = (exs: WorkoutExercise[]) => {
    const groups: { superset_group_id: string | null; items: WorkoutExercise[] }[] = [];
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

  const grouped = groupBySupersets(exercises);

  return (
    <AuthGuard>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-20">
        <Navigation />
        <div className="max-w-4xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {session?.routines?.name || 'Workout'}
            </h1>
            {session?.routine_days?.name && (
              <p className="text-gray-600 dark:text-gray-400">{session.routine_days.name}</p>
            )}
          </div>

          <div className="space-y-6">
            {grouped.map((group, gIdx) => {
              if (group.superset_group_id) {
                return (
                  <div key={gIdx} className="bg-white dark:bg-gray-900 rounded-lg shadow-sm overflow-hidden border-l-4 border-gray-900 dark:border-gray-100">
                    <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                      <p className="text-xs font-bold text-gray-700 dark:text-gray-300">SUPERSET</p>
                    </div>
                    {group.items.map((ex) => (
                      <ExerciseBlock
                        key={ex.id}
                        exercise={ex}
                        sets={sets[ex.id] || []}
                        lastTime={lastTimeData[ex.exercise_id]}
                        addSet={addSet}
                        updateSet={updateSet}
                        deleteSet={deleteSet}
                        toggleTechniqueTag={toggleTechniqueTag}
                      />
                    ))}
                  </div>
                );
              } else {
                const ex = group.items[0];
                return (
                  <div key={ex.id} className="bg-white dark:bg-gray-900 rounded-lg shadow-sm overflow-hidden">
                    <ExerciseBlock
                      exercise={ex}
                      sets={sets[ex.id] || []}
                      lastTime={lastTimeData[ex.exercise_id]}
                      addSet={addSet}
                      updateSet={updateSet}
                      deleteSet={deleteSet}
                      toggleTechniqueTag={toggleTechniqueTag}
                    />
                  </div>
                );
              }
            })}
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="max-w-4xl mx-auto">
            <button
              onClick={endWorkout}
              className="w-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 py-3 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 font-medium"
            >
              End Workout
            </button>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}

function ExerciseBlock({
  exercise,
  sets,
  lastTime,
  addSet,
  updateSet,
  deleteSet,
  toggleTechniqueTag,
}: {
  exercise: WorkoutExercise;
  sets: WorkoutSet[];
  lastTime?: { bestSet: string; volume: number; est1RM: number };
  addSet: (exerciseId: string) => void;
  updateSet: (setId: string, field: string, value: any) => void;
  deleteSet: (exerciseId: string, setId: string) => void;
  toggleTechniqueTag: (exerciseId: string, tag: string) => void;
}) {
  return (
    <div className="p-4">
      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{exercise.exercises?.name}</h3>

      {lastTime && (
        <div className="mb-3 text-xs text-gray-600 dark:text-gray-400">
          Last time: {lastTime.bestSet} | Vol: {lastTime.volume} kg | 1RM: {lastTime.est1RM > 0 ? `${lastTime.est1RM} kg` : 'N/A'}
        </div>
      )}

      <div className="mb-3">
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Techniques</p>
        <div className="flex flex-wrap gap-2">
          {TECHNIQUE_TAGS.map((tag) => {
            const isActive = exercise.technique_tags?.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleTechniqueTag(exercise.id, tag)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-2 py-2 text-left">Set</th>
              <th className="px-2 py-2 text-center">Reps</th>
              <th className="px-2 py-2 text-center">Weight</th>
              <th className="px-2 py-2 text-center">RPE</th>
              <th className="px-2 py-2 text-center">Done</th>
              <th className="px-2 py-2 text-center"></th>
            </tr>
          </thead>
          <tbody>
            {sets.map((set, idx) => (
              <tr key={set.id} className="border-b border-gray-100 dark:border-gray-800">
                <td className="px-2 py-2 font-medium text-gray-900 dark:text-gray-100">{idx + 1}</td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    value={set.reps}
                    onChange={(e) => updateSet(set.id, 'reps', parseInt(e.target.value) || 0)}
                    className="w-full px-2 py-1 border border-gray-300 dark:border-gray-700 rounded text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    step="0.5"
                    value={set.weight}
                    onChange={(e) => updateSet(set.id, 'weight', parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 border border-gray-300 dark:border-gray-700 rounded text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    step="0.5"
                    value={set.rpe || ''}
                    onChange={(e) => updateSet(set.id, 'rpe', parseFloat(e.target.value) || null)}
                    className="w-full px-2 py-1 border border-gray-300 dark:border-gray-700 rounded text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <button
                    onClick={() => updateSet(set.id, 'is_completed', !set.is_completed)}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center ${
                      set.is_completed
                        ? 'bg-gray-900 dark:bg-gray-100 border-gray-900 dark:border-gray-100'
                        : 'border-gray-300 dark:border-gray-700'
                    }`}
                  >
                    {set.is_completed && <Check className="w-4 h-4 text-white dark:text-gray-900" />}
                  </button>
                </td>
                <td className="px-2 py-2 text-center">
                  <button
                    onClick={() => deleteSet(exercise.id, set.id)}
                    className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={() => addSet(exercise.id)}
        className="w-full mt-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center justify-center space-x-2"
      >
        <Plus className="w-4 h-4" />
        <span>Add Set</span>
      </button>
    </div>
  );
}
