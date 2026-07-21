-- B2C → B2B conversion bridge. When an independent (self-registered) user asks
-- to join an official school, we record a pending request here for a School
-- Admin to approve. On approval the backend stamps users.school_id, converting
-- the account from B2C to B2B (unlocking My Classes, Attendance, and school
-- announcements). Run this once in the Supabase SQL editor.

create table if not exists public.school_access_requests (
  id           uuid        primary key default gen_random_uuid(),
  user_email   text        not null,
  school_id    uuid        not null references public.schools(id) on delete cascade,
  grade        text,                                   -- requested grade  (free text, e.g. 'PYP 4')
  section      text,                                   -- requested section (e.g. 'A')
  status       text        not null default 'pending', -- 'pending' | 'approved' | 'rejected'
  reviewed_by  text,                                   -- admin email who actioned it
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  -- One live (pending) request per user+school at a time; resolved rows are kept
  -- for history and don't block a re-request.
  unique (user_email, school_id, status)
);

create index if not exists sar_school_status_idx on public.school_access_requests (school_id, status);
create index if not exists sar_user_idx on public.school_access_requests (user_email);

-- Backend (service key) only — anon/authenticated clients get nothing.
alter table public.school_access_requests enable row level security;
