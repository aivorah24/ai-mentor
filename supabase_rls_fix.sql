-- ============================================================
-- Aivorah — Row Level Security (RLS) Fix
-- Run this in Supabase Dashboard → SQL Editor → New Query
--
-- Context: The server uses SUPABASE_SERVICE_KEY which BYPASSES
-- RLS automatically. Enabling RLS here only blocks direct public
-- access (anon key). The server will continue working normally.
-- ============================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_daily_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_daily_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_student ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'parent_student') THEN
    EXECUTE 'ALTER TABLE public.parent_student ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'videos') THEN
    EXECUTE 'ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_events') THEN
    EXECUTE 'ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'monitor_incidents') THEN
    EXECUTE 'ALTER TABLE public.monitor_incidents ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_notifications') THEN
    EXECUTE 'ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'server_errors') THEN
    EXECUTE 'ALTER TABLE public.server_errors ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- Verify: all rows should show rls_enabled = true
SELECT tablename, rowsecurity AS rls_enabled
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
