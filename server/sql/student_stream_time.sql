-- Adds per-stream time tracking (Assignments, Challenges) alongside the
-- existing study_time_minutes / learning_path_minutes columns, so the
-- teacher dashboard can show real time spent per activity stream instead
-- of only an aggregate "Typical Study Time".
-- Run once in the Supabase SQL editor.

alter table public.student_stats
  add column if not exists assignment_time_minutes integer not null default 0,
  add column if not exists challenge_time_minutes   integer not null default 0;
