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

  // 2) Pull routine_day_exercises + exercise default scheme
  const { data: rdeRows, error: rdeErr } = await supabase
    .from('routine_day_exercises')
    .select('exercise_id, order_index, default_sets, exercises(default_set_scheme)')
    .eq('routine_day_id', routineDayId)
    .order('order_index', { ascending: true });

  if (rdeErr) throw rdeErr;

  const exercisesToInsert =
    (rdeRows || [])
      .filter((r: any) => r.exercise_id)
      .map((r: any) => ({
        workout_session_id: session.id,
        exercise_id: r.exercise_id,
        order_index: r.order_index ?? 0,
        technique_tags: [],
      })) || [];

  if (exercisesToInsert.length > 0) {
    // 3) Insert workout_exercises (return id + exercise_id)
    const { data: weRows, error: weErr } = await supabase
      .from('workout_exercises')
      .insert(exercisesToInsert)
      .select('id, exercise_id');

    if (weErr) throw weErr;

    // Build lookup by exercise_id so we know how many sets to create
    const rdeByExerciseId: Record<string, { default_sets: any[]; default_set_scheme: any | null }> = {};

    for (const row of rdeRows || []) {
      const exerciseId = (row as any).exercise_id as string | undefined;
      if (!exerciseId) continue;
      rdeByExerciseId[exerciseId] = {
        default_sets: Array.isArray((row as any).default_sets) ? (row as any).default_sets : [],
        default_set_scheme: (row as any).exercises?.default_set_scheme ?? null,
      };
    }

    // 4) Insert starter sets (N sets per exercise based on default scheme)
    const setsToInsert: any[] = [];

    for (const we of weRows || []) {
      const workoutExerciseId = (we as any).id as string;
      const exerciseId = (we as any).exercise_id as string;

      const meta = rdeByExerciseId[exerciseId];
      const scheme = meta?.default_set_scheme || null;
      const defaultSetsArray = meta?.default_sets || [];

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

      for (let i = 0; i < setsCount; i++) {
        const fromDefaultArray = Array.isArray(defaultSetsArray) ? defaultSetsArray[i] : null;
        const repsFromArray =
          fromDefaultArray && typeof fromDefaultArray === 'object' ? (fromDefaultArray as any).reps : undefined;
        const weightFromArray =
          fromDefaultArray && typeof fromDefaultArray === 'object' ? (fromDefaultArray as any).weight : undefined;

        setsToInsert.push({
          workout_exercise_id: workoutExerciseId,
          set_index: i,
          reps: Number.isFinite(Number(repsFromArray)) ? Number(repsFromArray) : defaultReps,
          weight: Number.isFinite(Number(weightFromArray)) ? Number(weightFromArray) : 0,
          rpe: null,
          is_completed: false,
        });
      }
    }

    if (setsToInsert.length > 0) {
      const { error: wsErr } = await supabase.from('workout_sets').insert(setsToInsert);
      if (wsErr) throw wsErr;
    }
  }

  return String(session.id);
}
