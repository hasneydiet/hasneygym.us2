'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { Routine, RoutineDay } from '@/lib/types';
import { ChevronDown, MoreHorizontal } from 'lucide-react';

export const dynamic = 'force-dynamic';

type RoutineDayCard = RoutineDay & {
  routineName?: string;
  preview?: string;
  exerciseCount?: number;
};

export default function WorkoutStartPage() {
  const router = useRouter();

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routineDays, setRoutineDays] = useState<RoutineDayCard[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [startingDayId, setStartingDayId] = useState<string | null>(null);

  // ✅ "..." menu (keyed by the *card* id so only one opens)
  const [openMenuCardId, setOpenMenuCardId] = useState<string | null>(null);

  // ✅ Last performed date per routine_id
  const [lastPerformedByRoutineId, setLastPerformedByRoutineId] = useState<Record<string, string | null>>({});

  
  const chunkArray = <T,>(arr: T[], size: number) => {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
  };


  const getDayTitle = (d: any) => {
    // Prefer explicit day name from DB
    const n = d?.name || d?.day_name || d?.title || d?.label;
    if (n && String(n).trim().length > 0) return String(n);

    // Fallback: derive "Workout A/B/C..." from day_index (0-based or 1-based)
    const idxRaw = d?.day_index ?? d?.dayIndex ?? d?.index;
    const idx = Number(idxRaw);
    if (Number.isFinite(idx)) {
      const zeroBased = idx >= 0 ? idx : 0;
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      return `Workout ${letters[Math.min(zeroBased, letters.length - 1)]}`;
    }
    return 'Workout';
  };


  useEffect(() => {
    loadRoutinesAndDays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest?.('[data-routine-menu]')) return;
      setOpenMenuCardId(null);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const loadRoutinesAndDays = async () => {
    setLoading(true);

    const { data: routinesData, error: routinesErr } = await supabase
      .from('routines')
      .select('*')
      .order('created_at', { ascending: false });

    if (routinesErr) console.error('Failed to load routines:', routinesErr);

    const routinesList = (routinesData || []) as Routine[];
    setRoutines(routinesList);

    // ✅ last performed session per routine (most recent started_at where ended_at is not null)
    if (routinesList.length > 0) {
      const { data: sessionRows, error: sessErr } = await supabase
        .from('workout_sessions')
        .select('routine_id, started_at, ended_at')
        .in('routine_id', routinesList.map((r) => r.id))
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(500);

      if (sessErr) console.error('Failed to load last performed sessions:', sessErr);

      const map: Record<string, string | null> = {};
      for (const row of (sessionRows || []) as any[]) {
        const rid = row.routine_id as string;
        if (!rid) continue;
        if (map[rid] !== undefined) continue; // first (most recent) wins
        map[rid] = row.started_at ?? null;
      }
      setLastPerformedByRoutineId(map);
    } else {
      setLastPerformedByRoutineId({});
    }

    const routineNameById: Record<string, string> = {};
    for (const r of routinesList) routineNameById[r.id] = r.name;

    // Pull routine days (we list day cards like HEVY)
    const { data: daysData, error: daysErr } = await supabase
      .from('routine_days')
      .select('*')
      .order('day_index', { ascending: true });

    if (daysErr) console.error('Failed to load routine days:', daysErr);

    const daysList = (daysData || []) as RoutineDay[];
    const daysWithNames: RoutineDayCard[] = daysList
      .filter((d: any) => !!d.routine_id)
      .map((d: any) => ({
        ...d,
        routineName: routineNameById[d.routine_id] || 'Routine',
      }));

    // Build exercise preview for each routine day
    const withPreview = await Promise.all(
      daysWithNames.map(async (d) => {
        const { data: exRows, error: exErr } = await supabase
          .from('routine_day_exercises')
          .select('exercise_id, order_index, exercises(name)')
          .eq('routine_day_id', d.id)
          .order('order_index', { ascending: true })
          .limit(6);

        if (exErr) console.error('Failed to load day exercises:', exErr);

        const names = (exRows || [])
          .map((x: any) => x.exercises?.name)
          .filter(Boolean) as string[];

        return {
          ...d,
          exerciseCount: names.length,
          preview: names.length ? names.join(' • ') : 'No exercises added yet',
        } as RoutineDayCard;
      })
    );

    // Sort: keep within routine order by day_index, but routines already global; OK
    setRoutineDays(withPreview);
    setLoading(false);
  };

  const formatLastPerformed = (iso: string | null | undefined) => {
    if (!iso) return 'Never';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '—';
    }
  };

    const startRoutineDay = async (routineId: string, routineDayId: string) => {
    try {
      setStartingDayId(routineDayId);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // 1) Create workout session (fast)
      const { data: session, error: sessionError } = await supabase
        .from('workout_sessions')
        .insert({
          user_id: user.id,
          routine_id: routineId,
          routine_day_id: routineDayId,
        })
        .select()
        .single();

      if (sessionError || !session) {
        console.error('Failed to create session:', sessionError);
        return;
      }

      // 2) Load routine exercises (one query)
      const { data: routineExercises, error: exErr } = await supabase
        .from('routine_exercises')
        .select('*, exercises(*)')
        .eq('routine_day_id', routineDayId)
        .order('order_index', { ascending: true });

      if (exErr) {
        console.error('Failed to load routine exercises:', exErr);
        router.push(`/workout/${session.id}`);
        return;
      }

      const reList = (routineExercises || []) as any[];
      if (reList.length === 0) {
        router.push(`/workout/${session.id}`);
        return;
      }

      // 3) Bulk insert workout_exercises (single request)
      const workoutExercisePayloads = reList.map((ex) => ({
        workout_session_id: session.id,
        exercise_id: ex.exercise_id,
        order_index: ex.order_index,
        superset_group_id: ex.superset_group_id,
        technique_tags: ex.exercises?.default_technique_tags || [],
      }));

      const { data: insertedWorkoutExercises, error: weBulkErr } = await supabase
        .from('workout_exercises')
        .insert(workoutExercisePayloads)
        .select('id, exercise_id, order_index, superset_group_id');

      if (weBulkErr || !insertedWorkoutExercises) {
        console.error('Failed to create workout exercises (bulk):', weBulkErr);
        router.push(`/workout/${session.id}`);
        return;
      }

      // Map inserted workout_exercise rows back to routine_exercises by (exercise_id + order_index + superset_group_id)
      const key = (exercise_id: any, order_index: any, superset_group_id: any) =>
        `${exercise_id ?? ''}::${order_index ?? ''}::${superset_group_id ?? ''}`;

      const insertedMap = new Map<string, any>();
      for (const row of insertedWorkoutExercises as any[]) {
        insertedMap.set(key(row.exercise_id, row.order_index, row.superset_group_id), row);
      }

      // 4) Bulk insert workout_sets (batched)
      const setsPayloads: any[] = [];
      for (const ex of reList) {
        const row = insertedMap.get(key(ex.exercise_id, ex.order_index, ex.superset_group_id));
        if (!row?.id) continue;

        const defaultSets: any[] = ex.default_sets || [];
        const schemeSets = Number(ex.exercises?.default_set_scheme?.sets ?? 0);
        const setsToCreate = schemeSets > 0 ? schemeSets : defaultSets.length > 0 ? defaultSets.length : 3;

        for (let i = 0; i < setsToCreate; i++) {
          const ds = defaultSets[i] || {};
          setsPayloads.push({
            workout_exercise_id: row.id,
            set_index: i,
            reps: ds.reps ?? ex.exercises?.default_reps ?? 0,
            weight: ds.weight ?? 0,
            rpe: null,
            is_completed: false,
          });
        }
      }

      // Supabase has payload limits; batch to stay safe
      const chunks = chunkArray(setsPayloads, 200);
      for (const c of chunks) {
        const { error: setErr } = await supabase.from('workout_sets').insert(c);
        if (setErr) console.error('Failed inserting workout sets (batch):', setErr);
      }

      // 5) Navigate to workout screen
      router.push(`/workout/${session.id}`);
    } finally {
      setStartingDayId(null);
    }
  };

  const renameRoutine = async (routineId: string, currentName: string) => {
    const next = window.prompt('Rename routine', currentName);
    if (!next) return;
    const name = next.trim();
    if (!name) return;

    const { error } = await supabase.from('routines').update({ name }).eq('id', routineId);
    if (error) {
      console.error('Rename failed:', error);
      return;
    }

    setOpenMenuCardId(null);
    await loadRoutinesAndDays();
  };

  const duplicateRoutine = async (routineId: string) => {
    const routine = routines.find((r: any) => r.id === routineId);
    if (!routine) return;

    const newName = `${routine.name || 'Routine'} Copy`;

    const { data: newRoutine, error: rErr } = await supabase
      .from('routines')
      .insert({ name: newName })
      .select()
      .single();

    if (rErr || !newRoutine?.id) {
      console.error('Duplicate routine (create) failed:', rErr);
      return;
    }

    const { data: oldDays, error: dErr } = await supabase
      .from('routine_days')
      .select('*')
      .eq('routine_id', routineId)
      .order('day_index', { ascending: true });

    if (dErr) {
      console.error('Duplicate routine (load days) failed:', dErr);
      return;
    }

    for (const d of (oldDays || []) as any[]) {
      const payload: any = {
        routine_id: newRoutine.id,
        name: d.name,
        day_index: d.day_index,
      };

      // copy any other optional fields safely
      for (const k of Object.keys(d)) {
        if (['id', 'created_at', 'updated_at', 'routine_id'].includes(k)) continue;
        if (payload[k] !== undefined) continue;
        payload[k] = d[k];
      }

      const { data: newDay, error: ndErr } = await supabase
        .from('routine_days')
        .insert(payload)
        .select()
        .single();

      if (ndErr || !newDay?.id) {
        console.error('Duplicate routine (create day) failed:', ndErr);
        continue;
      }

      const { data: oldEx, error: exErr } = await supabase
        .from('routine_day_exercises')
        .select('*')
        .eq('routine_day_id', d.id)
        .order('order_index', { ascending: true });

      if (exErr) {
        console.error('Duplicate routine (load day exercises) failed:', exErr);
        continue;
      }

      for (const ex of (oldEx || []) as any[]) {
        const exPayload: any = { routine_day_id: newDay.id };
        for (const k of Object.keys(ex)) {
          if (['id', 'created_at', 'updated_at', 'routine_day_id'].includes(k)) continue;
          exPayload[k] = ex[k];
        }
        const { error: insErr } = await supabase.from('routine_day_exercises').insert(exPayload);
        if (insErr) console.error('Duplicate routine (insert day exercise) failed:', insErr);
      }
    }

    setOpenMenuCardId(null);
    await loadRoutinesAndDays();
  };

  const deleteRoutine = async (routineId: string) => {
    const ok = window.confirm('Delete this routine? This cannot be undone.');
    if (!ok) return;

    const { data: days } = await supabase.from('routine_days').select('id').eq('routine_id', routineId);
    const dayIds = (days || []).map((d: any) => d.id);

    if (dayIds.length > 0) {
      await supabase.from('routine_day_exercises').delete().in('routine_day_id', dayIds);
      await supabase.from('routine_days').delete().in('id', dayIds);
    }

    const { error } = await supabase.from('routines').delete().eq('id', routineId);
    if (error) {
      console.error('Delete routine failed:', error);
      return;
    }

    setOpenMenuCardId(null);
    await loadRoutinesAndDays();
  };

  const myRoutineCards = useMemo(() => {
    // routineDays already contains routineName/preview and day_index
    return routineDays;
  }, [routineDays]);

  return (
    <div className="min-h-screen bg-black text-white pb-20">
      <Navigation />

      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight">Workout</h1>

            <button
              onClick={() => setCollapsed((v) => !v)}
              className="mt-6 inline-flex items-center gap-2 text-white/80 hover:text-white"
            >
              <ChevronDown className={`w-5 h-5 transition-transform ${collapsed ? '-rotate-90' : 'rotate-0'}`} />
              <span className="text-lg font-semibold">My Routines</span>
              <span className="text-white/50 text-base">({myRoutineCards.length})</span>
            </button>
          </div>
        </div>

        {!collapsed && (
          <div className="mt-4 space-y-4">
            {loading && <div className="text-white/60">Loading routines…</div>}

            {!loading &&
              myRoutineCards.map((d) => (
                <div
                  key={d.id}
                  className="rounded-3xl p-6 bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 border border-white/10"
                >
                  <div className="flex items-start justify-between">
                    <div className="pr-4">
                      <div className="text-2xl font-extrabold">{getDayTitle(d)}</div>
                      <div className="mt-1 text-white/70 text-base">{d.routineName || 'Routine'}</div>
                      <div className="mt-1 text-white/60 text-base line-clamp-2">{d.preview || 'No exercises added yet'}</div>
                      <div className="mt-2 text-white/50 text-sm">
                        Last performed: {formatLastPerformed(lastPerformedByRoutineId[d.routine_id] ?? null)}
                      </div>
                    </div>

                    <div className="relative" data-routine-menu>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuCardId((cur) => (cur === d.id ? null : d.id));
                        }}
                        className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center text-white/80"
                        title="Routine actions"
                      >
                        <MoreHorizontal className="w-6 h-6" />
                      </button>

                      {openMenuCardId === d.id && (
                        <div className="absolute right-0 mt-2 w-44 rounded-xl border border-white/10 bg-gray-900/95 backdrop-blur shadow-lg overflow-hidden z-50">
                          <button
                            onClick={() => {
                              setOpenMenuCardId(null);
                              router.push(`/routines/${d.routine_id}`);
                            }}
                            className="w-full text-left px-4 py-3 text-sm text-white/90 hover:bg-white/10"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => renameRoutine(d.routine_id, d.routineName || 'Routine')}
                            className="w-full text-left px-4 py-3 text-sm text-white/90 hover:bg-white/10"
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => duplicateRoutine(d.routine_id)}
                            className="w-full text-left px-4 py-3 text-sm text-white/90 hover:bg-white/10"
                          >
                            Duplicate
                          </button>
                          <button
                            onClick={() => deleteRoutine(d.routine_id)}
                            className="w-full text-left px-4 py-3 text-sm text-red-300 hover:bg-white/10"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => startRoutineDay(d.routine_id, d.id)}
                    className="mt-4 w-full bg-sky-500 hover:bg-sky-400 text-white font-bold text-xl py-4 rounded-2xl"
                  >
                    Start Routine
                  </button>
                </div>
              ))}

            {!loading && myRoutineCards.length === 0 && (
              <div className="text-white/60">No routines found. Create a routine in the Routines tab.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
