-- Normalize exercise equipment values to a strict allowed set.
-- Allowed values: barbell, body weight, cable, dumbbell, kettlebell, machine, smith machine
-- Disallowed/legacy values are mapped where possible; otherwise set to NULL.

begin;

-- 1) Normalize whitespace/case
update public.exercises
set equipment = lower(trim(equipment))
where equipment is not null
  and equipment <> lower(trim(equipment));

-- 2) Map known variants
update public.exercises
set equipment = 'body weight'
where equipment in ('bodyweight','body_weight','body-weight');

update public.exercises
set equipment = 'cable'
where equipment in ('cables','cable(s)');

-- 3) Remove disallowed values (set NULL so exercises remain available under "All equipment")
update public.exercises
set equipment = null
where equipment is not null
  and equipment not in ('barbell','body weight','cable','dumbbell','kettlebell','machine','smith machine');

-- 4) Enforce allowed set (NULL permitted)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'exercises_equipment_allowed'
      and conrelid = 'public.exercises'::regclass
  ) then
    alter table public.exercises
      add constraint exercises_equipment_allowed
      check (equipment is null or equipment in ('barbell','body weight','cable','dumbbell','kettlebell','machine','smith machine'));
  end if;
end $$;

commit;
