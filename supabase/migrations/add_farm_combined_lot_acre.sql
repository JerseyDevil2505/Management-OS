-- Add farm_combined_lot_acre field to track combined 3A+3B acreage
ALTER TABLE property_records 
ADD COLUMN IF NOT EXISTS farm_combined_lot_acre numeric;

-- Create a helper function to calculate farm combined acreage
-- This scans for 3A properties and finds matching 3B properties
-- to sum their lot acres together
CREATE OR REPLACE FUNCTION calculate_farm_combined_acres(
  p_job_id uuid,
  p_block text,
  p_lot text
)
RETURNS numeric AS $$
DECLARE
  v_acre_sum numeric := 0;
BEGIN
  -- Sum asset_lot_acre for all properties (3A + 3B variants) with same block/lot
  SELECT COALESCE(SUM(asset_lot_acre), 0)
  INTO v_acre_sum
  FROM property_records
  WHERE job_id = p_job_id
    AND property_block = p_block
    AND property_lot = p_lot
    AND property_m4_class IN ('3A', '3B');
  
  RETURN v_acre_sum;
END;
$$ LANGUAGE plpgsql STABLE;

-- Backfill farm_combined_lot_acre for Lower Alloways Creek (CCDD 1008)
-- This finds all 3A properties and calculates their combined 3A+3B acreage
UPDATE property_records pr
SET farm_combined_lot_acre = calculate_farm_combined_acres(pr.job_id, pr.property_block, pr.property_lot)
WHERE pr.job_id IN (
  SELECT id FROM jobs 
  WHERE ccdd_code = '1008'  -- Lower Alloways Creek
)
AND pr.property_m4_class = '3A'
AND pr.farm_combined_lot_acre IS NULL;

-- Log the backfill results
SELECT 
  COUNT(*) as updated_count,
  AVG(farm_combined_lot_acre) as avg_farm_acres,
  MAX(farm_combined_lot_acre) as max_farm_acres
FROM property_records
WHERE farm_combined_lot_acre IS NOT NULL
AND job_id IN (SELECT id FROM jobs WHERE ccdd_code = '1008');
