-- Add ratable comparison and rate calculator columns to jobs table
-- These columns store current year ratable data and rate calculation inputs

ALTER TABLE jobs
  -- Current Year Ratable Data (user-entered from import)
  ADD COLUMN IF NOT EXISTS current_class_1_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_class_1_total BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_class_1_abatements INTEGER DEFAULT 0,
  
  ADD COLUMN IF NOT EXISTS current_class_2_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_class_2_total BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_class_2_abatements INTEGER DEFAULT 0,
  
  ADD COLUMN IF NOT EXISTS current_class_3a_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_class_3a_total BIGINT DEFAULT 0,
  
  ADD COLUMN IF NOT EXISTS current_class_3b_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_class_3b_total BIGINT DEFAULT 0,
  
  ADD COLUMN IF NOT EXISTS current_class_4_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_class_4_total BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_class_4_abatements INTEGER DEFAULT 0,
  
  ADD COLUMN IF NOT EXISTS current_class_6_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_class_6_total BIGINT DEFAULT 0,
  
  ADD COLUMN IF NOT EXISTS current_total_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_total_total BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_commercial_base_pct DECIMAL(5,2) DEFAULT 0,
  
  -- Rate Calculator Data
  ADD COLUMN IF NOT EXISTS rate_calc_budget DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rate_calc_current_rate DECIMAL(6,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rate_calc_buffer_for_loss DECIMAL(5,2) DEFAULT 0;

-- Add comment to document these columns
COMMENT ON COLUMN jobs.current_class_1_count IS 'Current year Class 1 property count (user-entered)';
COMMENT ON COLUMN jobs.current_class_1_total IS 'Current year Class 1 total valuation (user-entered)';
COMMENT ON COLUMN jobs.current_class_1_abatements IS 'Current year Class 1 abatements count (user-entered)';
COMMENT ON COLUMN jobs.current_class_2_count IS 'Current year Class 2 property count (user-entered)';
COMMENT ON COLUMN jobs.current_class_2_total IS 'Current year Class 2 total valuation (user-entered)';
COMMENT ON COLUMN jobs.current_class_2_abatements IS 'Current year Class 2 abatements count (user-entered)';
COMMENT ON COLUMN jobs.current_class_3a_count IS 'Current year Class 3A property count (user-entered)';
COMMENT ON COLUMN jobs.current_class_3a_total IS 'Current year Class 3A total valuation (user-entered)';
COMMENT ON COLUMN jobs.current_class_3b_count IS 'Current year Class 3B property count (user-entered)';
COMMENT ON COLUMN jobs.current_class_3b_total IS 'Current year Class 3B total valuation (user-entered)';
COMMENT ON COLUMN jobs.current_class_4_count IS 'Current year Class 4 (A,B,C combined) property count (user-entered)';
COMMENT ON COLUMN jobs.current_class_4_total IS 'Current year Class 4 (A,B,C combined) total valuation (user-entered)';
COMMENT ON COLUMN jobs.current_class_4_abatements IS 'Current year Class 4 abatements count (user-entered)';
COMMENT ON COLUMN jobs.current_class_6_count IS 'Current year Class 6 (A,B,C combined) property count (user-entered)';
COMMENT ON COLUMN jobs.current_class_6_total IS 'Current year Class 6 (A,B,C combined) total valuation (user-entered)';
COMMENT ON COLUMN jobs.current_total_count IS 'Current year total property count (user-entered)';
COMMENT ON COLUMN jobs.current_total_total IS 'Current year total valuation (user-entered)';
COMMENT ON COLUMN jobs.current_commercial_base_pct IS 'Current year commercial base percentage (user-entered)';
COMMENT ON COLUMN jobs.rate_calc_budget IS 'Tax rate calculator budget input';
COMMENT ON COLUMN jobs.rate_calc_current_rate IS 'Tax rate calculator current rate input';
COMMENT ON COLUMN jobs.rate_calc_buffer_for_loss IS 'Tax rate calculator buffer for loss percentage';
