-- Class Timetable (Toddle-style recurring weekly bell schedule), distinct from
-- the date-based Schedule. Two tiers:
--   class_timetables  — one master template per grade+section (the bell/period
--                       grid, stored in period_defs; owned by school admin +
--                       homeroom teacher).
--   timetable_slots   — the subject in each day x period cell (subject teachers
--                       edit their own; homeroom teacher/admin edit any).
-- Run once in the Supabase SQL editor.

create table if not exists public.class_timetables (
  id           uuid        primary key default gen_random_uuid(),
  school_id    uuid        not null references public.schools(id) on delete cascade,
  grade        text        not null,
  section      text        not null default '',
  title        text,
  -- Ordered bell structure, e.g.
  -- [{"code":"P0","start":"08:25","end":"08:50","isBreak":false},
  --  {"code":"BRK","start":"10:30","end":"10:40","isBreak":true}, ...]
  period_defs  jsonb       not null default '[]'::jsonb,
  updated_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (school_id, grade, section)
);

create table if not exists public.timetable_slots (
  id            uuid        primary key default gen_random_uuid(),
  timetable_id  uuid        not null references public.class_timetables(id) on delete cascade,
  day_of_week   text        not null,   -- 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT'
  period_code   text        not null,   -- matches a period_defs[].code, e.g. 'P1'
  subject_name  text,
  room_name     text,
  teacher_id    uuid        references public.users(id) on delete set null,
  material_url  text,                   -- optional lesson attachment
  material_name text,
  color         text,                   -- optional teacher-chosen card colour (hex)
  updated_by    text,
  updated_at    timestamptz not null default now(),
  unique (timetable_id, day_of_week, period_code)
);

create index if not exists timetable_slots_tt_idx on public.timetable_slots (timetable_id);

-- Backend (service key) only.
alter table public.class_timetables enable row level security;
alter table public.timetable_slots enable row level security;
