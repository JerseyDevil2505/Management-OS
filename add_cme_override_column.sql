-- Add cme_include_override column to property_market_analysis table
ALTER TABLE property_market_analysis
ADD COLUMN IF NOT EXISTS cme_include_override BOOLEAN DEFAULT NULL;

-- Add comment to document the column
COMMENT ON COLUMN property_market_analysis.cme_include_override IS 
'CME (Comparative Market Evaluation) include override: NULL = auto-determined, TRUE = manually included, FALSE = manually excluded';

-- Optional: Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_property_market_analysis_cme_override 
ON property_market_analysis(job_id, cme_include_override) 
WHERE cme_include_override IS NOT NULL;
