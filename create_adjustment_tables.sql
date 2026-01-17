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

-- Create job_custom_brackets table for user-defined price bracket columns
CREATE TABLE IF NOT EXISTS job_custom_brackets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  bracket_id TEXT NOT NULL, -- e.g., 'custom_1', 'custom_2'
  bracket_name TEXT NOT NULL, -- User-provided name, e.g., "$150K-$250K Custom"
  sort_order INTEGER DEFAULT 0,
  
  -- Adjustment values stored as JSONB for flexibility
  -- Structure: { "lot_size": { "value": 10, "type": "flat" }, "living_area": { "value": 50, "type": "per_sqft" }, ... }
  adjustment_values JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(job_id, bracket_id)
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

CREATE INDEX IF NOT EXISTS idx_job_custom_brackets_job_id
  ON job_custom_brackets(job_id);

CREATE INDEX IF NOT EXISTS idx_job_custom_brackets_bracket_id
  ON job_custom_brackets(job_id, bracket_id);

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

COMMENT ON TABLE job_custom_brackets IS 
'Stores user-defined custom price bracket columns with adjustment values for all attributes';

COMMENT ON COLUMN job_custom_brackets.adjustment_values IS 
'JSONB object storing adjustment values and types for each attribute. Example: {"lot_size": {"value": 10, "type": "flat"}, "living_area": {"value": 50, "type": "per_sqft"}}';

COMMENT ON TABLE job_settings IS
'Stores job-specific configuration settings (e.g., garage codes, custom thresholds)';

-- Create job_cme_evaluations table for storing iterative CME (Sales Comparison) results
CREATE TABLE IF NOT EXISTS job_cme_evaluations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  evaluation_run_id UUID DEFAULT gen_random_uuid(), -- Groups results from same "Evaluate" click

  -- Subject property being valued
  subject_property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  subject_pams TEXT, -- Subject PAMS ID for reference
  subject_address TEXT,

  -- Search criteria used (stored for audit trail)
  search_criteria JSONB DEFAULT '{}'::jsonb,
  -- Example: { "timeFilter": "90", "distanceFilter": "0.5", "bracketFilter": "bracket_2", ... }

  -- Comparables matched (up to 5)
  comparables JSONB DEFAULT '[]'::jsonb,
  -- Array of comparable objects with adjustment details
  -- Example: [
  --   {
  --     "property_id": "uuid",
  --     "pams_id": "12345",
  --     "address": "123 Main St",
  --     "sale_price": 450000,
  --     "sale_date": "2024-01-15",
  --     "rank": 1,
  --     "adjustments": {
  --       "living_area": { "subject": 2200, "comp": 2000, "adjustment": 10000, "type": "per_sqft" },
  --       "garage": { "subject": 2, "comp": 1, "adjustment": 5000, "type": "flat" },
  --       ...
  --     },
  --     "gross_adjustment": 35000,
  --     "net_adjustment": 15000,
  --     "net_adjustment_percent": 3.33,
  --     "adjusted_sale_price": 465000,
  --     "weight": 0.35
  --   },
  --   ...
  -- ]

  -- Calculated valuation
  projected_assessment NUMERIC(12,2),
  weighted_average_price NUMERIC(12,2),
  confidence_score NUMERIC(5,2), -- 0-100, based on # of comps and adjustment quality

  -- Workflow status
  status TEXT DEFAULT 'pending', -- 'pending', 'saved', 'applied', 'set_aside'
  notes TEXT,

  -- User tracking
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate evaluations for same subject in same run
  UNIQUE(evaluation_run_id, subject_property_id)
);

-- Create indexes for CME evaluations
CREATE INDEX IF NOT EXISTS idx_job_cme_evaluations_job_id
  ON job_cme_evaluations(job_id);

CREATE INDEX IF NOT EXISTS idx_job_cme_evaluations_run_id
  ON job_cme_evaluations(evaluation_run_id);

CREATE INDEX IF NOT EXISTS idx_job_cme_evaluations_subject
  ON job_cme_evaluations(subject_property_id);

CREATE INDEX IF NOT EXISTS idx_job_cme_evaluations_status
  ON job_cme_evaluations(job_id, status);

-- Add comments
COMMENT ON TABLE job_cme_evaluations IS
'Stores results from iterative CME (Sales Comparison) evaluations, including matched comps, adjustments, and projected assessments';

COMMENT ON COLUMN job_cme_evaluations.evaluation_run_id IS
'Groups all evaluations from a single "Evaluate" button click, allowing batch operations';

COMMENT ON COLUMN job_cme_evaluations.search_criteria IS
'Stores the filter settings used for this evaluation (time, distance, bracket, etc.) for audit trail';

COMMENT ON COLUMN job_cme_evaluations.comparables IS
'Array of up to 5 comparable sales with full adjustment calculations, rankings, and weights';

COMMENT ON COLUMN job_cme_evaluations.status IS
'Workflow status: pending (just evaluated), saved (user reviewed), applied (written to final roster), set_aside (subject successfully valued, excluded from next run)';

COMMENT ON COLUMN job_cme_evaluations.confidence_score IS
'Quality metric 0-100 based on number of comps found and average net adjustment percentage';
