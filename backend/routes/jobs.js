const express = require('express');
const pino = require('pino');
const { executeNeonQuery, executeSupabaseQuery, DatabaseError } = require('../config/database');

const router = express.Router();
const logger = pino();

// ===== JOB INITIALIZATION ENDPOINT =====
// Fixes the hanging initialization issue

router.post('/initialize/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const { userId, skipCache = false } = req.body;
  
  logger.info({
    jobId,
    userId,
    skipCache
  }, 'Starting job initialization');

  try {
    // Step 1: Get basic job info from Supabase (fast)
    const { data: job } = await executeSupabaseQuery('jobs', {
      type: 'select',
      columns: `
        id, job_name, ccdd_code, municipality, county, state,
        vendor_type, status, total_properties, start_date, end_date,
        source_file_status, code_file_status, raw_file_content
      `,
      filters: {
        eq: ['id', jobId]
      }
    });

    if (!job || job.length === 0) {
      return res.status(404).json({
        error: 'Job not found',
        jobId
      });
    }

    const jobData = job[0];

    // Step 2: Stream response to prevent timeout
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Transfer-Encoding': 'chunked'
    });

    // Send initial job data
    res.write(JSON.stringify({
      type: 'job_info',
      data: jobData,
      timestamp: new Date().toISOString()
    }) + '\n');

    // Step 3: Get property count with timeout (Neon)
    try {
      const propertyCountQuery = `
        SELECT 
          COUNT(*) as total_count,
          COUNT(CASE WHEN asset_building_class = '2' OR asset_building_class = '3A' THEN 1 END) as residential_count,
          COUNT(CASE WHEN asset_building_class LIKE '4%' THEN 1 END) as commercial_count,
          COUNT(CASE WHEN is_assigned_property = true THEN 1 END) as assigned_count
        FROM properties 
        WHERE job_id = $1
      `;
      
      const countResult = await executeNeonQuery(propertyCountQuery, [jobId], 10000); // 10s timeout
      
      res.write(JSON.stringify({
        type: 'property_counts',
        data: countResult.rows[0],
        timestamp: new Date().toISOString()
      }) + '\n');

    } catch (error) {
      logger.warn({
        jobId,
        error: error.message
      }, 'Property count query failed, using fallback');

      res.write(JSON.stringify({
        type: 'property_counts',
        data: {
          total_count: jobData.total_properties || 0,
          residential_count: 0,
          commercial_count: 0,
          assigned_count: 0
        },
        error: 'Count query timeout - using cached values',
        timestamp: new Date().toISOString()
      }) + '\n');
    }

    // Step 4: Get job assignments (Supabase - fast)
    try {
      const { data: assignments } = await executeSupabaseQuery('job_assignments', {
        type: 'select',
        columns: `
          id, role,
          employee:employees!job_assignments_employee_id_fkey (
            id, first_name, last_name, email, region
          )
        `,
        filters: {
          eq: ['job_id', jobId]
        }
      });

      res.write(JSON.stringify({
        type: 'job_assignments',
        data: assignments || [],
        timestamp: new Date().toISOString()
      }) + '\n');

    } catch (error) {
      logger.warn({
        jobId,
        error: error.message
      }, 'Assignment query failed');

      res.write(JSON.stringify({
        type: 'job_assignments',
        data: [],
        error: 'Assignment query failed',
        timestamp: new Date().toISOString()
      }) + '\n');
    }

    // Step 5: Check for processing status (Neon with timeout)
    try {
      const statusQuery = `
        SELECT 
          COALESCE(SUM(CASE WHEN values_mod_total > 0 THEN 1 ELSE 0 END), 0) as properties_with_values,
          COALESCE(SUM(CASE WHEN sales_price > 0 THEN 1 ELSE 0 END), 0) as properties_with_sales,
          COALESCE(MAX(last_updated), NOW()) as last_processing_update
        FROM properties 
        WHERE job_id = $1
      `;
      
      const statusResult = await executeNeonQuery(statusQuery, [jobId], 15000); // 15s timeout
      
      res.write(JSON.stringify({
        type: 'processing_status',
        data: statusResult.rows[0],
        timestamp: new Date().toISOString()
      }) + '\n');

    } catch (error) {
      logger.warn({
        jobId,
        error: error.message
      }, 'Processing status query failed');

      res.write(JSON.stringify({
        type: 'processing_status',
        data: {
          properties_with_values: 0,
          properties_with_sales: 0,
          last_processing_update: new Date().toISOString()
        },
        error: 'Status query timeout',
        timestamp: new Date().toISOString()
      }) + '\n');
    }

    // Step 6: Final completion signal
    res.write(JSON.stringify({
      type: 'initialization_complete',
      success: true,
      jobId,
      timestamp: new Date().toISOString()
    }) + '\n');

    res.end();

    logger.info({
      jobId,
      userId
    }, 'Job initialization completed successfully');

  } catch (error) {
    logger.error({
      jobId,
      userId,
      error: error.message,
      stack: error.stack
    }, 'Job initialization failed');

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Job initialization failed',
        message: error.message,
        jobId,
        timestamp: new Date().toISOString()
      });
    } else {
      // If streaming already started, send error through stream
      res.write(JSON.stringify({
        type: 'error',
        error: error.message,
        jobId,
        timestamp: new Date().toISOString()
      }) + '\n');
      res.end();
    }
  }
});

// ===== GET PROPERTIES WITH PAGINATION =====
// Replaces the heavy property loading causing timeouts

router.get('/:jobId/properties', async (req, res) => {
  const { jobId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 1000, 5000); // Max 5000 per page
  const offset = (page - 1) * limit;
  
  const filters = {
    building_class: req.query.building_class,
    assigned_only: req.query.assigned_only === 'true',
    has_sales: req.query.has_sales === 'true',
    search: req.query.search
  };

  logger.info({
    jobId,
    page,
    limit,
    filters
  }, 'Loading properties with pagination');

  try {
    // Build the query with proper indexing
    let whereClause = 'WHERE job_id = $1';
    let queryParams = [jobId];
    let paramIndex = 2;

    if (filters.building_class) {
      whereClause += ` AND asset_building_class = $${paramIndex}`;
      queryParams.push(filters.building_class);
      paramIndex++;
    }

    if (filters.assigned_only) {
      whereClause += ` AND is_assigned_property = true`;
    }

    if (filters.has_sales) {
      whereClause += ` AND sales_price > 0`;
    }

    if (filters.search) {
      whereClause += ` AND (
        property_location ILIKE $${paramIndex} OR 
        property_composite_key ILIKE $${paramIndex} OR
        CONCAT(property_block, '-', property_lot) ILIKE $${paramIndex}
      )`;
      queryParams.push(`%${filters.search}%`);
      paramIndex++;
    }

    // Get total count (with timeout)
    const countQuery = `SELECT COUNT(*) as total FROM properties ${whereClause}`;
    const countResult = await executeNeonQuery(countQuery, queryParams, 10000);
    const totalProperties = parseInt(countResult.rows[0].total);

    // Get properties for current page (with timeout)
    const propertiesQuery = `
      SELECT 
        property_composite_key,
        property_block,
        property_lot,
        property_qualifier,
        property_location,
        asset_building_class,
        asset_type_use,
        asset_design_style,
        asset_stories,
        asset_ext_cond,
        asset_int_cond,
        values_mod_total,
        sales_price,
        sales_date,
        is_assigned_property,
        last_updated
      FROM properties 
      ${whereClause}
      ORDER BY property_block::int, property_lot::int
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    queryParams.push(limit, offset);
    const propertiesResult = await executeNeonQuery(propertiesQuery, queryParams, 30000); // 30s timeout

    const response = {
      success: true,
      data: propertiesResult.rows,
      pagination: {
        page,
        limit,
        total: totalProperties,
        totalPages: Math.ceil(totalProperties / limit),
        hasNext: offset + limit < totalProperties,
        hasPrev: page > 1
      },
      filters,
      timestamp: new Date().toISOString()
    };

    res.json(response);

    logger.info({
      jobId,
      page,
      propertiesReturned: propertiesResult.rows.length,
      totalProperties
    }, 'Properties loaded successfully');

  } catch (error) {
    logger.error({
      jobId,
      page,
      limit,
      error: error.message,
      stack: error.stack
    }, 'Properties loading failed');

    res.status(500).json({
      error: 'Failed to load properties',
      message: error.message,
      jobId,
      page,
      timestamp: new Date().toISOString()
    });
  }
});

// ===== EMERGENCY RECOVERY ENDPOINT =====
// Resets stuck operations

router.post('/:jobId/recover', async (req, res) => {
  const { jobId } = req.params;
  const { userId, operation = 'full' } = req.body;

  logger.warn({
    jobId,
    userId,
    operation
  }, 'Emergency recovery initiated');

  try {
    const recoveryActions = [];

    if (operation === 'full' || operation === 'initialization') {
      // Clear any stuck initialization flags
      await executeSupabaseQuery('jobs', {
        type: 'update',
        data: {
          source_file_status: 'ready',
          last_updated: new Date().toISOString()
        },
        filters: {
          eq: ['id', jobId]
        }
      });
      recoveryActions.push('Reset initialization status');
    }

    if (operation === 'full' || operation === 'processing') {
      // Reset any processing locks in the database
      const resetQuery = `
        UPDATE properties 
        SET processing_lock = false, 
            processing_started_at = NULL,
            last_updated = NOW()
        WHERE job_id = $1 AND processing_lock = true
      `;
      
      const result = await executeNeonQuery(resetQuery, [jobId]);
      recoveryActions.push(`Reset ${result.rowCount} stuck property locks`);
    }

    res.json({
      success: true,
      message: 'Emergency recovery completed',
      actions: recoveryActions,
      jobId,
      timestamp: new Date().toISOString()
    });

    logger.info({
      jobId,
      userId,
      actions: recoveryActions
    }, 'Emergency recovery completed successfully');

  } catch (error) {
    logger.error({
      jobId,
      userId,
      error: error.message,
      stack: error.stack
    }, 'Emergency recovery failed');

    res.status(500).json({
      error: 'Recovery failed',
      message: error.message,
      jobId,
      timestamp: new Date().toISOString()
    });
  }
});

// ===== JOB ANALYTICS ENDPOINT =====
// Provides quick stats without heavy queries

router.get('/:jobId/analytics', async (req, res) => {
  const { jobId } = req.params;

  try {
    // Use optimized queries with appropriate timeouts
    const analyticsQuery = `
      SELECT 
        COUNT(*) as total_properties,
        COUNT(CASE WHEN is_assigned_property = true THEN 1 END) as assigned_properties,
        COUNT(CASE WHEN values_mod_total > 0 THEN 1 END) as properties_with_values,
        COUNT(CASE WHEN sales_price > 0 THEN 1 END) as properties_with_sales,
        AVG(CASE WHEN values_mod_total > 0 THEN values_mod_total END) as avg_assessed_value,
        AVG(CASE WHEN sales_price > 0 THEN sales_price END) as avg_sale_price,
        MAX(last_updated) as last_processing_update
      FROM properties 
      WHERE job_id = $1
    `;

    const result = await executeNeonQuery(analyticsQuery, [jobId], 20000); // 20s timeout
    const analytics = result.rows[0];

    // Calculate percentages
    const totalProperties = parseInt(analytics.total_properties);
    const assignedProperties = parseInt(analytics.assigned_properties);
    
    const response = {
      success: true,
      data: {
        ...analytics,
        assignment_percentage: totalProperties > 0 ? (assignedProperties / totalProperties * 100).toFixed(1) : 0,
        completion_percentage: totalProperties > 0 ? (parseInt(analytics.properties_with_values) / totalProperties * 100).toFixed(1) : 0,
        sales_percentage: totalProperties > 0 ? (parseInt(analytics.properties_with_sales) / totalProperties * 100).toFixed(1) : 0
      },
      jobId,
      timestamp: new Date().toISOString()
    };

    res.json(response);

    logger.debug({
      jobId,
      totalProperties,
      assignedProperties
    }, 'Job analytics retrieved successfully');

  } catch (error) {
    logger.error({
      jobId,
      error: error.message
    }, 'Job analytics failed');

    res.status(500).json({
      error: 'Failed to get job analytics',
      message: error.message,
      jobId,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
