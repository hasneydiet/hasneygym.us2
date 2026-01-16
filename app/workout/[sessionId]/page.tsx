'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, Clock } from 'lucide-react';
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
  const { effectiveUserId } = useCoach();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [sets, setSets] = useState<{ [exerciseId: string]: WorkoutSet[] }>({});

  const [prevSetsByExercise, setPrevSetsByExercise] = useState<Record<string, WorkoutSet[]>>({});

  // Add Exercise (session-only): allows adding extra exercises during a workout day
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [selectedExerciseId, setSelectedExerciseId] = useState('');
  const [availableExercises, setAvailableExercises] = useState<any[]>([]);
  const [addingExercise, setAddingExercise] = useState(false);

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
  const [restExerciseId, setRestExerciseId] = useState<string | null>(null);
  const restIntervalRef = useRef<number | null>(null);
  const beepedRef = useRef(false);

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

  const playBeep = () => {
    // Loud "boxing bell" style alert using Web Audio API (no external assets).
    // Uses a few harmonics + longer decay, plus a second strike.
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();

      // Smooth out peaks to avoid distortion while staying loud.
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-18, ctx.currentTime);
      compressor.knee.setValueAtTime(18, ctx.currentTime);
      compressor.ratio.setValueAtTime(6, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.15, ctx.currentTime);

      const master = ctx.createGain();
      master.gain.setValueAtTime(0.9, ctx.currentTime);

      master.connect(compressor);
      compressor.connect(ctx.destination);

      const strike = (t0: number) => {
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        // Fast attack, long decay (bell-like)
        gain.gain.exponentialRampToValueAtTime(0.95, t0 + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.35);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
        gain.connect(master);

        const freqs = [740, 1110, 1480]; // bell-ish partials
        const types: OscillatorType[] = ['triangle', 'sine', 'square'];
        const oscs = freqs.map((f, i) => {
          const osc = ctx.createOscillator();
          osc.type = types[i];
          osc.frequency.setValueAtTime(f, t0);
          // slight detune for richness
          osc.detune.setValueAtTime((i - 1) * 8, t0);
          osc.connect(gain);
          osc.start(t0);
          osc.stop(t0 + 1.25);
          return osc;
        });

        // Cleanup when the last oscillator ends
        oscs[oscs.length - 1].onended = () => {
          try {
            gain.disconnect();
          } catch {}
        };
      };

      const now = ctx.currentTime + 0.01;
      strike(now);
      strike(now + 0.35);

      // Close audio context after it finishes
      setTimeout(() => {
        try {
          ctx.close();
        } catch {}
      }, 1800);
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
    setRestExerciseId(null);
    if (restIntervalRef.current) {
      window.clearInterval(restIntervalRef.current);
      restIntervalRef.current = null;
    }
  };

  const startRestTimer = (exerciseId: string, seconds: number) => {
    const dur = clampInt(seconds, 5, 600);
    beepedRef.current = false;
    setRestExerciseId(exerciseId);
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
          if (!beepedRef.current) {
            beepedRef.current = true;
            playBeep();
            vibrate([60, 40, 60]);
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

  // Load exercise list lazily for the session-only "Add Exercise" flow
  useEffect(() => {
    if (!showAddExercise) return;
    let cancelled = false;

    const load = async () => {
      if (availableExercises.length > 0) return;

      const { data, error } = await supabase
        .from('exercises')
        .select('id, name')
        .order('name');

      if (!cancelled && !error && data) {
        setAvailableExercises(data);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [showAddExercise, availableExercises.length]);

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

  const addExerciseToSession = async () => {
    if (!selectedExerciseId) {
      alert('Select an exercise first.');
      return;
    }
    if (addingExercise) return;

    try {
      setAddingExercise(true);

      // determine order index (append to end)
      const nextOrder = exercises.length;

      // pull default set scheme for a better starter experience (still session-only)
      const { data: exMeta } = await supabase
        .from('exercises')
        .select('default_set_scheme')
        .eq('id', selectedExerciseId)
        .maybeSingle();

      const scheme = (exMeta as any)?.default_set_scheme ?? null;
      const schemeSets = scheme && typeof scheme === 'object' ? Number((scheme as any).sets) : NaN;
      const schemeReps = scheme && typeof scheme === 'object' ? Number((scheme as any).reps) : NaN;

      const setsCount = Number.isFinite(schemeSets) ? Math.max(1, Math.floor(schemeSets)) : 1;
      const defaultReps = Number.isFinite(schemeReps) ? Math.max(0, Math.floor(schemeReps)) : 0;

      const { data: newWorkoutExercise, error: weErr } = await supabase
        .from('workout_exercises')
        .insert({
          workout_session_id: sessionId,
          exercise_id: selectedExerciseId,
          order_index: nextOrder,
          technique_tags: [],
        })
        .select('id')
        .single();

      if (weErr) throw weErr;

      const workoutExerciseId = (newWorkoutExercise as any)?.id as string | undefined;
      if (!workoutExerciseId) throw new Error('Failed to create workout exercise.');

      const setsToInsert = Array.from({ length: setsCount }).map((_, i) => ({
        workout_exercise_id: workoutExerciseId,
        set_index: i,
        reps: defaultReps,
        weight: 0,
        rpe: null,
        is_completed: false,
      }));

      const { error: wsErr } = await supabase.from('workout_sets').insert(setsToInsert);
      if (wsErr) throw wsErr;

      // Reset UI and reload workout (so it appears immediately and is logged to history via session tables)
      setSelectedExerciseId('');
      setShowAddExercise(false);
      await loadWorkout();
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Failed to add exercise.');
    } finally {
      setAddingExercise(false);
    }
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

  const getExerciseRestSeconds = (ex: any): number => {
    const v = ex?.exercises?.rest_seconds ?? ex?.exercises?.default_set_scheme?.restSeconds;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 60;
    return Math.floor(n);
  };

  const handleToggleCompleted = async (workoutExerciseRow: any, setRow: any) => {
    const willComplete = !setRow.is_completed;
    await saveSet(setRow.id, 'is_completed', willComplete);
    if (willComplete) startRestTimer(workoutExerciseRow.id, getExerciseRestSeconds(workoutExerciseRow));
  };

  // Guardrail: only allow ending/saving a workout when all sets are completed
  // and required fields are filled out.
  const getWorkoutValidationError = (): string | null => {
    for (const ex of exercises) {
      const exName = ex?.exercises?.name || ex?.name || 'Exercise';
      const exSets = sets[ex.id] || [];

      if (exSets.length === 0) {
        return `Please complete your workout before finishing.\n\nMissing sets for: ${exName}`;
      }

      for (let i = 0; i < exSets.length; i++) {
        const s: any = exSets[i];
        const setLabel = `Set ${i + 1}`;

        // Require completion toggle.
        if (!s?.is_completed) {
          return `Please complete all sets before finishing.\n\n${exName} — ${setLabel} is not checked.`;
        }

        // Require reps > 0
        const reps = Number(s?.reps);
        if (!Number.isFinite(reps) || reps <= 0) {
          return `Please fill out all fields before finishing.\n\n${exName} — ${setLabel} has missing reps.`;
        }

        // Require a numeric weight (0 is allowed for bodyweight)
        const weight = Number(s?.weight);
        if (!Number.isFinite(weight) || weight < 0) {
          return `Please fill out all fields before finishing.\n\n${exName} — ${setLabel} has missing weight.`;
        }
      }
    }

    return null;
  };

  const endWorkout = async () => {
    const validationError = getWorkoutValidationError();
    if (validationError) {
      window.alert(validationError);
      return;
    }

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

    const { data, error } = await supabase
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

    if (error) {
      console.error('Add set failed:', error);
      alert(error.message || 'Failed to add set.');
      return;
    }

    if (data) {
      // Optimistic UI update so the new set appears immediately on mobile even
      // if the session/user context briefly flickers.
      setSets((prev) => {
        const next = { ...prev };
        const list = next[exerciseId] ? [...next[exerciseId]] : [];
        list.push(data as any);
        next[exerciseId] = list;
        return next;
      });

      vibrate(15);
      setHighlightSetId((data as any).id);
      window.setTimeout(() => setHighlightSetId((prev) => (prev === (data as any).id ? null : prev)), 700);
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
    <div className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-6">
		{/* Sticky session timer: stays visible while scrolling (HEVY-style) */}
        <div className="sticky top-0 z-40 -mx-4 px-4 pt-2 pb-3 backdrop-blur bg-black/40">
          <div className="flex items-center justify-end">
            {/* No outline around the timer pill (smooth, like HEVY) */}
            <div className="inline-flex items-center gap-2 rounded-full bg-gray-900/60 px-3 py-1.5">
              <Clock className="h-4 w-4 text-white/90" />
              <span className="font-mono text-sm font-semibold tabular-nums">{formatClock(elapsedSeconds)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold truncate">{session?.routines?.name || 'Workout'}</h1>
            {session?.routine_days?.name && <p className="text-gray-400 truncate">{session.routine_days.name}</p>}
          </div>
        </div>

        {/* Rest timer is displayed inside each exercise card (HEVY style). */}

        <div className="space-y-6">
          {exercises.map((exercise: any) => {
            const prevSets = prevSetsByExercise[exercise.id] || [];

            return (
              <div key={exercise.id} className="bg-gray-900/40 border border-gray-800 rounded-2xl p-4 sm:p-5 shadow-lg shadow-black/20">
                <div className="mb-3">
                  <h3 className="section-title text-white">{exercise.exercises?.name || 'Exercise'}</h3>

                  <div className="mt-2 flex items-center justify-between gap-3">
                    {/* Technique on the left (no pill border) */}
                    <div className="min-w-0">
                      {exercise.exercises?.default_technique_tags?.[0] ? (
                        <button
                          type="button"
                          onClick={() => openTechnique(exercise.exercises!.default_technique_tags![0])}
                          className="tap-target text-sm font-semibold text-primary truncate"
                          aria-label={`How to perform ${exercise.exercises!.default_technique_tags![0]}`}
                        >
                          {exercise.exercises!.default_technique_tags![0]}
                        </button>
                      ) : (
                        <span className="text-sm text-gray-400">&nbsp;</span>
                      )}
                    </div>

                    {/* Rest timer on the right */}
                    <div className="flex items-center gap-2 text-sm text-gray-300 shrink-0">
                      <Clock className="h-4 w-4 text-gray-300" />
                      {restSecondsRemaining !== null && restExerciseId === exercise.id ? (
                        <span className="font-medium">{formatClock(restSecondsRemaining)}</span>
                      ) : (
                        <span className="font-medium">{formatClock(getExerciseRestSeconds(exercise))}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-gray-300/80 border-b border-gray-800">
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
                          <tr
                            key={set.id}
                            className={
                              "set-row " +
                              (set.id === highlightSetId ? "set-row--new " : "") +
                              (removingSetIds.has(set.id) ? "set-row--removing " : "")
                            }
                          >
                            <td className="px-2 py-2 font-semibold text-gray-200 tabular-nums">{idx + 1}</td>

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
                                className="w-full h-11 px-2 py-2 rounded-xl border border-gray-700 bg-gray-900/40 text-center text-white placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
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
                                className="w-full h-11 px-2 py-2 rounded-xl border border-gray-700 bg-gray-900/40 text-center text-white placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
                              />
                              {formatPrevLine('Prev:', prevWeight)}
                            </td>

                            <td className="px-2 py-2 text-center">
                              <button
                                onClick={() => handleToggleCompleted(exercise, set)}
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

                  {/* Add set button (HEVY-style pill) */}
                  <div className="mt-3">
                    <button
                      type="button"
                      aria-label="Add set"
                      onClick={() => addSet(exercise.id)}
                      className="w-full h-14 rounded-2xl bg-gray-800/60 border border-gray-700 text-white/90 text-base font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.99]"
                    >
                      <Plus className="h-5 w-5" aria-hidden="true" />
                      Add Set
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="pt-6 space-y-3">
            {showAddExercise ? (
              <div className="surface p-4">
                <select
                  value={selectedExerciseId}
                  onChange={(e) => setSelectedExerciseId(e.target.value)}
                  className="w-full h-11 rounded-xl border border-input bg-background bg-opacity-70 backdrop-blur px-3 text-sm text-foreground mb-3"
                >
                  <option value="">Select Exercise</option>
                  {availableExercises.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.name}
                    </option>
                  ))}
                </select>

                <div className="flex gap-2">
                  <Button
                    onClick={addExerciseToSession}
                    disabled={addingExercise}
                    className="flex-1"
                  >
                    {addingExercise ? 'Adding…' : 'Add'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowAddExercise(false);
                      setSelectedExerciseId('');
                    }}
                    disabled={addingExercise}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => setShowAddExercise(true)}
                className="w-full gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>Add Exercise</span>
              </Button>
            )}

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
