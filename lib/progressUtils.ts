import { WorkoutSet } from './types';

export function computeExerciseMetrics(sets: WorkoutSet[]): {
  volume: number;
  bestSet: string;
  est1RM: number;
} {
  const completedSets = sets.filter(s => s.is_completed);
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

  const bestSet = bestWeight > -1 ? `${bestWeight}kg × ${bestReps}` : 'N/A';

  return {
    volume: Math.round(volume),
    bestSet,
    est1RM: Math.round(maxOneRM * 10) / 10,
  };
}
