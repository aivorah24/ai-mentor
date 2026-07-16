-- Logs every bulk-import run (students or teachers) so School Administrators
-- can see what was imported, by whom, and with what result. Written once by
-- the server at the end of POST /school-admin/students/bulk and
-- /school-admin/teachers/bulk — never client-writable.
-- Run this once in the Supabase SQL editor.

create table if not exists public.import_runs (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id),
  type           text not null check (type in ('students', 'teachers')),
  file_name      text not null,
  run_by_email   text not null,
  imported_count int not null default 0,
  skipped_count  int not null default 0,
  status         text not null,
  created_at     timestamptz not null default now()
);

create index if not exists import_runs_school_id_idx on public.import_runs (school_id, created_at desc);

alter table public.import_runs enable row level security;
-- No policies => anon/authenticated clients get nothing directly; service
-- role (used by the backend) bypasses RLS, matching every other table here.
