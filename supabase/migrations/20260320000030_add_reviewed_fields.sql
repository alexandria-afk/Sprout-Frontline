ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
