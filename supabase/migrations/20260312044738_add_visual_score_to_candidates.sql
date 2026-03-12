/*
  # Add visual scoring fields to discogs_candidates

  ## Summary
  Adds two new optional columns to the discogs_candidates table to store
  the result of OpenAI Vision-based artwork comparison between the uploaded
  record photo and the Discogs release image.

  ## New Columns
  - `discogs_candidates.visual_score` (integer, nullable) — 0–100 score from OpenAI visual comparison
  - `discogs_candidates.visual_reason` (text, nullable) — short explanation from OpenAI for the score

  ## Notes
  - Both columns are nullable; existing rows are unaffected
  - No RLS changes required (table already has appropriate policies)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discogs_candidates' AND column_name = 'visual_score'
  ) THEN
    ALTER TABLE discogs_candidates ADD COLUMN visual_score integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discogs_candidates' AND column_name = 'visual_reason'
  ) THEN
    ALTER TABLE discogs_candidates ADD COLUMN visual_reason text;
  END IF;
END $$;
