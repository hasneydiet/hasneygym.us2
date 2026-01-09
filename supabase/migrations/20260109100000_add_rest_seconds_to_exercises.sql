-- Add per-exercise default rest timer (seconds)
-- This is used during workout logging to start the rest countdown after a completed set.

alter table if exists public.exercises
  add column if not exists rest_seconds integer not null default 60;

-- Backfill any existing rows (defensive)
update public.exercises
set rest_seconds = 60
where rest_seconds is null;
