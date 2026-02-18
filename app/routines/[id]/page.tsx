'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import { Routine, RoutineDay, RoutineDayExercise, Exercise } from '@/lib/types';
import { CANONICAL_MUSCLE_GROUPS, normalizeMuscleGroup } from '@/lib/muscleGroups';
import { Plus, Trash2, ChevronUp, ChevronDown, X, PencilLine, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default function RoutineEditorPage() {
  const params = useParams();
  const router = useRouter();
  const { effectiveUserId, ready } = useCoach();
  const routineId = params.id as string;

  const [routine, setRoutine] = useState<Routine | null>(null);
  const [days, setDays] = useState<RoutineDay[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [dayExercises, setDayExercises] = useState<{ [dayId: string]: RoutineDayExercise[] }>({});
  const [prevSetsByExerciseId, setPrevSetsByExerciseId] = useState<Record<string, { reps: number; weight: number; set_index: number }[]>>({});
  const [showAddDay, setShowAddDay] = useState(false);
  const [showAddExercise, setShowAddExercise] = useState<string | null>(null);
  const [newDayName, setNewDayName] = useState('');
  const [selectedExerciseId, setSelectedExerciseId] = useState('');

  // Add-exercise filters (improves mobile UX for large libraries)
  const [exerciseMuscleGroupFilter, setExerciseMuscleGroupFilter] = useState<string>('all');
  const [exerciseEquipmentFilter, setExerciseEquipmentFilter] = useState<string>('all');
  const [exerciseNameFilter, setExerciseNameFilter] = useState<string>('');

  const muscleGroupOptions = useMemo(() => {
    // Keep filter options consistent across the app to prevent duplicates.
    return ['all', ...CANONICAL_MUSCLE_GROUPS];
  }, [exercises]);

  const ALLOWED_EQUIPMENT = ['barbell','body weight','cable','dumbbell','kettlebell','machine','smith machine'] as const;
  const normalizeEquipment = (v?: string | null) => {
    if (!v) return null;
    const s = String(v).trim().toLowerCase();
    if (!s) return null;
    if (s in {'bodyweight':1,'body-weight':1,'body_weight':1}) return 'body weight';
    if (s in {'cables':1,'cable(s)':1}) return 'cable';
    return s;
  };

  const equipmentOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const e of exercises) {
      const norm = normalizeEquipment((e as any).equipment);
      if (!norm) continue;
      if (ALLOWED_EQUIPMENT.includes(norm as any)) seen.add(norm);
    }
    return ['all', ...Array.from(seen).sort()];
  }, [exercises]);

  const filteredExercises = useMemo(() => {
    const q = exerciseNameFilter.trim().toLowerCase();
    return exercises.filter((e) => {
      if (
        exerciseMuscleGroupFilter !== 'all' &&
        normalizeMuscleGroup(e.muscle_group) !== normalizeMuscleGroup(exerciseMuscleGroupFilter)
      )
        return false;
      const eqNorm = normalizeEquipment((e as any).equipment);
      if (exerciseEquipmentFilter !== 'all' && eqNorm !== exerciseEquipmentFilter) return false;
      if (q && !e.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [exercises, exerciseMuscleGroupFilter, exerciseEquipmentFilter, exerciseNameFilter]);

  // Inline rename (minimal behavior change: updates existing fields only)
  const [isEditingRoutineName, setIsEditingRoutineName] = useState(false);
  const [routineNameDraft, setRoutineNameDraft] = useState('');
  const [editingDayId, setEditingDayId] = useState<string | null>(null);
  const [dayNameDraft, setDayNameDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!ready) return;
    if (effectiveUserId) loadRoutine(effectiveUserId);
    loadExercises();
  }, [routineId, ready, effectiveUserId]);

  const loadRoutine = async (uid: string) => {
    if (!uid) return;

    // Fetch routine + days + day exercises in a single request to avoid N+1 queries.
    const { data: routineRow } = await supabase
      .from('routines')
      .select(
        `
        *,
        routine_days(
          *,
          routine_day_exercises(
            *,
            exercises(*)
          )
        )
      `
      )
      .eq('id', routineId)
      // Production schema uses user_id; keep user-scoped fetch.
      .eq('user_id', uid)
      .single();

    if (!routineRow) return;

    setRoutine(routineRow as any);
    setRoutineNameDraft((routineRow as any).name || '');

    const daysData: RoutineDay[] = Array.isArray((routineRow as any).routine_days)
      ? [...(routineRow as any).routine_days]
      : [];
    daysData.sort((a, b) => (a.day_index ?? 0) - (b.day_index ?? 0));
    setDays(daysData);

    // initialize day name drafts (keeps inputs stable)
    const drafts: Record<string, string> = {};
    for (const d of daysData) drafts[d.id] = d.name || '';
    setDayNameDraft(drafts);

    // Keep drafts in sync (without stomping active edits)
    setDayNameDraft((prev) => {
      const next = { ...prev };
      for (const d of daysData) {
        if (typeof next[d.id] !== 'string') next[d.id] = d.name || '';
      }
      return next;
    });

    const exMap: { [dayId: string]: RoutineDayExercise[] } = {};
    for (const day of daysData as any[]) {
      const list: RoutineDayExercise[] = Array.isArray(day.routine_day_exercises)
        ? [...day.routine_day_exercises]
        : [];
      list.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
      exMap[day.id] = list;
    }
    setDayExercises(exMap);

    // UI-only: show last performed sets/weights for exercises in this routine.
    // Best-effort; failures should not block routine editing.
    try {
      void loadPrevSets(uid, exMap);
    } catch {}
  };

  const formatPrevSetsSummary = (sets: { reps: number; weight: number; set_index: number }[]) => {
    if (!sets || sets.length === 0) return '';
    const parts = sets
      .slice(0, 6)
      .map((s) => {
        const reps = typeof s.reps === 'number' ? s.reps : Number(s.reps || 0);
        const weight = typeof s.weight === 'number' ? s.weight : Number(s.weight || 0);
        if (!reps && !weight) return null;
        if (!weight) return `${reps}`;
        return `${reps}×${weight}`;
      })
      .filter(Boolean);
    return parts.length ? `Prev: ${parts.join(', ')}` : '';
  };

  const formatDefaultSetsSummary = (def: any[]) => {
    if (!Array.isArray(def) || def.length === 0) return '';
    const parts = def
      .slice(0, 6)
      .map((s: any) => {
        const reps = s?.reps ?? s?.targetReps ?? s?.rep ?? null;
        const r = reps !== null && reps !== undefined ? Number(reps) : null;
        return r && Number.isFinite(r) && r > 0 ? String(r) : null;
      })
      .filter(Boolean);
    if (!parts.length) return `${def.length} sets`;
    return `${def.length} sets: ${parts.join('-')}`;
  };

  const loadPrevSets = async (uid: string, exMap: { [dayId: string]: RoutineDayExercise[] }) => {
    try {
      const uniqueExerciseIds = Array.from(
        new Set(
          Object.values(exMap)
            .flat()
            .map((e) => e.exercise_id)
            .filter(Boolean)
        )
      ) as string[];

      if (!uid || uniqueExerciseIds.length === 0) {
        setPrevSetsByExerciseId({});
        return;
      }

      // Fetch a small window of recent sessions for this user.
      const { data: sessions, error: sErr } = await supabase
        .from('workout_sessions')
        .select('id, started_at')
        .eq('user_id', uid)
        .order('started_at', { ascending: false })
        .limit(30);

      if (sErr || !sessions || sessions.length === 0) {
        setPrevSetsByExerciseId({});
        return;
      }

      const sessionIds = sessions.map((s: any) => s.id).filter(Boolean);
      const sessionRank: Record<string, number> = {};
      sessions.forEach((s: any, idx: number) => {
        sessionRank[s.id] = idx;
      });

      // Find the most recent workout_exercise row per exercise_id across recent sessions.
      const { data: wex, error: wexErr } = await supabase
        .from('workout_exercises')
        .select('id, workout_session_id, exercise_id')
        .in('workout_session_id', sessionIds)
        .in('exercise_id', uniqueExerciseIds);

      if (wexErr || !wex || wex.length === 0) {
        setPrevSetsByExerciseId({});
        return;
      }

      const bestByExercise: Record<string, { workoutExerciseId: string; rank: number }> = {};
      for (const row of wex as any[]) {
        const exId = row.exercise_id as string;
        const wid = row.id as string;
        const sid = row.workout_session_id as string;
        const r = sessionRank[sid] ?? 9999;
        const existing = bestByExercise[exId];
        if (!existing || r < existing.rank) {
          bestByExercise[exId] = { workoutExerciseId: wid, rank: r };
        }
      }

      const workoutExerciseIds = Array.from(new Set(Object.values(bestByExercise).map((v) => v.workoutExerciseId)));
      if (workoutExerciseIds.length === 0) {
        setPrevSetsByExerciseId({});
        return;
      }

      const { data: sets, error: setErr } = await supabase
        .from('workout_sets')
        .select('workout_exercise_id, set_index, reps, weight')
        .in('workout_exercise_id', workoutExerciseIds)
        .order('set_index', { ascending: true });

      if (setErr || !sets) {
        setPrevSetsByExerciseId({});
        return;
      }

      const setsByWorkoutExercise: Record<string, any[]> = {};
      for (const st of sets as any[]) {
        const k = st.workout_exercise_id as string;
        if (!setsByWorkoutExercise[k]) setsByWorkoutExercise[k] = [];
        setsByWorkoutExercise[k].push({
          set_index: Number(st.set_index ?? 0),
          reps: Number(st.reps ?? 0),
          weight: Number(st.weight ?? 0),
        });
      }

      const next: Record<string, { reps: number; weight: number; set_index: number }[]> = {};
      for (const exId of Object.keys(bestByExercise)) {
        const wid = bestByExercise[exId].workoutExerciseId;
        next[exId] = (setsByWorkoutExercise[wid] || []) as any[];
      }

      setPrevSetsByExerciseId(next);
    } catch {
      // Ignore; routine editor must remain usable even if preview fails.
      setPrevSetsByExerciseId({});
    }
  };

  const loadExercises = async () => {
    const { data } = await supabase
      .from('exercises')
      .select('id,created_by,name,muscle_group,muscle_section,equipment,notes,created_at,rest_seconds,default_technique_tags,default_set_scheme')
      .order('name');

    if (data) setExercises(data);
  };

  const startEditRoutineName = () => {
    if (!routine) return;
    setRoutineNameDraft(routine.name || '');
    setIsEditingRoutineName(true);
  };

  const saveRoutineName = async () => {
    if (!routine) return;
    const nextName = routineNameDraft.trim();
    if (!nextName || nextName === (routine.name || '')) {
      setIsEditingRoutineName(false);
      setRoutineNameDraft(routine.name || '');
      return;
    }

    // optimistic UI
    const prev = routine;
    setRoutine({ ...routine, name: nextName });
    setIsEditingRoutineName(false);

    const { error } = await supabase
      .from('routines')
      .update({ name: nextName })
      .eq('id', routineId);

    if (error) {
      // revert on failure
      setRoutine(prev);
      setRoutineNameDraft(prev.name || '');
      alert('Could not rename routine. Please try again.');
    }
  };

  const startEditDayName = (day: RoutineDay) => {
    setEditingDayId(day.id);
    setDayNameDraft((prev) => ({ ...prev, [day.id]: day.name || '' }));
  };

  const saveDayName = async (day: RoutineDay) => {
    const nextName = (dayNameDraft[day.id] || '').trim();
    if (!nextName || nextName === (day.name || '')) {
      setEditingDayId(null);
      setDayNameDraft((prev) => ({ ...prev, [day.id]: day.name || '' }));
      return;
    }

    // optimistic UI
    const prevDays = days;
    setDays((cur) => cur.map((d) => (d.id === day.id ? { ...d, name: nextName } : d)));
    setEditingDayId(null);

    const { error } = await supabase
      .from('routine_days')
      .update({ name: nextName })
      .eq('id', day.id);

    if (error) {
      setDays(prevDays);
      setDayNameDraft((prev) => ({ ...prev, [day.id]: day.name || '' }));
      alert('Could not rename day. Please try again.');
    }
  };

  const addDay = async () => {
    if (!newDayName.trim()) return;

    const nextIndex = days.length;
    const { data } = await supabase
      .from('routine_days')
      .insert({
        routine_id: routineId,
        day_index: nextIndex,
        name: newDayName,
      })
      .select()
      .single();

    if (data) {
      setDays([...days, data]);
      setDayExercises({ ...dayExercises, [data.id]: [] });
      setDayNameDraft((prev) => ({ ...prev, [data.id]: data.name || '' }));
      setNewDayName('');
      setShowAddDay(false);
    }
  };

  const deleteDay = async (dayId: string) => {
    if (confirm('Delete this day?')) {
      await supabase.from('routine_days').delete().eq('id', dayId);
      if (effectiveUserId) loadRoutine(effectiveUserId);
    }
  };

  const addExerciseToDayHandler = async (dayId: string) => {
    if (!selectedExerciseId) return;

    const currentExercises = dayExercises[dayId] || [];
    const nextIndex = currentExercises.length;

    const { data } = await supabase
      .from('routine_day_exercises')
      .insert({
        routine_day_id: dayId,
        exercise_id: selectedExerciseId,
        order_index: nextIndex,
      })
      .select()
      .single();

    if (data) {
      if (effectiveUserId) loadRoutine(effectiveUserId);
      setShowAddExercise(null);
      setSelectedExerciseId('');
    }
  };

  const deleteExerciseFromDay = async (exerciseId: string) => {
    await supabase.from('routine_day_exercises').delete().eq('id', exerciseId);
    if (effectiveUserId) loadRoutine(effectiveUserId);
  };

  const moveExercise = async (dayId: string, exerciseId: string, direction: 'up' | 'down') => {
    const exs = [...(dayExercises[dayId] || [])];
    const idx = exs.findIndex((e) => e.id === exerciseId);
    if (idx === -1) return;

    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === exs.length - 1) return;

    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    [exs[idx], exs[newIdx]] = [exs[newIdx], exs[idx]];

    // Batch update order indexes in one request (avoids sequential UPDATE loop).
    const updates = exs.map((e, i) => ({ id: e.id, order_index: i }));
    await supabase
      .from('routine_day_exercises')
      .upsert(updates, { onConflict: 'id' });

    if (effectiveUserId) loadRoutine(effectiveUserId);
  };

  // Pointer-drag reorder for routine day exercises (mobile-friendly, same feel as active workout).
  // We intentionally avoid introducing new UI elements; drag starts from the exercise name area.
  const exerciseNodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [dragging, setDragging] = useState<{ dayId: string; exerciseId: string } | null>(null);
  const dragPointerYRef = useRef<number>(0);
  const dragStartYRef = useRef<number>(0);
  const dragStartIndexRef = useRef<number>(-1);
  const [dragOverIndex, setDragOverIndex] = useState<number>(-1);
  const dragOverIndexRef = useRef<number>(-1);
  const [dragTranslateY, setDragTranslateY] = useState<number>(0);
  const dragRafRef = useRef<number | null>(null);
  const isPersistingOrderRef = useRef(false);
  const dayExercisesRef = useRef<Record<string, RoutineDayExercise[]>>({});

  useEffect(() => {
    dayExercisesRef.current = dayExercises;
  }, [dayExercises]);

  const arrayMove = <T,>(arr: T[], from: number, to: number) => {
    const next = arr.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };

  const persistDayExerciseOrder = async (dayId: string, ordered: RoutineDayExercise[]) => {
    // Avoid uniqueness conflicts if there's a unique constraint on (routine_day_id, order_index)
    // by first writing to a temporary index space.
    if (isPersistingOrderRef.current) return;
    isPersistingOrderRef.current = true;
    try {
      const tmp = ordered.map((e, i) => ({ id: e.id, order_index: 1000 + i }));
      const fin = ordered.map((e, i) => ({ id: e.id, order_index: i }));
      await supabase.from('routine_day_exercises').upsert(tmp, { onConflict: 'id' });
      await supabase.from('routine_day_exercises').upsert(fin, { onConflict: 'id' });
    } finally {
      isPersistingOrderRef.current = false;
    }
  };

  const startRoutineExerciseDrag = (dayId: string, exerciseId: string, e: ReactPointerEvent) => {
    const list = dayExercises[dayId] || [];
    const idx = list.findIndex((x) => x.id === exerciseId);
    if (idx < 0) return;

    const key = `${dayId}:${exerciseId}`;
    const node = exerciseNodeRefs.current.get(key);
    if (!node) return;

    try {
      (e.currentTarget as any)?.setPointerCapture?.(e.pointerId);
    } catch {}

    e.preventDefault();
    e.stopPropagation();

    dragStartYRef.current = e.clientY;
    dragPointerYRef.current = e.clientY;
    dragStartIndexRef.current = idx;
    setDragging({ dayId, exerciseId });
    dragOverIndexRef.current = idx;
    setDragOverIndex(idx);
  };

  const stopRoutineExerciseDrag = async () => {
    const current = dragging;
    setDragging(null);
    dragOverIndexRef.current = -1;
    setDragOverIndex(-1);
    dragStartIndexRef.current = -1;
    setDragTranslateY(0);
    if (dragRafRef.current != null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    if (!current) return;
    try {
      const ordered = (dayExercisesRef.current[current.dayId] || []).slice();
      await persistDayExerciseOrder(current.dayId, ordered);
      // Re-sync from server so the saved order is guaranteed when navigating away/back.
      if (effectiveUserId) await loadRoutine(effectiveUserId);
    } catch (err) {
      console.error(err);
      if (effectiveUserId) await loadRoutine(effectiveUserId);
    }
  };

  useEffect(() => {
    if (!dragging) return;

    const onMove = (ev: PointerEvent) => {
      dragPointerYRef.current = ev.clientY;

      // Auto-scroll while dragging near viewport edges (mobile-friendly)
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

      const list = dayExercisesRef.current[dragging.dayId] || [];
      const entries = list
        .map((ex, i) => {
          const n = exerciseNodeRefs.current.get(`${dragging.dayId}:${ex.id}`);
          if (!n) return null;
          const r = n.getBoundingClientRect();
          return { i, mid: r.top + r.height / 2 };
        })
        .filter(Boolean) as { i: number; mid: number }[];

      if (entries.length === 0) return;

      let over = dragOverIndexRef.current;
      for (const it of entries) {
        if (y < it.mid) {
          over = it.i;
          break;
        }
        over = it.i;
      }

      if (over !== dragOverIndexRef.current) {
        dragStartYRef.current = ev.clientY;
        setDragTranslateY(0);
        setDayExercises((prev) => {
          const cur = prev[dragging.dayId] || [];
          const from = dragStartIndexRef.current;
          const to = over;
          if (from < 0 || from >= cur.length) return prev;
          if (to < 0 || to >= cur.length) return prev;
          if (from === to) return prev;
          const nextList = arrayMove(cur, from, to);
          dragStartIndexRef.current = to;
          return { ...prev, [dragging.dayId]: nextList };
        });
        dragOverIndexRef.current = over;
        setDragOverIndex(over);
      }

      ev.preventDefault();
    };

    const onUp = () => {
      stopRoutineExerciseDrag();
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove as any);
      window.removeEventListener('pointerup', onUp as any);
      window.removeEventListener('pointercancel', onUp as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const toggleSuperset = async (dayId: string, exerciseId: string) => {
    const exs = dayExercises[dayId] || [];
    const ex = exs.find((e) => e.id === exerciseId);
    if (!ex) return;

    const newGroupId = ex.superset_group_id ? null : crypto.randomUUID();

    await supabase
      .from('routine_day_exercises')
      .update({ superset_group_id: newGroupId })
      .eq('id', exerciseId);

    if (effectiveUserId) loadRoutine(effectiveUserId);
  };

  const groupBySupersets = (exs: RoutineDayExercise[]) => {
    const groups: { superset_group_id: string | null; items: RoutineDayExercise[] }[] = [];
    const seen = new Set<string | null>();

    exs.forEach((ex) => {
      if (ex.superset_group_id && !seen.has(ex.superset_group_id)) {
        seen.add(ex.superset_group_id);
        groups.push({
          superset_group_id: ex.superset_group_id,
          items: exs.filter((e) => e.superset_group_id === ex.superset_group_id),
        });
      } else if (!ex.superset_group_id) {
        groups.push({ superset_group_id: null, items: [ex] });
      }
    });

    return groups;
  };

  return (
    <AuthGuard>
      <div className="app-shell">
        <Navigation />
        <div className="page max-w-7xl">
          <div className="routine-sticky">
            <button
              onClick={() => router.push('/routines')}
              className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              ← Back to Routines
            </button>
            <div className="flex items-start justify-between gap-3">
              {isEditingRoutineName ? (
                <div className="flex-1">
                  <Input
                    value={routineNameDraft}
                    onChange={(e) => setRoutineNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRoutineName();
                      if (e.key === 'Escape') {
                        setIsEditingRoutineName(false);
                        setRoutineNameDraft(routine?.name || '');
                      }
                    }}
                    onBlur={saveRoutineName}
                    className="h-12 text-base font-semibold"
                    aria-label="Routine name"
                    autoFocus
                  />
                </div>
              ) : (
                <h1 className="page-title flex-1 pr-2">{routine?.name}</h1>
              )}

              {isEditingRoutineName ? (
                <div className="flex items-center gap-1 pt-1">
                  <button
                    onClick={saveRoutineName}
                    className="icon-btn"
                    aria-label="Save routine name"
                    title="Save"
                  >
                    <Check className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingRoutineName(false);
                      setRoutineNameDraft(routine?.name || '');
                    }}
                    className="icon-btn"
                    aria-label="Cancel"
                    title="Cancel"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={startEditRoutineName}
                  className="icon-btn"
                  aria-label="Rename routine"
                  title="Rename"
                >
                  <PencilLine className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>

          <div className="space-y-6">
            {days.map((day) => {
              const exs = dayExercises[day.id] || [];
              const grouped = groupBySupersets(exs);

              return (
                <div key={day.id} className="surface p-6">
                  <div className="day-sticky-header flex justify-between items-center gap-3">
                    {editingDayId === day.id ? (
                      <div className="flex-1 pr-2">
                        <Input
                          value={dayNameDraft[day.id] ?? ''}
                          onChange={(e) => setDayNameDraft((prev) => ({ ...prev, [day.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveDayName(day);
                            if (e.key === 'Escape') {
                              setEditingDayId(null);
                              setDayNameDraft((prev) => ({ ...prev, [day.id]: day.name || '' }));
                            }
                          }}
                          onBlur={() => saveDayName(day)}
                          className="h-11 text-sm font-semibold"
                          aria-label="Day name"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-1 pr-2">
                        <h2 className="text-lg font-semibold tracking-tight truncate">{day.name}</h2>
                        <button
                          onClick={() => startEditDayName(day)}
                          className="icon-btn"
                          aria-label="Rename day"
                          title="Rename day"
                        >
                          <PencilLine className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => deleteDay(day.id)}
                      className="icon-btn text-destructive hover:text-destructive"
                      aria-label="Delete day"
                      title="Delete day"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="mt-4 space-y-2 mb-4">
                    {grouped.map((group, gIdx) => {
                      if (group.superset_group_id) {
                        return (
                          <div key={gIdx} className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                            <div className="mb-2">
                              <Badge variant="secondary" className="border-border/60">SUPERSET</Badge>
                            </div>
                            {group.items.map((ex) => (
                              <div
                                key={ex.id}
                                ref={(el) => {
                                  const k = `${day.id}:${ex.id}`;
                                  if (el) exerciseNodeRefs.current.set(k, el);
                                  else exerciseNodeRefs.current.delete(k);
                                }}
                                className="flex items-center justify-between py-2"
                                style={
                                  dragging?.dayId === day.id && dragging?.exerciseId === ex.id
                                    ? { transform: `translateY(${dragTranslateY}px)`, zIndex: 50, position: 'relative' }
                                    : undefined
                                }
                              >
                                <div
                                  className="min-w-0"
                                  onPointerDown={(e) => startRoutineExerciseDrag(day.id, ex.id, e)}
                                  style={{ touchAction: 'none' }}
                                >
                                  <span className="font-medium text-foreground block truncate">{ex.exercises?.name}</span>
                                  {(() => {
                                    const prev = prevSetsByExerciseId[ex.exercise_id] || [];
                                    const text = formatPrevSetsSummary(prev);
                                    return text ? (
                                      <div className="text-xs text-muted-foreground mt-1 truncate">{text}</div>
                                    ) : null;
                                  })()}
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => moveExercise(day.id, ex.id, 'up')}
                                    className="icon-btn"
                                    aria-label="Move up"
                                  >
                                    <ChevronUp className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => moveExercise(day.id, ex.id, 'down')}
                                    className="icon-btn"
                                    aria-label="Move down"
                                  >
                                    <ChevronDown className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => toggleSuperset(day.id, ex.id)}
                                    className="tap-target rounded-xl border border-border/60 bg-background bg-opacity-60 px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                                  >
                                    Ungroup
                                  </button>
                                  <button
                                    onClick={() => deleteExerciseFromDay(ex.id)}
                                    className="icon-btn text-destructive hover:text-destructive"
                                    aria-label="Delete exercise"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      } else {
                        const ex = group.items[0];
                        return (
                          <div
                            key={ex.id}
                            ref={(el) => {
                              const k = `${day.id}:${ex.id}`;
                              if (el) exerciseNodeRefs.current.set(k, el);
                              else exerciseNodeRefs.current.delete(k);
                            }}
                            className="flex items-center justify-between py-2 border-b border-border/50"
                            style={
                              dragging?.dayId === day.id && dragging?.exerciseId === ex.id
                                ? { transform: `translateY(${dragTranslateY}px)`, zIndex: 50, position: 'relative' }
                                : undefined
                            }
                          >
                            <div
                              className="min-w-0"
                              onPointerDown={(e) => startRoutineExerciseDrag(day.id, ex.id, e)}
                              style={{ touchAction: 'none' }}
                            >
                              <span className="font-medium text-foreground block truncate">{ex.exercises?.name}</span>
                              {(() => {
                                const prev = prevSetsByExerciseId[ex.exercise_id] || [];
                                const text = formatPrevSetsSummary(prev);
                                return text ? (
                                  <div className="text-xs text-muted-foreground mt-1 truncate">{text}</div>
                                ) : null;
                              })()}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => moveExercise(day.id, ex.id, 'up')}
                                className="icon-btn"
                                aria-label="Move up"
                              >
                                <ChevronUp className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => moveExercise(day.id, ex.id, 'down')}
                                className="icon-btn"
                                aria-label="Move down"
                              >
                                <ChevronDown className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => toggleSuperset(day.id, ex.id)}
                                className="tap-target rounded-xl border border-border/60 bg-background bg-opacity-60 px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                              >
                                Superset
                              </button>
                              <button
                                onClick={() => deleteExerciseFromDay(ex.id)}
                                className="icon-btn text-destructive hover:text-destructive"
                                aria-label="Delete exercise"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      }
                    })}
                  </div>

                  {showAddExercise === day.id ? (
                    <div className="border-t border-border/60 pt-4">
                      <div className="flex flex-col gap-2 mb-2">
                        <div className="grid grid-cols-2 gap-2">
                          <select
                            value={exerciseMuscleGroupFilter}
                            onChange={(e) => setExerciseMuscleGroupFilter(e.target.value)}
                            className="w-full h-11 rounded-xl border border-input bg-background bg-opacity-70 backdrop-blur px-3 text-sm text-foreground"
                          >
                            {muscleGroupOptions.map((g) => (
                              <option key={g} value={g}>
                                {g === 'all' ? 'All muscle groups' : g}
                              </option>
                            ))}
                          </select>

                          <select
                            value={exerciseEquipmentFilter}
                            onChange={(e) => setExerciseEquipmentFilter(e.target.value)}
                            className="w-full h-11 rounded-xl border border-input bg-background bg-opacity-70 backdrop-blur px-3 text-sm text-foreground"
                          >
                            {equipmentOptions.map((eq) => (
                              <option key={eq} value={eq}>
                                {eq === 'all' ? 'All equipment' : eq}
                              </option>
                            ))}
                          </select>
                        </div>

                        <Input
                          value={exerciseNameFilter}
                          onChange={(e) => setExerciseNameFilter(e.target.value)}
                          placeholder="Search exercise name…"
                        />
                      </div>

                      <select
                        value={selectedExerciseId}
                        onChange={(e) => setSelectedExerciseId(e.target.value)}
                        className="w-full h-11 rounded-xl border border-input bg-background bg-opacity-70 backdrop-blur px-3 text-sm text-foreground mb-2"
                      >
                        <option value="">Select Exercise</option>
                        {filteredExercises.map((ex) => (
                          <option key={ex.id} value={ex.id}>
                            {ex.name}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <Button onClick={() => addExerciseToDayHandler(day.id)} className="flex-1">Add</Button>
                        <Button onClick={() => setShowAddExercise(null)} variant="outline" className="flex-1">Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button onClick={() => setShowAddExercise(day.id)} variant="outline" className="w-full gap-2">
                      <Plus className="w-4 h-4" />
                      <span>Add Exercise</span>
                    </Button>
                  )}
                </div>
              );
            })}

            {showAddDay ? (
              <div className="surface p-6">
                <h2 className="text-lg font-semibold tracking-tight mb-4">Add Day</h2>
                <Input
                  type="text"
                  value={newDayName}
                  onChange={(e) => setNewDayName(e.target.value)}
                  placeholder="Day name (e.g., Push Day, Leg Day)"
                  className="mb-4"
                />
                <div className="flex gap-2">
                  <Button onClick={addDay} className="flex-1">Add</Button>
                  <Button onClick={() => setShowAddDay(false)} variant="outline" className="flex-1">Cancel</Button>
                </div>
              </div>
            ) : (
              <Button
                onClick={() => setShowAddDay(true)}
                variant="outline"
                className="w-full h-14 border-dashed gap-2 text-muted-foreground hover:text-foreground"
              >
                <Plus className="w-5 h-5" />
                <span>Add Day</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}

