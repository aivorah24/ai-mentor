-- Normalizes the free-text users.school column into a real schools table so
-- announcement targeting (and anything else school-scoped later) can use a
-- stable school_id FK instead of matching on inconsistent strings like
-- "TSRA" vs "tsra" vs "TSRA Hyderabad". Additive only — users.school (text)
-- is left in place untouched so no existing code breaks.
-- Run this once in the Supabase SQL editor, before announcements.sql.

create table if not exists public.schools (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness so "ABC School" and "abc school" collapse to one row.
create unique index if not exists schools_name_lower_idx on public.schools (lower(trim(name)));

-- Backfill: one schools row per distinct non-empty users.school value.
insert into public.schools (name)
select distinct trim(school)
from public.users
where school is not null and trim(school) <> ''
on conflict (lower(trim(name))) do nothing;

-- Link users to their school row. Nullable — students/parents/teachers with no
-- school set yet, or who never match a row, simply get no school_id (global-only
-- announcements still reach them).
alter table public.users add column if not exists school_id uuid references public.schools(id);

update public.users u
set school_id = s.id
from public.schools s
where u.school is not null
  and trim(u.school) <> ''
  and lower(trim(u.school)) = lower(trim(s.name))
  and u.school_id is distinct from s.id;

create index if not exists users_school_id_idx on public.users (school_id);

alter table public.schools enable row level security;
-- No policies => anon/authenticated clients get nothing directly; service role
-- (used by the backend) bypasses RLS, matching every other table in this app.
