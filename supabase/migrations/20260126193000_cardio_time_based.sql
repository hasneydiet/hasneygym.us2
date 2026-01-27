-- Cardio vs Strength
-- Cardio is time-based (duration_seconds on workout_exercises)
-- Strength remains set-based (workout_sets)

-- 1) Exercises: add exercise_type
alter table if exists public.exercises
  add column if not exists exercise_type text;

-- Backfill exercise_type from muscle_group
update public.exercises
set exercise_type = case
  when muscle_group = 'Cardio' then 'cardio'
  else 'strength'
end
where exercise_type is null;

-- Default + enforce valid values
alter table if exists public.exercises
  alter column exercise_type set default 'strength';

alter table if exists public.exercises
  alter column exercise_type set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'exercises_exercise_type_check'
  ) then
    alter table public.exercises
      add constraint exercises_exercise_type_check
      check (exercise_type in ('strength', 'cardio'));
  end if;
end $$;

-- 2) Workout exercises: add duration_seconds for cardio tracking
alter table if exists public.workout_exercises
  add column if not exists duration_seconds integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workout_exercises_duration_seconds_check'
  ) then
    alter table public.workout_exercises
      add constraint workout_exercises_duration_seconds_check
      check (duration_seconds is null or duration_seconds >= 0);
  end if;
end $$;
