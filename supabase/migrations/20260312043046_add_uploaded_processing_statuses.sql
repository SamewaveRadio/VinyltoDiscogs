/*
  # Update records status constraint

  Adds 'uploaded' status to the records table status check constraint,
  supporting the full ingestion workflow:
  uploaded → processing → matched / needs_review / failed → added
*/

ALTER TABLE records DROP CONSTRAINT IF EXISTS records_status_check;

ALTER TABLE records ADD CONSTRAINT records_status_check
  CHECK (status IN ('uploaded', 'processing', 'matched', 'needs_review', 'added', 'failed'));
