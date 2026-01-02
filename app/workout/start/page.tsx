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

  // Draft input state (smooth typing)
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});

  // End/Discard states
  const [ending, setEnding] = useState(false);
  const [discarding, setDiscarding] = useState(false);

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

  // Minimal fix: if the field shows "0" and user taps into it, clear it so typing won't append to 0.
  const handleNumericFocus = (setId: string, field: string, fallback: number | null | undefined) => {
    const existingDraft = draft[setId]?.[field];
    if (existingDraft !== undefined) return;

    const shown = (fallback ?? '').toString();
    if (shown === '0') {
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

    // Load ALL sets in one go (faster than N+1)
    const exIds = exData.map((e: any) => e.id);
    const { data: allSets } = await supabase
      .from('workout_sets')
      .select('*')
      .in('workout_exercise_id', exIds)
      .order('set_index');

    const map: { [exerciseId: string]: WorkoutSet[] } = {};
    for (const ex of exData) map[ex.id] = [];
    for (const s of allSets || []) {
      map[s.workout_exercise_id] = map[s.workout_exercise_id] || [];
      map[s.workout_exercise_id].push(s);
    }
    setSets(map);

    // HEVY-style previous sets
    await loadPreviousSetsForExercises(exData, sessionData.started_at);

    // keep any existing last-time summary function (if your project has it)
    if (typeof (globalThis as any).loadLastTimeData === 'function') {
      const res = await (globalThis as any).loadLastTimeData(exData, sessionData.started_at);
      if (res) setLastTimeData(res);
    }
  };

  const loadPreviousSetsForExercises = async (exData: WorkoutExercise[], startedAt: string) => {
    setPrevSetsByExercise({});

    const exerciseIds = Array.from(
      new Set(
        exData
          .map((e: any) => e.exercise_id)
          .filter(Boolean)
      )
    );

    if (exerciseIds.length === 0) {
      const empty: Record<string, WorkoutSet[]> = {};
      for (const ex of exData) empty[ex.id] = [];
      setPrevSetsByExercise(empty);
      return;
    }

    // Fetch a pool of recent historical workout_exercises for all exercise_ids in one query,
    // then select the most recent per exercise_id.
    const { data: prevWorkoutExercises, error: prevWeErr } = await supabase
      .from('workout_exercises')
      .select('id, exercise_id, workout_session_id, workout_sessions!inner(started_at)')
      .in('exercise_id', exerciseIds)
      .lt('workout_sessions.started_at', startedAt)
      .order('workout_sessions(started_at)', { ascending: false })
      .limit(250);

    if (prevWeErr) {
      console.error('Failed loading previous workout exercises:', prevWeErr);
      const empty: Record<string, WorkoutSet[]> = {};
      for (const ex of exData) empty[ex.id] = [];
      setPrevSetsByExercise(empty);
      return;
    }

    const mostRecentByExerciseId = new Map<string, string>();
    for (const row of prevWorkoutExercises || []) {
      const exId = (row as any).exercise_id as string;
      if (!exId) continue;
      if (!mostRecentByExerciseId.has(exId)) {
        mostRecentByExerciseId.set(exId, (row as any).id as string);
      }
    }

    const prevWorkoutExerciseIds = Array.from(mostRecentByExerciseId.values());
    let prevSetsRows: any[] = [];
    if (prevWorkoutExerciseIds.length > 0) {
      const { data: prevSets, error: prevSetsErr } = await supabase
        .from('workout_sets')
        .select('*')
        .in('workout_exercise_id', prevWorkoutExerciseIds)
        .order('set_index');
      if (prevSetsErr) {
        console.error('Failed loading previous workout sets:', prevSetsErr);
      }
      prevSetsRows = prevSets || [];
    }

    const prevSetsByPrevWeId: Record<string, WorkoutSet[]> = {};
    for (const s of prevSetsRows) {
      const weId = s.workout_exercise_id;
      prevSetsByPrevWeId[weId] = prevSetsByPrevWeId[weId] || [];
      prevSetsByPrevWeId[weId].push(s);
    }

    const map: Record<string, WorkoutSet[]> = {};
    for (const ex of exData) {
      const exId = (ex as any).exercise_id as string;
      const prevWeId = exId ? mostRecentByExerciseId.get(exId) : undefined;
      map[(ex as any).id] = prevWeId ? (prevSetsByPrevWeId[prevWeId] || []) : [];
    }
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
    const ok = window.confirm('End workout? This will save it to History.');
    if (!ok) return;

    try {
      setEnding(true);
      await supabase
        .from('workout_sessions')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', sessionId);

      router.push('/history');
    } finally {
      setEnding(false);
    }
  };

  const discardWorkout = async () => {
    const ok = window.confirm('Discard workout? This will permanently delete this session and all sets.');
    if (!ok) return;

    try {
      setDiscarding(true);

      const { data: exRows, error: exErr } = await supabase
        .from('workout_exercises')
        .select('id')
        .eq('workout_session_id', sessionId);

      if (exErr) console.error('Failed loading workout exercises for discard:', exErr);

      const exIds = (exRows || []).map((r: any) => r.id);

      if (exIds.length > 0) {
        const { error: delSetsErr } = await supabase
          .from('workout_sets')
          .delete()
          .in('workout_exercise_id', exIds);

        if (delSetsErr) console.error('Failed deleting workout sets:', delSetsErr);
      }

      const { error: delExErr } = await supabase
        .from('workout_exercises')
        .delete()
        .eq('workout_session_id', sessionId);

      if (delExErr) console.error('Failed deleting workout exercises:', delExErr);

      const { error: delSessionErr } = await supabase
        .from('workout_sessions')
        .delete()
        .eq('id', sessionId);

      if (delSessionErr) console.error('Failed deleting workout session:', delSessionErr);

      router.push('/workout/start');
    } finally {
      setDiscarding(false);
    }
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
        rpe: null, // keep DB compatible even though UI removed
      })
      .select()
      .single();

    if (data) loadWorkout();
  };

  const deleteSet = async (exerciseId: string, setId: string) => {
    await supabase.from('workout_sets').delete().eq('id', setId);

    const remaining = (sets[exerciseId] || []).filter((s: any) => s.id !== setId);

    if (remaining.length > 0) {
      const payload = remaining.map((s: any, i: number) => ({ id: s.id, set_index: i }));
      const { error: reindexErr } = await supabase.from('workout_sets').upsert(payload, { onConflict: 'id' });
      if (reindexErr) {
        console.error('Failed reindexing sets:', reindexErr);
      }
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
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Header WITHOUT End button */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {session?.routines?.name || 'Workout'}
            </h1>
            {session?.routine_days?.name && (
              <p className="text-gray-600 dark:text-gray-400">{session.routine_days.name}</p>
            )}
          </div>
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
                          className={`px-3 py-2 min-h-[44px] rounded-full text-xs font-semibold border ${
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

                            <td className="px-2 py-2">
                              <input
                                type="number"
                                inputMode="numeric"
                                placeholder="0"
                                value={getDraftValue(set.id, 'reps', set.reps)}
                                onFocus={() => handleNumericFocus(set.id, 'reps', set.reps)}
                                onChange={(e) => setDraftValue(set.id, 'reps', e.target.value)}
                                onBlur={() => {
                                  const raw = getDraftValue(set.id, 'reps', set.reps);
                                  const num = raw.trim() === '' ? 0 : Number(raw);
                                  saveSet(set.id, 'reps', Number.isFinite(num) ? num : 0);
                                  clearDraftField(set.id, 'reps');
                                }}
                                className={`w-full h-11 px-2 py-2 border rounded text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ${
                                  pr ? 'border-green-400 dark:border-green-500' : 'border-gray-300 dark:border-gray-700'
                                }`}
                              />
                              {formatPrevLine('Prev:', prevReps)}
                            </td>

                            <td className="px-2 py-2">
                              <input
                                type="number"
                                inputMode="decimal"
                                step="0.5"
                                placeholder="0"
                                value={getDraftValue(set.id, 'weight', set.weight)}
                                onFocus={() => handleNumericFocus(set.id, 'weight', set.weight)}
                                onChange={(e) => setDraftValue(set.id, 'weight', e.target.value)}
                                onBlur={() => {
                                  const raw = getDraftValue(set.id, 'weight', set.weight);
                                  const num = raw.trim() === '' ? 0 : Number(raw);
                                  saveSet(set.id, 'weight', Number.isFinite(num) ? num : 0);
                                  clearDraftField(set.id, 'weight');
                                }}
                                className={`w-full h-11 px-2 py-2 border rounded text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ${
                                  pr ? 'border-green-400 dark:border-green-500' : 'border-gray-300 dark:border-gray-700'
                                }`}
                              />
                              {formatPrevLine('Prev:', prevWeight)}
                            </td>

                            <td className="px-2 py-2 text-center">
                              <button
                                onClick={() => saveSet(set.id, 'is_completed', !set.is_completed)}
                                className={`w-11 h-11 rounded border-2 flex items-center justify-center ${
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
                                className="w-11 h-11 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-red-600 hover:bg-red-50 dark:text-gray-400 dark:hover:text-red-400 dark:hover:bg-red-900/20"
                                title="Delete set"
                                aria-label="Delete set"
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
                      className="px-4 py-3 min-h-[44px] rounded bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 font-semibold"
                    >
                      + Add Set
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Bottom actions (HEVY-style) */}
          <div className="pt-6 space-y-3">
            <button
              onClick={endWorkout}
              disabled={ending || discarding}
              className="w-full px-4 py-3 rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {ending ? 'Ending…' : 'End Workout'}
            </button>

            <button
              onClick={discardWorkout}
              disabled={ending || discarding}
              className="w-full px-4 py-3 rounded-lg border border-red-500/60 text-red-600 dark:text-red-400 font-semibold bg-transparent disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {discarding ? 'Discarding…' : 'Discard Workout'}
            </button>
          </div>

          {exercises.length === 0 && (
            <div className="text-gray-600 dark:text-gray-400">No exercises found for this session.</div>
          )}
        </div>
      </div>
    </div>
  );
}
