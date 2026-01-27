import { supabase } from '@/lib/supabase';

function safeInt(v: any, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i < 0 ? fallback : i;
}

export type StartWorkoutInput = {
  userId: string;
  routineId: string;
  routineDayId: string;
};

/**
 * Creates a workout session for the given routine day and seeds workout_exercises + workout_sets.
 * This mirrors the logic used on the Workout Start page so Dashboard can start workouts directly.
 */
export async function startWorkoutForDay(input: StartWorkoutInput): Promise<string> {
  const { userId, routineId, routineDayId } = input;

  // 1) Create session
  const { data: session, error: sessErr } = await supabase
    .from('workout_sessions')
    .insert({
      user_id: userId,
      routine_id: routineId,
      routine_day_id: routineDayId,
      started_at: new Date().toISOString(),
      ended_at: null,
      notes: '',
    })
    .select()
    .single();

  if (sessErr) throw sessErr;
  if (!session?.id) throw new Error('Failed to create workout session.');

    // 2) Pull routine_day_exercises + exercise metadata (including type for cardio)
  const { data: rdeRows, error: rdeErr } = await supabase
    .from('routine_day_exercises')
    .select('id, exercise_id, order_index, default_sets, technique_tags, exercises(default_set_scheme, exercise_type, muscle_group)')
    .eq('routine_day_id', routineDayId)
    .order('order_index', { ascending: true });

  if (rdeErr) throw rdeErr;

  // Smart defaults: if the routine template doesn't specify a technique, fall back to the user's last used technique for that exercise.
  const exerciseIds = (rdeRows || []).map((r: any) => r.exercise_id).filter(Boolean) as string[];
  const prefByExerciseId: Record<string, string> = {};
  if (exerciseIds.length > 0) {
    const { data: prefs } = await supabase
      .from('user_exercise_preferences')
      .select('exercise_id, technique')
      .eq('user_id', userId)
      .in('exercise_id', exerciseIds);

    for (const p of prefs || []) {
      const exId = (p as any).exercise_id as string | undefined;
      const t = (p as any).technique as string | undefined;
      if (exId && t) prefByExerciseId[exId] = String(t);
    }
  }

  // 3) Insert workout_exercises + workout_sets
  for (const r of (rdeRows || []).filter((x: any) => x.exercise_id)) {
    const exMeta = (r as any).exercises || {};
    const isCardio =
      (exMeta as any)?.exercise_type === 'cardio' || (exMeta as any)?.muscle_group === 'Cardio';

    const technique_tags =
      Array.isArray((r as any).technique_tags) && (r as any).technique_tags.length > 0
        ? (r as any).technique_tags
        : [prefByExerciseId[String((r as any).exercise_id)] ?? 'Normal-Sets'];

    const { data: weRow, error: weErr } = await supabase
      .from('workout_exercises')
      .insert({
        workout_session_id: session.id,
        routine_day_exercise_id: (r as any).id,
        exercise_id: (r as any).exercise_id,
        order_index: (r as any).order_index ?? 0,
        technique_tags,
        // Cardio is time-based: initialize duration at 0 and do NOT create sets
        duration_seconds: isCardio ? 0 : null,
      })
      .select('id')
      .single();

    if (weErr) throw weErr;
    if (!weRow?.id) throw new Error('Failed to create workout exercise.');

    // Strength: seed starter sets; Cardio: none.
    if (isCardio) continue;

    const scheme = (exMeta as any)?.default_set_scheme ?? null;
    const defaultSetsArray = Array.isArray((r as any).default_sets) ? (r as any).default_sets : [];

    let setsCount = 1;
    let defaultReps = 0;

    // If routine_day_exercises.default_sets is used (array), it wins
    if (Array.isArray(defaultSetsArray) && defaultSetsArray.length > 0) {
      setsCount = Math.max(1, defaultSetsArray.length);
    } else if (scheme && typeof scheme === 'object') {
      setsCount = Math.max(1, safeInt((scheme as any).sets, 1));
    }

    if (scheme && typeof scheme === 'object') {
      defaultReps = Math.max(0, safeInt((scheme as any).reps, 0));
    }

    const setsToInsert: any[] = [];
    for (let i = 0; i < setsCount; i++) {
      const fromDefaultArray = Array.isArray(defaultSetsArray) ? defaultSetsArray[i] : null;
      const repsFromArray =
        fromDefaultArray && typeof fromDefaultArray === 'object' ? (fromDefaultArray as any).reps : undefined;
      const weightFromArray =
        fromDefaultArray && typeof fromDefaultArray === 'object' ? (fromDefaultArray as any).weight : undefined;

      setsToInsert.push({
        workout_exercise_id: weRow.id,
        set_index: i,
        reps: Number.isFinite(Number(repsFromArray)) ? Number(repsFromArray) : defaultReps,
        weight: Number.isFinite(Number(weightFromArray)) ? Number(weightFromArray) : 0,
        rpe: null,
        is_completed: false,
      });
    }

    if (setsToInsert.length > 0) {
      const { error: wsErr } = await supabase.from('workout_sets').insert(setsToInsert);
      if (wsErr) throw wsErr;
    }
  }

  return String(session.id);
}
