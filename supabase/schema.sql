-- ─── DeenHabit: Supabase Schema ──────────────────────────────────────────────
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run

-- 1. Create the habit_data table
create table if not exists public.habit_data (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  payload     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  constraint habit_data_user_unique unique (user_id)
);

create index if not exists habit_data_user_id_idx on public.habit_data(user_id);
alter table public.habit_data enable row level security;

create policy "Users can read own habit data"
  on public.habit_data for select using (auth.uid() = user_id);
create policy "Users can insert own habit data"
  on public.habit_data for insert with check (auth.uid() = user_id);
create policy "Users can update own habit data"
  on public.habit_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own habit data"
  on public.habit_data for delete using (auth.uid() = user_id);

-- 2. Create the profiles table
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  profile     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  constraint profiles_user_unique unique (user_id)
);

create index if not exists profiles_user_id_idx on public.profiles(user_id);
alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select using (auth.uid() = user_id);
create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = user_id);
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own profile"
  on public.profiles for delete using (auth.uid() = user_id);

-- 3. Auto-update updated_at trigger (shared function)
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger habit_data_updated_at
  before update on public.habit_data
  for each row execute procedure public.handle_updated_at();

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();
