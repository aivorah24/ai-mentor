-- Migration: Add custom folders support to Class Portfolio
-- Run this script in your Supabase SQL Editor.

create table if not exists public.class_portfolio_folders (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  grade        text not null,
  section      text not null default '',
  name         text not null,
  color        text not null default '#0d9488',
  created_by   text not null,  -- teacher's email who created it
  created_at   timestamptz not null default now(),
  unique (school_id, grade, section, name)
);

alter table public.class_portfolio_posts 
  add column if not exists folder_id uuid references public.class_portfolio_folders(id) on delete set null;

alter table public.class_portfolio_folders enable row level security;
