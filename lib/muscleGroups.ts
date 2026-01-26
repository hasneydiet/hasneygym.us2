// Centralized muscle group options + normalization.
// Keep this list consistent across the entire app to avoid duplicates.

export const CANONICAL_MUSCLE_GROUPS: ReadonlyArray<string> = [
  'Chest',
  'Upper Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Forearms',
  'Abs',
  'Traps',
  'Lats',
  'Lower Back',
  'Glutes',
  'Quads',
  'Hamstrings',
  'Calves',
  'Adductors',
  'Abductors',
  'Hip Flexors',
  'Cardio',
];

const normalizeKey = (v?: string | null) => String(v ?? '').trim().toLowerCase();

// Maps common synonyms/variants to the canonical muscle groups.
export function normalizeMuscleGroup(input?: string | null): string {
  const s = normalizeKey(input);
  if (!s) return '';

  // Direct canonical matches
  for (const g of CANONICAL_MUSCLE_GROUPS) {
    if (normalizeKey(g) === s) return g;
  }

  // Common variants / legacy values
  if (['upper back', 'upper-back', 'upper_back', 'back'].includes(s)) return 'Upper Back';
  if (['lower back', 'lower-back', 'lower_back'].includes(s)) return 'Lower Back';
  if (['lat', 'lats'].includes(s)) return 'Lats';
  if (['trap', 'traps', 'trapezius'].includes(s)) return 'Traps';

  if (['quad', 'quads', 'quadricep', 'quadriceps'].includes(s)) return 'Quads';

  if (['hamstring', 'hamstrings'].includes(s)) return 'Hamstrings';

  if (['glute', 'glutes'].includes(s)) return 'Glutes';

  if (['calf', 'calves'].includes(s)) return 'Calves';

  if (['adductor', 'adductors'].includes(s)) return 'Adductors';
  if (['abductor', 'abductors'].includes(s)) return 'Abductors';

  if (['hip flexor', 'hip flexors', 'hip-flexors', 'hip_flexors'].includes(s)) return 'Hip Flexors';

  if (['ab', 'abs', 'abdominal', 'abdominals', 'abdominals', 'core', 'obliques'].includes(s)) return 'Abs';

  if (['shoulder', 'shoulders', 'delt', 'delts', 'deltoids'].includes(s)) return 'Shoulders';
  if (['chest', 'pec', 'pecs', 'pectorals'].includes(s)) return 'Chest';
  if (['bicep', 'biceps'].includes(s)) return 'Biceps';
  if (['tricep', 'triceps'].includes(s)) return 'Triceps';
  if (['forearm', 'forearms'].includes(s)) return 'Forearms';

  if (['cardio', 'conditioning', 'metcon', 'hiit', 'aerobic', 'full body', 'full-body', 'full_body'].includes(s)) return 'Cardio';

  // Unknown / custom values: keep user input so we don't break existing data.
  // (UI menus use canonical list; db migration will normalize common variants.)
  return input?.trim() || '';
}
