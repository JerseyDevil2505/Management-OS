-- Migration: Add projected_6_override column to final_valuation_data table
-- Purpose: Allow manual override of calculated 6A/6B/6C personal property projected values
-- Date: 2025-01-17

-- Add the override column to final_valuation_data
ALTER TABLE final_valuation_data
ADD COLUMN IF NOT EXISTS projected_6_override NUMERIC(12, 2) DEFAULT NULL;

-- Add a comment to document the field
COMMENT ON COLUMN final_valuation_data.projected_6_override IS 
'Manual override for projected personal property (Class 6A/6B/6C) value. When set, this value replaces the calculated value (land * (improvement/100)) in ratable comparisons and rate calculations.';

-- Create an index for faster lookups when filtering by override presence
CREATE INDEX IF NOT EXISTS idx_final_valuation_projected_6_override 
ON final_valuation_data(job_id, property_composite_key) 
WHERE projected_6_override IS NOT NULL;

-- Display migration completion message
DO $$
BEGIN
  RAISE NOTICE 'Migration completed: projected_6_override column added to final_valuation_data';
END $$;
