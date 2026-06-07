-- Create pool_manual_sales table for manually-entered historical sales (Microsystems)
CREATE TABLE IF NOT EXISTS pool_manual_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  property_block text NOT NULL,
  property_lot text NOT NULL,
  property_qualifier text DEFAULT '',
  sales_date date NOT NULL,
  sales_price numeric NOT NULL,
  sales_nu text,
  sales_book text,
  sales_page text,
  created_at timestamptz DEFAULT now(),
  created_by uuid,
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_pool_manual_sales_job_id ON pool_manual_sales(job_id);
CREATE INDEX idx_pool_manual_sales_block_lot ON pool_manual_sales(job_id, property_block, property_lot, property_qualifier);

COMMENT ON TABLE pool_manual_sales IS 'Manually entered historical sales for Microsystems jobs (no historical data in source). Used to unmask/override junk sales in the pool.';
COMMENT ON COLUMN pool_manual_sales.job_id IS 'Reference to the job';
COMMENT ON COLUMN pool_manual_sales.property_block IS 'Property block';
COMMENT ON COLUMN pool_manual_sales.property_lot IS 'Property lot';
COMMENT ON COLUMN pool_manual_sales.property_qualifier IS 'Property qualifier (optional)';
COMMENT ON COLUMN pool_manual_sales.sales_date IS 'Date of the sale';
COMMENT ON COLUMN pool_manual_sales.sales_price IS 'Sale price';
COMMENT ON COLUMN pool_manual_sales.sales_nu IS 'Sales Nature & Use code (optional)';
COMMENT ON COLUMN pool_manual_sales.sales_book IS 'Deed book (optional)';
COMMENT ON COLUMN pool_manual_sales.sales_page IS 'Deed page (optional)';
