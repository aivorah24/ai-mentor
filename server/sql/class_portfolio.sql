-- Class Portfolio: a per-class (grade+section) social feed — teacher-posted
-- photos/videos with a caption, optional student tags, likes and comments.
-- Mirrors announcements.sql's shape (posts + attachments + engagement state).
-- Run once in the Supabase SQL editor, after schools.sql and announcements.sql.

create table if not exists public.class_portfolio_posts (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id),
  grade        text not null,
  section      text not null default '',

  caption      text not null default '',
  status       text not null default 'draft'
                 check (status in ('draft', 'published', 'archived')),

  created_by   text not null,  -- homeroom teacher's email, same convention as announcements.created_by
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists class_portfolio_posts_class_idx
  on public.class_portfolio_posts (school_id, grade, section, status);

create table if not exists public.class_portfolio_attachments (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.class_portfolio_posts(id) on delete cascade,
  url          text not null,
  file_type    text not null check (file_type in ('image', 'video')),
  file_name    text,
  file_size    integer,
  position     integer not null default 0
);

create index if not exists class_portfolio_attachments_post_idx
  on public.class_portfolio_attachments (post_id);

-- Tagging is for the per-student filter sidebar (browse "this student's
-- posts"), NOT access control — every post is visible to the whole class's
-- parents/students regardless of who's tagged.
create table if not exists public.class_portfolio_tags (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.class_portfolio_posts(id) on delete cascade,
  student_id   uuid not null references public.users(id)
);

create index if not exists class_portfolio_tags_post_idx on public.class_portfolio_tags (post_id);
create index if not exists class_portfolio_tags_student_idx on public.class_portfolio_tags (student_id);

create table if not exists public.class_portfolio_likes (
  post_id      uuid not null references public.class_portfolio_posts(id) on delete cascade,
  user_id      uuid not null references public.users(id),
  created_at   timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.class_portfolio_comments (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.class_portfolio_posts(id) on delete cascade,
  user_id      uuid not null references public.users(id),
  body         text not null,
  created_at   timestamptz not null default now()
);

create index if not exists class_portfolio_comments_post_idx
  on public.class_portfolio_comments (post_id, created_at);

alter table public.class_portfolio_posts enable row level security;
alter table public.class_portfolio_attachments enable row level security;
alter table public.class_portfolio_tags enable row level security;
alter table public.class_portfolio_likes enable row level security;
alter table public.class_portfolio_comments enable row level security;
-- No policies => anon/authenticated clients get nothing directly; service role
-- (used by the backend) bypasses RLS, matching every other table in this app.
