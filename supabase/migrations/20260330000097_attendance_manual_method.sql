-- Allow 'manual' as a valid clock_in_method (used when GPS is unavailable)
ALTER TABLE attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_clock_in_method_check;

ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_records_clock_in_method_check
  CHECK (clock_in_method IN ('gps','manual','selfie','facial_recognition','qr_code','manager_override'));
