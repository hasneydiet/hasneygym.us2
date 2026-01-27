import { WorkoutSet } from './types';

function _compute(sets: WorkoutSet[]) {
  const completedSets = sets.filter((s) => s.is_completed);
  const setsToUse = completedSets.length > 0 ? completedSets : sets;

  let volume = 0;
  let bestWeight = -1;
  let bestReps = 0;
  let maxOneRM = 0;

  for (const set of setsToUse) {
    if (set.weight != null && set.reps != null) {
      volume += set.weight * set.reps;

      if (set.weight > bestWeight || (set.weight === bestWeight && set.reps > bestReps)) {
        bestWeight = set.weight;
        bestReps = set.reps;
      }

      if (set.reps >= 1 && set.reps <= 12) {
        const oneRM = set.weight * (1 + set.reps / 30);
        if (oneRM > maxOneRM) {
          maxOneRM = oneRM;
        }
      }
    }
  }

  return {
    volume: Math.round(volume),
    bestWeight,
    bestReps,
    est1RM: Math.round(maxOneRM * 10) / 10,
  };
}

export function computeExerciseMetrics(sets: WorkoutSet[]): {
  volume: number;
  bestSet: string;
  est1RM: number;
} {
  const r = _compute(sets);
  const bestSet = r.bestWeight > -1 ? `${r.bestWeight}kg × ${r.bestReps}` : 'N/A';
  return { volume: r.volume, bestSet, est1RM: r.est1RM };
}

/**
 * More detailed metrics used for PR detection & analytics.
 *
 * Note: The app stores weights as numbers without enforcing units.
 * This function returns numeric values only; presentation should decide units.
 */
export function computeExerciseMetricsDetailed(sets: WorkoutSet[]): {
  volume: number;
  bestWeight: number;
  bestReps: number;
  est1RM: number;
} {
  return _compute(sets);
}
