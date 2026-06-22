-- Job/status store for the swappable upload queue (services/jobQueue.js).
-- This table is the source of truth for job status in BOTH modes:
--   • QUEUE_DRIVER=db    → workers poll this table directly
--   • QUEUE_DRIVER=kafka → Kafka carries the job id; status still lives here
-- so the client can poll GET /jobs/:id regardless of the transport.
-- Run once in the Supabase SQL editor.

create table if not exists public.upload_jobs (
  id          text        primary key,          -- generated in Node (crypto.randomUUID)
  type        text        not null,             -- e.g. 'content_ingest', 'worksheet_quiz'
  status      text        not null default 'pending', -- pending | processing | done | failed
  payload     jsonb       not null default '{}'::jsonb,
  result      jsonb,
  error       text,
  locked_at   timestamptz,                       -- claim time (stale-lock recovery)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Fast lookup of the next pending jobs to drain.
create index if not exists upload_jobs_status_idx on public.upload_jobs (status, created_at);

-- Only the backend (service key) touches this table.
alter table public.upload_jobs enable row level security;
