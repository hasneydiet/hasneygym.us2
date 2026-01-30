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
    .select('id, exercise_id, order_index, default_sets, technique_tags, exercises(default_set_scheme, muscle_group, exercise_type)')
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

  const exercisesToInsert =
    (rdeRows || [])
      .filter((r: any) => r.exercise_id)
      .map((r: any) => ({
        workout_session_id: session.id,
        routine_day_exercise_id: r.id,
        exercise_id: r.exercise_id,
        order_index: r.order_index ?? 0,
        technique_tags:
          Array.isArray(r.technique_tags) && r.technique_tags.length > 0
            ? r.technique_tags
            : [prefByExerciseId[String(r.exercise_id)] ?? 'Normal-Sets'],
        // Cardio is time-based and has no sets.
        duration_seconds: 0,

      }));
  if (exercisesToInsert.length > 0) {
    // 3) Insert workout_exercises (return id + exercise_id)
    const { data: weRows, error: weErr } = await supabase
      .from('workout_exercises')
      .insert(exercisesToInsert)
      .select('id, exercise_id');

    if (weErr) throw weErr;


// Pull previous sets for each exercise (last time the SAME exercise was performed by this user).
// Used to:
// - show HEVY-style "Previous" values
// - seed today's workout with the SAME number of sets (and reps/weight) as last time
const prevSetsByExerciseId: Record<string, any[]> = {};
await Promise.all(
  exerciseIds.map(async (exerciseId) => {
    try {
      const { data: prevWe } = await supabase
        .from('workout_exercises')
        .select('id, workout_sessions!inner(started_at, user_id)')
        .eq('exercise_id', exerciseId)
        .eq('workout_sessions.user_id', userId)
        .lt('workout_sessions.started_at', session.started_at)
        .order('workout_sessions.started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const prevWorkoutExerciseId = (prevWe as any)?.id as string | undefined;
      if (!prevWorkoutExerciseId) return;

      const { data: prevSets } = await supabase
        .from('workout_sets')
        .select('set_index, reps, weight')
        .eq('workout_exercise_id', prevWorkoutExerciseId)
        .order('set_index');

      if (Array.isArray(prevSets) && prevSets.length > 0) {
        prevSetsByExerciseId[exerciseId] = prevSets as any[];
      }
    } catch {
      // best-effort; fall back to template defaults if anything fails
    }
  })
);
    // Build lookup by exercise_id so we know how many sets to create
    const rdeByExerciseId: Record<
      string,
      { default_sets: any[]; default_set_scheme: any | null; is_cardio: boolean }
    > = {};

    for (const row of rdeRows || []) {
      const exerciseId = (row as any).exercise_id as string | undefined;
      if (!exerciseId) continue;
      rdeByExerciseId[exerciseId] = {
        default_sets: Array.isArray((row as any).default_sets) ? (row as any).default_sets : [],
        default_set_scheme: (row as any).exercises?.default_set_scheme ?? null,
        is_cardio:
          (row as any)?.exercises?.exercise_type === 'cardio' || (row as any)?.exercises?.muscle_group === 'Cardio',
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

      // Cardio is time-based (no sets).
      if (meta?.is_cardio) continue;

let setsCount = 1;
let defaultReps = 0;

const prevSets = prevSetsByExerciseId[exerciseId] || null;
if (Array.isArray(prevSets) && prevSets.length > 0) {
  // HEVY behavior: seed with the SAME number of sets as last time.
  setsCount = Math.max(1, prevSets.length);
}

// If routine_day_exercises.default_sets is used (array), it wins (unless previous sets exist)
      if (!(Array.isArray(prevSets) && prevSets.length > 0) && Array.isArray(defaultSetsArray) && defaultSetsArray.length > 0) {
        setsCount = Math.max(1, defaultSetsArray.length);
      } else if (!(Array.isArray(prevSets) && prevSets.length > 0) && scheme && typeof scheme === 'object') {
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
reps: (() => {
  const p = Array.isArray(prevSets) ? (prevSets as any[])[i] : null;
  const pr = p ? Number((p as any).reps) : NaN;
  if (Number.isFinite(pr) && pr > 0) return pr;
  const r = Number(repsFromArray);
  if (Number.isFinite(r) && r > 0) return r;
  return defaultReps;
})(),
weight: (() => {
  const p = Array.isArray(prevSets) ? (prevSets as any[])[i] : null;
  const pw = p ? Number((p as any).weight) : NaN;
  if (Number.isFinite(pw) && pw >= 0) return pw;
  const w = Number(weightFromArray);
  if (Number.isFinite(w) && w >= 0) return w;
  return 0;
})(),
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
