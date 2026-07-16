-- Adds the school_admin role to users.role (V1 tenant model: schools table +
-- users.school_id FK + strict server-side scoping — see services/adminScope.js).
-- Applied to production 2026-07-12 after a defensive check confirmed the only
-- existing role values were student/parent/teacher/super_admin (all of which
-- remain valid, so the validating constraint swap is safe).
-- Kept here for reference / new environments.

alter table public.users drop constraint users_role_check;
alter table public.users add constraint users_role_check
  check (role = any (array['student'::text, 'parent'::text, 'teacher'::text, 'school_admin'::text, 'super_admin'::text]));
