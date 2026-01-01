'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type WorkoutSession = any;
type WorkoutExercise = any;
type WorkoutSet = any;
type ExerciseLastTime = any;

type PrevInfo = {
  sets: WorkoutSet[];
  session_started_at?: string | null;
};

export default function WorkoutPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [sets, setSets] = useState<{ [exerciseId: string]: WorkoutSet[] }>({});
  const [lastTimeData, setLastTimeData] = useState<ExerciseLastTime>({});

  // Previous sets + meta (prev session date)
  const [prevByExercise, setPrevByExercise] = useState<Record<string, PrevInfo>>({});

  // Draft input state (smooth typing)
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});

  // Warmup toggles (safe: persisted only if DB column exists)
  const [warmupLocal, setWarmupLocal] = useState<Record<string, boolean>>({});

  // Sticky footer "quick add"
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>('');

  // Rest timer
  const [timerPreset, setTimerPreset] = useState<number>(90);
  const [timerSecondsLeft, setTimerSecondsLeft] = useState<number>(90);
  const [timerRunning, setTimerRunning] = useState<boolean>(false);
  const timerIntervalRef = useRef<number | null>(null);

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

  // Keep selectedExerciseId stable
  useEffect(() => {
    if (!selectedExerciseId && exercises.length > 0) {
      setSelectedExerciseId(exercises[0].id);
    } else if (selectedExerciseId && exercises.length > 0) {
      const stillExists = exercises.some((e: any) => e.id === selectedExerciseId);
      if (!stillExists) setSelectedExerciseId(exercises[0].id);
    }
  }, [exercises, selectedExerciseId]);

  // Rest timer interval
  useEffect(() => {
    if (!timerRunning) {
      if (timerIntervalRef.current) {
        window.clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      return;
    }

    if (timerIntervalRef.current) return;

    timerIntervalRef.current = window.setInterval(() => {
      setTimerSecondsLeft((s) => {
        if (s <= 1) {
          // stop at 0
          setTimerRunning(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      if (timerIntervalRef.current) {
        window.clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [timerRunning]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const resetTimer = (preset?: number) => {
    const p = preset ?? timerPreset;
    setTimerPreset(p);
    setTimerSecondsLeft(p);
    setTimerRunning(false);
  };

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
    const warmMap: Record<string, boolean> = {};

    for (const ex of exData) {
      const { data: setsData } = await supabase
        .from('workout_sets')
        .select('*')
        .eq('workout_exercise_id', ex.id)
        .order('set_index');

      const rows = setsData || [];
      setsMap[ex.id] = rows;

      // Warmup local mirror (if DB has it, we mirror; otherwise default false)
      for (const s of rows as any[]) {
        if (Object.prototype.hasOwnProperty.call(s, 'is_warmup')) {
          warmMap[s.id] = !!s.is_warmup;
        }
      }
    }

    setSets(setsMap);
    setWarmupLocal((prev) => ({ ...prev, ...warmMap }));

    await loadPreviousForExercises(exData, sessionData.started_at);

    if (typeof (globalThis as any).loadLastTimeData === 'function') {
      const res = await (globalThis as any).loadLastTimeData(exData, sessionData.started_at);
      if (res) setLastTimeData(res);
    }
  };

  /**
   * Previous sets + previous session date (HEVY-like)
   */
  const loadPreviousForExercises = async (exData: WorkoutExercise[], startedAt: string) => {
    setPrevByExercise({});

    const entries = await Promise.all(
      exData.map(async (ex) => {
        const currentWorkoutExerciseId = ex.id;
        const exerciseId = ex.exercise_id;
        if (!exerciseId) return [currentWorkoutExerciseId, { sets: [] }] as [string, PrevInfo];

        // Previous sessions
        const { data: prevSessions } = await supabase
          .from('workout_sessions')
          .select('id, started_at')
          .lt('started_at', startedAt)
          .order('started_at', { ascending: false })
          .limit(25);

        if (!prevSessions || prevSessions.length === 0) {
          return [currentWorkoutExerciseId, { sets: [] }] as [string, PrevInfo];
        }

        // Find previous workout_exercise row for that exerciseId
        let prevWorkoutExerciseId: string | null = null;
        let prevSessionStartedAt: string | null = null;

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
            prevSessionStartedAt = s.started_at ?? null;
            break;
          }
        }

        if (!prevWorkoutExerciseId) {
          return [currentWorkoutExerciseId, { sets: [] }] as [string, PrevInfo];
        }

        const { data: prevSets } = await supabase
          .from('workout_sets')
          .select('*')
          .eq('workout_exercise_id', prevWorkoutExerciseId)
          .order('set_index');

        return [
          currentWorkoutExerciseId,
          { sets: (prevSets || []) as WorkoutSet[], session_started_at: prevSessionStartedAt },
        ] as [string, PrevInfo];
      })
    );

    const map: Record<string, PrevInfo> = {};
    for (const [k, v] of entries) map[k] = v;
    setPrevByExercise(map);
  };

  /**
   * Save set field (no lag) + optimistic UI update
   */
  const saveSet = async (setId: string, field: string, value: any) => {
    // optimistic update
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
        rpe: null, // UI removed; keep DB compatible
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

  const formatPrevLine = (text: string) => {
    if (!text) return null;
    return <div className="mt-1 text-[11px] leading-tight text-gray-500 dark:text-gray-400">{text}</div>;
  };

  const formatPrevDate = (iso?: string | null) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '';
    }
  };

  // PR only when Done
  const isPR = (current: any, prev: any) => {
    if (!current?.is_completed) return false;
    if (!prev) return false;

    const cw = Number(current?.weight ?? 0);
    const cr = Number(current?.reps ?? 0);
    const pw = Number(prev?.weight ?? 0);
    const pr = Number(prev?.reps ?? 0);

    if (!cw || !cr) return false;
    if (!pw && !pr) return false;

    return (cw > pw && cr >= pr) || (cr > pr && cw >= pw);
  };

  const applyWeightDelta = async (setRow: any, delta: number) => {
    const current = Number(setRow?.weight ?? 0);
    const next = Math.max(0, Math.round((current + delta) * 100) / 100);

    // Update draft so it feels instant
    setDraftValue(setRow.id, 'weight', next.toString());

    // If completed, we keep it read-only — don’t auto-save changes while done.
    if (setRow?.is_completed) return;

    // Save immediately on button tap (snappy)
    await saveSet(setRow.id, 'weight', next);
    clearDraftField(setRow.id, 'weight');
  };

  const toggleWarmup = async (setRow: any) => {
    const setId = setRow.id;
    const hasDbColumn = Object.prototype.hasOwnProperty.call(setRow, 'is_warmup');
    const nextVal = !getWarmup(setId, setRow);

    // optimistic local
    setWarmupLocal((prev) => ({ ...prev, [setId]: nextVal }));

    // Only persist if the column exists in returned row shape
    if (hasDbColumn) {
      await saveSet(setId, 'is_warmup', nextVal);
    }
  };

  const getWarmup = (setId: string, setRow: any) => {
    if (warmupLocal[setId] !== undefined) return warmupLocal[setId];
    if (Object.prototype.hasOwnProperty.call(setRow, 'is_warmup')) return !!setRow.is_warmup;
    return false;
  };

  const onToggleDone = async (exerciseId: string, setRow: any, idx: number) => {
    const nextCompleted = !setRow.is_completed;
    await saveSet(setRow.id, 'is_completed', nextCompleted);

    // Auto-add next set ONLY when completing the last set
    if (nextCompleted) {
      const currentList = sets[exerciseId] || [];
      const isLast = idx === currentList.length - 1;
      if (isLast) {
        await addSet(exerciseId);
        // start rest timer automatically (HEVY-like)
        resetTimer(timerPreset);
        setTimerRunning(true);
      }
    }
  };

  const footerExerciseOptions = useMemo(() => {
    return exercises.map((e: any) => ({
      id: e.id,
      name: e.exercises?.name || 'Exercise',
    }));
  }, [exercises]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-28">
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
          {exercises.map((exercise: any) => {
            const prevInfo = prevByExercise[exercise.id] || { sets: [] };
            const prevSets = prevInfo.sets || [];
            const prevDate = formatPrevDate(prevInfo.session_started_at);

            return (
              <div key={exercise.id} className="bg-white dark:bg-gray-800 rounded-lg overflow-hidden p-4">
                <div className="mb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                        {exercise.exercises?.name || 'Exercise'}
                      </h3>

                      {/* Better previous display (HEVY-like): show the previous session date */}
                      {prevDate && (
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Previous session: {prevDate}
                        </div>
                      )}

                      {lastTimeData?.[exercise.id] && (
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                          Last time: {lastTimeData[exercise.id].bestSet} | Vol:{' '}
                          {lastTimeData[exercise.id].volume?.toFixed?.(0)} | 1RM:{' '}
                          {lastTimeData[exercise.id].est1RM > 0 ? lastTimeData[exercise.id].est1RM.toFixed(0) : 'N/A'}
                        </div>
                      )}
                    </div>
                  </div>
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
                        <th className="px-2 py-2 w-16 text-center">WU</th>
                        <th className="px-2 py-2">Reps</th>
                        <th className="px-2 py-2">Weight</th>
                        <th className="px-2 py-2 text-center">Done</th>
                        <th className="px-2 py-2 w-12 text-center">Del</th>
                      </tr>
                    </thead>

                    <tbody>
                      {(sets[exercise.id] || []).map((setRow: any, idx: number) => {
                        const prev = prevSets[idx]; // match set number
                        const prevReps = prev?.reps ?? null;
                        const prevWeight = prev?.weight ?? null;

                        const pr = isPR(setRow, prev);
                        const warm = getWarmup(setRow.id, setRow);

                        // HEVY-like: lock/dim inputs when completed
                        const locked = !!setRow.is_completed;

                        const rowBg = pr ? 'bg-green-50/60 dark:bg-green-900/20' : '';
                        const lockedOpacity = locked ? 'opacity-60' : '';

                        return (
                          <tr key={setRow.id} className={`border-b dark:border-gray-800 align-top ${rowBg}`}>
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

                            {/* Warm-up toggle */}
                            <td className="px-2 py-2 text-center">
                              <button
                                onClick={() => toggleWarmup(setRow)}
                                className={`w-8 h-8 rounded border text-xs font-bold ${
                                  warm
                                    ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100'
                                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700'
                                }`}
                                title="Warm-up set"
                              >
                                W
                              </button>
                            </td>

                            {/* REPS */}
                            <td className={`px-2 py-2 ${lockedOpacity}`}>
                              <input
                                type="number"
                                inputMode="numeric"
                                readOnly={locked}
                                value={getDraftValue(setRow.id, 'reps', setRow.reps)}
                                onChange={(e) => setDraftValue(setRow.id, 'reps', e.target.value)}
                                onBlur={() => {
                                  if (locked) return;
                                  const raw = getDraftValue(setRow.id, 'reps', setRow.reps);
                                  const num = raw.trim() === '' ? 0 : Number(raw);
                                  saveSet(setRow.id, 'reps', Number.isFinite(num) ? num : 0);
                                  clearDraftField(setRow.id, 'reps');
                                }}
                                className={`w-full px-2 py-1 border rounded text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ${
                                  pr
                                    ? 'border-green-400 dark:border-green-500'
                                    : 'border-gray-300 dark:border-gray-700'
                                } ${locked ? 'cursor-not-allowed' : ''}`}
                              />

                              {/* Better prev display */}
                              {prevReps !== null && prevWeight !== null
                                ? formatPrevLine(`Prev: ${prevReps} × ${prevWeight}`)
                                : prevReps !== null
                                  ? formatPrevLine(`Prev: ${prevReps}`)
                                  : null}
                            </td>

                            {/* WEIGHT + quick buttons */}
                            <td className={`px-2 py-2 ${lockedOpacity}`}>
                              <input
                                type="number"
                                inputMode="decimal"
                                step="0.5"
                                readOnly={locked}
                                value={getDraftValue(setRow.id, 'weight', setRow.weight)}
                                onChange={(e) => setDraftValue(setRow.id, 'weight', e.target.value)}
                                onBlur={() => {
                                  if (locked) return;
                                  const raw = getDraftValue(setRow.id, 'weight', setRow.weight);
                                  const num = raw.trim() === '' ? 0 : Number(raw);
                                  saveSet(setRow.id, 'weight', Number.isFinite(num) ? num : 0);
                                  clearDraftField(setRow.id, 'weight');
                                }}
                                className={`w-full px-2 py-1 border rounded text-center bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ${
                                  pr
                                    ? 'border-green-400 dark:border-green-500'
                                    : 'border-gray-300 dark:border-gray-700'
                                } ${locked ? 'cursor-not-allowed' : ''}`}
                              />

                              {/* Quick weight buttons (tap = save immediately, unless locked) */}
                              <div className="mt-2 flex flex-wrap gap-1 justify-center">
                                {[-10, -5, -2.5, 2.5, 5, 10].map((d) => (
                                  <button
                                    key={d}
                                    onClick={() => applyWeightDelta(setRow, d)}
                                    disabled={locked}
                                    className={`px-2 py-1 rounded border text-[11px] font-semibold ${
                                      locked
                                        ? 'opacity-50 cursor-not-allowed border-gray-200 dark:border-gray-700'
                                        : 'border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    }`}
                                    title={d > 0 ? `+${d}` : `${d}`}
                                  >
                                    {d > 0 ? `+${d}` : `${d}`}
                                  </button>
                                ))}
                              </div>

                              {prevWeight !== null && prevReps === null ? formatPrevLine(`Prev: ${prevWeight}`) : null}
                            </td>

                            {/* DONE */}
                            <td className="px-2 py-2 text-center">
                              <button
                                onClick={() => onToggleDone(exercise.id, setRow, idx)}
                                className={`w-6 h-6 rounded border-2 flex items-center justify-center mt-1 ${
                                  setRow.is_completed
                                    ? 'bg-gray-900 dark:bg-gray-100 border-gray-900 dark:border-gray-100'
                                    : 'border-gray-300 dark:border-gray-700'
                                }`}
                              >
                                {setRow.is_completed && <span className="text-white dark:text-gray-900 text-xs">✓</span>}
                              </button>
                            </td>

                            {/* DELETE */}
                            <td className="px-2 py-2 text-center">
                              <button
                                onClick={() => deleteSet(exercise.id, setRow.id)}
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
      </div>

      {/* ✅ Sticky Footer Bar (HEVY-like) */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur z-50">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <div className="flex flex-col gap-3">
            {/* Rest timer row */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Rest: <span className="tabular-nums">{formatTime(timerSecondsLeft)}</span>
                </div>

                <div className="flex items-center gap-2">
                  {[60, 90, 120].map((p) => (
                    <button
                      key={p}
                      onClick={() => resetTimer(p)}
                      className={`px-2 py-1 rounded border text-xs font-semibold ${
                        timerPreset === p
                          ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100'
                          : 'border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {p}s
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTimerRunning((v) => !v)}
                  className="px-3 py-2 rounded bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 text-sm font-semibold"
                >
                  {timerRunning ? 'Pause' : 'Start'}
                </button>
                <button
                  onClick={() => resetTimer()}
                  className="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Actions row */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {footerExerciseOptions.length > 1 ? (
                  <select
                    value={selectedExerciseId}
                    onChange={(e) => setSelectedExerciseId(e.target.value)}
                    className="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
                  >
                    {footerExerciseOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    {footerExerciseOptions[0]?.name ?? 'Exercise'}
                  </div>
                )}

                <button
                  onClick={() => selectedExerciseId && addSet(selectedExerciseId)}
                  className="px-3 py-2 rounded bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 text-sm font-semibold"
                >
                  + Add Set
                </button>
              </div>

              <button
                onClick={endWorkout}
                className="px-4 py-2 rounded bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 text-sm font-semibold"
              >
                End Workout
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
