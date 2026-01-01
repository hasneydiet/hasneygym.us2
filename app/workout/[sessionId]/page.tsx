'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type WorkoutSession = {
  id: string;
  started_at: string;
  ended_at: string | null;
  notes?: string | null;
  routines?: { name: string } | null;
  routine_days?: { name: string } | null;
};

type WorkoutExercise = {
  id: string;
  workout_session_id: string;
  exercise_id: string;
  order_index: number;
  superset_group_id?: string | null;
  technique_tags?: string[] | null;
  exercises?: {
    id: string;
    name: string;
  } | null;
};

type WorkoutSet = {
  id: string;
  workout_exercise_id: string;
  set_index: number;
  reps: number;
  weight: number;
  rpe: number | null;
  is_completed: boolean;
};

type ExerciseLastTime = Record<
  string,
  {
    bestSet: string;
    volume: number;
    est1RM: number;
  }
>;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const loadLastTimeData = async (exData: WorkoutExercise[], startedAt: string) => {
    const result: ExerciseLastTime = {};

    for (const ex of exData) {
      const { data: prevSessions } = await supabase
        .from('workout_sessions')
        .select('id, started_at')
        .lt('started_at', startedAt)
        .order('started_at', { ascending: false })
        .limit(15);

      if (!prevSessions || prevSessions.length === 0) continue;

      // Find the most recent session that included this exercise
      let found = false;
      for (const s of prevSessions) {
        const { data: prevExercise } = await supabase
          .from('workout_exercises')
          .select('id')
          .eq('workout_session_id', s.id)
          .eq('exercise_id', ex.exercise_id)
          .single();

        if (prevExercise?.id) {
          const { data: prevSets } = await supabase
            .from('workout_sets')
            .select('*')
            .eq('workout_exercise_id', prevExercise.id);

          if (prevSets && prevSets.length > 0) {
            const volume = prevSets.reduce((sum, st) => sum + (st.reps || 0) * (st.weight || 0), 0);
            const best = prevSets.reduce((acc, st) => {
              const load = (st.reps || 0) * (st.weight || 0);
              return load > acc.load ? { reps: st.reps, weight: st.weight, load } : acc;
            }, { reps: 0, weight: 0, load: 0 });

            // Epley 1RM estimate: weight * (1 + reps/30)
            const est1RM = best.weight > 0 && best.reps > 0 ? best.weight * (1 + best.reps / 30) : 0;

            result[ex.id] = {
              bestSet: best.reps > 0 && best.weight > 0 ? `${best.reps} x ${best.weight}` : 'N/A',
              volume,
              est1RM,
            };
            found = true;
            break;
          }
        }
      }

      if (!found) {
        // no-op
      }
    }

    setLastTimeData(result);
  };

  const endWorkout = async () => {
    await supabase
      .from('workout_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', sessionId);

    router.push('/workout');
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

  // ✅ UPDATED: Optimistic save, no refetch per keystroke
  const updateSet = async (setId: string, field: string, value: any) => {
    // Optimistic local update so the UI stays responsive (no refetch on every edit)
    setSets((prev) => {
      const next: { [exerciseId: string]: WorkoutSet[] } = {};
      for (const exId of Object.keys(prev)) {
        next[exId] = prev[exId].map((s) => (s.id === setId ? { ...s, [field]: value } : s));
      }
      return next;
    });

    const { error } = await supabase.from('workout_sets').update({ [field]: value }).eq('id', setId);

    if (error) {
      console.error('Save failed:', error);
      loadWorkout(); // fallback to server truth if something goes wrong
    }
  };

  const deleteSet = async (exerciseId: string, setId: string) => {
    await supabase.from('workout_sets').delete().eq('id', setId);

    // Re-index the remaining sets
    const remaining = (sets[exerciseId] || []).filter((s) => s.id !== setId);
    for (let i = 0; i < remaining.length; i++) {
      await supabase.from('workout_sets').update({ set_index: i }).eq('id', remaining[i].id);
    }

    loadWorkout();
  };

  const toggleTechniqueTag = async (exerciseId: string, tag: string) => {
    const exercise = exercises.find((e) => e.id === exerciseId);
    if (!exercise) return;

    const current = exercise.technique_tags || [];
    const updated = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];

    await supabase
      .from('workout_exercises')
      .update({ technique_tags: updated })
      .eq('id', exerciseId);

    loadWorkout();
  };

  const grouped = (() => {
    const groups: Array<{ superset_group_id: string | null; items: WorkoutExercise[] }> = [];
    const byGroup = new Map<string | null, WorkoutExercise[]>();

    for (const ex of exercises) {
      const key = ex.superset_group_id || null;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(ex);
    }

    for (const [k, v] of byGroup.entries()) {
      groups.push({ superset_group_id: k, items: v });
    }

    // Keep stable ordering by the first exercise's order_index
    groups.sort((a, b) => (a.items[0]?.order_index ?? 0) - (b.items[0]?.order_index ?? 0));
    return groups;
  })();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {session?.routines?.name || 'Workout'}
            </h1>
            {session?.routine_days?.name && (
              <p className="text-gray-600 dark:text-gray-400">{session.routine_days.name}</p>
            )}
          </div>

          <button
            onClick={endWorkout}
            className="px-4 py-2 rounded bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 font-semibold"
          >
            End Workout
          </button>
        </div>

        <div className="space-y-6">
          {grouped.map((group, gIdx) => {
            if (group.superset_group_id) {
              return (
                <div
                  key={gIdx}
                  className="bg-white dark:bg-gray-800 rounded-lg overflow-hidden border-l-4 border-gray-900 dark:border-gray-100"
                >
                  <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                    <p className="text-xs font-bold text-gray-700 dark:text-gray-300">SUPERSET</p>
                  </div>

                  {group.items.map((ex) => (
                    <ExerciseBlock
                      key={ex.id}
                      exercise={ex}
                      sets={sets[ex.id] || []}
                      lastTime={lastTimeData[ex.id]}
                      addSet={addSet}
                      updateSet={updateSet}
                      deleteSet={deleteSet}
                      toggleTechniqueTag={toggleTechniqueTag}
                    />
                  ))}
                </div>
              );
            }

            return group.items.map((ex) => (
              <div key={ex.id} className="bg-white dark:bg-gray-800 rounded-lg overflow-hidden">
                <ExerciseBlock
                  exercise={ex}
                  sets={sets[ex.id] || []}
                  lastTime={lastTimeData[ex.id]}
                  addSet={addSet}
                  updateSet={updateSet}
                  deleteSet={deleteSet}
                  toggleTechniqueTag={toggleTechniqueTag}
                />
              </div>
            ));
          })}
        </div>
      </div>
    </div>
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
  // ✅ NEW: local draft state so typing is smooth; saves only onBlur
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});

  const setDraftValue = (setId: string, field: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      [setId]: { ...(prev[setId] || {}), [field]: value },
    }));
  };

  const getDraftValue = (setId: string, field: string, fallback: number | null | undefined) => {
    const v = draft[setId]?.[field];
    return v !== undefined ? v : (fallback ?? '').toString();
  };

  const clearDraftField = (setId: string, field: string) => {
    setDraft((prev) => {
      const next = { ...prev };
      if (!next[setId]) return prev;
      const inner = { ...next[setId] };
      delete inner[field];
      next[setId] = inner;
      return next;
    });
  };

  return (
    <div className="p-4">
      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{exercise.exercises?.name}</h3>

      {lastTime && (
        <div className="mb-3 text-xs text-gray-600 dark:text-gray-400">
          Last time: {lastTime.bestSet} | Vol: {lastTime.volume.toFixed(0)} kg | 1RM:{' '}
          {lastTime.est1RM > 0 ? `${lastTime.est1RM.toFixed(0)} kg` : 'N/A'}
        </div>
      )}

      <div className="mb-3">
        <div className="flex flex-wrap gap-2">
          {['drop set', 'rest pause', 'tempo', 'partial', 'pause reps'].map((tag) => {
            const active = (exercise.technique_tags || []).includes(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleTechniqueTag(exercise.id, tag)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                  active
                    ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700'
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
          <thead>
            <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="px-2 py-2 w-12">Set</th>
              <th className="px-2 py-2">Reps</th>
              <th className="px-2 py-2">Weight</th>
              <th className="px-2 py-2">RPE</th>
              <th className="px-2 py-2 text-center">Done</th>
              <th className="px-2 py-2 w-12 text-center">Del</th>
            </tr>
          </thead>

          <tbody>
            {sets.map((set, idx) => (
              <tr key={set.id} className="border-b border-gray-100 dark:border-gray-800">
                <td className="px-2 py-2 font-medium text-gray-900 dark:text-gray-100">{idx + 1}</td>

                <td className="px-2 py-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={getDraftValue(set.id, 'reps', set.reps)}
                    onChange={(e) => setDraftValue(set.id, 'reps', e.target.value)}
                    onBlur={() => {
                      const raw = getDraftValue(set.id, 'reps', set.reps);
                      const num = raw.trim() === '' ? 0 : Number(raw);
                      updateSet(set.id, 'reps', Number.isFinite(num) ? num : 0);
                      clearDraftField(set.id, 'reps');
                    }}
                    className="w-full px-2 py-1 border border-gray-300 dark:border-gray-700 rounded text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </td>

                <td className="px-2 py-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    value={getDraftValue(set.id, 'weight', set.weight)}
                    onChange={(e) => setDraftValue(set.id, 'weight', e.target.value)}
                    onBlur={() => {
                      const raw = getDraftValue(set.id, 'weight', set.weight);
                      const num = raw.trim() === '' ? 0 : Number(raw);
                      updateSet(set.id, 'weight', Number.isFinite(num) ? num : 0);
                      clearDraftField(set.id, 'weight');
                    }}
                    className="w-full px-2 py-1 border border-gray-300 dark:border-gray-700 rounded text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </td>

                <td className="px-2 py-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    value={getDraftValue(set.id, 'rpe', set.rpe)}
                    onChange={(e) => setDraftValue(set.id, 'rpe', e.target.value)}
                    onBlur={() => {
                      const raw = getDraftValue(set.id, 'rpe', set.rpe);
                      const val = raw.trim() === '' ? null : Number(raw);
                      updateSet(set.id, 'rpe', val === null ? null : Number.isFinite(val) ? val : null);
                      clearDraftField(set.id, 'rpe');
                    }}
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
                    {set.is_completed && <span className="text-white dark:text-gray-900 text-xs">✓</span>}
                  </button>
                </td>

                <td className="px-2 py-2 text-center">
                  <button
                    onClick={() => deleteSet(exercise.id, set.id)}
                    className="text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
                    title="Delete set"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3">
          <button
            onClick={() => addSet(exercise.id)}
            className="px-4 py-2 rounded bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 font-semibold"
          >
            + Add Set
          </button>
        </div>
      </div>
    </div>
  );
}
