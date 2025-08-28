-- =============================================================================
-- FIND DEPENDENCIES ON VALIDATION_STATUS COLUMN
-- =============================================================================

-- 1. CHECK FOR VIEWS THAT REFERENCE validation_status
SELECT 
  schemaname,
  viewname,
  definition
FROM pg_views 
WHERE definition ILIKE '%validation_status%';

-- 2. CHECK FOR INDEXES ON validation_status
SELECT 
  i.relname as index_name,
  t.relname as table_name,
  a.attname as column_name
FROM pg_class t
JOIN pg_index ix ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_attribute a ON t.oid = a.attrelid
WHERE a.attname = 'validation_status'
  AND t.relname = 'property_records';

-- 3. CHECK FOR FOREIGN KEY CONSTRAINTS
SELECT 
  conname as constraint_name,
  conrelid::regclass as table_name,
  confrelid::regclass as referenced_table,
  pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint 
WHERE pg_get_constraintdef(oid) ILIKE '%validation_status%';

-- 4. CHECK FOR FUNCTIONS/PROCEDURES THAT REFERENCE validation_status
SELECT 
  p.proname as function_name,
  n.nspname as schema_name,
  pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE pg_get_functiondef(p.oid) ILIKE '%validation_status%';

-- 5. CHECK FOR TRIGGERS
SELECT 
  t.tgname as trigger_name,
  c.relname as table_name,
  pg_get_triggerdef(t.oid) as trigger_definition
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE pg_get_triggerdef(t.oid) ILIKE '%validation_status%';

-- 6. GENERAL DEPENDENCY CHECK
SELECT 
  d.classid::regclass as dependent_type,
  d.objid,
  d.objsubid,
  d.refclassid::regclass as referenced_type,
  d.refobjid,
  d.refobjsubid,
  d.deptype
FROM pg_depend d
JOIN pg_attribute a ON d.refobjid = a.attrelid AND d.refobjsubid = a.attnum
WHERE a.attname = 'validation_status'
  AND a.attrelid = 'property_records'::regclass;
