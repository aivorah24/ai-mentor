-- Adds the Workspace Settings fields a school administrator can edit
-- (Academic year, Contact email) alongside the existing id/name/curriculum
-- columns on public.schools. Additive only.
-- Run this once in the Supabase SQL editor.

alter table public.schools add column if not exists academic_year text;
alter table public.schools add column if not exists contact_email text;
