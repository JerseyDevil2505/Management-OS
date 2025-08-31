import React, { useState, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertTriangle, X, Database, Settings, Download, Eye, Calendar, RefreshCw } from 'lucide-react';
import { jobService, propertyService, supabase, preservedFieldsHandler } from '../../lib/supabaseClient';

const FileUploadButton = ({
  job,
  onFileProcessed,
  isJobLoading = false,
  onDataRefresh,
  isJobContainerLoading = false  // Accept loading state from JobContainer
}) => {
  const [sourceFile, setSourceFile] = useState(null);
  const [codeFile, setCodeFile] = useState(null);
  // REMOVED: No need for detectedVendor state - use job.vendor_type directly
  const [sourceFileContent, setSourceFileContent] = useState(null);
  const [codeFileContent, setCodeFileContent] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [isProcessingLocked, setIsProcessingLocked] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [comparisonResults, setComparisonResults] = useState(null);
  const [salesDecisions, setSalesDecisions] = useState(new Map());
  const [currentFileVersion, setCurrentFileVersion] = useState(1);
  const [lastSourceProcessedDate, setLastSourceProcessedDate] = useState(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [lastCodeProcessedDate, setLastCodeProcessedDate] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);  

  const [showReportsModal, setShowReportsModal] = useState(false);
  const [reportsList, setReportsList] = useState([]);
  const [reportCount, setReportCount] = useState(0);
  const [loadingReports, setLoadingReports] = useState(false);

  // Pagination for reports modal
  const [currentReportPage, setCurrentReportPage] = useState(1);
  const [reportsPerPage, setReportsPerPage] = useState(5);

  // Modal resize functionality
  const [modalSize, setModalSize] = useState({
    width: 800,
    height: 600
  });
  
  // NEW: Batch processing modal state
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchLogs, setBatchLogs] = useState([]);
  const [currentBatch, setCurrentBatch] = useState(null);
  const [batchComplete, setBatchComplete] = useState(false);
 
  // ENHANCED: Add batch insert progress tracking
  const [batchInsertProgress, setBatchInsertProgress] = useState({
    totalBatches: 0,
    currentBatch: 0,
    batchSize: 500,
    insertAttempts: [],
    isInserting: false,
    currentOperation: ''
  });


  // REMOVED: No syncing needed - use job.vendor_type directly

  const addNotification = (message, type = 'info') => {
    const id = Date.now() + Math.random(); // Make unique with random component
    const notification = { id, message, type, timestamp: new Date() };
    setNotifications(prev => [...prev, notification]);
    
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const removeNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  // NEW: Add log entry to batch processing
  const addBatchLog = (message, type = 'info', details = null) => {
    const logEntry = {
      id: Date.now() + Math.random(), // Make unique with random component
      timestamp: new Date().toISOString(),
      message,
      type,
      details
    };
    setBatchLogs(prev => [...prev, logEntry]);
    
    // Also update current batch info for summary display
    if (type === 'batch_start') {
      setCurrentBatch(details);
    }
  };

  // NEW: Clear batch logs for new processing session
  const clearBatchLogs = () => {
    setBatchLogs([]);
    setCurrentBatch(null);
    setBatchComplete(false);
    setBatchInsertProgress({
      totalBatches: 0,
      currentBatch: 0,
      batchSize: 500,
      insertAttempts: [],
      isInserting: false,
      currentOperation: ''
    });
  };


  // FIXED: Use exact same date parsing method as processors
  const parseDate = (dateString) => {
    if (!dateString || dateString.trim() === '') return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
  };

  // FIXED: Composite key generation that matches processors EXACTLY
  const generateCompositeKey = (record, vendor, yearCreated, ccddCode) => {
    if (vendor === 'BRT') {
      // BRT format: preserve string values exactly as processors do
      const blockValue = String(record.BLOCK || '').trim();
      const lotValue = String(record.LOT || '').trim();
      const qualifierValue = String(record.QUALIFIER || '').trim() || 'NONE';
      const cardValue = String(record.CARD || '').trim() || 'NONE';
      const locationValue = String(record.PROPERTY_LOCATION || '').trim() || 'NONE';
      
      return `${yearCreated}${ccddCode}-${blockValue}-${lotValue}_${qualifierValue}-${cardValue}-${locationValue}`;
    } else if (vendor === 'Microsystems') {
      // FIXED: Microsystems format - EXACT MATCH to processor logic
      const blockValue = String(record['Block'] || '').trim();
      const lotValue = String(record['Lot'] || '').trim();
      const qualValue = String(record['Qual'] || '').trim() || 'NONE';
      const bldgValue = String(record['Bldg'] || '').trim() || 'NONE';
      const locationValue = String(record['Location'] || '').trim() || 'NONE';
      
      // This EXACTLY matches the processor: property_composite_key: `${yearCreated}${ccddCode}-${rawRecord['Block']}-${rawRecord['Lot']}_${(rawRecord['Qual'] || '').trim() || 'NONE'}-${(rawRecord['Bldg'] || '').trim() || 'NONE'}-${(rawRecord['Location'] || '').trim() || 'NONE'}`
      return `${yearCreated}${ccddCode}-${blockValue}-${lotValue}_${qualValue}-${bldgValue}-${locationValue}`;
    }
    
    return null;
  };

  // REMOVED: No longer needed - vendor type comes from job data

  // NEW: Parse BRT mixed format code files (headers + JSON sections)
  const parseBRTMixedFormat = (fileContent) => {
    const lines = fileContent.split('\n');
    let currentSection = null;
    let jsonBuffer = '';
    let inJsonBlock = false;
    const allSections = {};
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (!line) continue;
      
      if (!line.startsWith('{') && !line.startsWith('"') && !inJsonBlock) {
        // Process previous section if exists
        if (jsonBuffer && currentSection) {
          try {
            allSections[currentSection] = JSON.parse(jsonBuffer);
          } catch (error) {
            console.warn(`Failed to parse section ${currentSection}:`, error);
          }
        }
        
        currentSection = line;
        jsonBuffer = '';
        inJsonBlock = false;
        continue;
      }
      
      if (line.startsWith('{') || inJsonBlock) {
        inJsonBlock = true;
        jsonBuffer += line;
        
        const openBrackets = (jsonBuffer.match(/\{/g) || []).length;
        const closeBrackets = (jsonBuffer.match(/\}/g) || []).length;
        
        if (openBrackets === closeBrackets && openBrackets > 0) {
          if (currentSection) {
            try {
              allSections[currentSection] = JSON.parse(jsonBuffer);
            } catch (error) {
              console.warn(`Failed to parse section ${currentSection}:`, error);
            }
          }
          jsonBuffer = '';
          inJsonBlock = false;
        }
      }
    }
    
    // Process final section
    if (jsonBuffer && currentSection) {
      try {
        allSections[currentSection] = JSON.parse(jsonBuffer);
      } catch (error) {
        console.warn(`Failed to parse final section ${currentSection}:`, error);
      }
    }
    
    return allSections;
  };

  // FIXED: Enhanced code file parsing with BRT mixed format support
  const parseCodeFile = (fileContent, vendor) => {
    try {
      if (vendor === 'BRT') {
        // Check if it's pure JSON or mixed format
        const trimmedContent = fileContent.trim();
        if (trimmedContent.startsWith('{')) {
          // Pure JSON format
          const codeData = JSON.parse(fileContent);
          return codeData;
        } else {
          // Mixed format with headers - extract JSON sections
          const sections = parseBRTMixedFormat(fileContent);
          return sections;
        }
      } else if (vendor === 'Microsystems') {
        // Microsystems codes are pipe-delimited text
        const lines = fileContent.split('\n').filter(line => line.trim());
        const codes = {};
        
        lines.forEach(line => {
          const parts = line.split('|');
          if (parts.length >= 2) {
            const code = parts[0].trim();
            const description = parts[1].trim();
            codes[code] = description;
          }
        });
        
        return codes;
      }
      
      return null;
    } catch (error) {
      console.error('Error parsing code file:', error);
      return null;
    }
  };

// FIXED: Handle code file update with proper Unicode sanitization and BRT support
const handleCodeFileUpdate = async () => {
  if (!codeFile || !codeFileContent) {
    addNotification('Please select a code file first', 'error');
    return;
  }

  // Vendor type is now guaranteed from JobContainer props

  try {
    setProcessing(true);
    setProcessingStatus('Processing code file...');

    // Call the actual processor to handle the code file properly
    if (job.vendor_type === 'BRT') {
      const { brtProcessor } = await import('../../lib/data-pipeline/brt-processor.js');
      await brtProcessor.processCodeFile(codeFileContent, job.id);
    } else if (job.vendor_type === 'Microsystems') {
      const { microsystemsProcessor } = await import('../../lib/data-pipeline/microsystems-processor.js');
      await microsystemsProcessor.processCodeFile(codeFileContent, job.id);
    } else {
      throw new Error('Unsupported vendor type');
    }
    
    // Only update date stamp if we successfully got here
    const processedDate = new Date().toISOString();
    setLastCodeProcessedDate(processedDate);

    // Store in sessionStorage to persist across re-renders
    sessionStorage.setItem(`job_${job.id}_lastCodeProcessed`, processedDate);

    // Update job's code file version
    const currentCodeVersion = job.code_file_version || 1;
    const newCodeVersion = currentCodeVersion + 1;

    console.log(`🔧 Code Update - Current version: ${currentCodeVersion}, New version: ${newCodeVersion}`);

    const updateResult = await jobService.update(job.id, {
      code_file_version: newCodeVersion,
      code_file_uploaded_at: processedDate
    });

    console.log(`🔧 Code Update - jobService.update result:`, updateResult);

    addNotification(`✅ Successfully updated code definitions for ${job.vendor_type}`, 'success');

    // Clear code file selection
    setCodeFile(null);
    setCodeFileContent(null);
    document.getElementById('code-file-upload').value = '';

    // Refresh job data in parent component
    if (onDataRefresh) {
      console.log(`���� Code Update - Calling onDataRefresh to update job data`);
      console.log(`🔧 Code Update - BEFORE refresh - job.code_file_uploaded_at: ${job.code_file_uploaded_at}`);
      console.log(`🔧 Code Update - BEFORE refresh - job.code_file_version: ${job.code_file_version}`);

      await onDataRefresh();

      console.log(`🔧 Code Update - AFTER refresh - job.code_file_uploaded_at: ${job.code_file_uploaded_at}`);
      console.log(`🔧 Code Update - AFTER refresh - job.code_file_version: ${job.code_file_version}`);

      // Wait a bit and check again - sometimes React needs a moment to update props
      setTimeout(() => {
        console.log(`🔧 Code Update - DELAYED check - job.code_file_uploaded_at: ${job.code_file_uploaded_at}`);
        console.log(`���� Code Update - DELAYED check - job.code_file_version: ${job.code_file_version}`);
      }, 1000);
    }

    // Notify parent component of the update
    if (onFileProcessed) {
      onFileProcessed({
        type: 'code_update',
        vendor: job.vendor_type
      });
    }

  } catch (error) {
    console.error('❌ Code file update failed:', error);
    addNotification(`Code file update failed: ${error.message}`, 'error');
    // Don't update the date if we failed!
  } finally {
    setProcessing(false);
    setProcessingStatus('');
  }
};

  // FIXED: Parse files with exact processor logic
  const parseSourceFile = (fileContent, vendor) => {
    const lines = fileContent.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    // Defensive check for undefined vendor
    if (!vendor) {
      throw new Error('Vendor type is required but not provided');
    }

    let headers, separator;

    if (vendor === 'BRT') {
      // Auto-detect BRT separator (comma vs tab)
      const firstLine = lines[0];
      const commaCount = (firstLine.match(/,/g) || []).length;
      const tabCount = (firstLine.match(/\t/g) || []).length;

      separator = (tabCount > 10 && tabCount > commaCount * 2) ? '\t' : ',';

      if (separator === ',') {
        headers = parseCSVLine(lines[0]);
      } else {
        headers = lines[0].split('\t').map(h => h.trim());
      }
    } else if (vendor === 'Microsystems') {
      separator = '|';
      const originalHeaders = lines[0].split('|');
      headers = renameDuplicateHeaders(originalHeaders);
    } else {
      throw new Error(`Unsupported vendor type: "${vendor}". Expected 'BRT' or 'Microsystems'`);
    }

    // Additional safety check
    if (!headers) {
      throw new Error('Failed to parse file headers');
    }
    
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      let values;
      
      if (vendor === 'BRT') {
        values = separator === ',' ? parseCSVLine(lines[i]) : lines[i].split('\t').map(v => v.trim());
      } else if (vendor === 'Microsystems') {
        values = lines[i].split('|');
      }
      
      if (values.length !== headers.length) continue;
      
      const record = {};
      headers.forEach((header, index) => {
        record[header] = values[index] || null;
      });
      
      records.push(record);
    }
    
    return records;
  };

  // Helper functions for parsing
  const parseCSVLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    let i = 0;
    
    while (i < line.length) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
        i++;
        continue;
      } else {
        current += char;
      }
      
      i++;
    }
    
    result.push(current.trim());
    return result;
  };

  const renameDuplicateHeaders = (originalHeaders) => {
    const headerCounts = {};
    return originalHeaders.map(header => {
      if (headerCounts[header]) {
        headerCounts[header]++;
        return `${header}${headerCounts[header]}`;
      } else {
        headerCounts[header] = 1;
        return header;
      }
    });
  };

  // NEW: Save comparison report to database in old CSV format
  const saveComparisonReport = async (comparisonResults, salesDecisions) => {
    try {
      // Structure data to match old CSV format
      const reportChanges = [];
      const reportDate = new Date().toLocaleDateString();
      
      // Add removed properties
      if (comparisonResults.details.missing?.length > 0) {
        comparisonResults.details.missing.forEach(record => {
          const blockField = job.vendor_type === 'BRT' ? 'BLOCK' : 'Block';
          const lotField = job.vendor_type === 'BRT' ? 'LOT' : 'Lot';
          const qualifierField = job.vendor_type === 'BRT' ? 'QUALIFIER' : 'Qual';
          const locationField = job.vendor_type === 'BRT' ? 'PROPERTY_LOCATION' : 'Location';
          
          reportChanges.push({
            Report_Date: reportDate,
            Change_Type: 'Property_Added',
            Block: record[blockField],
            Lot: record[lotField],
            Qualifier: record[qualifierField] || '',
            Property_Location: record[locationField] || '',
            Old_Value: 'Property_Not_Existed',
            New_Value: 'Property_Added',
            Status: 'pending_review',
            Reviewed_By: null,
            Reviewed_Date: null
          });
        });
      }

      // Add deleted properties
      if (comparisonResults.details.deletions?.length > 0) {
        comparisonResults.details.deletions.forEach(record => {
          reportChanges.push({
            Report_Date: reportDate,
            Change_Type: 'Property_Removed',
            Block: record.property_block,
            Lot: record.property_lot,
            Qualifier: record.property_qualifier || '',
            Property_Location: record.property_location || '',
            Old_Value: 'Property_Existed',
            New_Value: 'Property_Removed',
            Status: 'pending_review',
            Reviewed_By: null,
            Reviewed_Date: null
          });
        });
      }

      // Add class changes
      if (comparisonResults.details.classChanges?.length > 0) {
        comparisonResults.details.classChanges.forEach(change => {
          change.changes.forEach(classChange => {
            reportChanges.push({
              Report_Date: reportDate,
              Change_Type: 'Class_Change',
              Block: change.property_block,
              Lot: change.property_lot,
              Qualifier: change.property_qualifier || '',
              Property_Location: change.property_location || '',
              Old_Value: classChange.old || '',
              New_Value: classChange.new || '',
              Status: 'pending_review',
              Reviewed_By: null,
              Reviewed_Date: null
            });
          });
        });
      }

      // Add sales changes with decisions
      if (comparisonResults.details.salesChanges?.length > 0) {
        comparisonResults.details.salesChanges.forEach(change => {
          const decision = salesDecisions.get(change.property_composite_key) || 'Keep New (default)';
          const oldSaleValue = change.differences.sales_price.old ? 
            `$${change.differences.sales_price.old.toLocaleString()} (${change.differences.sales_date.old || 'No Date'})` : 
            'No_Sale';
          const newSaleValue = change.differences.sales_price.new ? 
            `$${change.differences.sales_price.new.toLocaleString()} (${change.differences.sales_date.new || 'No Date'})` : 
            'No_Sale';
            
          reportChanges.push({
            Report_Date: reportDate,
            Change_Type: 'Sales_Change',
            Block: change.property_block,
            Lot: change.property_lot,
            Qualifier: change.property_qualifier || '',
            Property_Location: change.property_location || '',
            Old_Value: oldSaleValue,
            New_Value: newSaleValue,
            Status: 'reviewed',
            Reviewed_By: 'user', // TODO: Get actual user
            Reviewed_Date: new Date().toLocaleDateString()
          });
        });
      }

      const reportData = {
        summary: comparisonResults.summary,
        changes: reportChanges,
        sales_decisions: Object.fromEntries(salesDecisions),
        vendor_detected: job.vendor_type,
        source_file_name: sourceFile?.name,
        comparison_timestamp: new Date().toISOString()
      };

      // Extract property keys for the new structured fields
      const propertiesAdded = [];
      const propertiesRemoved = [];
      const propertiesModified = [];

      // Extract added property keys (from source file records)
      if (comparisonResults.details.missing?.length > 0) {
        comparisonResults.details.missing.forEach(record => {
          // Generate composite key from source record
          const blockField = job.vendor_type === 'BRT' ? 'BLOCK' : 'Block';
          const lotField = job.vendor_type === 'BRT' ? 'LOT' : 'Lot';
          const qualifierField = job.vendor_type === 'BRT' ? 'QUALIFIER' : 'Qual';
          const cardField = job.vendor_type === 'BRT' ? 'CARD' : 'Bldg';
          const locationField = job.vendor_type === 'BRT' ? 'PROPERTY_LOCATION' : 'Location';

          // Construct composite key similar to processors
          const year = job.start_date ? new Date(job.start_date).getFullYear() : new Date().getFullYear();
          const ccddCode = job.ccdd_code || '';
          const block = String(record[blockField] || '').trim();
          const lot = String(record[lotField] || '').trim();
          const qualifier = String(record[qualifierField] || '').trim() || 'NONE';
          const card = String(record[cardField] || '').trim() || 'NONE';
          const location = String(record[locationField] || '').trim() || 'NONE';

          const compositeKey = `${year}${ccddCode}-${block}-${lot}_${qualifier}-${card}-${location}`;
          propertiesAdded.push(compositeKey);
        });
      }

      // Extract removed property keys (from database records)
      if (comparisonResults.details.deletions?.length > 0) {
        comparisonResults.details.deletions.forEach(record => {
          if (record.property_composite_key) {
            propertiesRemoved.push(record.property_composite_key);
          }
        });
      }

      // Extract modified property keys (from various change types)
      if (comparisonResults.details.changes?.length > 0) {
        comparisonResults.details.changes.forEach(record => {
          if (record.property_composite_key) {
            propertiesModified.push(record.property_composite_key);
          }
        });
      }

      if (comparisonResults.details.classChanges?.length > 0) {
        comparisonResults.details.classChanges.forEach(change => {
          if (change.property_composite_key) {
            propertiesModified.push(change.property_composite_key);
          }
        });
      }

      if (comparisonResults.details.salesChanges?.length > 0) {
        comparisonResults.details.salesChanges.forEach(change => {
          if (change.property_composite_key) {
            propertiesModified.push(change.property_composite_key);
          }
        });
      }

      // Remove duplicates from modified properties
      const uniquePropertiesModified = [...new Set(propertiesModified)];

      console.log(`📊 Property tracking summary:`, {
        added: propertiesAdded.length,
        removed: propertiesRemoved.length,
        modified: uniquePropertiesModified.length
      });

      const { data, error } = await supabase
        .from('comparison_reports')
        .insert([{
          job_id: job.id,
          report_data: reportData,
          properties_added: propertiesAdded,
          properties_removed: propertiesRemoved,
          properties_modified: uniquePropertiesModified,
          report_date: new Date().toISOString(),
          generated_by: 'FileUploadButton',
          status: 'generated'
        }])
        .select()
        .single();

      if (error) {
        console.error('Error saving comparison report:', error);
        addNotification('⚠️ Comparison completed but report save failed', 'warning');
      } else {
      }

      return data;
    } catch (error) {
    }
  };

  // NEW: Export comparison results in old CSV format
  const exportComparisonReport = () => {
    if (!comparisonResults) return;

    // Create CSV content matching old format
    let csvContent = "Report_Date,Change_Type,Block,Lot,Qualifier,Property_Location,Old_Value,New_Value,Status,Reviewed_By,Reviewed_Date\n";
    
    const reportDate = new Date().toLocaleDateString();
    
    // Add new records
    if (comparisonResults.details.missing?.length > 0) {
      comparisonResults.details.missing.forEach(record => {
        const blockField = job.vendor_type === 'BRT' ? 'BLOCK' : 'Block';
        const lotField = job.vendor_type === 'BRT' ? 'LOT' : 'Lot';
        const qualifierField = job.vendor_type === 'BRT' ? 'QUALIFIER' : 'Qual';
        const locationField = job.vendor_type === 'BRT' ? 'PROPERTY_LOCATION' : 'Location';
        
        csvContent += `"${reportDate}","Property_Added","${record[blockField]}","${record[lotField]}","${record[qualifierField] || ''}","${record[locationField] || ''}","Property_Not_Existed","Property_Added","pending_review","",""\n`;
      });
    }

    // Add sales changes with decisions
    if (comparisonResults.details.salesChanges?.length > 0) {
      comparisonResults.details.salesChanges.forEach(change => {
        const decision = salesDecisions.get(change.property_composite_key) || 'Keep New (default)';
        const oldSaleValue = change.differences.sales_price.old ? 
          `$${change.differences.sales_price.old.toLocaleString()} (${change.differences.sales_date.old || 'No Date'})` : 
          'No_Sale';
        const newSaleValue = change.differences.sales_price.new ? 
          `$${change.differences.sales_price.new.toLocaleString()} (${change.differences.sales_date.new || 'No Date'})` : 
          'No_Sale';
          
        csvContent += `"${reportDate}","Sales_Change","${change.property_block}","${change.property_lot}","${change.property_qualifier || ''}","${change.property_location || ''}","${oldSaleValue}","${newSaleValue}","reviewed","user","${reportDate}"\n`;
      });
    }

    // Download the file
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${job.name}_Comparison_Report_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    addNotification('📊 Comparison report exported', 'success');
  };

  // FIXED: Comparison logic using property_records directly instead of current_properties view
  const performComparison = async () => {
    if (!sourceFileContent || !job) return null;

    try {
      setProcessingStatus('Analyzing files...');

      // Get vendor type directly from job data
      if (!job.vendor_type) {
        throw new Error('Vendor type not found in job data. Please check job configuration.');
      }

      // Parse source file
      const sourceRecords = parseSourceFile(sourceFileContent, job.vendor_type);
      
      // FIXED: Get ALL database records from property_records table directly
      setProcessingStatus('Fetching current database records...');
      
      // DEBUG: Check actual count in database
      const { count: actualCount, error: countError } = await supabase
        .from('property_records')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', job.id);
   
     
      // FIXED: Use pagination to get ALL records instead of relying on limit
      let allDbRecords = [];
      let rangeStart = 0;
      const batchSize = 1000;
      let hasMore = true;
      
      while (hasMore) {
        const { data: batch, error: batchError } = await supabase
          .from('property_records')
          .select('property_composite_key, property_block, property_lot, property_qualifier, property_location, sales_price, sales_date, sales_nu, sales_book, sales_page, property_m4_class, property_cama_class')
          .eq('job_id', job.id)
          .range(rangeStart, rangeStart + batchSize - 1);
          
        if (batchError) {
          console.error('🔍 DEBUG - Batch error:', batchError);
          break;
        }
       
     
        if (batch && batch.length > 0) {
          allDbRecords = allDbRecords.concat(batch);
          rangeStart += batchSize;
          hasMore = batch.length === batchSize; // If we got less than batch size, we're done
        } else {
          hasMore = false;
        }
      }
      
      const dbRecords = allDbRecords;
      const dbError = null;
        
      
      if (dbError) {
        throw new Error(`Database fetch failed: ${dbError.message}`);
      }
      
      
      // Generate composite keys for source records using EXACT processor logic
      setProcessingStatus('Generating composite keys...');
      const yearCreated = job.year_created || new Date().getFullYear();
      const ccddCode = job.ccdd_code || job.ccddCode;
      
      const sourceKeys = new Set();
      const sourceKeyMap = new Map();
      
      sourceRecords.forEach(record => {
        const compositeKey = generateCompositeKey(record, job.vendor_type, yearCreated, ccddCode);
        if (compositeKey) {
          sourceKeys.add(compositeKey);
          sourceKeyMap.set(compositeKey, record);
        }
      });
      
      
      // Create database key sets
      const dbKeys = new Set(dbRecords.map(r => r.property_composite_key));
      const dbKeyMap = new Map(dbRecords.map(r => [r.property_composite_key, r]));
      
      
      // Find differences
      setProcessingStatus('Comparing records...');
      
      // Missing records (in source but not in database)
      const missingKeys = [...sourceKeys].filter(key => !dbKeys.has(key));
      const missing = missingKeys.map(key => sourceKeyMap.get(key));
      
      // Extra records (in database but not in source) 
      const extraKeys = [...dbKeys].filter(key => !sourceKeys.has(key));
      const deletions = extraKeys.map(key => dbKeyMap.get(key));
      
      // Changed records (same key, different data)
      const changes = [];
      const salesChanges = [];
      const classChanges = [];
      
      [...sourceKeys].filter(key => dbKeys.has(key)).forEach(key => {
        const sourceRecord = sourceKeyMap.get(key);
        const dbRecord = dbKeyMap.get(key);
        
        // FIXED: Check for sales changes with proper number and date comparison
        const sourceSalesPrice = parseFloat(String(sourceRecord[job.vendor_type === 'BRT' ? 'CURRENTSALE_PRICE' : 'Sale Price'] || 0).replace(/[,$]/g, '')) || 0;
        const dbSalesPrice = parseFloat(dbRecord.sales_price || 0);

        // ADD: Get sales_nu values
        const sourceSalesNu = sourceRecord[job.vendor_type === 'BRT' ? 'CURRENTSALE_NU' : 'Sale Nu'] || '';
        const dbSalesNu = dbRecord.sales_nu || '';
        const sourceSalesBook = sourceRecord[job.vendor_type === 'BRT' ? 'CURRENTSALE_DEEDBOOK' : 'Sale Book'] || '';
        const dbSalesBook = dbRecord.sales_book || '';
        const sourceSalesPage = sourceRecord[job.vendor_type === 'BRT' ? 'CURRENTSALE_DEEDPAGE' : 'Sale Page'] || '';
        const dbSalesPage = dbRecord.sales_page || '';
          
        // FIXED: Normalize both dates for accurate comparison using processor method
        const sourceSalesDate = parseDate(sourceRecord[job.vendor_type === 'BRT' ? 'CURRENTSALE_DATE' : 'Sale Date']);
        const dbSalesDate = parseDate(dbRecord.sales_date);
        
        // FIXED: Use proper number comparison with reasonable tolerance AND normalized date comparison
        const pricesDifferent = Math.abs(sourceSalesPrice - dbSalesPrice) > 0.01;
        const datesDifferent = sourceSalesDate !== dbSalesDate;
        const booksDifferent = sourceSalesBook !== dbSalesBook;
        const pagesDifferent = sourceSalesPage !== dbSalesPage;
        
        /* DEBUG: Log the first few sales comparisons to see what's happening
        if ((pricesDifferent || datesDifferent) && salesChanges.length < 3) {
          console.log(`🔍 Sales difference detected for ${key}:`, {
            sourcePrice: sourceSalesPrice,
            dbPrice: dbSalesPrice, 
            pricesDifferent,
            sourceDateRaw: sourceRecord[job.vendor_type === 'BRT' ? 'CURRENTSALE_DATE' : 'Sale Date'],
            sourceDateNormalized: sourceSalesDate,
            dbDateRaw: dbRecord.sales_date,
            dbDateNormalized: dbSalesDate,
            datesDifferent
          });
        }
        */
        if (pricesDifferent || datesDifferent) {
          salesChanges.push({
            property_composite_key: key,
            property_block: dbRecord.property_block,
            property_lot: dbRecord.property_lot,
            property_qualifier: dbRecord.property_qualifier,
            property_location: dbRecord.property_location,
            differences: {
              sales_price: { old: dbSalesPrice, new: sourceSalesPrice },
              sales_date: { old: dbSalesDate, new: sourceSalesDate },
              sales_nu: { old: dbSalesNu, new: sourceSalesNu },
              sales_book: { old: dbSalesBook, new: sourceSalesBook },
              sales_page: { old: dbSalesPage, new: sourceSalesPage }
            }
          });
        }
        
        // Check for class changes
        if (job.vendor_type === 'BRT') {
          // BRT: Check both property_m4_class and property_cama_class
          const sourceM4Class = sourceRecord['PROPERTY_CLASS'];
          const sourceCamaClass = sourceRecord['PROPCLASS'];
          
          const classChangesForProperty = [];
          
          if (sourceM4Class !== dbRecord.property_m4_class) {
            classChangesForProperty.push({
              field: 'property_m4_class',
              old: dbRecord.property_m4_class,
              new: sourceM4Class
            });
          }
          
          if (sourceCamaClass !== dbRecord.property_cama_class) {
            classChangesForProperty.push({
              field: 'property_cama_class',
              old: dbRecord.property_cama_class,
              new: sourceCamaClass
            });
          }
          
          if (classChangesForProperty.length > 0) {
            classChanges.push({
              property_composite_key: key,
              property_block: dbRecord.property_block,
              property_lot: dbRecord.property_lot,
              property_qualifier: dbRecord.property_qualifier,
              property_location: dbRecord.property_location,
              changes: classChangesForProperty
            });
          }
          
        } else if (job.vendor_type === 'Microsystems') {
          // Microsystems: Check only property_m4_class
          const sourceM4Class = sourceRecord['Class'];
          
          if (sourceM4Class !== dbRecord.property_m4_class) {
            classChanges.push({
              property_composite_key: key,
              property_block: dbRecord.property_block,
              property_lot: dbRecord.property_lot,
              property_qualifier: dbRecord.property_qualifier,
              property_location: dbRecord.property_location,
              changes: [{
                field: 'property_m4_class',
                old: dbRecord.property_m4_class,
                new: sourceM4Class
              }]
            });
          }
        }
      });
      
      const results = {
        summary: {
          missing: missing.length,
          changes: changes.length,
          deletions: deletions.length,
          salesChanges: salesChanges.length,
          classChanges: classChanges.length
        },
        details: {
          missing,
          changes,
          deletions,
          salesChanges,
          classChanges
        }
      };
      
      return results;
      
    } catch (error) {
      console.error('Comparison error:', error);
      throw error;
    }
  };

  const handleSalesDecision = (propertyKey, decision) => {
    // Save current scroll position of BOTH containers
    const salesContainer = document.getElementById('sales-changes-container');
    const modalBody = document.querySelector('.fixed .overflow-y-auto');
    
    const salesScrollPos = salesContainer ? salesContainer.scrollTop : 0;
    const modalScrollPos = modalBody ? modalBody.scrollTop : 0;
    
    // Update the decision
    setSalesDecisions(prev => new Map(prev.set(propertyKey, decision)));
    
    // Force restore scroll position with multiple attempts
    const restoreScroll = () => {
      if (salesContainer) salesContainer.scrollTop = salesScrollPos;
      if (modalBody) modalBody.scrollTop = modalScrollPos;
    };
    
    // Try immediately
    restoreScroll();
    
    // Try after React renders
    requestAnimationFrame(restoreScroll);
    
    // Try after a short delay
    setTimeout(restoreScroll, 10);
    setTimeout(restoreScroll, 50);
    setTimeout(restoreScroll, 100);
  };

  // FIXED: Compare only (don't process yet) - show modal for review
  const handleCompareFile = async (fileType) => {
    if (fileType === 'source' && (!sourceFile || !sourceFileContent)) {
      addNotification('Please select a source file first', 'error');
      return;
    }
    
    try {
      setComparing(true);
      setProcessingStatus('Starting comparison...');
      
      // Perform comparison only (no processing yet)
      const comparison = await performComparison();
      
      // Show results in modal for review
      setComparisonResults(comparison);
      setShowResultsModal(true);
      
      const hasAnyChanges = comparison.summary.missing > 0 || 
                           comparison.summary.changes > 0 || 
                           comparison.summary.deletions > 0 || 
                           comparison.summary.salesChanges > 0 || 
                           comparison.summary.classChanges > 0;
      
      if (hasAnyChanges) {
        addNotification(`📊 Found ${comparison.summary.missing + comparison.summary.changes + comparison.summary.deletions + comparison.summary.salesChanges + comparison.summary.classChanges} total changes`, 'info');
      } else {
        addNotification('✅ No changes detected - files match database perfectly', 'success');
      }
      
    } catch (error) {
      console.error('❌ Comparison failed:', error);
      addNotification(`Comparison failed: ${error.message}`, 'error');
    } finally {
      setComparing(false);
      setProcessingStatus('');
    }
  };

  // Fetch current file version and updated_at from property_records
  const fetchCurrentFileVersion = async () => {
    try {
      // First get job assignment status
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .select('has_property_assignments')
        .eq('id', job.id)
        .single();

      if (jobError) throw jobError;
      const hasAssignments = jobData?.has_property_assignments || false;

      // Build query with assignment filter if needed (same logic as JobContainer)
      let versionQuery = supabase
        .from('property_records')
        .select('file_version, updated_at')
        .eq('job_id', job.id);

      if (hasAssignments) {
        versionQuery = versionQuery.eq('is_assigned_property', true);
        console.log('📊 Fetching file version for assigned properties only');
      } else {
        console.log('📊 Fetching file version for all properties');
      }

      const { data: versionData, error } = await versionQuery
        .order('file_version', { ascending: false })
        .limit(1)
        .single();

      if (versionData && !error) {
        console.log(`📊 Current file_version from DB: ${versionData.file_version}, updated_at: ${versionData.updated_at}`);
        setCurrentFileVersion(versionData.file_version || 1);
        setLastUpdatedAt(versionData.updated_at);
      } else {
        console.log('📊 No records found, setting file_version to 1');
        setCurrentFileVersion(1);
        setLastUpdatedAt(null);
      }
    } catch (error) {
      console.error('Error fetching file version:', error);
      setCurrentFileVersion(1);
      setLastUpdatedAt(null);
    }
  };

  // Initialize file version on component mount
  useEffect(() => {
    if (job?.id) {
      fetchCurrentFileVersion();
    }
  }, [job?.id]);

  // ENHANCED: Track batch insert operations from propertyService with better capture
  const trackBatchInserts = (operation) => {
    return new Promise((resolve, reject) => {
      // Create a listener for console messages
      const originalLog = console.log;
      const originalError = console.error;
      let batchCount = 0;
      let totalRecords = 0;
      
      // Override console.log to capture batch messages
      console.log = function(...args) {
        const message = args.join(' ');
        
        // Capture various batch-related messages
        if (message.includes('Processing batch') || 
            message.includes('Batch') || 
            message.includes('UPSERT') || 
            message.includes('records processed') ||
            message.includes('Attempting') ||
            message.includes('Retry') ||
            message.includes('batch of')) {
          
          // Parse batch information
          const batchMatch = message.match(/batch (\d+) of (\d+)/i) || 
                            message.match(/Batch (\d+)\/(\d+)/);
          const recordMatch = message.match(/(\d+) records/);
          const retryMatch = message.match(/retry|attempt/i);
          
          if (batchMatch) {
            const currentBatch = parseInt(batchMatch[1]);
            const totalBatches = parseInt(batchMatch[2]);
            batchCount = totalBatches;
            
            setBatchInsertProgress(prev => ({
              ...prev,
              currentBatch,
              totalBatches,
              isInserting: true,
              currentOperation: message
            }));
            
            // Add attempt to log
            setBatchInsertProgress(prev => {
              const attemptExists = prev.insertAttempts.find(a => a.batchNumber === currentBatch);
              if (!attemptExists) {
                return {
                  ...prev,
                  insertAttempts: [...prev.insertAttempts, {
                    batchNumber: currentBatch,
                    size: recordMatch ? parseInt(recordMatch[1]) : prev.batchSize,
                    startTime: new Date().toISOString(),
                    status: retryMatch ? 'retrying' : 'attempting',
                    retries: retryMatch ? 1 : 0
                  }]
                };
              } else if (retryMatch) {
                return {
                  ...prev,
                  insertAttempts: prev.insertAttempts.map(a => 
                    a.batchNumber === currentBatch 
                      ? { ...a, status: 'retrying', retries: a.retries + 1 }
                      : a
                  )
                };
              }
              return prev;
            });
          }
          
          if (recordMatch) {
            totalRecords += parseInt(recordMatch[1]);
          }
          
          // Log the batch operation
          addBatchLog(message, 
            message.includes('Error') ? 'error' : 
            message.includes('Success') || message.includes('successfully') ? 'success' : 
            message.includes('Retry') ? 'warning' : 
            'info'
          );
        }
        
        // Also capture general processing messages
        if (message.includes('Processing') || message.includes('Updating') || message.includes('UPSERT')) {
          addBatchLog(message, 'info');
        }
        
        // Call original console.log
        originalLog.apply(console, args);
      };
      
      // Override console.error too
      console.error = function(...args) {
        const message = args.join(' ');
        if (message.includes('batch') || message.includes('UPSERT')) {
          addBatchLog(`Error: ${message}`, 'error');
        }
        originalError.apply(console, args);
      };
      
      // Set initial state with detailed logging
      console.log('���� Starting batch operation with timeout protection...');
      setBatchInsertProgress(prev => ({
        ...prev,
        isInserting: true,
        currentOperation: 'Initializing batch processing...',
        startTime: new Date().toISOString()
      }));

      // Add a heartbeat to show we're still alive during initialization
      let heartbeatCount = 0;
      const heartbeatInterval = setInterval(() => {
        heartbeatCount++;
        console.log(`💓 Batch operation heartbeat - still initializing... (${heartbeatCount * 10}s)`);
        addBatchLog(`💓 Operation still running... (${heartbeatCount * 10} seconds)`, 'info');

        // If stuck for more than 60 seconds, show warning
        if (heartbeatCount >= 6) {
          addBatchLog('⚠️ Operation appears stuck. Database may be overloaded or there\'s a query issue. Consider using Emergency Stop.', 'warning');
        }
      }, 10000); // Every 10 seconds
      
      // Execute the operation with timeout protection (reduced from 5 to 2 minutes)
      Promise.race([
        operation(),
        new Promise((_, timeoutReject) =>
          setTimeout(() => timeoutReject(new Error('Batch processing timeout after 2 minutes')), 2 * 60 * 1000)
        )
      ]).then(result => {
        // Clear heartbeat and restore original console methods
        clearInterval(heartbeatInterval);
        console.log = originalLog;
        console.error = originalError;
        
        // Mark all batches as complete
        setBatchInsertProgress(prev => ({
          ...prev,
          isInserting: false,
          currentOperation: `Batch processing complete - ${totalRecords} records processed`,
          insertAttempts: prev.insertAttempts.map(a => ({
            ...a,
            status: 'success',
            endTime: new Date().toISOString()
          }))
        }));
        
        addBatchLog(`�� All batches complete - Total records: ${totalRecords}`, 'success');
        
        resolve(result);
      }).catch(error => {
        // Clear heartbeat and restore original console methods
        clearInterval(heartbeatInterval);
        console.log = originalLog;
        console.error = originalError;
        
        const isTimeout = error.message && error.message.includes('timeout');
        const errorMessage = isTimeout ?
          'Batch processing timeout - try refreshing and uploading again' :
          'Batch processing failed';

        setBatchInsertProgress(prev => ({
          ...prev,
          isInserting: false,
          currentOperation: errorMessage,
          insertAttempts: prev.insertAttempts.map(a => ({
            ...a,
            status: a.status === 'success' ? 'success' : 'failed'
          }))
        }));

        if (isTimeout) {
          addBatchLog('��� Operation timed out after 2 minutes. The database may be overloaded or there\'s a query issue. Try refreshing the page and uploading again.', 'error');
        }
        
        addBatchLog(`❌ Batch processing failed: ${error.message}`, 'error');
        
        reject(error);
      });
    });
  };

  // ENHANCED: Process changes with batch logging modal
  const handleProcessChanges = async () => {
    // Prevent processing while job is loading
    if (isJobLoading) {
      console.log('⚠️ Job data is still loading, please wait');
      addNotification('Job data is still loading, please wait', 'warning');
      return;
    }
    
    // Prevent double processing
    if (isProcessingLocked) {
      console.log('⚠️ Processing already in progress, ignoring duplicate request');
      return;
    }
    setIsProcessingLocked(true);
    
    // Wait for initialization
    if (!isInitialized) {
      addNotification('System initializing, please try again in a moment', 'warning');
      setIsProcessingLocked(false); // Reset lock on early return
      return;
    }
    
    if (!sourceFile || !sourceFileContent) {
      addNotification('No source file to process', 'error');
      setIsProcessingLocked(false); // Reset lock on early return
      return;
    }
    
    try {
      // Initialize batch logging
      clearBatchLogs();
      setShowBatchModal(true);
      setProcessing(true);

      // Direct Supabase processing
      setProcessingStatus(`Processing ${job.vendor_type} data via Supabase...`);

      addBatchLog('🚀 Starting direct Supabase processing workflow', 'batch_start', {
        vendor: job.vendor_type,
        fileName: sourceFile.name,
        changesDetected: comparisonResults.summary.missing + comparisonResults.summary.changes + comparisonResults.summary.deletions + comparisonResults.summary.salesChanges + comparisonResults.summary.classChanges,
        salesDecisions: salesDecisions.size,
        method: 'supabase'
      });
      
      
      // Call the updater to UPSERT the database
      addBatchLog(`📊 Calling ${job.vendor_type} updater (UPSERT mode)...`, 'info');

      // FIX: Calculate new file_version for property_records - fetch current from DB with timeout
      addBatchLog('🔍 Fetching current file version from database...', 'info');

      let currentFileVersion = 1;
      let newFileVersion = 2;

      try {
        // Add 10-second timeout to prevent hanging
        const versionPromise = supabase
          .from('property_records')
          .select('file_version')
          .eq('job_id', job.id)
          .order('file_version', { ascending: false })
          .limit(1)
          .single();

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Version fetch timeout after 10 seconds')), 10000)
        );

        const { data: currentVersionData, error: versionError } = await Promise.race([
          versionPromise,
          timeoutPromise
        ]);

        if (versionError && versionError.code !== 'PGRST116') {
          throw versionError;
        }

        currentFileVersion = currentVersionData?.file_version || 1;
        newFileVersion = currentFileVersion + 1;

        addBatchLog(`📊 Current DB version: ${currentFileVersion}, incrementing to: ${newFileVersion}`, 'info');

      } catch (error) {
        addBatchLog(`⚠️ Version fetch failed: ${error.message}, using default version increment`, 'warning');
        // Fallback: get a reasonable version number
        currentFileVersion = Date.now() % 100; // Use timestamp as version
        newFileVersion = currentFileVersion + 1;
        addBatchLog(`📊 Using fallback version: ${newFileVersion}`, 'info');
      }

      // Track batch operations
      const result = await trackBatchInserts(async () => {
        try {
          const startTime = Date.now();
          addBatchLog('🔄 Processing file data...', 'info');

          const result = await propertyService.updateCSVData(
            sourceFileContent,
            codeFileContent,
            job.id,
            job.year_created || new Date().getFullYear(),
            job.ccdd_code || job.ccddCode,
            job.vendor_type,
            {
              source_file_name: sourceFile?.name,
              source_file_version_id: crypto.randomUUID(),
              source_file_uploaded_at: new Date().toISOString(),
              file_version: newFileVersion,
              preservedFieldsHandler: preservedFieldsHandler,
              preservedFields: [
                'is_assigned_property'     // AdminJobManagement - from assignments
              ]
            }
          );

          const endTime = Date.now();
          addBatchLog(`✅ Processing completed in ${endTime - startTime}ms`, 'info');

          return result;
        } catch (updateError) {
          console.error('❌ updateCSVData failed:', updateError);
          // Add more specific error info to batch log
          addBatchLog(`�� Update failed: ${updateError.message}`, 'error', {
            error: updateError.message,
            stack: updateError.stack,
            vendor: job.vendor_type
          });
          throw updateError;
        }
      });
      
      addBatchLog('✅ Property data processing completed', 'success', {
        processed: result.processed,
        errors: result.errors
      });

      // Update validation_status on jobs table (moved from property_records)
      addBatchLog('📝 Updating job validation status...', 'info');
      const { error: jobUpdateError } = await supabase
        .from('jobs')
        .update({ validation_status: 'updated' })
        .eq('id', job.id);

      if (jobUpdateError) {
        console.error('❌ Failed to update job validation_status:', jobUpdateError);
        addBatchLog('⚠️ Warning: Could not update job validation status', 'warning');
      } else {
        addBatchLog('✅ Job validation status set to "updated"', 'success');
      }

      // Save comparison report with sales decisions
      addBatchLog('💾 Saving comparison report to database...', 'info');
      await saveComparisonReport(comparisonResults, salesDecisions);
      
      // Refresh report count
      await loadReportCount();
      
      addBatchLog('✅ Comparison report saved successfully', 'success');
          
      // Store sales decisions as JSON in property records
      if (salesDecisions.size > 0) {
        setProcessingStatus('Saving sales decisions...');
        addBatchLog(`💰 Processing ${salesDecisions.size} sales decisions...`, 'info');
        
        let salesProcessed = 0;
        let salesReverted = 0;
        let salesBothStored = 0;
        
        for (const [compositeKey, decision] of salesDecisions.entries()) {
          const salesChange = comparisonResults.details.salesChanges.find(sc => sc.property_composite_key === compositeKey);
          
          if (!salesChange) {
            console.error('Could not find sales change data for:', compositeKey);
            continue;
          }
          
          try {
            let updateData = {};
            
            if (decision === 'Keep Old') {
              // REVERT to old sales data
              updateData = {
                sales_price: salesChange.differences.sales_price.old,
                sales_date: salesChange.differences.sales_date.old,
                sales_nu: salesChange.differences.sales_nu.old,
                sales_book: salesChange.differences.sales_book.old,
                sales_page: salesChange.differences.sales_page.old,
                sales_history: {
                  comparison_date: new Date().toISOString().split('T')[0],
                  sales_decision: {
                    decision_type: decision,
                    old_price: salesChange.differences.sales_price.old,
                    new_price: salesChange.differences.sales_price.new,
                    old_date: salesChange.differences.sales_date.old,
                    new_date: salesChange.differences.sales_date.new,
                    old_book: salesChange.differences.sales_book.old,
                    new_book: salesChange.differences.sales_book.new,
                    old_page: salesChange.differences.sales_page.old,
                    new_page: salesChange.differences.sales_page.new,
                    decided_by: 'user',
                    decided_at: new Date().toISOString(),
                    action_taken: 'Reverted to old values'
                  }
                }
              };
              salesReverted++;
              
            } else if (decision === 'Keep New') {
              // Just store the decision - new values already in place
              updateData = {
                sales_history: {
                  comparison_date: new Date().toISOString().split('T')[0],
                  sales_decision: {
                    decision_type: decision,
                    old_price: salesChange.differences.sales_price.old,
                    new_price: salesChange.differences.sales_price.new,
                    old_date: salesChange.differences.sales_date.old,
                    new_date: salesChange.differences.sales_date.new,
                    old_book: salesChange.differences.sales_book.old,
                    new_book: salesChange.differences.sales_book.new,
                    old_page: salesChange.differences.sales_page.old,
                    new_page: salesChange.differences.sales_page.new,
                    decided_by: 'user',
                    decided_at: new Date().toISOString(),
                    action_taken: 'Kept new values'
                  }
                }
              };
              
            } else if (decision === 'Keep Both') {
              // Store both sales in history, keep new as current
              updateData = {
                sales_history: {
                  comparison_date: new Date().toISOString().split('T')[0],
                  sales_decision: {
                    decision_type: decision,
                    old_price: salesChange.differences.sales_price.old,
                    new_price: salesChange.differences.sales_price.new,
                    old_date: salesChange.differences.sales_date.old,
                    new_date: salesChange.differences.sales_date.new,
                    old_book: salesChange.differences.sales_book.old,
                    new_book: salesChange.differences.sales_book.new,
                    old_page: salesChange.differences.sales_page.old,
                    new_page: salesChange.differences.sales_page.new,
                    decided_by: 'user',
                    decided_at: new Date().toISOString(),
                    action_taken: 'Kept both - new as current, old in history'
                  },
                  previous_sales: [
                    {
                      sales_price: salesChange.differences.sales_price.old,
                      sales_date: salesChange.differences.sales_date.old,
                      sales_nu: salesChange.differences.sales_nu.old,
                      sales_book: salesChange.differences.sales_book.old,
                      sales_page: salesChange.differences.sales_page.old,
                      recorded_date: new Date().toISOString()
                    }
                  ]
                }
              };
              salesBothStored++;
            }
            
            const { error } = await supabase
              .from('property_records')
              .update(updateData)
              .eq('property_composite_key', compositeKey)
              .eq('job_id', job.id);
            
            if (error) {
              console.error('Error updating sales decision:', error);
              addBatchLog(`❌ Error saving sales decision for ${compositeKey}`, 'error', { error: error.message });
            } else {
              salesProcessed++;
            }
          } catch (updateError) {
            console.error('Failed to update sales decision for property:', compositeKey, updateError);
            addBatchLog(`❌ Failed to update sales decision for ${compositeKey}`, 'error', { error: updateError.message });
          }
        }
        
        addBatchLog(`✅ Processed ${salesProcessed}/${salesDecisions.size} sales decisions`, 'success', {
          reverted: salesReverted,
          keptNew: salesProcessed - salesReverted - salesBothStored,
          keptBoth: salesBothStored
        });
        
        if (salesReverted > 0) {
          addNotification(`↩️ Reverted ${salesReverted} sales to old values`, 'info');
        }
      }
      
       // Update job with new file info - removed source_file_version update
      addBatchLog('🔄 Updating job metadata...', 'info');
      try {
        const updateData = {
          totalProperties: result.processed,
          source_file_uploaded_at: new Date().toISOString()
        };

        console.log('🔍 DEBUG - Updating job with:', updateData);
        await jobService.update(job.id, updateData);
        addBatchLog('✅ Job metadata updated successfully', 'success', updateData);
      } catch (updateError) {
        console.error('❌ Failed to update job:', updateError);
        addBatchLog('⚠️ Job metadata update failed', 'warning', { error: updateError.message });
        addNotification('Data processed but job update failed', 'warning');
      }

      // Set flag for ProductionTracker to know data is stale
      try {
        const { data: currentJob } = await supabase
          .from('jobs')
          .select('workflow_stats')
          .eq('id', job.id)
          .single();

        if (currentJob?.workflow_stats) {
          const updatedWorkflowStats = {
            ...currentJob.workflow_stats,
            needsRefresh: true,
            lastFileUpdate: new Date().toISOString()
          };
          
          await supabase
            .from('jobs')
            .update({ 
              workflow_stats: updatedWorkflowStats 
            })
            .eq('id', job.id);
          
          addBatchLog('🔄 Marked production analytics as needing refresh', 'info');
        }
      } catch (statsError) {
        console.error('Error updating workflow stats flag:', statsError);
      }      
      
      const totalProcessed = result.processed || 0;
      const errorCount = result.errors || 0;
      
      if (errorCount > 0) {
        addBatchLog(`⚠️ Processing completed with ${errorCount} errors`, 'warning', {
          totalProcessed,
          errorCount
        });
        addNotification(`❌ Processing completed with ${errorCount} errors. ${totalProcessed} records processed.`, 'warning');
      } else {
        addBatchLog('🎉 All processing completed successfully!', 'success', {
          totalProcessed,
          vendor: job.vendor_type,
          salesDecisions: salesDecisions.size
        });
        addNotification(`✅ Successfully processed ${totalProcessed} records via ${job.vendor_type} updater`, 'success');
        
        if (salesDecisions.size > 0) {
          addNotification(`💾 Saved ${salesDecisions.size} sales decisions`, 'success');
        }
      }
      // Check if rollback occurred
      if (result.warnings && result.warnings.some(w => w.includes('rolled back'))) {
        addBatchLog('⚠️ UPDATE FAILED - All changes have been rolled back', 'error', {
          message: 'The update encountered errors and all changes were automatically reversed'
        });
        addNotification('���� Update failed - all changes rolled back. Check logs for details.', 'error');
      }

      // Update local file version and date from DB
      await fetchCurrentFileVersion(); // Refresh file version and updated_at from DB

      setBatchComplete(true);
      
      // Auto-close modal after 3 seconds if successful
      if (errorCount === 0) {
        setTimeout(() => {
          setShowBatchModal(false);
          setShowResultsModal(false);
          setSourceFile(null);
          setSourceFileContent(null);
          setSalesDecisions(new Map());
        }, 3000);
      }
        
      // Notify parent component
      if (onFileProcessed) {
        onFileProcessed(result);
      }
      
      // Trigger data refresh in JobContainer
      if (onDataRefresh) {
        addBatchLog('🔄 Triggering data refresh in JobContainer...', 'info');
        await onDataRefresh();
        addBatchLog('✅ JobContainer data refreshed', 'success');

        // DEBUG: Small delay then check if JobContainer shows the new version
        setTimeout(() => {
          addBatchLog('⏰ Checking if JobContainer updated (after 2 second delay)...', 'info');
          // This will show in console - user should check JobContainer UI
        }, 2000);
      } else {
        addBatchLog('⚠️ No onDataRefresh callback provided!', 'warning');
      }
    } catch (error) {
      console.error('❌ Processing failed:', error);
      
      // Check if this was a rollback error
      const isRollback = error.message && (error.message.includes('rolled back') || error.message.includes('reverted'));
      
      if (isRollback) {
        addBatchLog('�� CRITICAL FAILURE - Update rolled back', 'error', { 
          error: error.message,
          details: 'All database changes have been reversed'
        });
        addNotification(`❌ ${error.message}`, 'error');
      } else {
        addBatchLog('❌ Processing workflow failed', 'error', { error: error.message });
        addNotification(`Processing failed: ${error.message}`, 'error');
      }
    } finally {
      setProcessing(false);
      setProcessingStatus('');
      setIsProcessingLocked(false);  // Add this line
    }
  };
  const handleSourceFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    setSourceFile(file);
    
    try {
      const content = await file.text();
      setSourceFileContent(content);
      
      // Use vendor type from job data
      const vendor = job.vendor_type;
      
      if (vendor) {
        addNotification(`✅ Using ${vendor} file format`, 'success');
      }
    } catch (error) {
      console.error('Error reading file:', error);
      addNotification('Error reading file', 'error');
    }
  };

  const handleCodeFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    setCodeFile(file);
    
    try {
      const content = await file.text();
      setCodeFileContent(content);
      
      // Use vendor type from job data
      if (job.vendor_type) {
        addNotification(`✅ Detected ${job.vendor_type} code file`, 'success');
      }
    } catch (error) {
      console.error('Error reading code file:', error);
      addNotification('Error reading code file', 'error');
    }
  };

  // Reports List Modal - View all comparison reports
  const ReportsListModal = () => {
    if (!showReportsModal) return null;

    // Calculate pagination
    const totalPages = Math.ceil(reportsList.length / reportsPerPage);
    const startIndex = (currentReportPage - 1) * reportsPerPage;
    const endIndex = startIndex + reportsPerPage;
    const currentReports = reportsList.slice(startIndex, endIndex);

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div
          className="bg-gray-900 rounded-lg overflow-hidden shadow-2xl flex flex-col resize-none"
          style={{
            width: `${modalSize.width}px`,
            height: `${modalSize.height}px`,
            minWidth: '600px',
            minHeight: '400px',
            maxWidth: '90vw',
            maxHeight: '90vh'
          }}
        >
          {/* Header */}
          <div className="p-4 border-b border-gray-700 bg-gray-800 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <FileText className="w-5 h-5 text-purple-400" />
                <h2 className="text-lg font-bold text-white">
                  Comparison Reports History ({reportsList.length})
                </h2>
              </div>
              <button
                onClick={() => setShowReportsModal(false)}
                className="text-gray-400 hover:text-gray-300 p-1"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {loadingReports ? (
              <div className="flex justify-center items-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
              </div>
            ) : reportsList.length === 0 ? (
              <div className="text-center py-12">
                <Database className="w-12 h-12 mx-auto mb-4 text-gray-500" />
                <p className="text-gray-300">No comparison reports found for this job</p>
              </div>
            ) : (
              <div className="space-y-4">
                {currentReports.map((report, idx) => {
                  const reportData = report.report_data || {};
                  const summary = reportData.summary || {};
                  const totalChanges = (summary.missing || 0) + (summary.deletions || 0) + 
                                     (summary.salesChanges || 0) + (summary.classChanges || 0);
                  
                  return (
                    <div key={report.id || idx} className="border border-gray-700 rounded-lg p-4 hover:bg-gray-800 bg-gray-850">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="font-semibold text-white">
                            {formatDate(report.report_date)}
                          </div>
                          <div className="text-sm text-gray-300 mt-1">
                            File: {reportData.source_file_name || 'Unknown'}
                          </div>
                          <div className="text-sm text-gray-300">
                            Vendor: {reportData.vendor_detected || 'Unknown'}
                          </div>
                          <div className="flex gap-4 mt-2 text-xs">
                            <span className="text-green-600">
                              New: {summary.missing || 0}
                            </span>
                            <span className="text-red-600">
                              Deleted: {summary.deletions || 0}
                            </span>
                            <span className="text-blue-600">
                              Sales: {summary.salesChanges || 0}
                            </span>
                            <span className="text-purple-600">
                              Class: {summary.classChanges || 0}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              // Export individual report
                              if (reportData.changes) {
                                let csvContent = "Report_Date,Change_Type,Block,Lot,Qualifier,Property_Location,Old_Value,New_Value,Status,Reviewed_By,Reviewed_Date\n";
                                
                                reportData.changes.forEach(change => {
                                  csvContent += `"${change.Report_Date}","${change.Change_Type}","${change.Block}","${change.Lot}","${change.Qualifier}","${change.Property_Location}","${change.Old_Value}","${change.New_Value}","${change.Status}","${change.Reviewed_By || ''}","${change.Reviewed_Date || ''}"\n`;
                                });

                                const blob = new Blob([csvContent], { type: 'text/csv' });
                                const url = window.URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `${job.name}_Report_${formatDate(report.report_date).replace(/\//g, '-')}.csv`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                window.URL.revokeObjectURL(url);

                                addNotification('Report exported', 'success');
                              }
                            }}
                            className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
                          >
                            <Download className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Enhanced Footer with Pagination */}
          <div className="px-6 py-4 border-t border-gray-700 bg-gray-800 shrink-0">
            {/* First row - Page info and navigation */}
            <div className="flex justify-between items-center mb-3">
              <div className="text-sm text-gray-300">
                Showing {startIndex + 1}-{Math.min(endIndex, reportsList.length)} of {reportsList.length} reports
              </div>

              {/* Enhanced Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center space-x-1">
                  {/* First page */}
                  <button
                    onClick={() => setCurrentReportPage(1)}
                    disabled={currentReportPage === 1}
                    className="px-2 py-1 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="First page"
                  >
                    ««
                  </button>

                  {/* Previous page */}
                  <button
                    onClick={() => setCurrentReportPage(Math.max(1, currentReportPage - 1))}
                    disabled={currentReportPage === 1}
                    className="px-2 py-1 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Previous page"
                  >
                    ‹
                  </button>

                  {/* Page input */}
                  <div className="flex items-center space-x-1">
                    <input
                      type="number"
                      min="1"
                      max={totalPages}
                      value={currentReportPage}
                      onChange={(e) => {
                        const page = parseInt(e.target.value);
                        if (page >= 1 && page <= totalPages) {
                          setCurrentReportPage(page);
                        }
                      }}
                      className="w-16 px-2 py-1 text-sm text-center border border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-300">of {totalPages}</span>
                  </div>

                  {/* Next page */}
                  <button
                    onClick={() => setCurrentReportPage(Math.min(totalPages, currentReportPage + 1))}
                    disabled={currentReportPage === totalPages}
                    className="px-2 py-1 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Next page"
                  >
                    ›
                  </button>

                  {/* Last page */}
                  <button
                    onClick={() => setCurrentReportPage(totalPages)}
                    disabled={currentReportPage === totalPages}
                    className="px-2 py-1 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Last page"
                  >
                    »»
                  </button>
                </div>
              )}
            </div>

            {/* Second row - Action buttons */}
            <div className="flex justify-end space-x-3">
              <button
                onClick={viewAllReports}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 font-medium transition-colors"
              >
                Export All Reports
              </button>
              <button
                onClick={() => setShowReportsModal(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Batch Processing Modal - existing component
  const BatchProcessingModal = () => {
    if (!showBatchModal) return null;
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-4xl w-full max-h-[80vh] overflow-hidden shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 bg-gray-50 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Database className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-bold text-gray-900">
                  {processing ? 'Processing File Update...' : 'Processing Complete'}
                </h2>
              </div>
              {batchComplete && (
                <button
                  onClick={() => {
                    setShowBatchModal(false);
                    setShowResultsModal(false);
                    setSourceFile(null);
                    setSourceFileContent(null);
                    setSalesDecisions(new Map());
                  }}
                  className="text-gray-400 hover:text-gray-600 p-1"
                >
                  <X className="w-6 h-6" />
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Summary Info */}
            {currentBatch && (
              <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-900 mb-2">Processing Summary:</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-blue-800">Vendor:</span> {currentBatch.vendor}
                  </div>
                  <div>
                    <span className="font-medium text-blue-800">File:</span> {currentBatch.fileName}
                  </div>
                  <div>
                    <span className="font-medium text-blue-800">Changes Detected:</span> {currentBatch.changesDetected}
                  </div>
                  <div>
                    <span className="font-medium text-blue-800">Sales Decisions:</span> {currentBatch.salesDecisions}
                  </div>
                </div>
              </div>
            )}

            {/* Batch Insert Progress Section - FIX 2: Now shows real progress */}
            {batchInsertProgress.isInserting && (
              <div className="mb-4 bg-purple-50 border border-purple-200 rounded-lg p-4">
                <div className="flex items-center mb-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600 mr-2"></div>
                  <h4 className="font-medium text-gray-900">Database Batch Insert Progress</h4>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-900">{batchInsertProgress.currentOperation}</span>
                    {batchInsertProgress.totalBatches > 0 && (
                      <span className="text-gray-900 font-medium">
                        Batch {batchInsertProgress.currentBatch} of {batchInsertProgress.totalBatches}
                      </span>
                    )}
                  </div>
                  
                  {batchInsertProgress.totalBatches > 0 && (
                    <div className="w-full bg-purple-200 rounded-full h-2">
                      <div 
                        className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(batchInsertProgress.currentBatch / batchInsertProgress.totalBatches) * 100}%` }}
                      />
                    </div>
                  )}
                  
                  {/* Batch Insert Attempts Log */}
                  {batchInsertProgress.insertAttempts.length > 0 && (
                    <div className="mt-3 max-h-32 overflow-y-auto">
                      <div className="text-xs font-medium text-gray-900 mb-1">Batch Insert Log:</div>
                      <div className="space-y-1">
                        {batchInsertProgress.insertAttempts.map((attempt, idx) => (
                          <div key={idx} className="text-xs flex items-center justify-between bg-white rounded px-2 py-1">
                            <span className="font-medium">Batch {attempt.batchNumber} ({attempt.size} records)</span>
                            <span className={`flex items-center ${
                              attempt.status === 'success' ? 'text-green-600' :
                              attempt.status === 'retrying' ? 'text-yellow-600' :
                              attempt.status === 'attempting' ? 'text-gray-900' :
                              attempt.status === 'failed' ? 'text-red-600' :
                              'text-gray-600'
                            }`}>
                              {attempt.status === 'success' && <CheckCircle className="w-3 h-3 mr-1" />}
                              {attempt.status === 'retrying' && <RefreshCw className="w-3 h-3 mr-1 animate-spin" />}
                              {attempt.status === 'attempting' && <div className="w-3 h-3 mr-1 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />}
                              {attempt.status === 'failed' && <X className="w-3 h-3 mr-1" />}
                              {attempt.status}
                              {attempt.retries > 0 && ` (${attempt.retries} retries)`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Processing Logs */}
            <div className="space-y-3">
              <h3 className="font-bold text-gray-900 mb-4">Processing Log:</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {batchLogs.map((log, index) => (
                  <div
                    key={log.id}
                    className={`p-3 rounded-lg border-l-4 ${
                      log.type === 'error' ? 'border-red-400 bg-red-50' :
                      log.type === 'warning' ? 'border-yellow-400 bg-yellow-50' :
                      log.type === 'success' ? 'border-green-400 bg-green-50' :
                      log.type === 'batch_start' ? 'border-blue-400 bg-blue-50' :
                      'border-gray-400 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className={`font-medium ${
                          log.type === 'error' ? 'text-red-800' :
                          log.type === 'warning' ? 'text-yellow-800' :
                          log.type === 'success' ? 'text-green-800' :
                          log.type === 'batch_start' ? 'text-blue-800' :
                          'text-gray-800'
                        }`}>
                          {log.message}
                        </div>
                        {log.details && (
                          <div className="mt-1 text-xs text-gray-600">
                            <pre className="whitespace-pre-wrap">
                              {JSON.stringify(log.details, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 ml-4">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))}
                
                {/* Show current status if processing */}
                {processing && processingStatus && !batchInsertProgress.isInserting && (
                  <div className="p-3 border-l-4 border-blue-400 bg-blue-50 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                      <span className="font-medium text-blue-800">{processingStatus}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center shrink-0">
            <div className="text-sm text-gray-600">
              {processing ? 'Processing in progress...' : `Completed ${batchLogs.length} operations`}
            </div>
            
            {/* Emergency Stop Button - shows when processing but not complete */}
            {processing && !batchComplete && (
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    // Force stop the operation
                    setProcessing(false);
                    setBatchComplete(true);
                    setIsProcessingLocked(false);
                    addBatchLog('����� Operation manually stopped by user', 'warning');
                    console.log('🛑 Emergency stop triggered - operation cancelled');
                  }}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 font-medium flex items-center space-x-2"
                >
                  <span>🛑</span>
                  <span>Emergency Stop</span>
                </button>
              </div>
            )}

            {batchComplete && (
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowBatchModal(false);
                    setShowResultsModal(false);
                    setSourceFile(null);
                    setSourceFileContent(null);
                    setSalesDecisions(new Map());
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-medium"
                >
                  ✅ Close & Continue
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

// SINGLE RESULTS MODAL - Clean and properly sized with comparison first workflow
  const ResultsModal = () => {
    if (!comparisonResults || !showResultsModal) return null;
    
    const { summary, details } = comparisonResults;
    const hasNewRecords = summary.missing > 0;
    const hasChanges = summary.changes > 0;
    const hasDeletions = summary.deletions > 0;
    const hasSalesChanges = summary.salesChanges > 0;
    const hasClassChanges = summary.classChanges > 0;
    const hasAnyChanges = hasNewRecords || hasChanges || hasDeletions || hasSalesChanges || hasClassChanges;
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-40">
        <div className="bg-white rounded-lg w-full max-w-5xl" style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
          {/* Header - FIXED: Always visible */}
          <div className="p-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <FileText className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-bold text-gray-900">File Comparison Results</h2>
              </div>
              <button
                onClick={() => setShowResultsModal(false)}
                className="text-gray-400 hover:text-gray-600 p-2 -m-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Content - FIXED: Scrollable area */}
          <div className="flex-1 overflow-y-auto p-6" style={{ maxHeight: 'calc(90vh - 140px)' }}>
            {/* Summary Tiles */}
            <div className="grid grid-cols-5 gap-4 mb-6">
              {/* New Records */}
              <div className={`p-4 rounded-lg border-2 text-center ${hasNewRecords ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className={`text-2xl font-bold ${hasNewRecords ? 'text-green-600' : 'text-gray-500'}`}>
                  {summary.missing || 0}
                </div>
                <div className="text-sm text-gray-600">New Records</div>
              </div>

              {/* Deletions */}
              <div className={`p-4 rounded-lg border-2 text-center ${hasDeletions ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className={`text-2xl font-bold ${hasDeletions ? 'text-red-600' : 'text-gray-500'}`}>
                  {summary.deletions || 0}
                </div>
                <div className="text-sm text-gray-600">Deletions</div>
              </div>

              {/* Changes */}
              <div className={`p-4 rounded-lg border-2 text-center ${hasChanges ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className={`text-2xl font-bold ${hasChanges ? 'text-yellow-600' : 'text-gray-500'}`}>
                  {summary.changes || 0}
                </div>
                <div className="text-sm text-gray-600">Changes</div>
              </div>

              {/* Sales Changes */}
              <div className={`p-4 rounded-lg border-2 text-center ${hasSalesChanges ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className={`text-2xl font-bold ${hasSalesChanges ? 'text-blue-600' : 'text-gray-500'}`}>
                  {summary.salesChanges || 0}
                </div>
                <div className="text-sm text-gray-600">Sales Changes</div>
              </div>

              {/* Class Changes */}
              <div className={`p-4 rounded-lg border-2 text-center ${hasClassChanges ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className={`text-2xl font-bold ${hasClassChanges ? 'text-gray-900' : 'text-gray-500'}`}>
                  {summary.classChanges || 0}
                </div>
                <div className="text-sm text-gray-600">Class Changes</div>
              </div>
            </div>

            {/* No Changes State */}
            {!hasAnyChanges && (
              <div className="text-center py-8">
                <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-gray-900 mb-2">✅ Files Match Database</h3>
                <p className="text-gray-600">All data is current and synchronized.</p>
              </div>
            )}

            {/* Sales Changes Section (if any) */}
            {hasSalesChanges && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Sales Changes Requiring Decisions: 
                  <span className="ml-2 text-blue-600">
                    ({details.salesChanges.filter(change => !salesDecisions.has(change.property_composite_key)).length} remaining)
                  </span>
                </h3>
                <div id="sales-changes-container" className="space-y-4" style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem' }}>
                  {details.salesChanges.map((change, idx) => {
                    const currentDecision = salesDecisions.get(change.property_composite_key);
                    
                    return (
                      <div key={idx} className="border border-blue-200 rounded-lg p-4 bg-blue-50">
                          <div className="mb-3">
                          {/* Property Info */}
                          <div className="mb-2">
                            <h4 className="font-bold text-gray-900">
                              Property {change.property_block}-{change.property_lot}
                              {change.property_qualifier && change.property_qualifier !== 'NONE' && 
                                <span className="text-gray-600"> (Qual: {change.property_qualifier})</span>}
                            </h4>
                            <p className="text-gray-600 text-sm">{change.property_location}</p>
                          </div>
                          
                          {/* Sales Comparison */}
                          <div className="grid grid-cols-2 gap-4 p-3 bg-white rounded-lg border border-gray-200">
                            {/* Old Sale */}
                            <div className="text-center">
                              <div className="text-xs font-semibold text-gray-500 mb-1">OLD SALE</div>
                              <div className="text-lg font-bold text-red-600">
                                ${change.differences.sales_price.old?.toLocaleString() || 0}
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                {change.differences.sales_date.old || 'No Date'}
                              </div>
                              <div className="text-xs text-gray-500">
                                Book: {change.differences.sales_book?.old || '--'} Page: {change.differences.sales_page?.old || '--'}
                              </div>
                              <div className="text-xs text-gray-500">
                                NU: {(() => {
                                  const nu = change.differences.sales_nu?.old;
                                  if (!nu || nu === '' || nu === ' ' || nu === '0' || nu === '00') return '--';
                                  return nu;
                                })()}
                              </div>
                            </div>
                            
                            {/* New Sale */}
                            <div className="text-center">
                              <div className="text-xs font-semibold text-gray-500 mb-1">NEW SALE</div>
                              <div className="text-lg font-bold text-green-600">
                                ${change.differences.sales_price.new?.toLocaleString() || 0}
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                {change.differences.sales_date.new || 'No Date'}
                              </div>
                              <div className="text-xs text-gray-500">
                                Book: {change.differences.sales_book?.new || '--'} Page: {change.differences.sales_page?.new || '--'}
                              </div>
                              <div className="text-xs text-gray-500">
                                NU: {(() => {
                                  const nu = change.differences.sales_nu?.new;
                                  if (!nu || nu === '' || nu === ' ' || nu === '0' || nu === '00') return '--';
                                  return nu;
                                })()}
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSalesDecision(change.property_composite_key, 'Keep Old')}
                            className={`px-3 py-1 rounded text-sm font-medium ${
                              currentDecision === 'Keep Old' 
                                ? 'bg-red-600 text-white' 
                                : 'bg-red-100 text-red-800 hover:bg-red-200'
                            }`}
                          >
                            Keep Old
                          </button>
                          
                          <button
                            onClick={() => handleSalesDecision(change.property_composite_key, 'Keep New')}
                            className={`px-3 py-1 rounded text-sm font-medium ${
                              currentDecision === 'Keep New' 
                                ? 'bg-green-600 text-white' 
                                : 'bg-green-100 text-green-800 hover:bg-green-200'
                            }`}
                          >
                            Keep New
                          </button>
                          
                          <button
                            onClick={() => handleSalesDecision(change.property_composite_key, 'Keep Both')}
                            className={`px-3 py-1 rounded text-sm font-medium ${
                              currentDecision === 'Keep Both' 
                                ? 'bg-blue-600 text-white' 
                                : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                            }`}
                          >
                            Keep Both
                          </button>
                        </div>
                        
                        {currentDecision && (
                          <div className="mt-2 p-2 bg-green-100 rounded">
                            <div className="text-sm font-medium text-green-800">
                              ✓ Decision: {currentDecision}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Class Changes Section (if any) */}
            {hasClassChanges && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Property Class Changes:</h3>
                <div className="space-y-3" style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem' }}>
                  {details.classChanges.map((change, idx) => (
                    <div key={idx} className="border border-purple-200 rounded-lg p-3 bg-purple-50">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-bold text-gray-900">
                            Property {change.property_block}-{change.property_lot}
                            {change.property_qualifier && change.property_qualifier !== 'NONE' && 
                              <span className="text-gray-600"> (Qual: {change.property_qualifier})</span>}
                          </h4>
                          <p className="text-gray-600 text-sm">{change.property_location}</p>
                        </div>
                        <div className="text-right">
                          {change.changes.map((classChange, cidx) => (
                            <div key={cidx} className="mb-1">
                              <div className="text-xs text-gray-600">{classChange.field}</div>
                              <div className="text-sm">
                                <span className="font-medium text-red-600">{classChange.old || 'None'}</span>
                                <span className="mx-1">→</span>
                                <span className="font-medium text-green-600">{classChange.new || 'None'}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* New Records Section (if any) */}
            {hasNewRecords && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">New Properties to Add:</h3>
                <div className="text-sm text-gray-600 mb-2">
                  Showing first 10 of {summary.missing} new properties
                </div>
                <div className="space-y-2" style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem' }}>
                  {details.missing.slice(0, 10).map((record, idx) => {
                    const blockField = job.vendor_type === 'BRT' ? 'BLOCK' : 'Block';
                    const lotField = job.vendor_type === 'BRT' ? 'LOT' : 'Lot';
                    const qualifierField = job.vendor_type === 'BRT' ? 'QUALIFIER' : 'Qual';
                    const locationField = job.vendor_type === 'BRT' ? 'PROPERTY_LOCATION' : 'Location';
                    const classField = job.vendor_type === 'BRT' ? 'PROPERTY_CLASS' : 'Class';
                    const priceField = job.vendor_type === 'BRT' ? 'CURRENTSALE_PRICE' : 'Sale Price';
                    const dateField = job.vendor_type === 'BRT' ? 'CURRENTSALE_DATE' : 'Sale Date';
                    
                    const salePrice = parseFloat(String(record[priceField] || 0).replace(/[,$]/g, '')) || 0;
                    
                    return (
                      <div key={idx} className="border border-green-200 rounded p-2 bg-green-50 text-sm">
                        <div className="flex justify-between">
                          <div>
                            <span className="font-medium">{record[blockField]}-{record[lotField]}</span>
                            {record[qualifierField] && record[qualifierField] !== 'NONE' && 
                              <span className="text-gray-600"> (Qual: {record[qualifierField]})</span>}
                            <span className="text-gray-600 ml-2">{record[locationField]}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-gray-600">Class: {record[classField]}</span>
                            {salePrice > 0 && (
                              <span className="ml-3 font-medium">${salePrice.toLocaleString()}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Deletions Section (if any) */}
            {hasDeletions && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Properties to Remove:</h3>
                <div className="text-sm text-gray-600 mb-2">
                  Showing first 10 of {summary.deletions} properties not in source file
                </div>
                <div className="space-y-2" style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem' }}>
                  {details.deletions.slice(0, 10).map((record, idx) => (
                    <div key={idx} className="border border-red-200 rounded p-2 bg-red-50 text-sm">
                      <div className="flex justify-between">
                        <div>
                          <span className="font-medium">{record.property_block}-{record.property_lot}</span>
                          {record.property_qualifier && record.property_qualifier !== 'NONE' && 
                            <span className="text-gray-600"> (Qual: {record.property_qualifier})</span>}
                          <span className="text-gray-600 ml-2">{record.property_location}</span>
                        </div>
                        <div className="text-right text-gray-600">
                          Will be removed
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Debug Info - ENHANCED: Show composite keys for debugging */}
            <div className="mt-6 p-4 bg-gray-100 rounded-lg">
              <h3 className="font-bold text-gray-900 mb-2">🔍 Debug Info:</h3>
              <div className="text-sm text-gray-700 space-y-1">
                <div>Vendor: {job.vendor_type}</div>
                <div>Job ID: {job.id}</div>
                <div>Source File: {sourceFile?.name}</div>
                <div>Total Changes: {summary.missing + summary.changes + summary.deletions + summary.salesChanges + summary.classChanges}</div>
                <div>Using: property_records table (all versions)</div>
                
                {/* Show sample composite keys for debugging */}
                {hasNewRecords && details.missing?.length > 0 && (
                  <div className="mt-2 p-2 bg-yellow-50 rounded">
                    <div className="font-medium text-yellow-800 mb-1">Sample "New" Record Keys:</div>
                    {details.missing.slice(0, 3).map((record, idx) => {
                      const yearCreated = job.year_created || new Date().getFullYear();
                      const ccddCode = job.ccdd_code || job.ccddCode;
                      const generatedKey = generateCompositeKey(record, job.vendor_type, yearCreated, ccddCode);
                      
                      return (
                        <div key={idx} className="text-xs text-yellow-700 font-mono">
                          {job.vendor_type === 'BRT' ?
                            `${record.BLOCK}-${record.LOT} → ${generatedKey}` :
                            `${record.Block}-${record.Lot} → ${generatedKey}`
                          }
                        </div>
                      );
                    })}
                  </div>
                )}
                
                {hasDeletions && details.deletions?.length > 0 && (
                  <div className="mt-2 p-2 bg-red-50 rounded">
                    <div className="font-medium text-red-800 mb-1">Sample "Deleted" Record Keys:</div>
                    {details.deletions.slice(0, 3).map((record, idx) => (
                      <div key={idx} className="text-xs text-red-700 font-mono">
                        {record.property_block}-{record.property_lot} → {record.property_composite_key}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer - FIXED: Always visible at bottom */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center flex-shrink-0">
            <div className="flex space-x-3">
              <button
                onClick={viewAllReports}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center space-x-2 transition-colors"
                style={{color: 'white' }}
              >
                <Eye className="w-4 h-4" />
                <span>View All Reports</span>
              </button>
              
              <button
                onClick={exportComparisonReport}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center space-x-2 transition-colors"
                style={{ color: 'white'}}
              >
                <Download className="w-4 h-4" />
                <span>Export This Report</span>
              </button>
            </div>
            
              {hasAnyChanges ? (
              <button
                onClick={handleProcessChanges}
                disabled={processing}
                className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                {processing ? 'Processing...' : 'Mark Reviewed & Process'}
              </button>
            ) : (
              <button
                onClick={async () => {
                  // Even with no changes, call processors to update with latest data and version
                  if (!sourceFile || !sourceFileContent) {
                    addNotification('No source file to process', 'error');
                    return;
                  }
                  
                  try {
                    // Initialize batch logging for no-changes workflow too
                    clearBatchLogs();
                    setShowBatchModal(true);
                    setProcessing(true);
                    setProcessingStatus(`Processing ${job.vendor_type} data via updater...`);

                    addBatchLog('🚀 Processing file with no changes detected', 'batch_start', {
                      vendor: job.vendor_type,
                      fileName: sourceFile.name,
                      changesDetected: 0,
                      salesDecisions: 0
                    });
                    
                    
                    // Call the updater to UPSERT the database with latest data
                    addBatchLog(`�� Calling ${job.vendor_type} updater for version refresh...`, 'info');

                    // FIX 1: Calculate new file_version for property_records - fetch current from DB
                    addBatchLog('🔍 Fetching current file version from database...', 'info');
                    const { data: currentVersionData, error: versionError } = await supabase
                      .from('property_records')
                      .select('file_version')
                      .eq('job_id', job.id)
                      .order('file_version', { ascending: false })
                      .limit(1)
                      .single();

                    const currentFileVersion = currentVersionData?.file_version || 1;
                    const newFileVersion = currentFileVersion + 1;

                    addBatchLog(`📊 Current DB version: ${currentFileVersion}, incrementing to: ${newFileVersion}`, 'info');
                    
                    const result = await trackBatchInserts(async () => {
                      addBatchLog('🔄 Processing data refresh...', 'info');

                      return await propertyService.updateCSVData(
                        sourceFileContent,
                        codeFileContent,
                        job.id,
                        job.year_created || new Date().getFullYear(),
                        job.ccdd_code || job.ccddCode,
                        job.vendor_type,
                        {
                          source_file_name: sourceFile?.name,
                          source_file_version_id: crypto.randomUUID(),
                          source_file_uploaded_at: new Date().toISOString(),
                          file_version: newFileVersion,
                          preservedFieldsHandler: preservedFieldsHandler,
                          preservedFields: [
                            'is_assigned_property'     // AdminJobManagement - from assignments
                          ]
                        }
                      );
                    });
                    
                    addBatchLog('✅ Data refresh completed', 'success', {
                      processed: result.processed,
                      errors: result.errors
                    });
                    
                    // Save comparison report (showing no changes)
                    addBatchLog('💾 Saving comparison report...', 'info');
                    await saveComparisonReport(comparisonResults, salesDecisions);
                    addBatchLog('✅ Comparison report saved', 'success');
                    
                    // Update job with new file info - removed source_file_version update
                    addBatchLog('🔄 Updating job metadata...', 'info');
                    await jobService.update(job.id, {
                      totalProperties: result.processed,
                      source_file_uploaded_at: new Date().toISOString()
                    });
                    addBatchLog('✅ Job metadata updated', 'success');
                    
                    const totalProcessed = result.processed || 0;
                    const errorCount = result.errors || 0;
                    
                    if (errorCount > 0) {
                      addBatchLog(`⚠️ Refresh completed with ${errorCount} errors`, 'warning');
                      addNotification(`⚠️ Processing completed with ${errorCount} errors. ${totalProcessed} records updated.`, 'warning');
                    } else {
                      addBatchLog('���� File version refresh completed successfully!', 'success');
                      addNotification(`✅ Successfully updated ${totalProcessed} records with latest data via ${job.vendor_type} updater`, 'success');
                    }
                    // Check if rollback occurred during refresh
                    if (result.warnings && result.warnings.some(w => w.includes('rolled back'))) {
                      addBatchLog('⚠�� REFRESH FAILED - All changes have been rolled back', 'error');
                      addNotification('❌ Refresh failed - all changes rolled back. Check logs for details.', 'error');
                    }
                    
                    // SIMPLIFIED: No complex state updates needed - banner reads from job object after refresh
                    
                    setBatchComplete(true);
                    
                    // Auto-close modal after 3 seconds if successful
                    if (errorCount === 0) {
                      setTimeout(() => {
                        setShowBatchModal(false);
                        setShowResultsModal(false);
                        setSourceFile(null);
                        setSourceFileContent(null);
                        setSalesDecisions(new Map());
                      }, 3000);
                    }
                    
                    // Notify parent
                    if (onFileProcessed) {
                      onFileProcessed(result);
                    }
                    
                    // Trigger data refresh in JobContainer
                    if (onDataRefresh) {
                      addBatchLog('🔄 Triggering data refresh in JobContainer...', 'info');
                      await onDataRefresh();
                      addBatchLog('✅ JobContainer data refreshed', 'success');
                    }
                    
                  } catch (error) {
                    console.error('❌ Processing failed:', error);
                    
                    const isRollback = error.message && (error.message.includes('rolled back') || error.message.includes('reverted'));
                    
                    if (isRollback) {
                      addBatchLog('❌ CRITICAL FAILURE - Refresh rolled back', 'error', { 
                        error: error.message,
                        details: 'All database changes have been reversed'
                      });
                      addNotification(`❌ ${error.message}`, 'error');
                    } else {
                      addBatchLog('❌ File refresh failed', 'error', { error: error.message });
                      addNotification(`Processing failed: ${error.message}`, 'error');
                    }
                  } finally {
                    setProcessing(false);
                    setProcessingStatus('');
                  }
                }}
                disabled={processing}
                className="px-6 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50 font-medium transition-colors"
                style={{ color: 'white'}}
              >
                {processing ? 'Processing...' : 'Acknowledge & Close'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };
  
  // Format date for display
  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: 'numeric', 
      day: 'numeric', 
      year: '2-digit',
      timeZone: 'America/New_York'
    });
  };

  // Load comparison reports count for this job
  const loadReportCount = async () => {
    if (!job?.id) return;
    
    try {
      const { count, error } = await supabase
        .from('comparison_reports')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', job.id);
      
      if (!error && count !== null) {
        setReportCount(count);
      }
    } catch (error) {
      console.error('Error loading report count:', error);
    }
  };

    // NEW: View all reports
  const viewAllReports = async () => {
    try {
      const { data: reports, error } = await supabase
        .from('comparison_reports')
        .select('*')
        .eq('job_id', job.id)
        .order('report_date', { ascending: false });

      if (error) throw error;

      addNotification(`Found ${reports.length} comparison reports for this job`, 'info');
      
      // Export all reports in old CSV format
      if (reports.length > 0) {
        let csvContent = "Report_Date,Change_Type,Block,Lot,Qualifier,Property_Location,Old_Value,New_Value,Status,Reviewed_By,Reviewed_Date\n";
        
        reports.forEach(report => {
          const reportData = report.report_data;
          if (reportData.changes) {
            reportData.changes.forEach(change => {
              csvContent += `"${change.Report_Date}","${change.Change_Type}","${change.Block}","${change.Lot}","${change.Qualifier}","${change.Property_Location}","${change.Old_Value}","${change.New_Value}","${change.Status}","${change.Reviewed_By || ''}","${change.Reviewed_Date || ''}"\n`;
            });
          }
        });

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${job.name}_All_Comparison_Reports_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        addNotification('📊 All reports exported', 'success');
      }
      
    } catch (error) {
      console.error('Error fetching reports:', error);
      addNotification('Error fetching reports: ' + error.message, 'error');
    }
  };

  // Load all comparison reports for display in modal
  const loadReportsList = async () => {
    if (!job?.id) return;
    
    setLoadingReports(true);
    try {
      const { data: reports, error } = await supabase
        .from('comparison_reports')
        .select('*')
        .eq('job_id', job.id)
        .order('report_date', { ascending: false });

      if (error) throw error;

      setReportsList(reports || []);
    } catch (error) {
      console.error('Error loading reports:', error);
      addNotification('Error loading reports: ' + error.message, 'error');
    } finally {
      setLoadingReports(false);
    }
  };

  // SIMPLIFIED: Basic initialization - no complex version tracking needed
  useEffect(() => {
    if (!job?.id) return;
    setIsInitialized(true);
  }, [job?.id]);

  // Load report count when job changes
  useEffect(() => {
    if (job?.id) {
      loadReportCount();
    }
  }, [job?.id]);  

  // Load reports when modal opens
  useEffect(() => {
    if (showReportsModal) {
      loadReportsList();
    }
  }, [showReportsModal]);


  const getFileStatusWithRealVersion = (timestamp, type) => {
    if (!timestamp) return 'Never';

    if (type === 'source') {
      if (currentFileVersion > 1) {
        // Use updated_at from property_records
        const uploadDate = lastUpdatedAt || timestamp;
        return `Updated via FileUpload (${formatDate(uploadDate)})`;
      } else {
        return `Imported at Job Creation (${formatDate(timestamp)})`;
      }
    } else if (type === 'code') {
      // Check if code file was updated
      const codeVersion = job.code_file_version || 1;

      if (codeVersion > 1) {
        const uploadDate = job.code_file_uploaded_at || timestamp;
        return `Updated via FileUpload (${formatDate(uploadDate)})`;
      } else {
        return `Imported at Job Creation (${formatDate(timestamp)})`;
      }
    }

    return `Updated (${formatDate(timestamp)})`;
  };

  if (!job) {
    return (
      <div className="text-center text-gray-500 py-8">
        <Database className="w-12 h-12 mx-auto mb-4" />
        <p>Select a job to manage files</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Notifications */}
      <div className="fixed top-4 right-4 z-40 space-y-2">
        {notifications.map(notification => (
          <div
            key={notification.id}
            className={`p-4 rounded-lg shadow-lg border-l-4 max-w-md transition-all duration-300 ${
              notification.type === 'error' ? 'bg-red-50 border-red-400 text-red-800' :
              notification.type === 'warning' ? 'bg-yellow-50 border-yellow-400 text-yellow-800' :
              notification.type === 'success' ? 'bg-green-50 border-green-400 text-green-800' :
              'bg-blue-50 border-blue-400 text-blue-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{notification.message}</span>
              <button
                onClick={() => removeNotification(notification.id)}
                className="ml-2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* NEW: Loading state while JobContainer loads job data */}
      {isJobContainerLoading && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
          <div className="flex items-center justify-center space-x-2 text-blue-600">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm font-medium">Loading job data...</span>
          </div>
          <p className="text-xs text-blue-500 mt-1">File uploads disabled until job data loads</p>
        </div>
      )}

      {/* Source File Section */}
      <div className="flex items-center gap-3 text-gray-300">
        <FileText className="w-4 h-4 text-blue-400" />
        <span className="text-sm min-w-0 flex-1">
          📄 Source: {getFileStatusWithRealVersion(job.updated_at || job.created_at, 'source')}
        </span>
        
        <input
          type="file"
          accept=".csv,.txt"
          onChange={handleSourceFileUpload}
          className="hidden"
          id="source-file-upload"
        />
        
        <button
          onClick={() => document.getElementById('source-file-upload').click()}
          disabled={comparing || processing || isJobLoading || isJobContainerLoading}
          className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:bg-gray-500 flex items-center gap-1"
          title={isJobLoading || isJobContainerLoading ? 'Job data is loading...' : ''}
        >
          <Upload className="w-3 h-3" />
          {sourceFile ? sourceFile.name.substring(0, 10) + '...' : 'Select File'}
        </button>
        
        {sourceFile && (
          <>
            <button
              onClick={() => {
                setSourceFile(null);
                setSourceFileContent(null);
                // REMOVED: Don't reset vendor - keep using prop from JobContainer
                document.getElementById('source-file-upload').value = '';
                addNotification('Source file cleared', 'info');
              }}
              disabled={comparing || processing}
              className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600 disabled:bg-gray-500 flex items-center"
            >
              <X className="w-3 h-3" />
            </button>
            <button
              onClick={() => handleCompareFile('source')}
              disabled={comparing || processing || isJobLoading}
              className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:bg-gray-500 flex items-center gap-1"
              title={isJobLoading ? 'Job data is loading...' : ''}
            >
              {comparing ? (
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
              ) : (
                <CheckCircle className="w-3 h-3" />
              )}
              Update
            </button>
          </>
        )}
      </div>

      {/* Code File Section */}
      <div className="flex items-center gap-3 text-gray-300">
        <Settings className="w-4 h-4 text-green-400" />
        <span className="text-sm min-w-0 flex-1">
          ⚙️ Code: {getFileStatusWithRealVersion(job.code_file_uploaded_at || job.created_at, 'code')}
        </span>
        
        <input
          type="file"
          accept=".txt,.json"
          onChange={handleCodeFileUpload}
          className="hidden"
          id="code-file-upload"
        />
        
        <button
          onClick={() => document.getElementById('code-file-upload').click()}
          disabled={comparing || processing || isJobContainerLoading}
          className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:bg-gray-500 flex items-center gap-1"
        >
          <Upload className="w-3 h-3" />
          {codeFile ? codeFile.name.substring(0, 10) + '...' : 'Select File'}
        </button>
        
        {codeFile && (
          <>
            <button
              onClick={() => {
                setCodeFile(null);
                setCodeFileContent(null);
                document.getElementById('code-file-upload').value = '';
                addNotification('Code file cleared', 'info');
              }}
              disabled={comparing || processing || isJobContainerLoading}
              className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600 disabled:bg-gray-500 flex items-center"
            >
              <X className="w-3 h-3" />
            </button>
            <button
              onClick={handleCodeFileUpdate}
              disabled={comparing || processing}
              className="px-3 py-1 bg-yellow-600 text-white text-xs rounded hover:bg-yellow-700 disabled:bg-gray-500 flex items-center gap-1"
            >
              {processing ? (
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
              ) : (
                <Settings className="w-3 h-3" />
              )}
              Update Codes
            </button>
          </>
        )}
  </div>

      {/* Comparison Reports Section */}
      <div className="flex items-center gap-3 text-gray-300">
        <Database className="w-4 h-4 text-purple-400" />
        <span className="text-sm min-w-0 flex-1">
          �� Reports: {reportCount} saved comparison{reportCount !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => {
            setCurrentReportPage(1); // Reset to first page
            setShowReportsModal(true);
          }}
          className="px-3 py-1 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 flex items-center gap-1"
        >
          <Eye className="w-3 h-3" />
          View History
        </button>
      </div>

      {/* Reports List Modal */}
      <ReportsListModal />

      {/* Batch Processing Modal */}
      <BatchProcessingModal />

      {/* Results Modal */}
      <ResultsModal />
    </div>
  );
};

export default FileUploadButton;
