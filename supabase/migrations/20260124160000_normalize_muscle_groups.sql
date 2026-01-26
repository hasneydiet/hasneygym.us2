/*
  Normalize muscle_group values in exercises to a single canonical list.
  This prevents duplicates across filters and when creating exercises.

  Canonical list:
  Chest, Upper Back, Shoulders, Biceps, Triceps, Forearms, Abs, Traps, Lats,
  Lower Back, Glutes, Quads, Hamstrings, Calves, Adductors, Abductors,
  Hip Flexors, Cardio
*/

update public.exercises
set muscle_group = case
  when muscle_group is null or btrim(muscle_group) = '' then null

  -- Chest
  when lower(btrim(muscle_group)) in ('chest','pec','pecs','pectorals') then 'Chest'

  -- Upper Back (merge generic Back into Upper Back)
  when lower(btrim(muscle_group)) in (
    'upper back','upperback','back','mid back','midback','middle back','rhomboids'
  ) then 'Upper Back'

  -- Lats
  when lower(btrim(muscle_group)) in ('lats','lat','latissimus','latissimus dorsi') then 'Lats'

  -- Lower Back
  when lower(btrim(muscle_group)) in ('lower back','lowerback','erectors','erector spinae','spinal erectors') then 'Lower Back'

  -- Shoulders
  when lower(btrim(muscle_group)) in ('shoulder','shoulders','delts','deltoids') then 'Shoulders'

  -- Arms
  when lower(btrim(muscle_group)) in ('bicep','biceps') then 'Biceps'
  when lower(btrim(muscle_group)) in ('tricep','triceps') then 'Triceps'
  when lower(btrim(muscle_group)) in ('forearm','forearms') then 'Forearms'

  -- Traps
  when lower(btrim(muscle_group)) in ('traps','trap','trapezius') then 'Traps'

  -- Core
  when lower(btrim(muscle_group)) in ('abs','ab','abdominal','abdominals','abdomen','core','obliques','oblique') then 'Abs'

  -- Glutes
  when lower(btrim(muscle_group)) in ('glute','glutes','gluteus') then 'Glutes'

  -- Quads
  when lower(btrim(muscle_group)) in ('quads','quad','quadriceps','quadricep','quadiceps','quadraceps','quadrceps') then 'Quads'

  -- Hamstrings
  when lower(btrim(muscle_group)) in ('hamstring','hamstrings') then 'Hamstrings'

  -- Calves
  when lower(btrim(muscle_group)) in ('calf','calves') then 'Calves'

  -- Adductors / Abductors
  when lower(btrim(muscle_group)) in ('adductor','adductors') then 'Adductors'
  when lower(btrim(muscle_group)) in ('abductor','abductors') then 'Abductors'

  -- Hip flexors
  when lower(btrim(muscle_group)) in ('hip flexor','hip flexors','hipflexor','hipflexors') then 'Hip Flexors'

  -- Cardio (also absorbs generic full-body buckets)
  when lower(btrim(muscle_group)) in ('cardio','conditioning','metcon','hiit','aerobic','full body','fullbody','full-body') then 'Cardio'

  else muscle_group
end;
