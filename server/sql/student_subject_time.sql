-- Per-subject Learning Path time (Maths: Xm, English: Ym, ...), so a teacher
-- scoped to specific subjects only sees time/progress for those subjects, and
-- time spent on subjects outside their scope (e.g. Physical Education) is
-- tracked separately rather than blended into one combined number.
-- Run once in the Supabase SQL editor.

create table if not exists public.student_subject_time (
  student_id  uuid    not null,
  subject     text    not null,
  minutes     integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (student_id, subject)
);

alter table public.student_subject_time enable row level security;
