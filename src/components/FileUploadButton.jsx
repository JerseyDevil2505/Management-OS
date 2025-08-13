  import React, { useState, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertTriangle, X, Database, Settings, Download, Eye, Calendar, RefreshCw } from 'lucide-react';
import { jobService, propertyService, supabase } from '../lib/supabaseClient';

const FileUploadButton = ({ job, onFileProcessed }) => {
  const [sourceFile, setSourceFile] = useState(null);
  const [codeFile, setCodeFile] = useState(null);
  const [detectedVendor, setDetectedVendor] = useState(null);
  const [sourceFileContent, setSourceFileContent] = useState(null);
  const [codeFileContent, setCodeFileContent] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [comparisonResults, setComparisonResults] = useState(null);
  const [salesDecisions, setSalesDecisions] = useState(new Map());
  const [sourceFileVersion, setSourceFileVersion] = useState(null);  // Changed from 1 to null
  const [lastSourceProcessedDate, setLastSourceProcessedDate] = useState(null);
  const [lastCodeProcessedDate, setLastCodeProcessedDate] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);  // Added new state
  
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

  const addNotification = (message, type = 'info') => {
    const id = Date.now();
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
      id: Date.now(),
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

  // FIXED: Enhanced vendor detection with BRT code file support
  const detectVendorType = (fileContent, fileName) => {
    if (!fileName) return null;
    
    // BRT source files: .csv extension
    if (fileName.endsWith('.csv')) {
      return 'BRT';
    }
    
    // Text files - distinguish by content
    if (fileName.endsWith('.txt')) {
      // BRT code files: contain JSON braces
      if (fileContent.includes('{')) {
        return 'BRT';
      }
      // Microsystems files: contain pipe delimiters
      else if (fileContent.includes('|')) {
        return 'Microsystems';
      }
    }
    
    // JSON files are BRT
    if (fileName.endsWith('.json')) {
      return 'BRT';
    }
    
    return null;
  };

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

    if (!detectedVendor) {
      addNotification('Could not detect vendor type for code file', 'error');
      return;
    }

    try {
      setProcessing(true);
      setProcessingStatus('Processing code file...');

      // Parse the code file
      const parsedCodes = parseCodeFile(codeFileContent, detectedVendor);
      
      if (!parsedCodes) {
        throw new Error('Failed to parse code file');
      }

      // Count codes for feedback
      let codeCount = 0;
      if (detectedVendor === 'BRT') {
        // BRT has nested sections - count all entries
        codeCount = Object.values(parsedCodes).reduce((total, section) => {
          return total + (typeof section === 'object' ? Object.keys(section).length : 1);
        }, 0);
      } else {
        // Microsystems has flat structure
        codeCount = Object.keys(parsedCodes).length;
      }

      // FIXED: Properly escape special characters to prevent Unicode errors
      const sanitizedContent = codeFileContent
        .replace(/\\/g, '\\\\')  // Escape backslashes first
        .replace(/'/g, "''")     // Escape single quotes for SQL
        .replace(/\x00/g, '\\0') // Escape null bytes
        .replace(/\n/g, '\\n')   // Escape newlines
        .replace(/\r/g, '\\r')   // Escape carriage returns
        .replace(/\x1a/g, '\\Z') // Escape Ctrl+Z
        .replace(/\t/g, '\\t');  // Escape tabs

      const newVersion = (job.code_file_version || 1) + 1;

      // Update jobs table directly
      const { error } = await supabase
        .from('jobs')
        .update({
          code_file_content: sanitizedContent,
          code_file_name: codeFile.name,
          code_file_status: 'current',
          code_file_uploaded_at: new Date().toISOString(),
          code_file_version: newVersion,
          parsed_code_definitions: parsedCodes,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);

      if (error) {
        throw new Error(`Failed to update job: ${error.message}`);
      }

      addNotification(`✅ Successfully updated ${codeCount} code definitions for ${detectedVendor}`, 'success');
      setLastCodeProcessedDate(new Date().toISOString());  // Track code file update date
      
      // Clear code file selection
      setCodeFile(null);
      setCodeFileContent(null);
      document.getElementById('code-file-upload').value = '';

      // Notify parent component of the update
      if (onFileProcessed) {
        onFileProcessed({ 
          type: 'code_update', 
          codes_updated: codeCount,
          vendor: detectedVendor 
        });
      }

    } catch (error) {
      console.error('❌ Code file update failed:', error);
      addNotification(`Code file update failed: ${error.message}`, 'error');
    } finally {
      setProcessing(false);
      setProcessingStatus('');
    }
  };

  // FIXED: Parse files with exact processor logic
  const parseSourceFile = (fileContent, vendor) => {
    const lines = fileContent.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];
    
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
          const blockField = detectedVendor === 'BRT' ? 'BLOCK' : 'Block';
          const lotField = detectedVendor === 'BRT' ? 'LOT' : 'Lot';
          const qualifierField = detectedVendor === 'BRT' ? 'QUALIFIER' : 'Qual';
          const locationField = detectedVendor === 'BRT' ? 'PROPERTY_LOCATION' : 'Location';
          
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
        vendor_detected: detectedVendor,
        source_file_name: sourceFile?.name,
        comparison_timestamp: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('comparison_reports')
        .insert([{
          job_id: job.id,
          report_data: reportData,
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
        const blockField = detectedVendor === 'BRT' ? 'BLOCK' : 'Block';
        const lotField = detectedVendor === 'BRT' ? 'LOT' : 'Lot';
        const qualifierField = detectedVendor === 'BRT' ? 'QUALIFIER' : 'Qual';
        const locationField = detectedVendor === 'BRT' ? 'PROPERTY_LOCATION' : 'Location';
        
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

  // FIXED: Comparison logic using property_records directly instead of current_properties view
  const performComparison = async () => {
    if (!sourceFileContent || !job) return null;
    
    try {
      setProcessingStatus('Analyzing files...');
      
      // Parse source file
      const sourceRecords = parseSourceFile(sourceFileContent, detectedVendor);
      
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
        const compositeKey = generateCompositeKey(record, detectedVendor, yearCreated, ccddCode);
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
        const sourceSalesPrice = parseFloat(String(sourceRecord[detectedVendor === 'BRT' ? 'CURRENTSALE_PRICE' : 'Sale Price'] || 0).replace(/[,$]/g, '')) || 0;
        const dbSalesPrice = parseFloat(dbRecord.sales_price || 0);

        // ADD: Get sales_nu values
        const sourceSalesNu = sourceRecord[detectedVendor === 'BRT' ? 'CURRENTSALE_NU' : 'Sale Nu'] || '';
        const dbSalesNu = dbRecord.sales_nu || '';
        const sourceSalesBook = sourceRecord[detectedVendor === 'BRT' ? 'CURRENTSALE_DEEDBOOK' : 'Sale Book'] || '';
        const dbSalesBook = dbRecord.sales_book || '';
        const sourceSalesPage = sourceRecord[detectedVendor === 'BRT' ? 'CURRENTSALE_DEEDPAGE' : 'Sale Page'] || '';
        const dbSalesPage = dbRecord.sales_page || '';
          
        // FIXED: Normalize both dates for accurate comparison using processor method
        const sourceSalesDate = parseDate(sourceRecord[detectedVendor === 'BRT' ? 'CURRENTSALE_DATE' : 'Sale Date']);
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
            sourceDateRaw: sourceRecord[detectedVendor === 'BRT' ? 'CURRENTSALE_DATE' : 'Sale Date'],
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
        if (detectedVendor === 'BRT') {
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
          
        } else if (detectedVendor === 'Microsystems') {
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
    // Save current scroll position
    const container = document.getElementById('sales-changes-container');
    const scrollPos = container ? container.scrollTop : 0;
    
    setSalesDecisions(prev => new Map(prev.set(propertyKey, decision)));
    
    // Restore scroll position after React re-renders
    setTimeout(() => {
      if (container) {
        container.scrollTop = scrollPos;
      }
    }, 0);
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

  // CRITICAL FIX: Refresh banner state immediately after processing
  const refreshBannerState = async () => {
    try {
      
      // Refresh source file version from property_records
      const { data: sourceVersionData, error: sourceVersionError } = await supabase
        .from('property_records')
        .select('file_version')
        .eq('job_id', job.id)
        .limit(1)
        .single();
        
      if (sourceVersionData && !sourceVersionError) {
        setSourceFileVersion(sourceVersionData.file_version || 1);
      } else {
        setSourceFileVersion(1);
      }
      
      // Force a re-render of the component to update banner display
      
    } catch (error) {
      console.error('🔄 REFRESH - Error refreshing banner state:', error);
    }
  };

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
      
      // Set initial state
      setBatchInsertProgress(prev => ({
        ...prev,
        isInserting: true,
        currentOperation: 'Initializing batch processing...'
      }));
      
      // Execute the operation
      operation().then(result => {
        // Restore original console methods
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
        
        addBatchLog(`✅ All batches complete - Total records: ${totalRecords}`, 'success');
        
        resolve(result);
      }).catch(error => {
        // Restore original console methods
        console.log = originalLog;
        console.error = originalError;
        
        setBatchInsertProgress(prev => ({
          ...prev,
          isInserting: false,
          currentOperation: 'Batch processing failed',
          insertAttempts: prev.insertAttempts.map(a => ({
            ...a,
            status: a.status === 'success' ? 'success' : 'failed'
          }))
        }));
        
        addBatchLog(`❌ Batch processing failed: ${error.message}`, 'error');
        
        reject(error);
      });
    });
  };

  // ENHANCED: Process changes with batch logging modal
  const handleProcessChanges = async () => {
    // Wait for initialization
    if (!isInitialized || sourceFileVersion === null) {
      addNotification('System initializing, please try again in a moment', 'warning');
      return;
    }
    
    if (!sourceFile || !sourceFileContent) {
      addNotification('No source file to process', 'error');
      return;
    }
    
    try {
      // Initialize batch logging
      clearBatchLogs();
      setShowBatchModal(true);
      setProcessing(true);
      setProcessingStatus(`Processing ${detectedVendor} data via updater...`);
      
      addBatchLog('🚀 Starting file processing workflow', 'batch_start', {
        vendor: detectedVendor,
        fileName: sourceFile.name,
        changesDetected: comparisonResults.summary.missing + comparisonResults.summary.changes + comparisonResults.summary.deletions + comparisonResults.summary.salesChanges + comparisonResults.summary.classChanges,
        salesDecisions: salesDecisions.size
      });
      
      
      // Call the updater to UPSERT the database
      addBatchLog(`📊 Calling ${detectedVendor} updater (UPSERT mode)...`, 'info');
      
      // FIX 1: Calculate new file_version for property_records
      const newFileVersion = sourceFileVersion + 1;
      
      // Track batch operations
      const result = await trackBatchInserts(async () => {
        return await propertyService.updateCSVData(
          sourceFileContent,
          codeFileContent,
          job.id,
          job.year_created || new Date().getFullYear(),
          job.ccdd_code || job.ccddCode,
          detectedVendor,
          {
            source_file_name: sourceFile?.name,
            source_file_version_id: crypto.randomUUID(),
            source_file_uploaded_at: new Date().toISOString(),
            file_version: newFileVersion  // FIX 1: Pass file_version, not source_file_version
          }
        );
      });
      
      addBatchLog('✅ Property data processing completed', 'success', {
        processed: result.processed,
        errors: result.errors,
        newVersion: newFileVersion  // FIX 1: Show correct version
      });
      
      // Save comparison report with sales decisions
      addBatchLog('💾 Saving comparison report to database...', 'info');
      await saveComparisonReport(comparisonResults, salesDecisions);
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
        await jobService.update(job.id, {
          sourceFileStatus: result.errors > 0 ? 'error' : 'imported',
          totalProperties: result.processed,
          source_file_uploaded_at: new Date().toISOString()
          // FIX 1: Removed source_file_version update - it's handled in property_records now
        });
        addBatchLog('✅ Job metadata updated successfully', 'success');
      } catch (updateError) {
        console.error('❌ Failed to update job:', updateError);
        addBatchLog('⚠️ Job metadata update failed', 'warning', { error: updateError.message });
        addNotification('Data processed but job update failed', 'warning');
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
          vendor: detectedVendor,
          salesDecisions: salesDecisions.size
        });
        addNotification(`✅ Successfully processed ${totalProcessed} records via ${detectedVendor} updater`, 'success');
        
        if (salesDecisions.size > 0) {
          addNotification(`💾 Saved ${salesDecisions.size} sales decisions`, 'success');
        }
      }
      // Check if rollback occurred
      if (result.warnings && result.warnings.some(w => w.includes('rolled back'))) {
        addBatchLog('⚠️ UPDATE FAILED - All changes have been rolled back', 'error', {
          message: 'The update encountered errors and all changes were automatically reversed'
        });
        addNotification('❌ Update failed - all changes rolled back. Check logs for details.', 'error');
      }
      
      // CRITICAL FIX: Update banner state immediately
      addBatchLog('🔄 Refreshing UI state...', 'info');
      setSourceFileVersion(newFileVersion);  // Use the newFileVersion we already calculated
      setLastSourceProcessedDate(new Date().toISOString());  // Track our own date!
      addBatchLog('✅ UI state refreshed successfully', 'success');
      
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
      
    } catch (error) {
      console.error('❌ Processing failed:', error);
      
      // Check if this was a rollback error
      const isRollback = error.message && (error.message.includes('rolled back') || error.message.includes('reverted'));
      
      if (isRollback) {
        addBatchLog('❌ CRITICAL FAILURE - Update rolled back', 'error', { 
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
    }
  };
  const handleSourceFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    setSourceFile(file);
    
    try {
      const content = await file.text();
      setSourceFileContent(content);
      
      const vendor = detectVendorType(content, file.name);
      setDetectedVendor(vendor);
      
      if (vendor) {
        addNotification(`✅ Detected ${vendor} file format`, 'success');
      } else {
        addNotification('⚠️ Could not detect vendor type', 'warning');
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
      
      const vendor = detectVendorType(content, file.name);
      if (vendor) {
        addNotification(`✅ Detected ${vendor} code file`, 'success');
      }
    } catch (error) {
      console.error('Error reading code file:', error);
      addNotification('Error reading code file', 'error');
    }
  };

  // ENHANCED: Batch Processing Modal with insert progress
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
        <div className="bg-white rounded-lg max-w-5xl w-full max-h-[70vh] overflow-hidden shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 bg-gray-50 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <FileText className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-bold text-gray-900">File Comparison Results</h2>
              </div>
              <button
                onClick={() => setShowResultsModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
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
                <div id="sales-changes-container" className="space-y-4 max-h-60 overflow-y-auto">
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
                <div className="space-y-3 max-h-60 overflow-y-auto">
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
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {details.missing.slice(0, 10).map((record, idx) => {
                    const blockField = detectedVendor === 'BRT' ? 'BLOCK' : 'Block';
                    const lotField = detectedVendor === 'BRT' ? 'LOT' : 'Lot';
                    const qualifierField = detectedVendor === 'BRT' ? 'QUALIFIER' : 'Qual';
                    const locationField = detectedVendor === 'BRT' ? 'PROPERTY_LOCATION' : 'Location';
                    const classField = detectedVendor === 'BRT' ? 'PROPERTY_CLASS' : 'Class';
                    const priceField = detectedVendor === 'BRT' ? 'CURRENTSALE_PRICE' : 'Sale Price';
                    const dateField = detectedVendor === 'BRT' ? 'CURRENTSALE_DATE' : 'Sale Date';
                    
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
                <div className="space-y-2 max-h-60 overflow-y-auto">
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
                <div>Vendor: {detectedVendor}</div>
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
                      const generatedKey = generateCompositeKey(record, detectedVendor, yearCreated, ccddCode);
                      
                      return (
                        <div key={idx} className="text-xs text-yellow-700 font-mono">
                          {detectedVendor === 'BRT' ? 
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

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between shrink-0">
            <div className="flex space-x-3">
              <button
                onClick={viewAllReports}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center space-x-2"
              >
                <Eye className="w-4 h-4" />
                <span>View All Reports</span>
              </button>
              
              <button
                onClick={exportComparisonReport}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center space-x-2"
              >
                <Download className="w-4 h-4" />
                <span>Export This Report</span>
              </button>
            </div>
            
            {hasAnyChanges ? (
              <button
                onClick={handleProcessChanges}
                disabled={processing}
                className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
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
                    setProcessingStatus(`Processing ${detectedVendor} data via updater...`);
                    
                    addBatchLog('🚀 Processing file with no changes detected', 'batch_start', {
                      vendor: detectedVendor,
                      fileName: sourceFile.name,
                      changesDetected: 0,
                      salesDecisions: 0
                    });
                    
                    
                    // Call the updater to UPSERT the database with latest data
                    addBatchLog(`📊 Calling ${detectedVendor} updater for version refresh...`, 'info');
                    
                    // FIX 1: Calculate new file_version for property_records
                    const newFileVersion = sourceFileVersion + 1;
                    
                    const result = await trackBatchInserts(async () => {
                      return await propertyService.updateCSVData(
                        sourceFileContent,
                        codeFileContent,
                        job.id,
                        job.year_created || new Date().getFullYear(),
                        job.ccdd_code || job.ccddCode,
                        detectedVendor,
                        {
                          source_file_name: sourceFile?.name,
                          source_file_version_id: crypto.randomUUID(),
                          source_file_uploaded_at: new Date().toISOString(),
                          file_version: newFileVersion  // FIX 1: Pass file_version, not source_file_version
                        }
                      );
                    });
                    
                    addBatchLog('✅ Data refresh completed', 'success', {
                      processed: result.processed,
                      errors: result.errors,
                      newVersion: newFileVersion  // FIX 1: Show correct version
                    });
                    
                    // Save comparison report (showing no changes)
                    addBatchLog('💾 Saving comparison report...', 'info');
                    await saveComparisonReport(comparisonResults, salesDecisions);
                    addBatchLog('✅ Comparison report saved', 'success');
                    
                    // Update job with new file info - removed source_file_version update
                    addBatchLog('🔄 Updating job metadata...', 'info');
                    await jobService.update(job.id, {
                      sourceFileStatus: result.errors > 0 ? 'error' : 'imported',
                      totalProperties: result.processed,
                      source_file_uploaded_at: new Date().toISOString()
                      // FIX 1: Removed source_file_version update - it's handled in property_records now
                    });
                    addBatchLog('✅ Job metadata updated', 'success');
                    
                    const totalProcessed = result.processed || 0;
                    const errorCount = result.errors || 0;
                    
                    if (errorCount > 0) {
                      addBatchLog(`⚠️ Refresh completed with ${errorCount} errors`, 'warning');
                      addNotification(`⚠️ Processing completed with ${errorCount} errors. ${totalProcessed} records updated.`, 'warning');
                    } else {
                      addBatchLog('🎉 File version refresh completed successfully!', 'success');
                      addNotification(`✅ Successfully updated ${totalProcessed} records with latest data via ${detectedVendor} updater`, 'success');
                    }
                    // Check if rollback occurred during refresh
                    if (result.warnings && result.warnings.some(w => w.includes('rolled back'))) {
                      addBatchLog('⚠️ REFRESH FAILED - All changes have been rolled back', 'error');
                      addNotification('❌ Refresh failed - all changes rolled back. Check logs for details.', 'error');
                    }
                    
                    // CRITICAL FIX: Update banner state immediately
                    addBatchLog('🔄 Refreshing UI state...', 'info');
                    setSourceFileVersion(newFileVersion);  // Use the newFileVersion we already calculated
                    addBatchLog('✅ UI state refreshed successfully', 'success');
                    
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
                className="px-6 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50 font-medium"
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

  // NEW: Fetch source file version from property_records
  useEffect(() => {
    const fetchSourceFileVersion = async () => {
      if (!job?.id) return;
      
      try {
        const { data, error } = await supabase
          .from('property_records')
          .select('file_version')
          .eq('job_id', job.id)
          .limit(1)
          .single();
          
        if (data && !error) {
          setSourceFileVersion(data.file_version || 1);
        } else {
          setSourceFileVersion(1);
        }
      } catch (error) {
        console.error('🔍 DEBUG - Error fetching source file version:', error);
        setSourceFileVersion(1);
      } finally {
        // Mark as initialized after fetching version
        setIsInitialized(true);
      }
    };

    fetchSourceFileVersion();
  }, [job?.id]);

  const getFileStatusWithRealVersion = (timestamp, type) => {
    if (!timestamp) return 'Never';
    
    if (type === 'source') {
      // Use our local date if we just processed, otherwise use job date
      const displayDate = lastSourceProcessedDate || timestamp;
      const result = sourceFileVersion === 1 
        ? `Imported at Job Creation (${formatDate(displayDate)})`
        : `Updated via FileUpload (${formatDate(displayDate)})`;
      return result;
    } else if (type === 'code') {
      // Use our local date if we just processed, otherwise use job date
      const displayDate = lastCodeProcessedDate || timestamp;
      const codeVersion = job.code_file_version || 1;
      const result = codeVersion === 1 
        ? `Imported at Job Creation (${formatDate(displayDate)})`
        : `Updated via FileUpload (${formatDate(displayDate)})`;
      return result;
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
          disabled={comparing || processing}
          className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:bg-gray-500 flex items-center gap-1"
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
                setDetectedVendor(null);
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
              disabled={comparing || processing}
              className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:bg-gray-500 flex items-center gap-1"
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
          disabled={comparing || processing}
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
              disabled={comparing || processing}
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

      {/* Batch Processing Modal */}
      <BatchProcessingModal />

      {/* Results Modal */}
      <ResultsModal />
    </div>
  );
};

export default FileUploadButton;
