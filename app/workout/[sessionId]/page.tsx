'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type WorkoutSession = any;
type WorkoutExercise = any;
type WorkoutSet = any;

function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export default function WorkoutPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [exercises, setExercises] = useStatez= useState<WorkoutExercise[]>([]);
  const [sets, setSets] = useState<{ [exerciseId: string]: WorkoutSet[] }>({});

  // Previous sets per exercise (indexed by set number)
  const [prevSetsByExercise, setPrevSetsByExercise] = useState<Record<string, WorkoutSet[]>>({});

  // Draft input state: always blank until user types; onBlur commits + clears draft.
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});

  // Session clock
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Rest timer
  const [restSecondsRemaining, setRestSecondsRemaining] = useState<number | null>(null);
  const [restDurationSeconds, setRestDurationSeconds] = useState<number>(90);
  const restIntervalRef = useRef<number | null>(null);

  // End/Discard states
  const [ending, setEnding] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const startAtMs = useMemo(() => {
    const started = session?.started_at ? new Date(session.started_at).getTime() : NaN;
    return Number.isFinite(started) ? started : Date.now();
  }, [session?.started_at]);

  const setDraftValue = (setId: string, field: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      [setId]: { ...(prev[setId] || {}), [field]: value },
    }));
  };

  const getDraftOrEmpty = (setId: string, field: string) => {
    const v = draft[setId]?.[field];
    return v !== undefined ? v : '';
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

  const stopRestTimer = () => {
    setRestSecondsRemaining(null);
    if (restIntervalRef.current) {
      window.clearInterval(restIntervalRef.current);
      restIntervalRef.current = null;
    }
  };

  const startRestTimer = (seconds: number) => {
    const dur = clampInt(seconds, 5, 600);
    setRestSecondsRemaining(dur);

    if (restIntervalRef.current) {
      window.clearInterval(restIntervalRef.current);
      restIntervalRef.current = null;
    }

    restIntervalRef.current = window.setInterval(() => {
      setRestSecondsRemaining((prev) => {
        if (prev === null) return null;
        const next = prev - 1;
        if (next <= 0) {
          if (restIntervalRef.current) {
            window.clearInterval(restIntervalRef.current);
            restIntervalRef.current = null;
          }
          return null;
        }
        return next;
      });
    }, 1000);
  };

  useEffect(() => {
    // Session elapsed timer
    const tick = () => {
      const now = Date.now();
      setElapsedSeconds(Math.max(0, Math.floor((now - startAtMs) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startAtMs]);

  useEffect(() => {
    // cleanup rest timer interval on unmount
    return () => {
      if (restIntervalRef.current) {
        window.clearInterval(restIntervalRef.current);
        restIntervalRef.current = null;
      }
    };
  }, []);

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

    // Load ALL sets in one go
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

    await loadPreviousSetsForExercises(exData, sessionData.started_at);
  };

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

        if (!prevSessions || prevSessions.length === 0) return [currentWorkoutExerciseId, []] as [string, WorkoutSet[]];

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

  const handleToggleCompleted = async (setRow: any) => {
    const willComplete = !setRow.is_completed;
    await saveSet(setRow.id, 'is_completed', willComplete);
    if (willComplete) {
      startRestTimer(restDurationSeconds);
    }
  };

  const endWorkout = async () => {
    const ok = window.confirm('End workout? This will save it to History.');
    if (!ok) return;

    try {
      setEnding(true);
      await supabase.from('workout_sessions').update({ ended_at: new Date().toISOString() }).eq('id', sessionId);

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
        const { error: delSetsErr } = await supabase.from('workout_sets').delete().in('workout_exercise_id', exIds);
        if (delSetsErr) console.error('Failed deleting workout sets:', delSetsErr);
      }

      const { error: delExErr } = await supabase.from('workout_exercises').delete().eq('workout_session_id', sessionId);
      if (delExErr) console.error('Failed deleting workout exercises:', delExErr);

      const { error: delSessionErr } = await supabase.from('workout_sessions').delete().eq('id', sessionId);
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
        rpe: null,
      })
      .select()
      .single();

    if (data) loadWorkout();
  };

  const deleteSet = async (exerciseId: string, setId: string) => {
    await supabase.from('workout_sets').delete().eq('id', setId);

    const remaining = (sets[exerciseId] || []).filter((s: any) => s.id !== setId);
    for (let i = 0; i < remaining.length; i++) {
      await supabase.from('workout_sets').update({ set_index: i }).eq('id', remaining[i].id);
    }

    loadWorkout();
  };

  const formatPrevLine = (label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return null;
    return (
      <div className="mt-1 text-[11px] leading-tight text-gray-400">
        <span className="opacity-80">{label}</span> {value}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold truncate">{session?.routines?.name || 'Workout'}</h1>
            {session?.routine_days?.name && <p className="text-gray-400 truncate">{session.routine_days.name}</p>}
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900/60 px-3 py-1.5">
              <span className="text-[11px] font-semibold text-gray-300">TIME</span>
              <span className="font-mono text-sm font-semibold tabular-nums">{formatClock(elapsedSeconds)}</span>
            </div>

            {restSecondsRemaining !== null && (
              <div className="inline-flex items-center gap-2 rounded-full border border-green-600/60 bg-green-900/20 px-3 py-1.5">
                <span className="text-[11px] font-semibold text-green-300">REST</span>
                <span className="font-mono text-sm font-semibold tabular-nums">{formatClock(restSecondsRemaining)}</span>
                <button
                  type="button"
                  onClick={() => setRestSecondsRemaining((v) => (v === null ? null : v + 15))}
                  className="min-h-[36px] min-w-[36px] rounded-full bg-white/10 text-green-100 border border-green-700/50 text-xs font-semibold"
                  title="+15s"
                >
                  +15
                </button>
                <button
                  type="button"
                  onClick={() => setRestSecondsRemaining((v) => (v === null ? null : v + 30))}
                  className="min-h-[36px] min-w-[36px] rounded-full bg-white/10 text-green-100 border border-green-700/50 text-xs font-semibold"
                  title="+30s"
                >
                  +30
                </button>
                <button
                  type="button"
                  onClick={stopRestTimer}
                  className="min-h-[36px] min-w-[36px] rounded-full bg-white/10 text-green-100 border border-green-700/50 text-xs font-semibold"
                  title="Stop rest timer"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>

        {restSecondsRemaining === null && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-gray-300 mr-1">Rest:</span>
            {[60, 90, 120].map((sec) => {
              const active = restDurationSeconds === sec;
              return (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setRestDurationSeconds(sec)}
                  className={`min-h-[44px] px-4 rounded-full text-sm font-semibold border transition ${
                    active ? 'bg-white text-gray-900 border-white' : 'bg-gray-900/60 text-white border-gray-700'
                  }`}
                >
                  {sec}s
                </button>
              );
            })}
          </div>
        )}

        <div className="space-y-6">
          {exercises.map((exercise: any) => {
            const prevSets = prevSetsByExercise[exercise.id] || [];

            return (
              <div key={exercise.id} className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
                <div className="mb-2">
                  <h3 className="text-lg font-bold">{exercise.exercises?.name || 'Exercise'}</h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-300 border-b border-gray-800">
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

                        // Placeholders show last session values
                        const repsPlaceholder =
                          prevReps !== null && prevReps !== undefined && prevReps !== ''
                            ? String(prevReps)
                            : String(set.reps ?? 0);

                        const weightPlaceholder =
                          prevWeight !== null && prevWeight !== undefined && prevWeight !== ''
                            ? String(prevWeight)
                            : '0';

                        return (
                          <tr key={set.id} className="border-b border-gray-800 align-top">
                            <td className="px-2 py-2 font-medium">{idx + 1}</td>

                            {/* Reps: SAME behavior as Weight (blank input, onBlur commit) */}
                            <td className="px-2 py-2">
                              <input
                                type="number"
                                inputMode="numeric"
                                placeholder={repsPlaceholder}
                                value={getDraftOrEmpty(set.id, 'reps')}
                                onChange={(e) => setDraftValue(set.id, 'reps', e.target.value)}
                                onFocus={(e) => e.currentTarget.select()}
                                onBlur={() => {
                                  const raw = getDraftOrEmpty(set.id, 'reps').trim();
                                  const num = raw === '' ? (set.reps ?? 0) : Number(raw);
                                  saveSet(set.id, 'reps', Number.isFinite(num) ? num : (set.reps ?? 0));
                                  clearDraftField(set.id, 'reps');
                                }}
                                className="w-full h-11 px-2 py-2 border border-gray-700 rounded text-center bg-gray-900/40 text-white placeholder:text-gray-500"
                              />
                              {formatPrevLine('Prev:', prevReps)}
                            </td>

                            {/* Weight: blank input, onBlur commit */}
                            <td className="px-2 py-2">
                              <input
                                type="number"
                                inputMode="decimal"
                                step="0.5"
                                placeholder={weightPlaceholder}
                                value={getDraftOrEmpty(set.id, 'weight')}
                                onChange={(e) => setDraftValue(set.id, 'weight', e.target.value)}
                                onFocus={(e) => e.currentTarget.select()}
                                onBlur={() => {
                                  const raw = getDraftOrEmpty(set.id, 'weight').trim();
                                  const num = raw === '' ? (set.weight ?? 0) : Number(raw);
                                  saveSet(set.id, 'weight', Number.isFinite(num) ? num : (set.weight ?? 0));
                                  clearDraftField(set.id, 'weight');
                                }}
                                className="w-full h-11 px-2 py-2 border border-gray-700 rounded text-center bg-gray-900/40 text-white placeholder:text-gray-500"
                              />
                              {formatPrevLine('Prev:', prevWeight)}
                            </td>

                            <td className="px-2 py-2 text-center">
                              <button
                                onClick={() => handleToggleCompleted(set)}
                                className={`w-11 h-11 rounded border-2 flex items-center justify-center ${
                                  set.is_completed ? 'bg-white border-white text-gray-900' : 'border-gray-700'
                                }`}
                                title="Mark set complete"
                              >
                                {set.is_completed && <span className="text-xs">✓</span>}
                              </button>
                            </td>

                            <td className="px-2 py-2 text-center">
                              <button
                                onClick={() => deleteSet(exercise.id, set.id)}
                                className="w-11 h-11 rounded text-gray-300 hover:text-red-400"
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
                      className="min-h-[44px] px-4 py-2 rounded bg-white text-gray-900 font-semibold"
                    >
                      + Add Set
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="pt-6 space-y-3">
            <button
              onClick={endWorkout}
              disabled={ending || discarding}
              className="w-full min-h-[44px] px-4 py-3 rounded-lg bg-white text-gray-900 font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {ending ? 'Ending…' : 'End Workout'}
            </button>

            <button
              onClick={discardWorkout}
              disabled={ending || discarding}
              className="w-full min-h-[44px] px-4 py-3 rounded-lg border border-red-500/60 text-red-400 font-semibold bg-transparent disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {discarding ? 'Discarding…' : 'Discard Workout'}
            </button>
          </div>

          {exercises.length === 0 && <div className="text-gray-400">No exercises found for this session.</div>}
        </div>
      </div>
    </div>
  );
}
