/*
  # Add processing_step column to records

  1. Modified Tables
    - `records`
      - `processing_step` (text, nullable) - Tracks which substep the record is currently on during processing.
        Values: 'extracting', 'searching', 'ranking', or null when not processing.

  2. Important Notes
    - This column enables the frontend to show granular progress during record processing
    - It is set to null when processing is complete (matched, needs_review, failed, etc.)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'records' AND column_name = 'processing_step'
  ) THEN
    ALTER TABLE records ADD COLUMN processing_step text DEFAULT null;
  END IF;
END $$;