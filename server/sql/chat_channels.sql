-- Group / class chat channels (Toddle-style) — parallel to the existing 1:1
-- `messages` table so it never touches direct messaging. A channel has a member
-- roster and a posting rule (staff-only broadcast vs. open family channel).
-- Run once in the Supabase SQL editor.

create table if not exists public.chat_channels (
  id          uuid        primary key default gen_random_uuid(),
  school_id   uuid        not null references public.schools(id) on delete cascade,
  name        text        not null,                 -- "PYP 5 Parents - 2026-27"
  -- category drives the All / Staff / Public tabs:
  --   'class'  = grade/family channels (default)
  --   'public' = open school-wide channels
  --   'staff'  = staff-only channels
  category    text        not null default 'class',
  grade       text,                                  -- optional scope
  section     text,
  -- posting rule: 'members' (anyone in the channel) | 'staff_only' (teachers/admins only)
  posting     text        not null default 'members',
  icon_label  text,                                  -- short badge, e.g. "PYP 5"
  created_by  text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.chat_channel_members (
  id          uuid        primary key default gen_random_uuid(),
  channel_id  uuid        not null references public.chat_channels(id) on delete cascade,
  user_email  text        not null,
  role_label  text,                                  -- "Teacher" / "Family member of Ela" / ...
  is_manager  boolean     not null default false,    -- can post in staff_only + manage roster
  joined_at   timestamptz not null default now(),
  unique (channel_id, user_email)
);

create table if not exists public.chat_channel_messages (
  id          uuid        primary key default gen_random_uuid(),
  channel_id  uuid        not null references public.chat_channels(id) on delete cascade,
  sender_email text       not null,
  body        text        not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.chat_channel_reads (
  channel_id   uuid        not null references public.chat_channels(id) on delete cascade,
  user_email   text        not null,
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_email)
);

create index if not exists chat_members_user_idx on public.chat_channel_members (user_email);
create index if not exists chat_messages_channel_idx on public.chat_channel_messages (channel_id, created_at);

alter table public.chat_channels        enable row level security;
alter table public.chat_channel_members enable row level security;
alter table public.chat_channel_messages enable row level security;
alter table public.chat_channel_reads   enable row level security;
