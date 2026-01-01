/*
  # Add Exercise Defaults

  1. Changes
    - Add `default_technique_tags` column to exercises table
      - Type: text[] (array of strings)
      - Default: empty array
    - Add `default_set_scheme` column to exercises table
      - Type: jsonb (JSON object)
      - Nullable
      - Stores default sets, reps, rest seconds, and notes

  2. Security
    - No RLS changes needed; existing policies remain in effect
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'default_technique_tags'
  ) THEN
    ALTER TABLE exercises ADD COLUMN default_technique_tags text[] NOT NULL DEFAULT '{}';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'default_set_scheme'
  ) THEN
    ALTER TABLE exercises ADD COLUMN default_set_scheme jsonb NULL;
  END IF;
END $$;
