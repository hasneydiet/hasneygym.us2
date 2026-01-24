export interface Profile {
  id: string;
  created_at: string;
}

export interface Exercise {
  id: string;
  created_by: string | null;
  name: string;
  muscle_group: string;
  muscle_section: string;
  equipment: string;
  notes: string;
  created_at: string;
  /** Default rest time after a completed set (in seconds). */
  rest_seconds?: number;
  default_technique_tags: string[];
  default_set_scheme: {
    sets?: number;
    reps?: number;
    restSeconds?: number;
    notes?: string;
  } | null;
}

export interface Routine {
  id: string;
  created_by: string | null;
  name: string;
  notes: string;
  created_at: string;
}

export interface RoutineDay {
  id: string;
  routine_id: string;
  day_index: number;
  name: string;
  created_at: string;
}

export interface RoutineDayExercise {
  id: string;
  routine_day_id: string;
  exercise_id: string;
  order_index: number;
  superset_group_id: string | null;
  default_sets: any[];
  created_at: string;
  exercises?: Exercise;
}

export interface WorkoutSession {
  id: string;
  user_id: string;
  routine_id: string | null;
  routine_day_id: string | null;
  started_at: string;
  ended_at: string | null;
  notes: string;
  routines?: Routine;
  routine_days?: RoutineDay;
}

export interface WorkoutExercise {
  id: string;
  workout_session_id: string;
  exercise_id: string;
  order_index: number;
  superset_group_id: string | null;
  technique_tags: string[];
  exercises?: Exercise;
}

export interface WorkoutSet {
  id: string;
  workout_exercise_id: string;
  set_index: number;
  reps: number;
  weight: number;
  rpe: number | null;
  is_completed: boolean;
  notes: string;
}

export const TECHNIQUE_TAGS = [
  'Normal-Sets',
  'Drop-Sets',
  'Rest-Pause',
  'GVT',
  'Myo-Reps',
  'Super-Sets',
  'Failure',
];

export interface ExerciseMetrics {
  volume: number;
  bestSet: string;
  est1RM: number;
}
