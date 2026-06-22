-- Stateless OTP store (replaces in-memory Maps in routes/user.js) so one-time
-- codes survive across multiple Cloud Run instances behind the load balancer.
-- Run this once in the Supabase SQL editor.

create table if not exists public.otp_codes (
  email          text        not null,
  purpose        text        not null,            -- 'email_verify' | 'recovery'
  otp            text        not null,
  recovery_email text,                             -- only used for the recovery flow
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  primary key (email, purpose)
);

-- Helps the (optional) periodic cleanup of expired codes.
create index if not exists otp_codes_expires_idx on public.otp_codes (expires_at);

-- Lock the table down: only the service key (used by the backend) may read/write.
-- RLS with no policies => anon/authenticated clients get nothing; service role bypasses RLS.
alter table public.otp_codes enable row level security;
