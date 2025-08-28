-- Neon Database Schema Setup
-- Copy the essential tables from Supabase for heavy operations

-- Properties table (main heavy operations table)
CREATE TABLE IF NOT EXISTS properties (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL,
    property_composite_key TEXT UNIQUE NOT NULL,
    property_block TEXT,
    property_lot TEXT,
    property_qualifier TEXT,
    property_location TEXT,
    asset_building_class TEXT,
    asset_type_use TEXT,
    asset_design_style TEXT,
    asset_stories TEXT,
    asset_ext_cond TEXT,
    asset_int_cond TEXT,
    asset_lot_sf NUMERIC,
    asset_lot_acre NUMERIC,
    asset_lot_frontage NUMERIC,
    asset_lot_depth NUMERIC,
    values_mod_total NUMERIC DEFAULT 0,
    sales_price NUMERIC DEFAULT 0,
    sales_date DATE,
    sales_book TEXT,
    sales_page TEXT,
    sales_nu TEXT,
    is_assigned_property BOOLEAN DEFAULT false,
    raw_data JSONB,
    processing_lock BOOLEAN DEFAULT false,
    processing_started_at TIMESTAMP,
    last_updated TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_properties_job_id ON properties(job_id);
CREATE INDEX IF NOT EXISTS idx_properties_composite_key ON properties(property_composite_key);
CREATE INDEX IF NOT EXISTS idx_properties_building_class ON properties(asset_building_class);
CREATE INDEX IF NOT EXISTS idx_properties_assigned ON properties(is_assigned_property);
CREATE INDEX IF NOT EXISTS idx_properties_processing_lock ON properties(processing_lock);
CREATE INDEX IF NOT EXISTS idx_properties_last_updated ON properties(last_updated);

-- Package sales detection index
CREATE INDEX IF NOT EXISTS idx_properties_sales_package ON properties(sales_date, sales_book, sales_page) 
WHERE sales_date IS NOT NULL AND sales_book IS NOT NULL AND sales_page IS NOT NULL;

-- Jobs table (lightweight copy for reference)
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY,
    job_name TEXT NOT NULL,
    ccdd_code TEXT,
    municipality TEXT,
    county TEXT,
    state TEXT,
    vendor_type TEXT,
    status TEXT DEFAULT 'active',
    total_properties INTEGER DEFAULT 0,
    start_date DATE,
    end_date DATE,
    raw_file_content TEXT,
    code_file_content TEXT,
    code_definitions JSONB,
    source_file_status TEXT DEFAULT 'pending',
    code_file_status TEXT DEFAULT 'pending',
    last_updated TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Job indexes
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_vendor_type ON jobs(vendor_type);
CREATE INDEX IF NOT EXISTS idx_jobs_last_updated ON jobs(last_updated);

-- File processing logs table
CREATE TABLE IF NOT EXISTS file_processing_logs (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL,
    operation_type TEXT NOT NULL, -- 'upload', 'process', 'initialize'
    status TEXT NOT NULL, -- 'started', 'progress', 'completed', 'failed'
    message TEXT,
    details JSONB,
    progress_percentage NUMERIC,
    batch_number INTEGER,
    error_details TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Processing logs indexes
CREATE INDEX IF NOT EXISTS idx_file_logs_job_id ON file_processing_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_file_logs_operation ON file_processing_logs(operation_type);
CREATE INDEX IF NOT EXISTS idx_file_logs_status ON file_processing_logs(status);
CREATE INDEX IF NOT EXISTS idx_file_logs_created ON file_processing_logs(created_at);

-- Performance monitoring table
CREATE TABLE IF NOT EXISTS performance_metrics (
    id BIGSERIAL PRIMARY KEY,
    operation_type TEXT NOT NULL,
    job_id UUID,
    duration_ms INTEGER,
    records_processed INTEGER,
    memory_usage_mb NUMERIC,
    success BOOLEAN,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Performance metrics index
CREATE INDEX IF NOT EXISTS idx_perf_metrics_operation ON performance_metrics(operation_type);
CREATE INDEX IF NOT EXISTS idx_perf_metrics_created ON performance_metrics(created_at);

-- Connection health check table
CREATE TABLE IF NOT EXISTS health_checks (
    id BIGSERIAL PRIMARY KEY,
    check_type TEXT NOT NULL, -- 'startup', 'scheduled', 'on-demand'
    database_latency_ms INTEGER,
    connection_count INTEGER,
    memory_usage_mb NUMERIC,
    status TEXT NOT NULL, -- 'healthy', 'degraded', 'unhealthy'
    details JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Health checks index
CREATE INDEX IF NOT EXISTS idx_health_checks_status ON health_checks(status);
CREATE INDEX IF NOT EXISTS idx_health_checks_created ON health_checks(created_at);

-- Function to automatically update last_updated timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for auto-updating timestamps
CREATE TRIGGER update_properties_updated_at 
    BEFORE UPDATE ON properties 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_jobs_updated_at 
    BEFORE UPDATE ON jobs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function for batch insert performance optimization
CREATE OR REPLACE FUNCTION reset_processing_locks()
RETURNS INTEGER AS $$
DECLARE
    reset_count INTEGER;
BEGIN
    UPDATE properties 
    SET processing_lock = false, 
        processing_started_at = NULL,
        last_updated = NOW()
    WHERE processing_lock = true 
      AND processing_started_at < NOW() - INTERVAL '10 minutes';
    
    GET DIAGNOSTICS reset_count = ROW_COUNT;
    RETURN reset_count;
END;
$$ LANGUAGE plpgsql;

-- View for job analytics (used by backend API)
CREATE OR REPLACE VIEW job_analytics AS
SELECT 
    j.id,
    j.job_name,
    j.total_properties,
    COUNT(p.id) as actual_property_count,
    COUNT(CASE WHEN p.is_assigned_property = true THEN 1 END) as assigned_count,
    COUNT(CASE WHEN p.values_mod_total > 0 THEN 1 END) as properties_with_values,
    COUNT(CASE WHEN p.sales_price > 0 THEN 1 END) as properties_with_sales,
    COUNT(CASE WHEN p.asset_building_class = '2' OR p.asset_building_class = '3A' THEN 1 END) as residential_count,
    COUNT(CASE WHEN p.asset_building_class LIKE '4%' THEN 1 END) as commercial_count,
    AVG(CASE WHEN p.values_mod_total > 0 THEN p.values_mod_total END) as avg_assessed_value,
    AVG(CASE WHEN p.sales_price > 0 THEN p.sales_price END) as avg_sale_price,
    MAX(p.last_updated) as last_property_update,
    j.last_updated as job_last_updated
FROM jobs j
LEFT JOIN properties p ON j.id = p.job_id
GROUP BY j.id, j.job_name, j.total_properties, j.last_updated;

-- Performance optimization: Analyze tables for query planning
ANALYZE properties;
ANALYZE jobs;
ANALYZE file_processing_logs;
ANALYZE performance_metrics;
ANALYZE health_checks;

-- Grant permissions for connection pooling user
-- (You'll need to run this with your actual database user)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO your_app_user;

-- Success message
SELECT 'Neon database schema setup completed successfully!' as status;
