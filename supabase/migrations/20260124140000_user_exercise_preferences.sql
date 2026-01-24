-- Stores per-user "smart defaults" for exercises (e.g., last used set technique).
-- Used to prefill technique when adding an exercise or when a routine template does not specify one.

create table if not exists public.user_exercise_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  technique text not null default 'Normal-Sets',
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

alter table public.user_exercise_preferences enable row level security;

-- Users can read their own preferences
create policy if not exists "user_exercise_preferences_select_own"
on public.user_exercise_preferences
for select
to authenticated
using (auth.uid() = user_id);

-- Users can insert their own preferences
create policy if not exists "user_exercise_preferences_insert_own"
on public.user_exercise_preferences
for insert
to authenticated
with check (auth.uid() = user_id);

-- Users can update their own preferences
create policy if not exists "user_exercise_preferences_update_own"
on public.user_exercise_preferences
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Users can delete their own preferences
create policy if not exists "user_exercise_preferences_delete_own"
on public.user_exercise_preferences
for delete
to authenticated
using (auth.uid() = user_id);

create index if not exists idx_user_exercise_preferences_exercise
on public.user_exercise_preferences (exercise_id);
