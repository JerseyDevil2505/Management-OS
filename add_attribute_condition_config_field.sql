-- Migration: Add attribute_condition_config field to jobs table
-- This field stores the condition analysis configuration as JSON
-- Run this in your Supabase SQL editor

ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS attribute_condition_config JSONB;

-- Add a comment to document the field
COMMENT ON COLUMN jobs.attribute_condition_config IS 'Stores condition analysis configuration including baseline and classifications for exterior and interior conditions. Format: {exterior: {baseline, better[], worse[]}, interior: {baseline, better[], worse[]}}';

-- Example data structure:
-- {
--   "exterior": {
--     "baseline": "AVERAGE",
--     "better": ["EXCELLENT", "GOOD"],
--     "worse": ["FAIR", "POOR", "VERY POOR"]
--   },
--   "interior": {
--     "baseline": "AVERAGE",
--     "better": ["EXCELLENT", "GOOD"],
--     "worse": ["FAIR", "POOR", "VERY POOR"]
--   },
--   "savedAt": "2025-01-14T12:00:00.000Z"
-- }
