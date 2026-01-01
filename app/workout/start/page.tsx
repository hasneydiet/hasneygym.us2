'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { Routine, RoutineDay } from '@/lib/types';
import { ChevronDown, Plus, Search, MoreHorizontal } from 'lucide-react';

export const dynamic = 'force-dynamic';

type RoutineDayCard = RoutineDay & {
  routineName?: string;
  preview?: string;
  exerciseCount?: number;
};

export default function StartWorkoutPage() {
  const router = useRouter();

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routineDays, setRoutineDays] = useState<RoutineDayCard[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);

  // ✅ For "..." menu per routine
  const [openMenuRoutineId, setOpenMenuRoutineId] = useState<string | null>(null);

  // ✅ Last performed date per routine
  const [lastPerformedByRoutineId, setLastPerformedByRoutineId] = useState<Record<string, string | null>>({});


  useEffect(() => {
    loadRoutinesAndDays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      // Close any open menu when tapping outside
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest?.('[data-routine-menu]')) return;
      setOpenMenuRoutineId(null);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);


  const loadRoutinesAndDays = async () => {
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    // 1) routines
    const { data: routinesData } = await supabase
      .from('routines')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    const routinesList = (routinesData || []) as Routine[];
    setRoutines(routinesList);

    // ✅ last performed session per routine (most recent started_at where ended_at is not null)
    if (routinesList.length > 0) {
      const { data: sessionRows } = await supabase
        .from('workout_sessions')
        .select('routine_id, started_at, ended_at')
        .in('routine_id', routinesList.map((r) => r.id))
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(200);

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

    // 2) routine days
    const { data: daysData } = await supabase
      .from('routine_days')
      .select('*')
      .in('routine_id', routinesList.map((r) => r.id))
      .order('routine_id', { ascending: true })
      .order('day_index', { ascending: true });

    const days = (daysData || []) as RoutineDay[];

    // 3) build previews (safe: small extra queries per day)
    const cards: RoutineDayCard[] = await Promise.all(
      days.map(async (d) => {
        const { data: exRows } = await supabase
          .from('routine_day_exercises')
          .select('order_index, exercises(name)')
          .eq('routine_day_id', d.id)
          .order('order_index', { ascending: true })
          .limit(6);

        const names =
          (exRows || [])
            .map((x: any) => x.exercises?.name)
            .filter(Boolean) as string[];

        const preview = names.slice(0, 3).join(', ');
        const more = names.length > 3 ? '…' : '';
        return {
          ...d,
          routineName: routineNameById[d.routine_id] || 'Routine',
          preview: preview ? preview + more : '',
          exerciseCount: names.length,
        };
      })
    );

    setRoutineDays(cards);
    setLoading(false);
  };

  const startRoutineDay = async (routineId: string, routineDayId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: session, error: sessionError } = await supabase
      .from('workout_sessions')
      .insert({
        user_id: user.id,
        routine_id: routineId,
        routine_day_id: routineDayId,
      })
      .select()
      .single();

    if (sessionError) {
      console.error('Failed to create session:', sessionError);
      return;
    }
    if (!session) return;

    const { data: routineExercises, error: rexError } = await supabase
      .from('routine_day_exercises')
      .select('*, exercises(*)')
      .eq('routine_day_id', routineDayId)
      .order('order_index', { ascending: true });

    if (rexError) {
      console.error('Failed to load routine exercises:', rexError);
      return;
    }

    if (routineExercises && routineExercises.length > 0) {
      for (const ex of routineExercises as any[]) {
        const techniqueTags = ex.exercises?.default_technique_tags || [];

        const { data: workoutExercise, error: weError } = await supabase
          .from('workout_exercises')
          .insert({
            workout_session_id: session.id,
            exercise_id: ex.exercise_id,
            order_index: ex.order_index,
            superset_group_id: ex.superset_group_id,
            technique_tags: techniqueTags,
          })
          .select()
          .single();

        if (weError) {
          console.error('Failed to create workout exercise:', weError);
          continue;
        }

        if (workoutExercise) {
          const defaultSets: any[] = ex.default_sets || [];
          const schemeSets = Number(ex.exercises?.default_set_scheme?.sets ?? 0);
          const setsToCreate =
            schemeSets > 0 ? schemeSets : (defaultSets.length > 0 ? defaultSets.length : 3);

          const defaultReps = Number(ex.exercises?.default_set_scheme?.reps ?? 0);

          const setsToInsert = Array.from({ length: setsToCreate }).map((_, i) => ({
            workout_exercise_id: workoutExercise.id,
            set_index: i,
            reps: defaultSets?.[i]?.reps ?? defaultReps ?? 0,
            weight: 0,
            rpe: null,
            is_completed: false,
            notes: '',
          }));

          const { error: setErr } = await supabase.from('workout_sets').insert(setsToInsert);
          if (setErr) console.error('Failed to create workout sets:', setErr);
        }
      }
    }

    router.push(`/workout/${session.id}`);
  };

  const routineCountLabel = useMemo(() => {
    return `My Routines (${routineDays.length})`;
  }, [routineDays.length]);

  
  const formatLastPerformed = (iso: string | null | undefined) => {
    if (!iso) return 'Never';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '—';
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
    setOpenMenuRoutineId(null);
    await loadRoutinesAndDays();
  };

  const duplicateRoutine = async (routineId: string) => {
    // Clone routine -> days -> day exercises (no schema assumptions beyond what we read)
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

    // days
    const { data: oldDays, error: dErr } = await supabase
      .from('routine_days')
      .select('*')
      .eq('routine_id', routineId)
      .order('day_index', { ascending: true });

    if (dErr) {
      console.error('Duplicate routine (load days) failed:', dErr);
      return;
    }

    const dayIdMap: Record<string, string> = {};

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

      dayIdMap[d.id] = newDay.id;

      // day exercises for that day
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

    setOpenMenuRoutineId(null);
    await loadRoutinesAndDays();
  };

  const deleteRoutine = async (routineId: string) => {
    const ok = window.confirm('Delete this routine? This cannot be undone.');
    if (!ok) return;

    // Delete children first (safe even if FK cascade exists)
    const { data: days } = await supabase
      .from('routine_days')
      .select('id')
      .eq('routine_id', routineId);

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

    setOpenMenuRoutineId(null);
    await loadRoutinesAndDays();
  };


return (
    <AuthGuard>
      <div className="min-h-screen bg-black text-white pb-20">
        <Navigation />

        <div className="max-w-3xl mx-auto px-4 py-6">
          {/* Header like HEVY */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-extrabold tracking-tight">Workout</h1>
              <div className="mt-6 flex items-center justify-between">
                <h2 className="text-3xl font-extrabold">Routines</h2>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-2">
              {/* Placeholder for refresh / pro pill feel */}
              <button
                onClick={loadRoutinesAndDays}
                className="w-11 h-11 rounded-full border border-white/15 flex items-center justify-center hover:bg-white/5"
                title="Refresh"
              >
                ↻
              </button>
              <div className="px-3 py-1 rounded-full bg-yellow-400 text-black font-bold text-sm select-none">
                PRO
              </div>
            </div>
          </div>

          {/* Action pills */}
          <div className="mt-6 flex items-center gap-4">
            <button
              onClick={() => router.push('/routines')}
              className="flex-1 flex items-center justify-center gap-3 bg-white/10 hover:bg-white/15 rounded-2xl py-4"
            >
              <Plus className="w-5 h-5" />
              <span className="text-lg font-semibold">New Routine</span>
            </button>

            <button
              onClick={() => router.push('/exercises')}
              className="flex-1 flex items-center justify-center gap-3 bg-white/10 hover:bg-white/15 rounded-2xl py-4"
            >
              <Search className="w-5 h-5" />
              <span className="text-lg font-semibold">Explore</span>
            </button>
          </div>

          {/* Collapsible label */}
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="mt-6 flex items-center gap-2 text-white/70 hover:text-white"
          >
            <ChevronDown className={`w-5 h-5 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
            <span className="text-lg">{routineCountLabel}</span>
          </button>

          {/* List like HEVY */}
          {!collapsed && (
            <div className="mt-4 space-y-4">
              {loading && (
                <div className="text-white/60">Loading routines…</div>
              )}

              {!loading && routineDays.length === 0 && (
                <div className="text-white/60">
                  No routines yet. Tap <span className="text-white">New Routine</span> to create one.
                </div>
              )}

              {!loading &&
                routineDays.map((d) => (
                  <div
                    key={d.id}
                    className="bg-white/10 rounded-3xl p-5 border border-white/10"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-2xl font-extrabold">{d.name}</div>
                        <div className="mt-1 text-white/60 text-base line-clamp-2">
                          {d.preview || 'No exercises added yet'}
                        </div>
                        <div className="mt-2 text-white/50 text-sm">
                          Last performed: {formatLastPerformed(lastPerformedByRoutineId[d.routine_id] ?? null)}
                        </div>
                      </div>

                      <div className="relative" data-routine-menu>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuRoutineId((cur) => (cur === d.routine_id ? null : d.routine_id));
                          }}
                          className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center text-white/80"
                          title="Routine actions"
                        >
                          <MoreHorizontal className="w-6 h-6" />
                        </button>

                        {openMenuRoutineId === d.routine_id && (
                          <div className="absolute right-0 mt-2 w-44 rounded-xl border border-white/10 bg-gray-900/95 backdrop-blur shadow-lg overflow-hidden z-50">
                            <button
                              onClick={() => {
                                setOpenMenuRoutineId(null);
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
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
