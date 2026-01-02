'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

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

  // HEVY-style: previous sets per exercise (indexed by set number)
  const [prevSetsByExercise, setPrevSetsByExercise] = useState<Record<string, WorkoutSet[]>>({});

  /**
   * Draft input state:
   * - keeps inputs smooth while typing
   * - prevents "snapping" to 0
   * - prevents DB updates on every keystroke
   * - ALSO hides leading 0 so you don't type "025" etc.
   */
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});

  const setDraftValue = (setId: string, field: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      [setId]: { ...(prev[setId] || {}), [field]: value },
    }));
  };

  // ✅ Key change: if fallback is 0, show empty string (unless user is typing)
  const getDraftValue = (setId: string, field: string, fallback: number | null | undefined) => {
    const v = draft[setId]?.[field];
    if (v !== undefined) return v; // user is typing

    if (fallback === 0) return ''; // hide zeros in UI
    return (fallback ?? '').toString();
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

  // ✅ On focus: if current value is 0 and no draft yet, clear it so typing starts clean
  const handleFocusClearZero = (setId: string, field: string, currentValue: any) => {
    const existingDraft = draft[setId]?.[field];
    if (existingDraft !== undefined) return; // already editing

    const num = Number(currentValue ?? 0);
    if (Number.isFinite(num) && num === 0) {
      setDraftValue(setId, field, '');
    }
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

    await loadPreviousSetsForExercises(exData, sessionData.started_at);

    // keep any existing last-time summary function (if your project has it)
    if (typeof (globalThis as any).loadLastTimeData === 'function') {
      const res = await (globalThis as any).loadLastTimeData(exData, sessionData.started_at);
      if (res) setLastTimeData(res);
    }
  };

  /**
   * HEVY-style previous sets:
   * for each current workout_exercise row, find the most recent previous workout session
   * where the same exercise_id was performed, then pull that session's sets.
   */
  const loadPreviousSetsForExercises = async (exData: WorkoutExercise[], startedAt: string) => {
    setPrevSetsByExercise({});

    const entries = await Promise.all(
      exData.map(async (ex) => {
        const currentWorkoutExerciseId = ex.id;
        const exerciseId = ex.exercise_id;

        if (!exerciseId) return [currentWorkoutExerciseId, []] as [string, WorkoutSet[]];

        const { data: prevSessions } = await supabase
          .from('workout_sessions')
          .select('id, started_at')
          .lt('started_at', startedAt)
          .order('started_at', { ascending: false })
          .limit(25);

        if (!prevSessions || prevSessions.length === 0)
          return [currentWorkoutExerciseId, []] as [string, WorkoutSet[]];

        let prevWorkoutExerciseId: string | null = null;

        for (const s of prevSessions) {
          const { data: prevExerciseRow } = await supabase
            .from('workout_exercises')
            .select('id')
            .eq('workout_session_id', s.id)
            .eq('exercise_id', exerciseId)
            .limit(1)
            .maybeSingle();

          if (prevExerciseRow?.id) {
            prevWorkoutExerciseId = prevExerciseRow.id;
            break;
          }
        }

        if (!prevWorkoutExerciseId) return [currentWorkoutExerciseId, []] as [string, WorkoutSet[]];

        const { data: prevSets } = await supabase
          .from('workout_sets')
          .select('*')
          .eq('workout_exercise_id', prevWorkoutExerciseId)
          .order('set_index');

        return [currentWorkoutExerciseId, (prevSets || []) as WorkoutSet[]] as [string, WorkoutSet[]];
      })
    );

    const map: Record<string, WorkoutSet[]> = {};
    for (const [k, v] of entries) map[k] = v;
    setPrevSetsByExercise(map);
  };

  /**
   * Save onBlur (no lag) + optimistic UI update
   */
  const saveSet = async (setId: string, field: string, value: any) => {
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
      loadWorkout();
    }
  };

  const endWorkout = async () => {
    await supabase
      .from('workout_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', sessionId);

    router.push('/history');
  };

  const discardWorkout = async () => {
    const ok = confirm('Discard this workout? This will delete the session and all sets.');
    if (!ok) return;

    const { error } = await supabase.from('workout_sessions').delete().eq('id', sessionId);
    if (error) {
      console.error('Discard failed:', error);
      alert('Failed to discard workout. Please try again.');
      return;
    }

    router.push('/workout/start');
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
        rpe: null, // kept for DB compatibility; UI removed
      })
      .select()
      .single();

    if (data) loadWorkout();
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

  const formatPrevLine = (label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return null;
    return (
      <div className="mt-1 text-[11px] leading-tight text-gray-500 dark:text-gray-400">
        <span className="opacity-80">{label}</span> {value}
      </div>
    );
  };

  // PR logic: green if you beat previous weight/reps for the same set number
  const isPR = (current: any, prev: any) => {
    if (!prev) return false;

    const cw = Number(current?.weight ?? 0);
    const cr = Number(current?.reps ?? 0);
    const pw = Number(prev?.weight ?? 0);
    const pr = Number(prev?.reps ?? 0);

    if (!cw || !cr) return false;
    if (!pw && !pr) return false;

    const heavierSameOrMoreReps = cw > pw && cr >= pr;
    const moreRepsSameOrMoreWeight = cr > pr && cw >= pw;

    return heavierSameOrMoreReps || moreRepsSameOrMoreWeight;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto px-4 py-6 pb-28">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {session?.routines?.name || 'Workout'}
          </h1>
          {session?.routine_days?.name && (
            <p className="text-gray-600 dark:text-gray-400">{session.routine_days.name}</p>
          )}
        </div>

        <div className="space-y-6">
          {exercises.map((exercise: any) => {
            const prevSets = prevSetsByExercise[exercise.id] || [];

            return (
              <div key={exercise.id} className="bg-white dark:bg-gray-800 rounded-lg overflow-hidden p-4">
                <div className="mb-2">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {exercise.exercises?.name || 'Exercise'}
                  </h3>

                  {lastTimeData?.[exercise.id] && (
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                      Last time: {lastTimeData[exercise.id].bestSet} | Vol:{' '}
                      {lastTimeData[exercise.id].volume?.toFixed?.(0)} | 1RM:{' '}
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
                        <th className="px-2 py-2 text-center">Done</th>
                        <th className="px-2 py-2 w-12 text-center">Del</th>
                      </tr>
                    </thead>

                    <tbody>
                      {(sets[exercise.id] || []).map((set: any, idx: number) => {
                        const prev = prevSets[idx];
                        const prevReps = prev?.reps ?? null;
                        const prevWeight = prev?.weight ?? null;

                        const pr = isPR(set, prev);

                        return (
                          <tr
                            key={set.id}
                            className={`border-b dark:border-gray-800 align-top ${
                              pr ? 'bg-green-50/60 dark:bg-green-900/20' : 'border-gray-100'
                            }`}
                          >
                            <td className="px-2 py-2 font-medium text-gray-900 dark:text-gray-100">
                              <div className="flex items-center gap-2">
                                <span>{idx + 1}</span>
                                {pr && (
                                  <span className="inline-flex items-center rounded-full bg-green-600 text-white text-[10px] px-2 py-0.5">
                                    PR
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* REPS */}
                            <td className="px-2 py-2">
                              <input
                                type="number"
                                inputMode="numeric"
                                value={getDraftValue(set.id, 'reps', set.reps)}
                                onFocus={() => handleFocusClearZero(set.id, 'reps', set.reps)}
                                onChange={(e) => setDraftValue(set.id, 'reps', e.target.value)}
                                onBlur={() => {
                                  const raw = getDraftValue(set.id, 'reps', set.reps);
                                  const num = raw.trim() === '' ? 0 : Number(raw);
                                  saveSet(set.id, 'reps', Number.isFinite(num) ? num : 0);
                                  clearDraftField(set.id, 'reps');
                                }}
                                className={`w-full px-2 py-1 border rounded text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ${
                                  pr ? 'border-green-400 dark:border-green-500' : 'border-gray-300 dark:border-gray-700'
                                }`}
                              />
                              {formatPrevLine('Prev:', prevReps)}
                            </td>

                            {/* WEIGHT */}
                            <td className="px-2 py-2">
                              <input
                                type="number"
                                inputMode="decimal"
                                step="0.5"
                                value={getDraftValue(set.id, 'weight', set.weight)}
                                onFocus={() => handleFocusClearZero(set.id, 'weight', set.weight)}
                                onChange={(e) => setDraftValue(set.id, 'weight', e.target.value)}
                                onBlur={() => {
                                  const raw = getDraftValue(set.id, 'weight', set.weight);
                                  const num = raw.trim() === '' ? 0 : Number(raw);
                                  saveSet(set.id, 'weight', Number.isFinite(num) ? num : 0);
                                  clearDraftField(set.id, 'weight');
                                }}
                                className={`w-full px-2 py-1 border rounded text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ${
                                  pr ? 'border-green-400 dark:border-green-500' : 'border-gray-300 dark:border-gray-700'
                                }`}
                              />
                              {formatPrevLine('Prev:', prevWeight)}
                            </td>

                            {/* Done */}
                            <td className="px-2 py-2 text-center">
                              <button
                                onClick={() => saveSet(set.id, 'is_completed', !set.is_completed)}
                                className={`w-6 h-6 rounded border-2 flex items-center justify-center mt-1 ${
                                  set.is_completed
                                    ? 'bg-gray-900 dark:bg-gray-100 border-gray-900 dark:border-gray-100'
                                    : 'border-gray-300 dark:border-gray-700'
                                }`}
                              >
                                {set.is_completed && <span className="text-white dark:text-gray-900 text-xs">✓</span>}
                              </button>
                            </td>

                            {/* Delete */}
                            <td className="px-2 py-2 text-center">
                              <button
                                onClick={() => deleteSet(exercise.id, set.id)}
                                className="text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 mt-1"
                                title="Delete set"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
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
          })}

          {exercises.length === 0 && (
            <div className="text-gray-600 dark:text-gray-400">No exercises found for this session.</div>
          )}
        </div>

        {/* Bottom actions (HEVY-like) */}
        <div className="mt-8 space-y-3">
          <button
            onClick={endWorkout}
            className="w-full px-4 py-3 rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 font-semibold"
          >
            End Workout
          </button>

          <button
            onClick={discardWorkout}
            className="w-full px-4 py-3 rounded-lg border border-red-500/60 text-red-600 dark:text-red-400 font-semibold hover:bg-red-50/30 dark:hover:bg-red-900/20"
          >
            Discard Workout
          </button>
        </div>
      </div>
    </div>
  );
}
