-- Adds teacher-scoped targeting so a teacher can send an announcement to
-- only the parents of students assigned to them (server/routes/announcements.js
-- scopeTargets()/matchesAudience()). A target row with teacher_id set means
-- "only parents of students taught by this teacher" (role is always 'parent'
-- for these rows — enforced server-side, not by this constraint).
-- Run once in the Supabase SQL editor, after sql/announcements.sql.

alter table public.announcement_targets
  add column if not exists teacher_id uuid references public.users(id);

create index if not exists announcement_targets_teacher_idx
  on public.announcement_targets (teacher_id);
