-- School Policies & Resources — a browsable file/folder library (PDFs,
-- handbooks) scoped by school and program/grade. Teachers & school admins
-- manage it; parents browse read-only; students never see it.
-- Run once in the Supabase SQL editor.

create table if not exists public.resource_folders (
  id               uuid        primary key default gen_random_uuid(),
  school_id        uuid        not null references public.schools(id) on delete cascade,
  parent_folder_id uuid        references public.resource_folders(id) on delete cascade, -- null = top level
  name             text        not null,
  -- 'school' = visible to the whole school; otherwise a grade/program name
  -- (e.g. 'Grade 5' or 'IB PYP') that scopes visibility.
  scope            text        not null default 'school',
  created_by       text        not null,          -- author email
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.resource_files (
  id           uuid        primary key default gen_random_uuid(),
  school_id    uuid        not null references public.schools(id) on delete cascade,
  folder_id    uuid        references public.resource_folders(id) on delete cascade, -- null = library root
  title        text        not null,
  file_url     text        not null,              -- Cloudinary URL
  file_type    text,                              -- 'pdf' | 'png' | ...
  file_size    bigint      default 0,             -- bytes (shown as "13.55 MB")
  scope        text        not null default 'school',
  uploaded_by  text        not null,              -- uploader email
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists resource_folders_school_idx on public.resource_folders (school_id, parent_folder_id);
create index if not exists resource_files_folder_idx    on public.resource_files (school_id, folder_id);

-- Backend (service key) only.
alter table public.resource_folders enable row level security;
alter table public.resource_files   enable row level security;
