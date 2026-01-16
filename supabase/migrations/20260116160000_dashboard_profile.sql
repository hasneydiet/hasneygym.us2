/*
  # Dashboard profile fields + avatars bucket

  Adds profile fields used by the Dashboard "Profile" card.
  Creates a Storage bucket for avatar/badge images and RLS policies.
*/

-- 1) Extend profiles table
alter table public.profiles
  add column if not exists full_name text,
  add column if not exists goal text,
  add column if not exists goal_start date,
  add column if not exists goal_end date,
  add column if not exists avatar_url text;

-- Allowed goal values (or NULL)
alter table public.profiles
  drop constraint if exists profiles_goal_allowed;

alter table public.profiles
  add constraint profiles_goal_allowed
  check (
    goal is null or goal in ('maintenance','recomposition','cut','bulking')
  );

-- 2) Create avatars bucket (public)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 3) Storage policies for avatars bucket
-- Note: Supabase Storage uses RLS on storage.objects.

do $$
begin
  -- Public read
  begin
    create policy "Avatar images are publicly readable"
      on storage.objects for select
      using (bucket_id = 'avatars');
  exception when duplicate_object then null;
  end;

  -- Authenticated users can upload their own avatars
  begin
    create policy "Users can upload avatars"
      on storage.objects for insert
      to authenticated
      with check (bucket_id = 'avatars' and owner = auth.uid());
  exception when duplicate_object then null;
  end;

  -- Authenticated users can update their own avatars
  begin
    create policy "Users can update their own avatars"
      on storage.objects for update
      to authenticated
      using (bucket_id = 'avatars' and owner = auth.uid())
      with check (bucket_id = 'avatars' and owner = auth.uid());
  exception when duplicate_object then null;
  end;

  -- Authenticated users can delete their own avatars
  begin
    create policy "Users can delete their own avatars"
      on storage.objects for delete
      to authenticated
      using (bucket_id = 'avatars' and owner = auth.uid());
  exception when duplicate_object then null;
  end;
end $$;
