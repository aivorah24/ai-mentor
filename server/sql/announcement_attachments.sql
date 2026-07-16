-- Attachments for announcements (parent handbooks, menus, brochures — PDFs
-- and images). Files live on Cloudinary (the app's storage convention, same
-- as message attachments in routes/messages.js); this table stores the URL
-- plus display metadata. Additive only — run once in the Supabase SQL editor,
-- after announcements.sql.

create table if not exists public.announcement_attachments (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  url             text not null,          -- Cloudinary secure_url
  file_name       text not null,
  file_type       text not null,          -- extension: pdf | png | jpg | ...
  file_size       integer not null default 0,  -- bytes
  created_at      timestamptz not null default now()
);

create index if not exists announcement_attachments_announcement_idx
  on public.announcement_attachments (announcement_id);

alter table public.announcement_attachments enable row level security;
-- No policies => only the backend's service-role key can read/write,
-- matching every other table in this app.
