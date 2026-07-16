-- Tracks last sign-in for the School Admin "Last Active" column.
-- Set on every successful /user/sync upsert (i.e. every real login).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_active_at timestamptz;
