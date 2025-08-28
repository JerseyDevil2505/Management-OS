const express = require('express');
const multer = require('multer');
const Papa = require('papaparse');
const pino = require('pino');
const { executeNeonQuery, executeNeonTransaction, executeSupabaseQuery, DatabaseError } = require('../config/database');

const router = express.Router();
const logger = pino();

// ===== FILE UPLOAD CONFIGURATION =====

// Configure multer for file uploads with size limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
    files: 1 // Only 1 file at a time
  },
  fileFilter: (req, file, cb) => {
    // Allow CSV, TXT, and DAT files
    const allowedTypes = ['.csv', '.txt', '.dat'];
    const fileExt = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
    
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`), false);
    }
  }
});

// ===== FILE UPLOAD ENDPOINT =====
// Handles file uploads with progress tracking and resume capability

router.post('/upload', upload.single('file'), async (req, res) => {
  const { jobId, fileType, vendorType } = req.body;
  
  if (!req.file) {
    return res.status(400).json({
      error: 'No file uploaded',
      message: 'Please select a file to upload'
    });
  }

  if (!jobId || !fileType) {
    return res.status(400).json({
      error: 'Missing required fields',
      message: 'jobId and fileType are required'
    });
  }

  const fileInfo = {
    originalName: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype,
    buffer: req.file.buffer
  };

  logger.info({
    jobId,
    fileType,
    vendorType,
    fileName: fileInfo.originalName,
    fileSize: fileInfo.size
  }, 'File upload started');

  try {
    // Step 1: Validate file content
    const fileContent = fileInfo.buffer.toString('utf-8');
    const lines = fileContent.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      return res.status(400).json({
        error: 'Invalid file content',
        message: 'File must contain at least a header and one data row'
      });
    }

    // Step 2: Detect vendor type if not provided
    let detectedVendor = vendorType;
    if (!detectedVendor) {
      const firstLine = lines[0].toLowerCase();
      if (firstLine.includes('block') && firstLine.includes('lot') && firstLine.includes('qualifier')) {
        detectedVendor = 'BRT';
      } else if (firstLine.includes('block') && firstLine.includes('lot') && firstLine.includes('qual')) {
        detectedVendor = 'Microsystems';
      } else {
        detectedVendor = 'Unknown';
      }
    }

    // Step 3: Store file content in Supabase
    const { data: job } = await executeSupabaseQuery('jobs', {
      type: 'update',
      data: {
        [fileType === 'source' ? 'raw_file_content' : 'code_file_content']: fileContent,
        [fileType === 'source' ? 'source_file_status' : 'code_file_status']: 'uploaded',
        vendor_type: detectedVendor,
        vendor_detection: `Auto-detected: ${detectedVendor}`,
        last_updated: new Date().toISOString()
      },
      filters: {
        eq: ['id', jobId]
      }
    });

    // Step 4: Return success response
    const response = {
      success: true,
      message: 'File uploaded successfully',
      fileInfo: {
        name: fileInfo.originalName,
        size: fileInfo.size,
        lines: lines.length,
        vendorType: detectedVendor
      },
      jobId,
      fileType,
      timestamp: new Date().toISOString()
    };

    res.json(response);

    logger.info({
      jobId,
      fileType,
      fileName: fileInfo.originalName,
      fileSize: fileInfo.size,
      linesProcessed: lines.length,
      vendorType: detectedVendor
    }, 'File upload completed successfully');

  } catch (error) {
    logger.error({
      jobId,
      fileType,
      fileName: fileInfo.originalName,
      error: error.message,
      stack: error.stack
    }, 'File upload failed');

    res.status(500).json({
      error: 'File upload failed',
      message: error.message,
      jobId,
      fileType,
      timestamp: new Date().toISOString()
    });
  }
});

// ===== FILE PROCESSING ENDPOINT =====
// Processes uploaded files with streaming progress updates

router.post('/process/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const { fileType = 'source', forceReprocess = false, batchSize = 1000 } = req.body;

  logger.info({
    jobId,
    fileType,
    forceReprocess,
    batchSize
  }, 'File processing started');

  try {
    // Step 1: Get job and file content
    const { data: job } = await executeSupabaseQuery('jobs', {
      type: 'select',
      columns: 'id, job_name, ccdd_code, vendor_type, raw_file_content, code_file_content, start_date',
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
    const fileContent = fileType === 'source' ? jobData.raw_file_content : jobData.code_file_content;

    if (!fileContent) {
      return res.status(400).json({
        error: 'No file content found',
        message: `No ${fileType} file has been uploaded for this job`,
        jobId
      });
    }

    // Step 2: Set up streaming response
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Transfer-Encoding': 'chunked'
    });

    // Send processing start signal
    res.write(JSON.stringify({
      type: 'processing_started',
      jobId,
      fileType,
      timestamp: new Date().toISOString()
    }) + '\n');

    // Step 3: Parse file content
    const lines = fileContent.split('\n').filter(line => line.trim());
    const totalLines = lines.length - 1; // Exclude header
    
    if (totalLines === 0) {
      res.write(JSON.stringify({
        type: 'error',
        error: 'No data rows found in file',
        timestamp: new Date().toISOString()
      }) + '\n');
      res.end();
      return;
    }

    res.write(JSON.stringify({
      type: 'file_parsed',
      totalLines,
      vendorType: jobData.vendor_type,
      timestamp: new Date().toISOString()
    }) + '\n');

    // Step 4: Process file based on vendor type
    if (fileType === 'source') {
      await processSourceFile(res, jobData, lines, batchSize);
    } else if (fileType === 'code') {
      await processCodeFile(res, jobData, lines);
    }

    // Step 5: Send completion signal
    res.write(JSON.stringify({
      type: 'processing_complete',
      success: true,
      jobId,
      fileType,
      timestamp: new Date().toISOString()
    }) + '\n');

    res.end();

    logger.info({
      jobId,
      fileType,
      totalLines
    }, 'File processing completed successfully');

  } catch (error) {
    logger.error({
      jobId,
      fileType,
      error: error.message,
      stack: error.stack
    }, 'File processing failed');

    if (!res.headersSent) {
      res.status(500).json({
        error: 'File processing failed',
        message: error.message,
        jobId,
        fileType,
        timestamp: new Date().toISOString()
      });
    } else {
      res.write(JSON.stringify({
        type: 'error',
        error: error.message,
        jobId,
        fileType,
        timestamp: new Date().toISOString()
      }) + '\n');
      res.end();
    }
  }
});

// ===== SOURCE FILE PROCESSING FUNCTION =====

async function processSourceFile(res, jobData, lines, batchSize) {
  const { id: jobId, ccdd_code, vendor_type, start_date } = jobData;
  const yearCreated = new Date(start_date).getFullYear();
  
  // Parse headers
  const headers = parseHeaders(lines[0], vendor_type);
  const dataLines = lines.slice(1);
  
  res.write(JSON.stringify({
    type: 'headers_parsed',
    headers: headers.length,
    rows: dataLines.length,
    timestamp: new Date().toISOString()
  }) + '\n');

  // Process in batches
  let processedRows = 0;
  let insertedRows = 0;
  const totalRows = dataLines.length;

  for (let i = 0; i < dataLines.length; i += batchSize) {
    const batch = dataLines.slice(i, i + batchSize);
    
    try {
      // Parse batch rows
      const properties = batch.map(line => {
        const values = parseRow(line, vendor_type);
        if (values.length !== headers.length) return null;

        const property = {};
        headers.forEach((header, index) => {
          property[header] = values[index] || null;
        });

        // Generate composite key
        const compositeKey = generateCompositeKey(property, vendor_type, yearCreated, ccdd_code);
        if (!compositeKey) return null;

        return {
          job_id: jobId,
          property_composite_key: compositeKey,
          property_block: getPropertyField(property, 'block', vendor_type),
          property_lot: getPropertyField(property, 'lot', vendor_type),
          property_qualifier: getPropertyField(property, 'qualifier', vendor_type),
          property_location: getPropertyField(property, 'location', vendor_type),
          asset_building_class: getPropertyField(property, 'building_class', vendor_type),
          asset_type_use: getPropertyField(property, 'type_use', vendor_type),
          asset_design_style: getPropertyField(property, 'design_style', vendor_type),
          asset_stories: getPropertyField(property, 'stories', vendor_type),
          asset_ext_cond: getPropertyField(property, 'ext_cond', vendor_type),
          asset_int_cond: getPropertyField(property, 'int_cond', vendor_type),
          values_mod_total: parseFloat(getPropertyField(property, 'total_value', vendor_type)) || 0,
          sales_price: parseFloat(getPropertyField(property, 'sale_price', vendor_type)) || 0,
          sales_date: getPropertyField(property, 'sale_date', vendor_type),
          raw_data: property,
          last_updated: new Date().toISOString()
        };
      }).filter(p => p !== null);

      // Insert batch with conflict handling
      if (properties.length > 0) {
        const insertQuery = `
          INSERT INTO properties (
            job_id, property_composite_key, property_block, property_lot, 
            property_qualifier, property_location, asset_building_class,
            asset_type_use, asset_design_style, asset_stories, asset_ext_cond,
            asset_int_cond, values_mod_total, sales_price, sales_date,
            raw_data, last_updated
          ) VALUES ${properties.map((_, idx) => 
            `($${idx * 17 + 1}, $${idx * 17 + 2}, $${idx * 17 + 3}, $${idx * 17 + 4},
             $${idx * 17 + 5}, $${idx * 17 + 6}, $${idx * 17 + 7}, $${idx * 17 + 8},
             $${idx * 17 + 9}, $${idx * 17 + 10}, $${idx * 17 + 11}, $${idx * 17 + 12},
             $${idx * 17 + 13}, $${idx * 17 + 14}, $${idx * 17 + 15}, $${idx * 17 + 16}, $${idx * 17 + 17})`
          ).join(', ')}
          ON CONFLICT (property_composite_key) 
          DO UPDATE SET
            raw_data = EXCLUDED.raw_data,
            last_updated = EXCLUDED.last_updated
        `;

        const params = properties.flatMap(p => [
          p.job_id, p.property_composite_key, p.property_block, p.property_lot,
          p.property_qualifier, p.property_location, p.asset_building_class,
          p.asset_type_use, p.asset_design_style, p.asset_stories, p.asset_ext_cond,
          p.asset_int_cond, p.values_mod_total, p.sales_price, p.sales_date,
          JSON.stringify(p.raw_data), p.last_updated
        ]);

        await executeNeonQuery(insertQuery, params, 60000); // 60s timeout for large batches
        insertedRows += properties.length;
      }

      processedRows += batch.length;
      
      // Send progress update
      res.write(JSON.stringify({
        type: 'progress',
        processed: processedRows,
        inserted: insertedRows,
        total: totalRows,
        percentage: ((processedRows / totalRows) * 100).toFixed(1),
        timestamp: new Date().toISOString()
      }) + '\n');

    } catch (error) {
      logger.error({
        jobId,
        batchStart: i,
        batchSize: batch.length,
        error: error.message
      }, 'Batch processing failed');

      res.write(JSON.stringify({
        type: 'batch_error',
        batchStart: i,
        batchSize: batch.length,
        error: error.message,
        timestamp: new Date().toISOString()
      }) + '\n');
    }
  }

  // Update job statistics
  try {
    await executeSupabaseQuery('jobs', {
      type: 'update',
      data: {
        total_properties: insertedRows,
        source_file_status: 'processed',
        last_updated: new Date().toISOString()
      },
      filters: {
        eq: ['id', jobId]
      }
    });
  } catch (error) {
    logger.warn({
      jobId,
      error: error.message
    }, 'Failed to update job statistics');
  }
}

// ===== CODE FILE PROCESSING FUNCTION =====

async function processCodeFile(res, jobData, lines) {
  const { id: jobId, vendor_type } = jobData;
  
  res.write(JSON.stringify({
    type: 'parsing_codes',
    totalLines: lines.length,
    vendorType: vendor_type,
    timestamp: new Date().toISOString()
  }) + '\n');

  // Parse code definitions based on vendor type
  let codeDefinitions = {};
  
  if (vendor_type === 'BRT') {
    codeDefinitions = parseBRTCodes(lines);
  } else if (vendor_type === 'Microsystems') {
    codeDefinitions = parseMicrosystemsCodes(lines);
  }

  // Store code definitions in Supabase
  try {
    await executeSupabaseQuery('jobs', {
      type: 'update',
      data: {
        code_definitions: codeDefinitions,
        code_file_status: 'processed',
        last_updated: new Date().toISOString()
      },
      filters: {
        eq: ['id', jobId]
      }
    });

    res.write(JSON.stringify({
      type: 'codes_processed',
      totalCodes: Object.keys(codeDefinitions).length,
      success: true,
      timestamp: new Date().toISOString()
    }) + '\n');

  } catch (error) {
    res.write(JSON.stringify({
      type: 'error',
      error: 'Failed to store code definitions',
      details: error.message,
      timestamp: new Date().toISOString()
    }) + '\n');
  }
}

// ===== UTILITY FUNCTIONS =====

function parseHeaders(headerLine, vendorType) {
  if (vendorType === 'BRT') {
    // BRT can be comma or tab separated
    const commaCount = (headerLine.match(/,/g) || []).length;
    const tabCount = (headerLine.match(/\t/g) || []).length;
    
    if (tabCount > 10 && tabCount > commaCount * 2) {
      return headerLine.split('\t').map(h => h.trim());
    } else {
      return Papa.parse(headerLine).data[0];
    }
  } else if (vendorType === 'Microsystems') {
    return headerLine.split('|').map(h => h.trim());
  }
  
  return headerLine.split(',').map(h => h.trim());
}

function parseRow(rowLine, vendorType) {
  if (vendorType === 'BRT') {
    // Same logic as headers
    const commaCount = (rowLine.match(/,/g) || []).length;
    const tabCount = (rowLine.match(/\t/g) || []).length;
    
    if (tabCount > 10 && tabCount > commaCount * 2) {
      return rowLine.split('\t').map(v => v.trim());
    } else {
      return Papa.parse(rowLine).data[0];
    }
  } else if (vendorType === 'Microsystems') {
    return rowLine.split('|').map(v => v.trim());
  }
  
  return Papa.parse(rowLine).data[0];
}

function generateCompositeKey(property, vendorType, yearCreated, ccddCode) {
  if (vendorType === 'BRT') {
    const block = property.BLOCK || '';
    const lot = property.LOT || '';
    const qualifier = property.QUALIFIER || 'NONE';
    const card = property.CARD || 'NONE';
    const location = property.PROPERTY_LOCATION || 'NONE';
    
    return `${yearCreated}${ccddCode}-${block}-${lot}_${qualifier}-${card}-${location}`;
  } else if (vendorType === 'Microsystems') {
    const block = property.Block || '';
    const lot = property.Lot || '';
    const qual = property.Qual || 'NONE';
    const bldg = property.Bldg || 'NONE';
    const location = property.Location || 'NONE';
    
    return `${yearCreated}${ccddCode}-${block}-${lot}_${qual}-${bldg}-${location}`;
  }
  
  return null;
}

function getPropertyField(property, fieldType, vendorType) {
  const fieldMaps = {
    BRT: {
      block: 'BLOCK',
      lot: 'LOT',
      qualifier: 'QUALIFIER',
      location: 'PROPERTY_LOCATION',
      building_class: 'BLDGCLASS',
      type_use: 'TYPEUSE',
      design_style: 'DESIGN',
      stories: 'STORYHGT',
      ext_cond: 'EXTERIORNC',
      int_cond: 'INTERIORNC',
      total_value: 'MODTOTAL',
      sale_price: 'SALEPRICE',
      sale_date: 'SALEDATE'
    },
    Microsystems: {
      block: 'Block',
      lot: 'Lot',
      qualifier: 'Qual',
      location: 'Location',
      building_class: 'Bldg Qual Class Code',
      type_use: 'Type Use Code',
      design_style: 'Style Code',
      stories: 'Story Height',
      ext_cond: 'Condition',
      int_cond: 'Condition',
      total_value: 'Total Assessed Value',
      sale_price: 'Sale Price',
      sale_date: 'Sale Date'
    }
  };

  const fieldMap = fieldMaps[vendorType];
  return fieldMap ? property[fieldMap[fieldType]] : null;
}

function parseBRTCodes(lines) {
  // Implement BRT code parsing logic
  const codes = {};
  // Add parsing implementation based on BRT format
  return codes;
}

function parseMicrosystemsCodes(lines) {
  // Implement Microsystems code parsing logic
  const codes = {};
  // Add parsing implementation based on Microsystems format
  return codes;
}

module.exports = router;
