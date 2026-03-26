/*
  # Add visual matching columns to discogs_candidates

  1. Modified Tables
    - `discogs_candidates`
      - `same_release_likelihood` (text, nullable) - likelihood assessment that candidate is the same release
      - `same_pressing_likelihood` (text, nullable) - likelihood assessment that candidate is the same pressing

  2. Notes
    - These columns support the visual-first matching strategy
    - Values will be descriptive strings like "high", "medium", "low", "very_high"
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discogs_candidates' AND column_name = 'same_release_likelihood'
  ) THEN
    ALTER TABLE discogs_candidates ADD COLUMN same_release_likelihood text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discogs_candidates' AND column_name = 'same_pressing_likelihood'
  ) THEN
    ALTER TABLE discogs_candidates ADD COLUMN same_pressing_likelihood text;
  END IF;
END $$;
