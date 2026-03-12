/*
  # Add 'queued' to records status check constraint

  1. Modified Tables
    - `records`
      - Updated `status` CHECK constraint to include 'queued' as a valid value

  2. Notes
    - The frontend and edge functions already use 'queued' as an initial status
    - The database constraint was missing this value, causing 400 errors on insert
*/

ALTER TABLE records DROP CONSTRAINT IF EXISTS records_status_check;

ALTER TABLE records ADD CONSTRAINT records_status_check
  CHECK (status = ANY (ARRAY['queued'::text, 'uploaded'::text, 'processing'::text, 'matched'::text, 'needs_review'::text, 'added'::text, 'failed'::text]));
