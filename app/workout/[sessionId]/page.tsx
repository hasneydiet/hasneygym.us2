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
  const [prevSetsByExercise, setPrevSetsByExercise] = useState<Record<string, WorkoutSet[]>>({});
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});

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
    for (const ex of exData) {
      const { data: setsData } = await supabase
        .from('workout_sets')
        .select('*')
        .eq('workout_exercise_id', ex.id)
        .order('set_index');

      setsMap[ex.id] = setsData || [];
    }
    setSets(setsMap);

    await loadPreviousSetsForExercises(exData, sessionData.started_at);

    if (typeof (globalThis as any).loadLastTimeData === 'function') {
      const res = await (globalThis as any).loadLastTimeData(exData, sessionData.started_at);
      if (res) setLastTimeData(res);
    }
  };

  const loadPreviousSetsForExercises = async (exData: WorkoutExercise[], startedAt: string) => {
    setPrevSetsByExercise({});

    const entries = await Promise.all(
      exData.map(async (ex) => {
        const exerciseId = ex.exercise_id;
        if (!exerciseId) return [ex.id, []] as [string, WorkoutSet[]];

        const { data: prevSessions } = await supabase
          .from('workout_sessions')
          .select('id, started_at')
          .lt('started_at', startedAt)
          .order('started_at', { ascending: false })
          .limit(25);

        let prevWorkoutExerciseId: string | null = null;

        for (const s of prevSessions || []) {
          const { data } = await supabase
            .from('workout_exercises')
            .select('id')
            .eq('workout_session_id', s.id)
            .eq('exercise_id', exerciseId)
            .limit(1)
            .maybeSingle();

          if (data?.id) {
            prevWorkoutExerciseId = data.id;
            break;
          }
        }

        if (!prevWorkoutExerciseId) return [ex.id, []] as [string, WorkoutSet[]];

        const { data: prevSets } = await supabase
          .from('workout_sets')
          .select('*')
          .eq('workout_exercise_id', prevWorkoutExerciseId)
          .order('set_index');

        return [ex.id, prevSets || []] as [string, WorkoutSet[]];
      })
    );

    const map: Record<string, WorkoutSet[]> = {};
    for (const [k, v] of entries) map[k] = v;
    setPrevSetsByExercise(map);
  };

  const saveSet = async (setId: string, field: string, value: any) => {
    setSets((prev) => {
      const next: typeof prev = {};
      for (const exId of Object.keys(prev)) {
        next[exId] = prev[exId].map((s: any) => (s.id === setId ? { ...s, [field]: value } : s));
      }
      return next;
    });

    const { error } = await supabase.from('workout_sets').update({ [field]: value }).eq('id', setId);
    if (error) loadWorkout();
  };

  const endWorkout = async () => {
    await supabase.from('workout_sessions').update({ ended_at: new Date().toISOString() }).eq('id', sessionId);
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
        rpe: null,
      })
      .select()
      .single();

    if (data) loadWorkout();
  };

  const isPR = (current: any, prev: any) => {
    if (!prev) return false;
    const cw = Number(current?.weight ?? 0);
    const cr = Number(current?.reps ?? 0);
    const pw = Number(prev?.weight ?? 0);
    const pr = Number(prev?.reps ?? 0);
    if (!cw || !cr || (!pw && !pr)) return false;
    return (cw > pw && cr >= pr) || (cr > pr && cw >= pw);
  };

  const formatPrevLine = (value: number | null | undefined) => {
    if (value === null || value === undefined) return null;
    return <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Prev: {value}</div>;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto px-4 py-6">

        <div className="flex justify-between mb-6">
          <h1 className="text-2xl font-bold">{session?.routines?.name || 'Workout'}</h1>
          <button onClick={endWorkout} className="px-4 py-2 bg-gray-900 text-white rounded">
            End Workout
          </button>
        </div>

        {exercises.map((exercise: any) => {
          const prevSets = prevSetsByExercise[exercise.id] || [];

          return (
            <div key={exercise.id} className="bg-white dark:bg-gray-800 rounded-lg p-4 mb-6">
              <h3 className="text-lg font-bold mb-4">{exercise.exercises?.name}</h3>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2">Set</th>
                    <th className="px-2">Reps</th>
                    <th className="px-2">Weight</th>
                    <th className="px-2 text-center">Done</th>
                    <th className="px-2 text-center">Del</th>
                  </tr>
                </thead>

                <tbody>
                  {(sets[exercise.id] || []).map((set: any, idx: number) => {
                    const prev = prevSets[idx];
                    const pr = isPR(set, prev);

                    return (
                      <tr key={set.id} className={pr ? 'bg-green-50 dark:bg-green-900/20' : ''}>
                        <td className="px-2 font-bold">
                          {idx + 1} {pr && <span className="text-green-600 text-xs ml-1">PR</span>}
                        </td>

                        <td className="px-2">
                          <input
                            type="number"
                            value={getDraftValue(set.id, 'reps', set.reps)}
                            onChange={(e) => setDraftValue(set.id, 'reps', e.target.value)}
                            onBlur={() => {
                              saveSet(set.id, 'reps', Number(getDraftValue(set.id, 'reps', set.reps)) || 0);
                              clearDraftField(set.id, 'reps');
                            }}
                            className={`w-full border rounded text-center ${pr ? 'border-green-500' : ''}`}
                          />
                          {formatPrevLine(prev?.reps)}
                        </td>

                        <td className="px-2">
                          <input
                            type="number"
                            value={getDraftValue(set.id, 'weight', set.weight)}
                            onChange={(e) => setDraftValue(set.id, 'weight', e.target.value)}
                            onBlur={() => {
                              saveSet(set.id, 'weight', Number(getDraftValue(set.id, 'weight', set.weight)) || 0);
                              clearDraftField(set.id, 'weight');
                            }}
                            className={`w-full border rounded text-center ${pr ? 'border-green-500' : ''}`}
                          />
                          {formatPrevLine(prev?.weight)}
                        </td>

                        <td className="px-2 text-center">
                          <button onClick={() => saveSet(set.id, 'is_completed', !set.is_completed)}>✓</button>
                        </td>

                        <td className="px-2 text-center">
                          <button onClick={() => deleteSet(exercise.id, set.id)}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <button onClick={() => addSet(exercise.id)} className="mt-3 px-4 py-2 bg-gray-900 text-white rounded">
                + Add Set
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
