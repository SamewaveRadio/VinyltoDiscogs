/*
  # Create processing_jobs table

  ## Summary
  Introduces a background job queue for async vinyl record processing.
  Each record submission creates a processing_jobs row that a scheduled
  worker function picks up, processes, and marks completed or failed.

  ## New Tables
  - `processing_jobs`
    - `id` (uuid, primary key)
    - `record_id` (uuid, FK → records.id, cascade delete)
    - `status` (text) — pending | running | completed | failed
    - `attempts` (integer) — number of processing attempts made
    - `error_message` (text, nullable) — last error if failed
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)

  ## Modified Tables
  - `records.status` — adds new 'queued' value (enforced by app logic; existing check constraint not changed to keep backwards compat)

  ## Security
  - RLS enabled on processing_jobs
  - Users can read their own jobs (joined through records)
  - Service role has full access for the worker function

  ## Notes
  1. The worker queries pending jobs ordered by created_at ASC (oldest first)
  2. attempts column supports future retry logic
  3. updated_at is refreshed automatically via trigger
*/

CREATE TABLE IF NOT EXISTS processing_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id    uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempts     integer NOT NULL DEFAULT 0,
  error_message text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS processing_jobs_status_created_idx ON processing_jobs (status, created_at ASC);
CREATE INDEX IF NOT EXISTS processing_jobs_record_id_idx ON processing_jobs (record_id);

ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own jobs"
  ON processing_jobs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM records
      WHERE records.id = processing_jobs.record_id
      AND records.user_id = auth.uid()
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_processing_jobs_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION update_processing_jobs_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $func$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $func$;

    CREATE TRIGGER set_processing_jobs_updated_at
      BEFORE UPDATE ON processing_jobs
      FOR EACH ROW EXECUTE FUNCTION update_processing_jobs_updated_at();
  END IF;
END $$;
