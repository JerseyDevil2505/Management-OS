-- Create job_adjustment_grid table for storing adjustment values by price bracket
CREATE TABLE IF NOT EXISTS job_adjustment_grid (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  adjustment_id TEXT NOT NULL,
  adjustment_name TEXT NOT NULL,
  adjustment_type TEXT NOT NULL, -- 'flat', 'per_sqft', 'percent', 'flat_or_percent'
  category TEXT, -- 'physical', 'amenity', 'quality', 'location', 'custom', 'other'
  is_default BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  
  -- Bracket values (one column per CME bracket)
  bracket_0 NUMERIC(12,2) DEFAULT 0, -- up to $99,999
  bracket_1 NUMERIC(12,2) DEFAULT 0, -- $100,000-$199,999
  bracket_2 NUMERIC(12,2) DEFAULT 0, -- $200,000-$299,999
  bracket_3 NUMERIC(12,2) DEFAULT 0, -- $300,000-$399,999
  bracket_4 NUMERIC(12,2) DEFAULT 0, -- $400,000-$499,999
  bracket_5 NUMERIC(12,2) DEFAULT 0, -- $500,000-$749,999
  bracket_6 NUMERIC(12,2) DEFAULT 0, -- $750,000-$999,999
  bracket_7 NUMERIC(12,2) DEFAULT 0, -- $1,000,000-$1,499,999
  bracket_8 NUMERIC(12,2) DEFAULT 0, -- $1,500,000-$1,999,999
  bracket_9 NUMERIC(12,2) DEFAULT 0, -- Over $2,000,000
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(job_id, adjustment_id)
);

-- Create job_settings table for storing job-specific configuration
CREATE TABLE IF NOT EXISTS job_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL,
  setting_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(job_id, setting_key)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_job_adjustment_grid_job_id 
  ON job_adjustment_grid(job_id);

CREATE INDEX IF NOT EXISTS idx_job_adjustment_grid_category 
  ON job_adjustment_grid(job_id, category);

CREATE INDEX IF NOT EXISTS idx_job_settings_job_id 
  ON job_settings(job_id);

CREATE INDEX IF NOT EXISTS idx_job_settings_key 
  ON job_settings(job_id, setting_key);

-- Add comments
COMMENT ON TABLE job_adjustment_grid IS 
'Stores sales adjustment values by price bracket for comparable sales analysis';

COMMENT ON COLUMN job_adjustment_grid.adjustment_type IS 
'Type of adjustment: flat (fixed $), per_sqft ($/SF), percent (%), or flat_or_percent (user choice)';

COMMENT ON COLUMN job_adjustment_grid.bracket_0 IS 'Adjustment value for properties priced up to $99,999';
COMMENT ON COLUMN job_adjustment_grid.bracket_1 IS 'Adjustment value for properties priced $100,000-$199,999';
COMMENT ON COLUMN job_adjustment_grid.bracket_2 IS 'Adjustment value for properties priced $200,000-$299,999';
COMMENT ON COLUMN job_adjustment_grid.bracket_3 IS 'Adjustment value for properties priced $300,000-$399,999';
COMMENT ON COLUMN job_adjustment_grid.bracket_4 IS 'Adjustment value for properties priced $400,000-$499,999';
COMMENT ON COLUMN job_adjustment_grid.bracket_5 IS 'Adjustment value for properties priced $500,000-$749,999';
COMMENT ON COLUMN job_adjustment_grid.bracket_6 IS 'Adjustment value for properties priced $750,000-$999,999';
COMMENT ON COLUMN job_adjustment_grid.bracket_7 IS 'Adjustment value for properties priced $1,000,000-$1,499,999';
COMMENT ON COLUMN job_adjustment_grid.bracket_8 IS 'Adjustment value for properties priced $1,500,000-$1,999,999';
COMMENT ON COLUMN job_adjustment_grid.bracket_9 IS 'Adjustment value for properties priced over $2,000,000';

COMMENT ON TABLE job_settings IS 
'Stores job-specific configuration settings (e.g., garage codes, custom thresholds)';
