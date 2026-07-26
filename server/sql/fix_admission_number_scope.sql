-- Fix: admission numbers must be unique PER SCHOOL, not globally across all users.
--
-- Root cause: users_admission_number_idx was a plain unique index on
-- admission_number alone. An orphaned test account (school_id = null) had been
-- stamped with "TSRA-1012" test data, and that alone permanently blocked The
-- Shri Ram Academy from ever assigning "TSRA-1012" to a real student — even
-- though the "TSRA-" prefix already implies the number is school-scoped.
--
-- Run this once in the Supabase SQL editor (not applied automatically).

DROP INDEX IF EXISTS users_admission_number_idx;

-- Partial unique index: only enforced where an admission number is actually
-- set, scoped to (school_id, admission_number) so two different schools (or
-- orphaned/null-school rows) can never collide with each other again.
CREATE UNIQUE INDEX users_admission_number_school_idx
  ON users (school_id, admission_number)
  WHERE admission_number IS NOT NULL;
