-- Announcement system: powers both the top banner and the full Announcement
-- Center (inbox) off one data model, per the reviewed architecture (Toddle
-- parity, github.com/aivorah24/ai-mentor issue #184).
-- Depends on schools.sql having been run first (school_id FK).
-- Run this once in the Supabase SQL editor.

create table if not exists public.announcements (
  id             uuid primary key default gen_random_uuid(),

  title          text not null,
  body           text not null,

  severity       text not null default 'info'
                   check (severity in ('info', 'warning', 'critical')),

  display_type   text not null default 'banner'
                   check (display_type in ('banner', 'inbox', 'both')),

  status         text not null default 'draft'
                   check (status in ('draft', 'scheduled', 'published', 'archived')),

  starts_at      timestamptz,
  expires_at     timestamptz,

  is_dismissible boolean not null default true,

  -- Bumped only when an admin explicitly wants a previously-dismissed
  -- announcement to resurface after an edit (e.g. re-opens for a material
  -- change), not on every typo fix.
  content_version integer not null default 1,

  created_by     text,  -- admin email; matches the email-based identity used
                         -- everywhere else in this app (no user-id auth layer yet)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists announcements_status_window_idx
  on public.announcements (status, starts_at, expires_at);

-- Targeting: zero rows for an announcement = visible to everyone.
-- A row with school_id = null means "any school"; role = null means "any role".
create table if not exists public.announcement_targets (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  school_id       uuid references public.schools(id),
  role            text check (role in ('student', 'parent', 'teacher', 'school_admin')),
  created_at      timestamptz not null default now()
);

create index if not exists announcement_targets_announcement_idx
  on public.announcement_targets (announcement_id);
create index if not exists announcement_targets_school_role_idx
  on public.announcement_targets (school_id, role);

-- Per-user seen/dismissed state — the DB is the source of truth (not
-- AsyncStorage) so dismissal follows the user across devices.
create table if not exists public.announcement_user_state (
  announcement_id    uuid not null references public.announcements(id) on delete cascade,
  user_id            uuid not null references public.users(id) on delete cascade,

  seen_at            timestamptz,
  dismissed_at       timestamptz,
  -- content_version of the announcement at the moment the user dismissed it;
  -- if announcements.content_version is later bumped past this, it resurfaces.
  dismissed_version  integer,

  primary key (announcement_id, user_id)
);

create index if not exists announcement_user_state_user_idx
  on public.announcement_user_state (user_id, announcement_id);

alter table public.announcements enable row level security;
alter table public.announcement_targets enable row level security;
alter table public.announcement_user_state enable row level security;
-- No policies => anon/authenticated clients get nothing directly; service role
-- (used by the backend) bypasses RLS, matching every other table in this app.
