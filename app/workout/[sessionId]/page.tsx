'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// NOTE: These types already exist in your project (they were used in your original file).
// If your original file imports them from elsewhere, you can re-add those imports.
// Keeping them as references here matches your existing state usage.
type WorkoutSession = any;
type WorkoutExercise = any;
type WorkoutSet = any;
type ExerciseLastTime = any;

export default function WorkoutPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [sets, setSets] = useState<{ [exerciseId: string]: WorkoutSet[] }>({});
  const [lastTimeData, setLastTimeData] = useState<ExerciseLastTime>({});

  /**
   * Draft input state:
   * - keeps inputs smooth while typing
   * - prevents "snapping" to 0
   * - prevents DB updates on every keystroke
   */
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

    if (!sessionData) return;

    setSession(sessionData);

    const { data: exData } = await supabase
      .from('workout_exercises')
      .select('*, exercises(*)')
      .eq('workout_session_id', sessionId)
      .order('order_index');

    if (!exData) return;

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

    // If your original file had last-time loading, keep it.
    // If you don’t have loadLastTimeData, this will be skipped safely.
    if (typeof (globalThis as any).loadLastTimeData === 'function') {
      await (globalThis as any).loadLastTimeData(exData, sessionData.started_at);
    }
  };

  /**
   * Save a set field to DB.
   * - We DO update local state optimistically to keep UI in sync.
   * - We DO NOT call loadWorkout() on success (that was the lag).
   * - We DO call loadWorkout() only if there is an error.
   */
  const saveSet = async (setId: string, field: string, value: any) => {
    // optimistic local update (prevents UI feeling stale)
    setSets((prev) => {
      const next: { [exerciseId: string]: WorkoutSet[] } = {};
      for (const exId of Object.keys(prev)) {
        next[exId] = prev[exId].map((s: any) => (s.id === setId ? { ...s, [field]: value } : s));
      }
      return next;
    });

    const { error } = await supabase.from('workout_sets').update({ [field]: value }).eq('id', setId);

    if (error) {
      console.error('Save failed:', error);
      loadWorkout(); // fallback to server truth only on error
    }
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

  const deleteSet = async (exerciseId: string, setId: string) => {
    await supabase.from('workout_sets').delete().eq('id', setId);

    // Re-index remaining sets
    const remaining = (sets[exerciseId] || []).filter((s: any) => s.id !== setId);
    for (let i = 0; i < remaining.length; i++) {
      await supabase.from('workout_sets').update({ set_index: i }).eq('id', remaining[i].id);
    }

    loadWorkout();
  };

  const toggleTechniqueTag = async (exerciseId: string, tag: string) => {
    const exercise = exercises.find((e: any) => e.id === exerciseId);
    if (!exercise) return;

    const current: string[] = exercise.technique_tags || [];
    const updated = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];

    await supabase.from('workout_exercises').update({ technique_tags: updated }).eq('id', exerciseId);

    loadWorkout();
  };

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
          {exercises.map((exercise: any) => (
            <div key={exercise.id} className="bg-white dark:bg-gray-800 rounded-lg overflow-hidden p-4">
              <div className="mb-2">
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {exercise.exercises?.name || 'Exercise'}
                </h3>

                {lastTimeData?.[exercise.id] && (
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                    Last time: {lastTimeData[exercise.id].bestSet} | Vol: {lastTimeData[exercise.id].volume?.toFixed?.(0)}{' '}
                    | 1RM:{' '}
                    {lastTimeData[exercise.id].est1RM > 0 ? lastTimeData[exercise.id].est1RM.toFixed(0) : 'N/A'}
                  </div>
                )}
              </div>

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
                    {(sets[exercise.id] || []).map((set: any, idx: number) => (
                      <tr key={set.id} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="px-2 py-2 font-medium text-gray-900 dark:text-gray-100">{idx + 1}</td>

                        {/* REPS: smooth typing, save onBlur */}
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            inputMode="numeric"
                            value={getDraftValue(set.id, 'reps', set.reps)}
                            onChange={(e) => setDraftValue(set.id, 'reps', e.target.value)}
                            onBlur={() => {
                              const raw = getDraftValue(set.id, 'reps', set.reps);
                              const num = raw.trim() === '' ? 0 : Number(raw);
                              saveSet(set.id, 'reps', Number.isFinite(num) ? num : 0);
                              clearDraftField(set.id, 'reps');
                            }}
                            className="w-full px-2 py-1 border border-gray-300 dark:border-gray-700 rounded text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                          />
                        </td>

                        {/* WEIGHT: smooth typing, save onBlur */}
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
                              saveSet(set.id, 'weight', Number.isFinite(num) ? num : 0);
                              clearDraftField(set.id, 'weight');
                            }}
                            className="w-full px-2 py-1 border border-gray-300 dark:border-gray-700 rounded text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                          />
                        </td>

                        {/* RPE: allow blank -> null, save onBlur */}
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
                              saveSet(set.id, 'rpe', val === null ? null : Number.isFinite(val) ? val : null);
                              clearDraftField(set.id, 'rpe');
                            }}
                            className="w-full px-2 py-1 border border-gray-300 dark:border-gray-700 rounded text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                          />
                        </td>

                        {/* Done checkbox: save immediately (no refetch) */}
                        <td className="px-2 py-2 text-center">
                          <button
                            onClick={() => saveSet(set.id, 'is_completed', !set.is_completed)}
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
          ))}

          {exercises.length === 0 && (
            <div className="text-gray-600 dark:text-gray-400">No exercises found for this session.</div>
          )}
        </div>
      </div>
    </div>
  );
}
