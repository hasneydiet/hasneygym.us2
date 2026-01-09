'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

import { ChevronLeft, Clock, MoreVertical, Plus, ArrowUpDown, Repeat, Layers, Trash2 } from 'lucide-react';
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

function formatHms(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${hh}h ${mm}min ${ss}s`;
  if (mm > 0) return `${mm}min ${ss}s`;
  return `${ss}s`;
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
  const { effectiveUserId } = useCoach();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [sets, setSets] = useState<{ [exerciseId: string]: WorkoutSet[] }>({});

  // Exercise action sheet ("…" menu) and pickers (replace/add/superset)
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuExercise, setMenuExercise] = useState<WorkoutExercise | null>(null);

  const [replaceOpen, setReplaceOpen] = useState(false);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [supersetOpen, setSupersetOpen] = useState(false);
  const [addExerciseOpen, setAddExerciseOpen] = useState(false);
  const [allExercises, setAllExercises] = useState<any[]>([]);
  const [exerciseSearch, setExerciseSearch] = useState('');

  const [prevSetsByExercise, setPrevSetsByExercise] = useState<Record<string, WorkoutSet[]>>({});

  // Micro-interactions: track which set was just added/removed for subtle animations
  const [highlightSetId, setHighlightSetId] = useState<string | null>(null);
  const [removingSetIds, setRemovingSetIds] = useState<Set<string>>(() => new Set());


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
  }, [sessionId, effectiveUserId]);

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
    if (!effectiveUserId) return;
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

  const ensureAllExercisesLoaded = async () => {
    if (!effectiveUserId) return;
    if (allExercises.length > 0) return;
    const { data, error } = await supabase
      .from('exercises')
      .select('id, name')
      .eq('user_id', effectiveUserId)
      .order('name');
    if (!error && data) setAllExercises(data);
  };

  const openMenuForExercise = (ex: WorkoutExercise) => {
    setMenuExercise(ex);
    setMenuOpen(true);
  };

  const swapOrder = async (a: WorkoutExercise, b: WorkoutExercise) => {
    // Swap order_index for two workout_exercises rows
    const aIdx = a.order_index;
    const bIdx = b.order_index;
    await supabase.from('workout_exercises').update({ order_index: bIdx }).eq('id', a.id);
    await supabase.from('workout_exercises').update({ order_index: aIdx }).eq('id', b.id);
    await loadWorkout();
  };

  const handleMoveUp = async () => {
    if (!menuExercise) return;
    const idx = exercises.findIndex((e) => e.id === menuExercise.id);
    if (idx <= 0) return;
    await swapOrder(exercises[idx], exercises[idx - 1]);
  };

  const handleMoveDown = async () => {
    if (!menuExercise) return;
    const idx = exercises.findIndex((e) => e.id === menuExercise.id);
    if (idx < 0 || idx >= exercises.length - 1) return;
    await swapOrder(exercises[idx], exercises[idx + 1]);
  };

  const handleRemoveExercise = async () => {
    if (!menuExercise) return;
    setMenuOpen(false);
    await supabase.from('workout_exercises').delete().eq('id', menuExercise.id);
    await loadWorkout();
  };

  const handleReplaceExercisePick = async (newExerciseId: string) => {
    if (!menuExercise) return;
    setReplaceOpen(false);
    setMenuOpen(false);

    // Reset this workout_exercise to point at the new exercise and clear its sets
    await supabase.from('workout_sets').delete().eq('workout_exercise_id', menuExercise.id);
    await supabase
      .from('workout_exercises')
      .update({ exercise_id: newExerciseId })
      .eq('id', menuExercise.id);

    // Create an initial blank set
    await supabase.from('workout_sets').insert({ workout_exercise_id: menuExercise.id, set_index: 0, reps: 0, weight: 0, is_completed: false });
    await loadWorkout();
  };

  const handleAddExercisePick = async (exerciseId: string) => {
    if (!effectiveUserId) return;
    setAddExerciseOpen(false);

    // Determine next order index
    const nextIdx = exercises.length ? Math.max(...exercises.map((e: any) => e.order_index ?? 0)) + 1 : 0;
    const { data: inserted, error } = await supabase
      .from('workout_exercises')
      .insert({ workout_session_id: sessionId, exercise_id: exerciseId, order_index: nextIdx, technique_tags: [] })
      .select('id')
      .single();

    if (error || !inserted?.id) {
      alert('Could not add exercise. Please try again.');
      return;
    }

    await supabase.from('workout_sets').insert({ workout_exercise_id: inserted.id, set_index: 0, reps: 0, weight: 0, is_completed: false });
    await loadWorkout();
  };

  const handleSupersetPick = async (otherWorkoutExerciseId: string) => {
    if (!menuExercise) return;
    setSupersetOpen(false);
    setMenuOpen(false);

    const groupId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    await supabase.from('workout_exercises').update({ superset_group_id: groupId }).eq('id', menuExercise.id);
    await supabase.from('workout_exercises').update({ superset_group_id: groupId }).eq('id', otherWorkoutExerciseId);
    await loadWorkout();
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

  const handleToggleCompleted = async (setRow: any) => {
    const willComplete = !setRow.is_completed;
    await saveSet(setRow.id, 'is_completed', willComplete);
    if (willComplete) startRestTimer(restDurationSeconds);
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
      setHighlightSetId(data.id);
      window.setTimeout(() => setHighlightSetId((prev) => (prev === data.id ? null : prev)), 700);
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
    // mark as removing for a subtle exit animation
    setRemovingSetIds((prev) => {
      const next = new Set(prev);
      next.add(setId);
      return next;
    });
    window.setTimeout(() => {
      setRemovingSetIds((prev) => {
        const next = new Set(prev);
        next.delete(setId);
        return next;
      });
    }, 800);
    await new Promise((r) => window.setTimeout(r, 140));
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
    <div className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <div className="max-w-5xl mx-auto px-4 pb-10">
        {/* Hevy-inspired header (layout only; no app logic changes) */}
        <div className="sticky top-0 z-10 -mx-4 px-4 pt-4 pb-3 bg-[hsl(var(--background))]">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="tap-target inline-flex items-center justify-center h-10 w-10 rounded-full bg-transparent hover:bg-white/5"
              aria-label="Back"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>

            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[hsl(var(--muted-foreground))]">Log Workout</div>
              <div className="truncate text-[13px] text-[hsl(var(--primary))] font-mono tabular-nums">
                {formatHms(elapsedSeconds)}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="tap-target inline-flex items-center justify-center h-10 w-10 rounded-full bg-transparent hover:bg-white/5"
                aria-label="Timer"
                onClick={() => {
                  // no-op for now; timer icon is present to match expected UI
                }}
              >
                <Clock className="h-5 w-5" />
              </button>
              <Button
                onClick={endWorkout}
                disabled={ending || discarding}
                className="h-10 px-5 rounded-xl bg-[hsl(var(--primary))] text-white hover:bg-[hsl(var(--primary))]/90"
              >
                Finish
              </Button>
            </div>
          </div>

          <div className="mt-3">
            <div className="text-2xl font-semibold truncate">{session?.routines?.name || 'Workout'}</div>
            {session?.routine_days?.name ? (
              <div className="text-sm text-[hsl(var(--muted-foreground))] truncate">{session.routine_days.name}</div>
            ) : null}
          </div>

          {restSecondsRemaining !== null ? (
            <div className="mt-3 inline-flex items-center gap-2 text-sm text-[hsl(var(--primary))]">
              <Clock className="h-4 w-4" />
              <span>Rest Timer: {formatHms(restSecondsRemaining)}</span>
              <button
                type="button"
                onClick={() => setRestSecondsRemaining((v) => (v === null ? null : v + 15))}
                className="ml-2 h-8 px-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--input))] text-white"
              >
                +15
              </button>
              <button
                type="button"
                onClick={() => setRestSecondsRemaining((v) => (v === null ? null : v + 30))}
                className="h-8 px-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--input))] text-white"
              >
                +30
              </button>
              <button
                type="button"
                onClick={stopRestTimer}
                className="h-8 px-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--input))] text-white"
              >
                ✕
              </button>
            </div>
          ) : null}
        </div>

        <div className="space-y-6 pt-4">
          {exercises.map((exercise: any) => {
            const prevSets = prevSetsByExercise[exercise.id] || [];

            const technique =
              exercise.technique_tags?.[0] ||
              exercise.exercises?.default_technique_tags?.[0] ||
              null;

            return (
              <div
                key={exercise.id}
                className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-4 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">
                    {(exercise.exercises?.name || 'E')
                      .split(' ')
                      .slice(0, 2)
                      .map((p: string) => p[0]?.toUpperCase())
                      .join('')}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[18px] font-semibold text-[hsl(var(--primary))]">
                          {exercise.exercises?.name || 'Exercise'}
                        </div>
                        {technique ? (
                          <button
                            type="button"
                            onClick={() => openTechnique(technique)}
                            className="mt-1 inline-flex items-center gap-2 text-sm text-white/90"
                          >
                            <Badge className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1 text-xs font-semibold text-white">
                              {technique}
                            </Badge>
                          </button>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={() => openMenuForExercise(exercise)}
                        className="tap-target inline-flex items-center justify-center h-10 w-10 rounded-full hover:bg-white/5"
                        aria-label="Exercise options"
                      >
                        <MoreVertical className="h-5 w-5" />
                      </button>
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-sm text-[hsl(var(--primary))]">
                      <Clock className="h-4 w-4" />
                      <span>Rest Timer: {formatHms(restSecondsRemaining ?? restDurationSeconds)}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="grid grid-cols-[56px_1fr_92px_76px_56px] gap-2 border-b border-[hsl(var(--divider))] pb-2 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    <div>Set</div>
                    <div>Previous</div>
                    <div className="text-center">Lbs</div>
                    <div className="text-center">Reps</div>
                    <div className="text-center">✓</div>
                  </div>

                  <div className="mt-2 space-y-2">
                      {(sets[exercise.id] || []).map((set: any, idx: number) => {
                        const prev = prevSets[idx];
                        const prevReps = prev?.reps ?? null;
                        const prevWeight = prev?.weight ?? null;

                        return (
                          <div
                            key={set.id}
                            className={
                              "grid grid-cols-[56px_1fr_92px_76px_56px] gap-2 items-center " +
                              (set.id === highlightSetId ? "set-row--new " : "") +
                              (removingSetIds.has(set.id) ? "set-row--removing " : "")
                            }
                          >
                            <div className="text-sm font-semibold tabular-nums text-white/90">{idx + 1}</div>

                            <div className="text-sm text-white/60 truncate">
                              {prevWeight || prevReps ? (
                                <span>{prevWeight ?? 0}lbs x {prevReps ?? 0}</span>
                              ) : (
                                <span>-</span>
                              )}
                            </div>

                            <div>
                              <input
                                type="number"
                                inputMode="decimal"
                                aria-label={`Weight for set ${idx + 1}`}
                                step="0.5"
                                placeholder={prevWeight !== null && prevWeight !== undefined && prevWeight !== '' ? String(prevWeight) : ''}
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
                                className="w-full h-11 px-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--input))] text-center text-white placeholder:text-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                              />
                            </div>

                            <div>
                              <input
                                type="number"
                                inputMode="numeric"
                                aria-label={`Reps for set ${idx + 1}`}
                                placeholder={prevReps !== null && prevReps !== undefined && prevReps !== '' ? String(prevReps) : ''}
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
                                className="w-full h-11 px-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--input))] text-center text-white placeholder:text-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                              />
                            </div>

                            <div className="flex items-center justify-center">
                              <button
                                type="button"
                                onClick={() => handleToggleCompleted(set)}
                                className={`h-11 w-11 rounded-xl border flex items-center justify-center ${
                                  set.is_completed
                                    ? 'bg-white/20 border-white/30'
                                    : 'bg-white/5 border-[hsl(var(--border))]'
                                }`}
                                aria-label="Mark set done"
                              >
                                {set.is_completed ? <span className="text-white">✓</span> : null}
                              </button>
                            </div>
                          </div>
                        );
                      })}

                    <Button
                      type="button"
                      onClick={() => addSet(exercise.id)}
                      variant="secondary"
                      className="mt-3 w-full h-12 rounded-2xl bg-white/10 hover:bg-white/15 text-white"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Set
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="pt-6 space-y-3">
            <Button
              type="button"
              onClick={async () => {
                await ensureAllExercisesLoaded();
                setExerciseSearch('');
                setAddExerciseOpen(true);
              }}
              variant="secondary"
              className="tap-target w-full min-h-[48px] px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/15 text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Exercise
            </Button>

            <button
              onClick={endWorkout}
              disabled={ending || discarding}
              className="tap-target w-full min-h-[48px] px-4 py-3 rounded-2xl bg-white text-gray-900 font-semibold shadow-sm transition hover:shadow-md active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {ending ? 'Ending…' : 'End Workout'}
            </button>

            <button
              onClick={discardWorkout}
              disabled={ending || discarding}
              className="tap-target w-full min-h-[48px] px-4 py-3 rounded-2xl border border-red-500/60 text-red-300 font-semibold bg-transparent transition hover:bg-red-500/10 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {discarding ? 'Discarding…' : 'Discard Workout'}
            </button>
          </div>

          {exercises.length === 0 && <div className="text-gray-400">No exercises found for this session.</div>}
        </div>
      </div>

      {/* Exercise options (Hevy-like bottom sheet) */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="bottom" className="border-t border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-white">
          <SheetHeader>
            <SheetTitle className="text-white">Options</SheetTitle>
            <SheetDescription className="text-[hsl(var(--muted-foreground))]">
              {menuExercise?.exercises?.name || 'Exercise'}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-2">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start h-12"
              onClick={() => {
                setMenuOpen(false);
                setReorderOpen(true);
              }}
            >
              <ArrowUpDown className="h-5 w-5 mr-3" />
              Reorder Exercises
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start h-12"
              onClick={async () => {
                await ensureAllExercisesLoaded();
                setExerciseSearch('');
                setReplaceOpen(true);
              }}
            >
              <Repeat className="h-5 w-5 mr-3" />
              Replace Exercise
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start h-12"
              onClick={() => {
                setExerciseSearch('');
                setSupersetOpen(true);
              }}
            >
              <Layers className="h-5 w-5 mr-3" />
              Add To Superset
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start h-12 text-[hsl(var(--destructive))]"
              onClick={handleRemoveExercise}
            >
              <Trash2 className="h-5 w-5 mr-3" />
              Remove Exercise
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Reorder dialog (minimal safe; preserves data ordering) */}
      <Dialog open={reorderOpen} onOpenChange={setReorderOpen}>
        <DialogContent className="bg-[hsl(var(--surface))] border-[hsl(var(--border))] text-white">
          <DialogHeader>
            <DialogTitle>Reorder Exercises</DialogTitle>
            <DialogDescription className="text-[hsl(var(--muted-foreground))]">
              Use the arrows to move exercises up or down.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {exercises.map((ex: any, idx: number) => (
              <div key={ex.id} className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2">
                <div className="min-w-0 truncate">{ex.exercises?.name || 'Exercise'}</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-9 px-3 bg-white/10 hover:bg-white/15 text-white"
                    disabled={idx === 0}
                    onClick={() => swapOrder(exercises[idx], exercises[idx - 1])}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-9 px-3 bg-white/10 hover:bg-white/15 text-white"
                    disabled={idx === exercises.length - 1}
                    onClick={() => swapOrder(exercises[idx], exercises[idx + 1])}
                  >
                    ↓
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Replace exercise picker */}
      <Dialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <DialogContent className="bg-[hsl(var(--surface))] border-[hsl(var(--border))] text-white">
          <DialogHeader>
            <DialogTitle>Replace Exercise</DialogTitle>
            <DialogDescription className="text-[hsl(var(--muted-foreground))]">
              Select an exercise to replace this one.
            </DialogDescription>
          </DialogHeader>
          <Command>
            <CommandInput placeholder="Search exercises…" value={exerciseSearch} onValueChange={setExerciseSearch} />
            <CommandList>
              <CommandEmpty>No exercises found.</CommandEmpty>
              <CommandGroup>
                {allExercises.map((ex) => (
                  <CommandItem
                    key={ex.id}
                    value={ex.name}
                    onSelect={() => handleReplaceExercisePick(ex.id)}
                  >
                    {ex.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>

      {/* Add exercise picker (adds only to this session/day, not the routine template) */}
      <Dialog open={addExerciseOpen} onOpenChange={setAddExerciseOpen}>
        <DialogContent className="bg-[hsl(var(--surface))] border-[hsl(var(--border))] text-white">
          <DialogHeader>
            <DialogTitle>Add Exercise</DialogTitle>
            <DialogDescription className="text-[hsl(var(--muted-foreground))]">
              Adds to this workout session only.
            </DialogDescription>
          </DialogHeader>
          <Command>
            <CommandInput placeholder="Search exercises…" value={exerciseSearch} onValueChange={setExerciseSearch} />
            <CommandList>
              <CommandEmpty>No exercises found.</CommandEmpty>
              <CommandGroup>
                {allExercises.map((ex) => (
                  <CommandItem
                    key={ex.id}
                    value={ex.name}
                    onSelect={() => handleAddExercisePick(ex.id)}
                  >
                    {ex.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>

      {/* Superset picker (pairs with another exercise in this session) */}
      <Dialog open={supersetOpen} onOpenChange={setSupersetOpen}>
        <DialogContent className="bg-[hsl(var(--surface))] border-[hsl(var(--border))] text-white">
          <DialogHeader>
            <DialogTitle>Add To Superset</DialogTitle>
            <DialogDescription className="text-[hsl(var(--muted-foreground))]">
              Choose another exercise in this workout to pair as a superset.
            </DialogDescription>
          </DialogHeader>
          <Command>
            <CommandInput placeholder="Search exercises…" value={exerciseSearch} onValueChange={setExerciseSearch} />
            <CommandList>
              <CommandEmpty>No exercises found.</CommandEmpty>
              <CommandGroup>
                {exercises
                  .filter((e: any) => (menuExercise ? e.id !== menuExercise.id : true))
                  .map((e: any) => (
                    <CommandItem
                      key={e.id}
                      value={e.exercises?.name || ''}
                      onSelect={() => handleSupersetPick(e.id)}
                    >
                      {e.exercises?.name || 'Exercise'}
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>

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
