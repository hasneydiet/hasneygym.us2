'use client';

export const dynamic = 'force-dynamic';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, Clock, Trash2, GripVertical, Info, Dumbbell } from 'lucide-react';

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

function formatMMSSFromSeconds(totalSeconds: number | null | undefined) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function parseMMSS(input: string): number {
  const raw = (input || '').trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Math.max(0, parseInt(raw, 10));
  const parts = raw.split(':').map((p) => p.trim());
  if (parts.length !== 2) return 0;
  const mm = parseInt(parts[0] || '0', 10);
  const ss = parseInt(parts[1] || '0', 10);
  if (!Number.isFinite(mm) || !Number.isFinite(ss)) return 0;
  return Math.max(0, mm * 60 + clampInt(ss, 0, 59));
}

function isCardioWorkoutExercise(ex: any) {
  return ex?.exercises?.exercise_type === 'cardio' || ex?.exercises?.muscle_group === 'Cardio';
}

const TECHNIQUE_GUIDES: Record<string, { title: string; summary: string; steps: string[]; tips?: string[] }> = {
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

const TECHNIQUE_LAST_SET_REMINDER = new Set(['Rest-Pause', 'Drop-Sets', 'Myo-Reps', 'Failure']);

export default function WorkoutPage() {
  const params = useParams();
  const router = useRouter();
  const { effectiveUserId } = useCoach();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [sets, setSets] = useState<{ [exerciseId: string]: WorkoutSet[] }>({});
  const [prevSetsByExercise, setPrevSetsByExercise] = useState<Record<string, WorkoutSet[]>>({});

  const [showAddExercise, setShowAddExercise] = useState(false);
  const [selectedExerciseId, setSelectedExerciseId] = useState('');
  const [availableExercises, setAvailableExercises] = useState<any[]>([]);
  const [addingExercise, setAddingExercise] = useState(false);

  const [cardioDraft, setCardioDraft] = useState<Record<string, string>>({});

  const [highlightSetId, setHighlightSetId] = useState<string | null>(null);
  const [removingSetIds, setRemovingSetIds] = useState<Set<string>>(() => new Set());

  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});

  const [techniqueGuideOpen, setTechniqueGuideOpen] = useState(false);
  const [techniqueGuideExerciseId, setTechniqueGuideExerciseId] = useState<string | null>(null);

  const [setTechniqueOpen, setSetTechniqueOpen] = useState(false);
  const [techniqueExerciseId, setTechniqueExerciseId] = useState<string | null>(null);

  const SET_TECHNIQUES = ['Normal-Sets', 'Drop-Sets', 'Rest-Pause', 'GVT', 'Myo-Reps', 'Super-Sets', 'Failure'];

  const openSetTechnique = (workoutExerciseId: string) => {
    setTechniqueExerciseId(workoutExerciseId);
    setSetTechniqueOpen(true);
  };

  const openTechniqueGuide = (workoutExerciseId: string) => {
    setTechniqueGuideExerciseId(workoutExerciseId);
    setTechniqueGuideOpen(true);
  };

  const applySetTechnique = async (newTechnique: string) => {
    const workoutExerciseId = techniqueExerciseId;
    if (!workoutExerciseId) return;

    const row = exercises.find((e: any) => e.id === workoutExerciseId) as any;
    const originRoutineDayExerciseId = row?.routine_day_exercise_id as string | null | undefined;

    setExercises((prev: any[]) =>
      prev.map((e: any) => (e.id === workoutExerciseId ? { ...e, technique_tags: [newTechnique] } : e))
    );

    try {
      const res1 = await supabase.from('workout_exercises').update({ technique_tags: [newTechnique] }).eq('id', workoutExerciseId);
      if (res1?.error) throw res1.error;

      if (originRoutineDayExerciseId) {
        const res2 = await supabase.from('routine_day_exercises').update({ technique_tags: [newTechnique] }).eq('id', originRoutineDayExerciseId);
        if (res2?.error) throw res2.error;
      }

      if (effectiveUserId && row?.exercise_id) {
        const res3 = await supabase
          .from('user_exercise_preferences')
          .upsert(
            {
              user_id: effectiveUserId,
              exercise_id: row.exercise_id,
              technique: newTechnique,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,exercise_id' }
          );
        if (res3?.error) throw res3.error;
      }
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Failed to update technique.');
      await loadWorkout();
    } finally {
      setSetTechniqueOpen(false);
      setTechniqueExerciseId(null);
    }
  };

  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const [restSecondsRemaining, setRestSecondsRemaining] = useState<number | null>(null);
  const [restExerciseId, setRestExerciseId] = useState<string | null>(null);
  const restIntervalRef = useRef<number | null>(null);
  const beepedRef = useRef(false);

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);

  const exerciseNodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [draggingExerciseId, setDraggingExerciseId] = useState<string | null>(null);
  const dragPointerYRef = useRef<number>(0);
  const dragStartYRef = useRef<number>(0);
  const dragStartIndexRef = useRef<number>(-1);
  const dragOffsetYRef = useRef<number>(0);
  const [dragOverIndex, setDragOverIndex] = useState<number>(-1);
  const [dragTranslateY, setDragTranslateY] = useState<number>(0);
  const dragRafRef = useRef<number | null>(null);
  const [isPersistingOrder, setIsPersistingOrder] = useState(false);
  const exercisesRef = useRef<WorkoutExercise[]>([]);

  useEffect(() => {
    exercisesRef.current = exercises;
  }, [exercises]);

  const arrayMove = <T,>(arr: T[], from: number, to: number) => {
    const next = arr.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };

  const persistExerciseOrder = async (ordered: WorkoutExercise[]) => {
    if (isPersistingOrder) return;
    setIsPersistingOrder(true);
    try {
      for (let i = 0; i < ordered.length; i++) {
        const id = (ordered[i] as any)?.id;
        if (!id) continue;
        await supabase.from('workout_exercises').update({ order_index: 1000 + i }).eq('id', id);
      }
      for (let i = 0; i < ordered.length; i++) {
        const id = (ordered[i] as any)?.id;
        if (!id) continue;
        await supabase.from('workout_exercises').update({ order_index: i }).eq('id', id);
      }
    } finally {
      setIsPersistingOrder(false);
    }
  };

  const startExerciseDrag = (exerciseId: string, e: React.PointerEvent) => {
    if (session?.ended_at) return;
    const idx = exercises.findIndex((x: any) => x.id === exerciseId);
    if (idx < 0) return;

    const node = exerciseNodeRefs.current.get(exerciseId);
    if (!node) return;

    try {
      (e.currentTarget as any)?.setPointerCapture?.(e.pointerId);
    } catch {}

    e.preventDefault();
    e.stopPropagation();

    const rect = node.getBoundingClientRect();
    dragStartYRef.current = e.clientY;
    dragPointerYRef.current = e.clientY;
    dragStartIndexRef.current = idx;
    dragOffsetYRef.current = e.clientY - rect.top;
    setDraggingExerciseId(exerciseId);
    setDragOverIndex(idx);
    vibrate(8);
  };

  const stopExerciseDrag = async () => {
    setDraggingExerciseId(null);
    setDragOverIndex(-1);
    dragStartIndexRef.current = -1;
    setDragTranslateY(0);
    if (dragRafRef.current != null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    try {
      await persistExerciseOrder(exercisesRef.current);
    } catch (err) {
      console.error(err);
      await loadWorkout();
    }
  };

  useEffect(() => {
    if (!draggingExerciseId) return;

    const onMove = (ev: PointerEvent) => {
      dragPointerYRef.current = ev.clientY;

      const edge = 80;
      const y = ev.clientY;
      const vh = window.innerHeight;
      if (y < edge) {
        const strength = (edge - y) / edge;
        window.scrollBy({ top: -Math.round(18 * strength), left: 0, behavior: 'auto' });
      } else if (y > vh - edge) {
        const strength = (y - (vh - edge)) / edge;
        window.scrollBy({ top: Math.round(18 * strength), left: 0, behavior: 'auto' });
      }

      if (dragRafRef.current == null) {
        dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = null;
          setDragTranslateY(dragPointerYRef.current - dragStartYRef.current);
        });
      }

      const entries = exercises
        .map((ex: any, i: number) => {
          const n = exerciseNodeRefs.current.get(ex.id);
          if (!n) return null;
          const r = n.getBoundingClientRect();
          return { id: ex.id, i, mid: r.top + r.height / 2 };
        })
        .filter(Boolean) as { id: string; i: number; mid: number }[];

      if (entries.length === 0) return;

      let over = dragOverIndex;
      for (const it of entries) {
        if (y < it.mid) {
          over = it.i;
          break;
        }
        over = it.i;
      }

      if (over !== dragOverIndex) {
        dragStartYRef.current = ev.clientY;
        setDragTranslateY(0);
        setExercises((prev) => {
          const from = dragStartIndexRef.current;
          if (from < 0 || from >= prev.length) return prev;
          const to = over;
          if (to < 0 || to >= prev.length) return prev;
          if (from === to) return prev;
          const next = arrayMove(prev, from, to);
          dragStartIndexRef.current = to;
          return next;
        });
        setDragOverIndex(over);
        vibrate(4);
      }
      ev.preventDefault();
    };

    const onUp = () => stopExerciseDrag();

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove as any);
      window.removeEventListener('pointerup', onUp as any);
      window.removeEventListener('pointercancel', onUp as any);
    };
  }, [draggingExerciseId, exercises, dragOverIndex, session?.ended_at]);

  const sessionIsCompleted = Boolean(session?.ended_at);

  const removeExerciseFromSession = async (workoutExerciseId: string) => {
    if (sessionIsCompleted) return;
    if (!confirm('Remove this exercise from this workout session?')) return;

    try {
      await supabase.from('workout_exercises').delete().eq('id', workoutExerciseId);
      const remaining = exercises.filter((x: any) => x.id !== workoutExerciseId);
      await persistExerciseOrder(remaining);
      await loadWorkout();
    } catch (err) {
      console.error(err);
      alert('Failed to remove exercise from session.');
      await loadWorkout();
    }
  };

  const focusByKey = (key: string) => {
    const el = inputRefs.current.get(key);
    if (el) {
      el.focus();
      requestAnimationFrame(() => el.select?.());
      return true;
    }
    return false;
  };

  const vibrate = (pattern: number | number[] = 10) => {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) (navigator as any).vibrate(pattern);
    } catch {}
  };

  const playBeep = () => {
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
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
        gain.gain.exponentialRampToValueAtTime(0.95, t0 + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.35);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
        gain.connect(master);

        const freqs = [740, 1110, 1480];
        const types: OscillatorType[] = ['triangle', 'sine', 'square'];
        const oscs = freqs.map((f, i) => {
          const osc = ctx.createOscillator();
          osc.type = types[i];
          osc.frequency.setValueAtTime(f, t0);
          osc.detune.setValueAtTime((i - 1) * 8, t0);
          osc.connect(gain);
          osc.start(t0);
          osc.stop(t0 + 1.25);
          return osc;
        });

        oscs[oscs.length - 1].onended = () => {
          try {
            gain.disconnect();
          } catch {}
        };
      };

      const now = ctx.currentTime + 0.01;
      strike(now);
      strike(now + 0.35);

      setTimeout(() => {
        try {
          ctx.close();
        } catch {}
      }, 1800);
    } catch {}
  };

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
  }, [sessionId, effectiveUserId]);

  useEffect(() => {
    if (!showAddExercise) return;
    let cancelled = false;

    const load = async () => {
      if (availableExercises.length > 0) return;

      const { data, error } = await supabase.from('exercises').select('id, name, muscle_group, exercise_type').order('name');
      if (!cancelled && !error && data) setAvailableExercises(data);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [showAddExercise, availableExercises.length]);

  useEffect(() => {
    if (!pendingFocusKey) return;
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
    const { data: allSets } = await supabase.from('workout_sets').select('*').in('workout_exercise_id', exIds).order('set_index');

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

      const nextOrder = exercises.length;

      const { data: exMeta, error: exMetaErr } = await supabase
        .from('exercises')
        .select('default_set_scheme, muscle_group, exercise_type')
        .eq('id', selectedExerciseId)
        .maybeSingle();

      if (exMetaErr) throw exMetaErr;

      const isCardio = (exMeta as any)?.exercise_type === 'cardio' || (exMeta as any)?.muscle_group === 'Cardio';

      const scheme = (exMeta as any)?.default_set_scheme ?? null;
      const schemeSets = scheme && typeof scheme === 'object' ? Number((scheme as any).sets) : NaN;
      const schemeReps = scheme && typeof scheme === 'object' ? Number((scheme as any).reps) : NaN;

      const setsCount = isCardio ? 0 : Number.isFinite(schemeSets) ? Math.max(1, Math.floor(schemeSets)) : 1;
      const defaultReps = isCardio ? 0 : Number.isFinite(schemeReps) ? Math.max(0, Math.floor(schemeReps)) : 0;

      let defaultTechnique = 'Normal-Sets';
      if (effectiveUserId) {
        const { data: prefRow } = await supabase
          .from('user_exercise_preferences')
          .select('technique')
          .eq('user_id', effectiveUserId)
          .eq('exercise_id', selectedExerciseId)
          .maybeSingle();
        if (prefRow?.technique) defaultTechnique = String(prefRow.technique);
      }

      const { data: newWorkoutExercise, error: weErr } = await supabase
        .from('workout_exercises')
        .insert({
          workout_session_id: sessionId,
          exercise_id: selectedExerciseId,
          order_index: nextOrder,
          routine_day_exercise_id: null,
          technique_tags: [defaultTechnique],
          duration_seconds: isCardio ? 0 : null,
        })
        .select('id')
        .single();

      if (weErr) throw weErr;

      const workoutExerciseId = (newWorkoutExercise as any)?.id as string | undefined;
      if (!workoutExerciseId) throw new Error('Failed to create workout exercise.');

      if (!isCardio) {
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
      }

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

  // --- REST OF YOUR FILE (UNCHANGED UI) ---
  // Keep everything below exactly as you currently have it.
  // The only functional fix needed for the build error was removing the undefined `exerciseLibrary` reference,
  // which is now fully eliminated by using `exMeta` fetched from Supabase above.
}
