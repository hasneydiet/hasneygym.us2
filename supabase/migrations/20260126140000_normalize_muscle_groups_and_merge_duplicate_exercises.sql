/*
  Normalize muscle_group values to the canonical set used in the UI, and merge duplicate exercises
  created under different muscle_group labels (e.g. "Quadriceps" vs "Quads").

  Notes:
  - No schema changes.
  - Updates references in routine_day_exercises and workout_exercises before deleting duplicates.
  - Duplicates are merged PER user_id by exercise name (case-insensitive).
*/

BEGIN;

-- 1) Normalize common legacy muscle_group values to canonical names.
UPDATE public.exercises
SET muscle_group = CASE
  WHEN lower(trim(muscle_group)) IN ('upper back','upper-back','upper_back','back') THEN 'Upper Back'
  WHEN lower(trim(muscle_group)) IN ('lower back','lower-back','lower_back') THEN 'Lower Back'
  WHEN lower(trim(muscle_group)) IN ('lat','lats') THEN 'Lats'
  WHEN lower(trim(muscle_group)) IN ('trap','traps','trapezius') THEN 'Traps'
  WHEN lower(trim(muscle_group)) IN ('quad','quads','quadricep','quadriceps') THEN 'Quads'
  WHEN lower(trim(muscle_group)) IN ('hamstring','hamstrings') THEN 'Hamstrings'
  WHEN lower(trim(muscle_group)) IN ('glute','glutes') THEN 'Glutes'
  WHEN lower(trim(muscle_group)) IN ('calf','calves') THEN 'Calves'
  WHEN lower(trim(muscle_group)) IN ('adductor','adductors') THEN 'Adductors'
  WHEN lower(trim(muscle_group)) IN ('abductor','abductors') THEN 'Abductors'
  WHEN lower(trim(muscle_group)) IN ('hip flexor','hip flexors','hip-flexors','hip_flexors') THEN 'Hip Flexors'
  WHEN lower(trim(muscle_group)) IN ('ab','abs','abdominal','abdominals','core','obliques') THEN 'Abs'
  WHEN lower(trim(muscle_group)) IN ('shoulder','shoulders','delt','delts','deltoids') THEN 'Shoulders'
  WHEN lower(trim(muscle_group)) IN ('chest','pec','pecs','pectorals') THEN 'Chest'
  WHEN lower(trim(muscle_group)) IN ('bicep','biceps') THEN 'Biceps'
  WHEN lower(trim(muscle_group)) IN ('tricep','triceps') THEN 'Triceps'
  WHEN lower(trim(muscle_group)) IN ('forearm','forearms') THEN 'Forearms'
  WHEN lower(trim(muscle_group)) IN ('cardio','conditioning','metcon','hiit','aerobic','full body','full-body','full_body') THEN 'Cardio'
  ELSE muscle_group
END
WHERE muscle_group IS NOT NULL AND trim(muscle_group) <> '';

-- 2) Merge duplicates created under different muscle groups.
--    Keep the smallest UUID (lexicographically) per user_id + lower(name).
WITH dups AS (
  SELECT
    user_id,
    lower(trim(name)) AS name_key,
    min(id) AS keep_id,
    array_agg(id) AS all_ids,
    count(*) AS cnt
  FROM public.exercises
  GROUP BY user_id, lower(trim(name))
  HAVING count(*) > 1
), mapping AS (
  SELECT
    d.user_id,
    d.keep_id,
    unnest(d.all_ids) AS dup_id
  FROM dups d
)
UPDATE public.routine_day_exercises rde
SET exercise_id = m.keep_id
FROM mapping m
WHERE rde.exercise_id = m.dup_id
  AND m.dup_id <> m.keep_id;

WITH dups AS (
  SELECT
    user_id,
    lower(trim(name)) AS name_key,
    min(id) AS keep_id,
    array_agg(id) AS all_ids
  FROM public.exercises
  GROUP BY user_id, lower(trim(name))
  HAVING count(*) > 1
), mapping AS (
  SELECT
    d.user_id,
    d.keep_id,
    unnest(d.all_ids) AS dup_id
  FROM dups d
)
UPDATE public.workout_exercises we
SET exercise_id = m.keep_id
FROM mapping m
WHERE we.exercise_id = m.dup_id
  AND m.dup_id <> m.keep_id;

WITH dups AS (
  SELECT
    user_id,
    lower(trim(name)) AS name_key,
    min(id) AS keep_id,
    array_agg(id) AS all_ids
  FROM public.exercises
  GROUP BY user_id, lower(trim(name))
  HAVING count(*) > 1
), mapping AS (
  SELECT
    d.user_id,
    d.keep_id,
    unnest(d.all_ids) AS dup_id
  FROM dups d
)
DELETE FROM public.exercises e
USING mapping m
WHERE e.id = m.dup_id
  AND m.dup_id <> m.keep_id;

COMMIT;
