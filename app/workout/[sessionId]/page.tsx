'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
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

const TECHNIQUE_GUIDES: Record<
  string,
  { title: string; summary: string; steps: string[]; tips?: string[] }
> = {
  'Normal-Sets': {
    title: 'Normal Sets',
    summary: 'Standard straight sets with consistent rest and tempo.',
    steps: [
      'Choose a load you can control through the full range of motion.',
      'Perform your prescribed reps with consistent form.',
      'Rest the planned duration, then repeat for the next set.',
    ],
    tips: ['Stop 0–2 reps shy of failure for most sets unless your program says otherwise.'],
  },
  'Drop-Sets': {
    title: 'Drop Sets',
    summary: 'Reduce weight after reaching near-failure and continue with minimal rest.',
    steps: [
      'Perform a set to near-failure at your working weight.',
      'Immediately reduce the load by ~10–30% (no long rest).',
      'Continue for more reps; repeat 1–2 more drops if desired.',
    ],
    tips: ['Keep form strict—drop weight, not technique.'],
  },
  'Rest-Pause': {
    title: 'Rest-Pause',
    summary: 'Brief rests to extend a set beyond initial fatigue.',
    steps: [
      'Perform reps to near-failure.',
      'Rest 10–20 seconds.',
      'Do additional reps; repeat 1–3 mini-sets with the same weight.',
    ],
    tips: ['Great for machines/cables where setup is quick.'],
  },
  GVT: {
    title: 'GVT (German Volume Training)',
    summary: 'High-volume protocol typically 10x10 at a challenging but repeatable load.',
    steps: [
      'Pick a weight you can complete for 10 reps with good form (often ~60% 1RM).',
      'Perform 10 sets of 10 reps with consistent rest (60–90 seconds).',
      'Keep tempo controlled and stop if form breaks down.',
    ],
    tips: ['Track performance—small load increases go a long way.'],
  },
  'Myo-Reps': {
    title: 'Myo-Reps',
    summary: 'Activation set to near-failure followed by short-rest clusters.',
    steps: [
      'Do an activation set to near-failure (e.g., 12–20 reps).',
      'Rest 10–20 seconds.',
      'Perform mini-sets of 3–5 reps, resting 10–20 seconds between.',
      'Stop when rep quality drops or you miss the target mini-set reps.',
    ],
    tips: ['Use stable exercises (machines/cables) to keep clusters consistent.'],
  },
  'Super-Sets': {
    title: 'Super Sets',
    summary: 'Two exercises performed back-to-back with little to no rest.',
    steps: [
      'Perform exercise A for prescribed reps.',
      'Immediately perform exercise B for prescribed reps.',
      'Rest 60–120 seconds after the pair, then repeat.',
    ],
    tips: ['Pair opposing muscles (e.g., chest/back) or non-competing movements for best performance.'],
  },
  Failure: {
    title: 'Failure',
    summary: 'Perform reps until you cannot complete another rep with good form.',
    steps: [
      'Warm up properly and choose a safe exercise variation.',
      'Perform reps until you cannot complete the next rep with proper form.',
      'Stop the set as soon as technique breaks down.',
    ],
    tips: ['Use mostly on machines/cables and limit frequency to manage fatigue.'],
  },
};
export default function WorkoutPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [sets, setSets] = useState<{ [exerciseId: string]: WorkoutSet[] }>({});

  const [prevSetsByExercise, setPrevSetsByExercise] = useState<Record<string, WorkoutSet[]>>({});

  // Draft typed values: used only while editing; after blur it gets cleared.
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});

// Technique guide sheet
const [techniqueOpen, setTechniqueOpen] = useState(false);
const [techniqueKey, setTechniqueKey] = useState<string | null>(null);

const openTechnique = (key: string) => {
  setTechniqueKey(key);
  setTechniqueOpen(true);
};

  // Session clock
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Rest timer
  const [restSecondsRemaining, setRestSecondsRemaining] = useState<number | null>(null);
  const [restDurationSeconds, setRestDurationSeconds] = useState<number>(90);
  const restIntervalRef = useRef<number | null>(null);

  // Input focus map for fast logging (mobile + keyboard)
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);

  // Exercise container refs for auto-advance scrolling
  const exerciseRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const focusByKey = (key: string) => {
    const el = inputRefs.current.get(key);
    if (el) {
      el.focus();
      // select after focus for quick overwrite
      requestAnimationFrame(() => el.select?.());
      return true;
    }
    return false;
  };

  const vibrate = (pattern: number | number[] = 10) => {
    try {
      // haptics on supported mobile devices (non-blocking)
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) (navigator as any).vibrate(pattern);
    } catch {}
  };


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

  // ✅ This is the key fix:
  // - If user is typing (draft exists), show draft.
  // - Otherwise show the saved value from state (sets) — but keep it blank if 0.
  const getDisplayValue = (setId: string, field: 'reps' | 'weight', savedValue: any) => {
    const v = draft[setId]?.[field];
    if (v !== undefined) return v;
    const n = Number(savedValue ?? 0);
    if (!Number.isFinite(n) || n === 0) return '';
    return String(n);
  };

  const getDraftRaw = (setId: string, field: 'reps' | 'weight') => {
    const v = draft[setId]?.[field];
    return v !== undefined ? v : '';
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
    const tick = () => {
      const now = Date.now();
      setElapsedSeconds(Math.max(0, Math.floor((now - startAtMs) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startAtMs]);

  useEffect(() => {
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

  // Apply pending focus after async updates (e.g., adding a set triggers reload)
  useEffect(() => {
    if (!pendingFocusKey) return;
    // try twice: immediately and next frame (DOM may still be updating)
    if (focusByKey(pendingFocusKey)) {
      setPendingFocusKey(null);
      return;
    }
    const id = requestAnimationFrame(() => {
      if (focusByKey(pendingFocusKey)) setPendingFocusKey(null);
    });
    return () => cancelAnimationFrame(id);
  }, [pendingFocusKey, sets]);

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
    // optimistic update so the value stays visible immediately
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

  const handleToggleCompleted = async (exerciseId: string, setRow: any) => {
    const willComplete = !setRow.is_completed;

    // compute completion state optimistically for auto-advance
    const exSetsAfter = (sets[exerciseId] || []).map((s: any) =>
      s.id === setRow.id ? { ...s, is_completed: willComplete } : s
    );

    await saveSet(setRow.id, 'is_completed', willComplete);
    if (willComplete) startRestTimer(restDurationSeconds);

    // Auto-advance only when the exercise becomes fully completed
    const allCompleted = exSetsAfter.length > 0 && exSetsAfter.every((s: any) => !!s.is_completed);
    if (willComplete && allCompleted) {
      // Find next exercise in order and scroll into view
      const idx = exercises.findIndex((e: any) => e.id === exerciseId);
      const next = idx >= 0 ? exercises[idx + 1] : null;
      if (next?.id) {
        // subtle haptic confirmation
        vibrate([8, 10, 8]);
        const el = exerciseRefs.current.get(next.id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        // Focus first reps input on the next exercise (set 0) after scroll/layout
        setPendingFocusKey(`${next.id}:0:reps`);
      }
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

      const { data: exRows } = await supabase.from('workout_exercises').select('id').eq('workout_session_id', sessionId);
      const exIds = (exRows || []).map((r: any) => r.id);

      if (exIds.length > 0) {
        await supabase.from('workout_sets').delete().in('workout_exercise_id', exIds);
      }

      await supabase.from('workout_exercises').delete().eq('workout_session_id', sessionId);
      await supabase.from('workout_sessions').delete().eq('id', sessionId);

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

    if (data) {
      vibrate(15);
      loadWorkout();
    }
  };


  const handleRepsKeyDown = (exerciseId: string, setIdx: number, e: any) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      focusByKey(`${exerciseId}:${setIdx}:weight`);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusByKey(`${exerciseId}:${setIdx + 1}:reps`);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusByKey(`${exerciseId}:${Math.max(0, setIdx - 1)}:reps`);
    }
  };

  const handleWeightKeyDown = async (
    exerciseId: string,
    setIdx: number,
    totalSets: number,
    e: any
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Move to next set reps; if last set, create a new set and focus its reps
      if (setIdx + 1 < totalSets) {
        focusByKey(`${exerciseId}:${setIdx + 1}:reps`);
        return;
      }
      // create new set (keeps existing behavior; just adds a focus target)
      setPendingFocusKey(`${exerciseId}:${setIdx + 1}:reps`);
      vibrate(15);
      await addSet(exerciseId);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusByKey(`${exerciseId}:${setIdx + 1}:weight`);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusByKey(`${exerciseId}:${Math.max(0, setIdx - 1)}:weight`);
    }
  };


  const deleteSet = async (exerciseId: string, setId: string) => {
    vibrate([12, 8]);
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
              <div
                key={exercise.id}
                ref={(el) => {
                  if (el) exerciseRefs.current.set(exercise.id, el);
                  else exerciseRefs.current.delete(exercise.id);
                }}
                className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 scroll-mt-24"
              >
<div className="mb-2 flex items-start justify-between gap-3">
  <h3 className="text-lg font-bold">{exercise.exercises?.name || 'Exercise'}</h3>
  {exercise.exercises?.default_technique_tags?.[0] ? (
    <button
      type="button"
      onClick={() => openTechnique(exercise.exercises!.default_technique_tags![0])}
      className="tap-target -mt-0.5"
      aria-label={`How to perform ${exercise.exercises!.default_technique_tags![0]}`}
    >
      <Badge className="rounded-full border border-sky-400/30 bg-sky-500/15 px-3 py-1 text-xs font-semibold text-sky-200 hover:bg-sky-500/20">
        {exercise.exercises!.default_technique_tags![0]}
      </Badge>
    </button>
  ) : null}
</div>

                {/*
                  Mobile-only padding so the sticky "+ Add Set" bar doesn't visually
                  cover the last set row when it sticks to the bottom of the screen.
                */}
                <div className="overflow-x-auto pb-24 md:pb-0">
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

                        const repsPlaceholder =
                          prevReps !== null && prevReps !== undefined && prevReps !== '' ? String(prevReps) : '';
                        const weightPlaceholder =
                          prevWeight !== null && prevWeight !== undefined && prevWeight !== '' ? String(prevWeight) : '';

                        return (
                          <tr key={set.id} className="border-b border-gray-800 align-top">
                            <td className="px-2 py-2 font-medium">{idx + 1}</td>

                            <td className="px-2 py-2">
                              <input
                                type="number"
                                inputMode="numeric"
                                 aria-label={`Reps for set ${idx + 1}`}
                                placeholder={repsPlaceholder}
                                value={getDisplayValue(set.id, 'reps', set.reps)}
                                onChange={(e) => setDraftValue(set.id, 'reps', e.target.value)}
                                onFocus={(e) => e.currentTarget.select()}
                                ref={(el) => {
                                  const keyA = `${exercise.id}:${set.id}:reps`;
                                  const keyB = `${exercise.id}:${idx}:reps`;
                                  if (el) {
                                    inputRefs.current.set(keyA, el);
                                    inputRefs.current.set(keyB, el);
                                  } else {
                                    inputRefs.current.delete(keyA);
                                    inputRefs.current.delete(keyB);
                                  }
                                }}
                                onKeyDown={(e) => handleRepsKeyDown(exercise.id, idx, e)}
                                onBlur={() => {
                                  const raw = getDraftRaw(set.id, 'reps').trim();
                                  const num = raw === '' ? 0 : Number(raw);
                                  saveSet(set.id, 'reps', Number.isFinite(num) ? num : 0);
                                  clearDraftField(set.id, 'reps');
                                }}
                                className="w-full h-11 px-2 py-2 border border-gray-700 rounded text-center bg-gray-900/40 text-white placeholder:text-gray-500"
                              />
                              {formatPrevLine('Prev:', prevReps)}
                            </td>

                            <td className="px-2 py-2">
                              <input
                                type="number"
                                inputMode="decimal"
                                 aria-label={`Weight for set ${idx + 1}`}
                                step="0.5"
                                placeholder={weightPlaceholder}
                                value={getDisplayValue(set.id, 'weight', set.weight)}
                                onChange={(e) => setDraftValue(set.id, 'weight', e.target.value)}
                                onFocus={(e) => e.currentTarget.select()}
                                ref={(el) => {
                                  const keyA = `${exercise.id}:${set.id}:weight`;
                                  const keyB = `${exercise.id}:${idx}:weight`;
                                  if (el) {
                                    inputRefs.current.set(keyA, el);
                                    inputRefs.current.set(keyB, el);
                                  } else {
                                    inputRefs.current.delete(keyA);
                                    inputRefs.current.delete(keyB);
                                  }
                                }}
                                onKeyDown={(e) => handleWeightKeyDown(exercise.id, idx, (sets[exercise.id] || []).length, e)}
                                onBlur={() => {
                                  const raw = getDraftRaw(set.id, 'weight').trim();
                                  const num = raw === '' ? 0 : Number(raw);
                                  saveSet(set.id, 'weight', Number.isFinite(num) ? num : 0);
                                  clearDraftField(set.id, 'weight');
                                }}
                                className="w-full h-11 px-2 py-2 border border-gray-700 rounded text-center bg-gray-900/40 text-white placeholder:text-gray-500"
                              />
                              {formatPrevLine('Prev:', prevWeight)}
                            </td>

                            <td className="px-2 py-2 text-center">
                              <button
                                onClick={() => handleToggleCompleted(exercise.id, set)}
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

                  {/* Sticky add-set bar on mobile for one-hand logging */}
                  <div
                    className="mt-3 md:mt-3 md:static sticky bottom-[calc(84px+env(safe-area-inset-bottom))] z-10"
                  >
                    <div className="-mx-4 px-4 py-3 md:mx-0 md:px-0 md:py-0 border-t border-white/10 md:border-t-0 bg-gray-950/80 md:bg-transparent backdrop-blur md:backdrop-blur-0">
                      <button
                        onClick={() => addSet(exercise.id)}
                        className="w-full md:w-auto min-h-[48px] px-4 py-3 rounded bg-white text-gray-900 font-semibold"
                      >
                        + Add Set
                      </button>
                    </div>
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

<Sheet open={techniqueOpen} onOpenChange={setTechniqueOpen}>
  <SheetContent
    side="bottom"
    className="border-t border-white/10 bg-[hsl(var(--surface))] text-white shadow-2xl"
  >
    {techniqueKey && TECHNIQUE_GUIDES[techniqueKey] ? (
      <div className="space-y-4">
        <SheetHeader>
          <SheetTitle className="text-white">{TECHNIQUE_GUIDES[techniqueKey].title}</SheetTitle>
          <SheetDescription className="text-gray-300">
            {TECHNIQUE_GUIDES[techniqueKey].summary}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3">
          <div>
            <div className="mb-2 text-sm font-semibold text-gray-200">How To</div>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-200">
              {TECHNIQUE_GUIDES[techniqueKey].steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>

          {TECHNIQUE_GUIDES[techniqueKey].tips?.length ? (
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-200">Tips</div>
              <ul className="list-disc space-y-2 pl-5 text-sm text-gray-200">
                {TECHNIQUE_GUIDES[techniqueKey].tips!.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    ) : null}
  </SheetContent>
</Sheet>
    </div>
  );
}