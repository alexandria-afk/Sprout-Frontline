-- Add placeholder text to form_fields so field builders can show sample prompts
ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS placeholder text;
