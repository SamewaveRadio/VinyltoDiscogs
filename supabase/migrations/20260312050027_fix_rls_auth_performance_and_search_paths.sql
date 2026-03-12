/*
  # Fix RLS policy performance and function security issues

  ## Changes

  1. RLS Policy Fixes (all tables)
     - Replace `auth.uid()` with `(select auth.uid())` in all policies to prevent
       per-row re-evaluation of auth functions. This is evaluated once per query instead.
     - Affected tables: users, records, record_photos, discogs_candidates, processing_jobs

  2. Function Search Path Fixes
     - Set `search_path = ''` and use fully-qualified names on:
       - update_updated_at_column
       - handle_new_user
       - update_processing_jobs_updated_at
     - This prevents search_path injection attacks

  ## Notes
  - DROP POLICY + CREATE POLICY is the correct way to replace policies in Postgres
  - No data is modified; only policy and function definitions change
*/

-- ============================================================
-- users table
-- ============================================================
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
CREATE POLICY "Users can view own profile"
  ON public.users FOR SELECT
  TO authenticated
  USING (id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
CREATE POLICY "Users can insert own profile"
  ON public.users FOR INSERT
  TO authenticated
  WITH CHECK (id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  TO authenticated
  USING (id = (select auth.uid()))
  WITH CHECK (id = (select auth.uid()));

-- ============================================================
-- records table
-- ============================================================
DROP POLICY IF EXISTS "Users can view own records" ON public.records;
CREATE POLICY "Users can view own records"
  ON public.records FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can insert own records" ON public.records;
CREATE POLICY "Users can insert own records"
  ON public.records FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can update own records" ON public.records;
CREATE POLICY "Users can update own records"
  ON public.records FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can delete own records" ON public.records;
CREATE POLICY "Users can delete own records"
  ON public.records FOR DELETE
  TO authenticated
  USING (user_id = (select auth.uid()));

-- ============================================================
-- record_photos table
-- ============================================================
DROP POLICY IF EXISTS "Users can view own record photos" ON public.record_photos;
CREATE POLICY "Users can view own record photos"
  ON public.record_photos FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.records
      WHERE records.id = record_photos.record_id
      AND records.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert own record photos" ON public.record_photos;
CREATE POLICY "Users can insert own record photos"
  ON public.record_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.records
      WHERE records.id = record_photos.record_id
      AND records.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete own record photos" ON public.record_photos;
CREATE POLICY "Users can delete own record photos"
  ON public.record_photos FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.records
      WHERE records.id = record_photos.record_id
      AND records.user_id = (select auth.uid())
    )
  );

-- ============================================================
-- discogs_candidates table
-- ============================================================
DROP POLICY IF EXISTS "Users can view own discogs candidates" ON public.discogs_candidates;
CREATE POLICY "Users can view own discogs candidates"
  ON public.discogs_candidates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.records
      WHERE records.id = discogs_candidates.record_id
      AND records.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert own discogs candidates" ON public.discogs_candidates;
CREATE POLICY "Users can insert own discogs candidates"
  ON public.discogs_candidates FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.records
      WHERE records.id = discogs_candidates.record_id
      AND records.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update own discogs candidates" ON public.discogs_candidates;
CREATE POLICY "Users can update own discogs candidates"
  ON public.discogs_candidates FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.records
      WHERE records.id = discogs_candidates.record_id
      AND records.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.records
      WHERE records.id = discogs_candidates.record_id
      AND records.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete own discogs candidates" ON public.discogs_candidates;
CREATE POLICY "Users can delete own discogs candidates"
  ON public.discogs_candidates FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.records
      WHERE records.id = discogs_candidates.record_id
      AND records.user_id = (select auth.uid())
    )
  );

-- ============================================================
-- processing_jobs table
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own jobs" ON public.processing_jobs;
CREATE POLICY "Users can view their own jobs"
  ON public.processing_jobs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.records
      WHERE records.id = processing_jobs.record_id
      AND records.user_id = (select auth.uid())
    )
  );

-- ============================================================
-- Fix function search paths to prevent search_path injection
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_processing_jobs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
