-- Generic curriculum resource ledger (CBSE/ICSE/Cambridge pipeline).
-- One row per (topic, resource_type). Additive only — does not alter
-- syllabus_chapters or syllabus_topics destructively.
--
-- NOTE (security): syllabus_chapters/syllabus_topics/syllabus_extraction_jobs
-- currently have RLS DISABLED in this project — anyone with the anon key can
-- read/write them. This new table inherits the same schema convention but
-- RLS is intentionally NOT enabled here either, to stay consistent with the
-- existing tables it joins against; enabling RLS on just this one table
-- would not fix the underlying exposure and needs a deliberate, separate
-- decision (with policies) covering all four tables together.

do $$ begin
  create type resource_status as enum ('READY', 'COMING_SOON', 'UNDER_REVIEW', 'NOT_AVAILABLE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type resource_source_tier as enum ('OFFICIAL_BOOK', 'LICENSED_CONTENT', 'MAPPED_OER', 'ORIGINAL_AI', 'PLACEHOLDER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type resource_type as enum (
    'AI_EXPLANATION', 'IMAGES', 'AUDIO', 'PRACTICE', 'FLASHCARDS',
    'WORKSHEETS', 'BOOK_REFERENCE', 'OER_MAPPING'
  );
exception when duplicate_object then null; end $$;

create table if not exists topic_resources (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references syllabus_topics(id) on delete cascade,
  resource_type resource_type not null,
  status resource_status not null default 'NOT_AVAILABLE',
  source_tier resource_source_tier,
  source text,
  qdrant_point_ids text[],
  static_payload jsonb,
  attribution text,
  updated_at timestamptz not null default now(),
  unique (topic_id, resource_type)
);

create index if not exists idx_topic_resources_topic on topic_resources(topic_id);
create index if not exists idx_topic_resources_status on topic_resources(status);

-- Nullable additive columns on syllabus_topics for AI-generated fallback
-- content (used when no official textbook exists for a topic).
alter table syllabus_topics add column if not exists key_concepts text[];
alter table syllabus_topics add column if not exists summary text;
alter table syllabus_topics add column if not exists reflection_question text;
alter table syllabus_topics add column if not exists content_origin text
  check (content_origin in ('official_textbook','licensed','oer','ai_generated'))
  default 'official_textbook';
