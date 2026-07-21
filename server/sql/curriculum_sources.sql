-- Registration mechanism for curriculum ingestion (ICSE/Cambridge/future
-- curricula). A row here means "this document/resource has been registered
-- as a known source for this curriculum+grade+subject" — separate from
-- whether it's been extracted/ingested yet (that's tracked via
-- syllabus_extraction_jobs, reused as-is, and topic_resources).
--
-- Additive only. Does not touch syllabus_chapters/syllabus_topics/
-- topic_resources/syllabus_extraction_jobs.

do $$ begin
  create type curriculum_source_type as enum ('OFFICIAL_SYLLABUS', 'LICENSED_TEXTBOOK', 'OER', 'AI_GENERATED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type curriculum_source_status as enum ('REGISTERED', 'INGESTED', 'REJECTED');
exception when duplicate_object then null; end $$;

create table if not exists curriculum_sources (
  id uuid primary key default gen_random_uuid(),
  curriculum text not null,
  grade text not null,
  subject text,
  source_type curriculum_source_type not null,
  title text not null,
  file_hash text,               -- links to syllabus_extraction_jobs.file_hash when this source has been extracted
  url text,                     -- for OER/licensed sources referenced by URL rather than upload
  license text,                 -- e.g. "CC BY 4.0" — required for OER sources
  status curriculum_source_status not null default 'REGISTERED',
  registered_by text,
  registered_at timestamptz not null default now(),
  ingested_at timestamptz
);

create index if not exists idx_curriculum_sources_scope on curriculum_sources(curriculum, grade, subject);
