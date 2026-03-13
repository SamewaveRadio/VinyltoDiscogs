/*
  # Add thumb_url to discogs_candidates

  1. Modified Tables
    - `discogs_candidates`
      - Added `thumb_url` (text, nullable) - stores the thumbnail image URL from Discogs search results

  2. Notes
    - This allows the frontend to display Discogs listing photos alongside candidate matches
    - The URL comes from the Discogs search API `thumb` field
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discogs_candidates' AND column_name = 'thumb_url'
  ) THEN
    ALTER TABLE discogs_candidates ADD COLUMN thumb_url text;
  END IF;
END $$;