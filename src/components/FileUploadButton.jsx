import React, { useState, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertTriangle, X, Database, Settings, Download, Eye, Calendar } from 'lucide-react';
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

  // FIXED: Comprehensive date parsing to handle all formats and normalize for comparison
  const parseAndNormalizeDate = (dateString) => {
    if (!dateString || dateString.trim() === '') return null;
    
    const cleanDate = dateString.trim();
    
    // Handle MM/DD/YYYY format from source files
    if (cleanDate.includes('/')) {
      const parts = cleanDate.split('/');
      if (parts.length === 3) {
        let [month, day, year] = parts;
        
        // Handle 2-digit years (convert to 4-digit)
        if (year.length === 2) {
          const currentYear = new Date().getFullYear();
          const currentCentury = Math.floor(currentYear / 100) * 100;
          year = parseInt(year) <= 30 ? currentCentury + parseInt(year) : currentCentury - 100 + parseInt(year);
        }
        
        // Create date and return normalized YYYY-MM-DD format
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0]; // Return as YYYY-MM-DD
        }
      }
    }
    
    // Handle YYYY-MM-DD format (already normalized)
    if (cleanDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const date = new Date(cleanDate);
      if (!isNaN(date.getTime())) {
        return cleanDate; // Already in correct format
      }
    }
    
    // Handle other standard formats
    const date = new Date(cleanDate);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
    
    console.warn('Could not parse date:', dateString);
    return null;
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
      // Microsystems format: handle renamed duplicate headers
      const blockValue = String(record['Block'] || '').trim();
      const lotValue = String(record['Lot'] || '').trim();
      const qualValue = String(record['Qual'] || '').trim() || 'NONE';
      const bldgValue = String(record['Bldg'] || '').trim() || 'NONE';
      const locationValue = String(record['Location'] || '').trim() || 'NONE'; // First Location field
      
      return `${yearCreated}${ccddCode}-${blockValue}-${lotValue}_${qualValue}-${bldgValue}-${locationValue}`;
    }
    
    return null;
  };

  // FIXED: Auto-detect vendor with proper format detection
  const detectVendorType = (fileContent) => {
    const firstLine = fileContent.split('\n')[0];
    
    // BRT detection: comma-separated or tab-separated with BRT headers
    const commaHeaders = firstLine.split(',');
    const tabHeaders = firstLine.split('\t');
    
    const hasBRTCommaFormat = commaHeaders.includes('BLOCK') && 
                             commaHeaders.includes('LOT') && 
                             commaHeaders.includes('QUALIFIER') &&
                             commaHeaders.includes('BATHTOT');
                             
    const hasBRTTabFormat = tabHeaders.includes('BLOCK') && 
                           tabHeaders.includes('LOT') && 
                           tabHeaders.includes('QUALIFIER') &&
                           tabHeaders.includes('BATHTOT');
    
    if (hasBRTCommaFormat || hasBRTTabFormat) {
      return 'BRT';
    }
    
    // Microsystems detection: pipe-delimited with Microsystems headers
    const pipeHeaders = firstLine.split('|');
    const hasMicrosystemsFormat = pipeHeaders.includes('Block') && 
                                 pipeHeaders.includes('Lot') && 
                                 pipeHeaders.includes('Qual');
    
    if (hasMicrosystemsFormat) {
      return 'Microsystems';
    }
    
    return null;
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
        console.log('✅ Comparison report saved:', data.id);
      }

      return data;
    } catch (error) {
      console.error('Failed to save comparison report:', error);
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

      console.log('📊 All reports for job:', reports);
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

  // FIXED: Comparison logic using current_properties view and proper date normalization
  const performComparison = async () => {
    if (!sourceFileContent || !job) return null;
    
    try {
      setProcessingStatus('Analyzing files...');
      
      // Parse source file
      const sourceRecords = parseSourceFile(sourceFileContent, detectedVendor);
      console.log(`📊 Parsed ${sourceRecords.length} source records`);
      
      // FIXED: Get current database records from current_properties view
      setProcessingStatus('Fetching current database records...');
      const { data: dbRecords, error: dbError } = await supabase
        .from('current_properties')  // Using the view instead of property_records
        .select('property_composite_key, property_block, property_lot, property_qualifier, property_location, sales_price, sales_date, property_m4_class, property_cama_class')
        .eq('job_id', job.id);
      
      if (dbError) {
        throw new Error(`Database fetch failed: ${dbError.message}`);
      }
      
      console.log(`📊 Found ${dbRecords.length} current database records`);
      
      // Generate composite keys for source records using EXACT processor logic
      setProcessingStatus('Generating composite keys...');
      const yearCreated = job.year_created || new Date().getFullYear();
      const ccddCode = job.ccdd || job.ccddCode;
      
      const sourceKeys = new Set();
      const sourceKeyMap = new Map();
      
      sourceRecords.forEach(record => {
        const compositeKey = generateCompositeKey(record, detectedVendor, yearCreated, ccddCode);
        if (compositeKey) {
          sourceKeys.add(compositeKey);
          sourceKeyMap.set(compositeKey, record);
        }
      });
      
      console.log(`🔑 Generated ${sourceKeys.size} source composite keys`);
      
      // Create database key sets
      const dbKeys = new Set(dbRecords.map(r => r.property_composite_key));
      const dbKeyMap = new Map(dbRecords.map(r => [r.property_composite_key, r]));
      
      console.log(`🔑 Found ${dbKeys.size} database composite keys`);
      
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
        
        // FIXED: Normalize both dates for accurate comparison
        const sourceSalesDate = parseAndNormalizeDate(sourceRecord[detectedVendor === 'BRT' ? 'CURRENTSALE_DATE' : 'Sale Date']);
        const dbSalesDate = parseAndNormalizeDate(dbRecord.sales_date);
        
        // FIXED: Use proper number comparison with reasonable tolerance AND normalized date comparison
        const pricesDifferent = Math.abs(sourceSalesPrice - dbSalesPrice) > 0.01;
        const datesDifferent = sourceSalesDate !== dbSalesDate;
        
        // Debug logging for sales comparison
        if (pricesDifferent || datesDifferent) {
          console.log(`🔍 Sales difference detected for ${key}:`, {
            prices: { source: sourceSalesPrice, db: dbSalesPrice, different: pricesDifferent },
            dates: { source: sourceSalesDate, db: dbSalesDate, different: datesDifferent }
          });
        }
        
        if (pricesDifferent || datesDifferent) {
          salesChanges.push({
            property_composite_key: key,
            property_block: dbRecord.property_block,
            property_lot: dbRecord.property_lot,
            property_qualifier: dbRecord.property_qualifier,
            property_location: dbRecord.property_location,
            differences: {
              sales_price: { old: dbSalesPrice, new: sourceSalesPrice },
              sales_date: { old: dbSalesDate, new: sourceSalesDate }
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
      
      console.log('📊 Comparison Results:', results.summary);
      return results;
      
    } catch (error) {
      console.error('Comparison error:', error);
      throw error;
    }
  };

  // NEW: Handle sales decisions
  const handleSalesDecision = (propertyKey, decision) => {
    setSalesDecisions(prev => new Map(prev.set(propertyKey, decision)));
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

  // NEW: Process changes after review and approval
  const handleProcessChanges = async () => {
    if (!sourceFile || !sourceFileContent) {
      addNotification('No source file to process', 'error');
      return;
    }
    
    try {
      setProcessing(true);
      setProcessingStatus(`Processing ${detectedVendor} data via processor...`);
      
      console.log('🚀 Processing approved changes...');
      
      // Call the processor to update the database
      const result = await propertyService.importCSVData(
        sourceFileContent,
        codeFileContent,
        job.id,
        job.year_created || new Date().getFullYear(),
        job.ccdd || job.ccddCode,
        detectedVendor,
        {
          source_file_name: sourceFile?.name,
          source_file_version_id: crypto.randomUUID(),
          source_file_uploaded_at: new Date().toISOString(),
          file_version: (job.source_file_version || 1) + 1
        }
      );
      
      console.log('📊 Processor completed with result:', result);
      
      // Save comparison report with sales decisions
      await saveComparisonReport(comparisonResults, salesDecisions);
      
      // Store sales decisions as JSON in property records
      if (salesDecisions.size > 0) {
        setProcessingStatus('Saving sales decisions...');
        
        for (const [compositeKey, decision] of salesDecisions.entries()) {
          const salesChange = comparisonResults.details.salesChanges.find(sc => sc.property_composite_key === compositeKey);
          
          try {
            const { error } = await supabase
              .from('property_records')
              .update({ 
                sales_history: {
                  comparison_date: new Date().toISOString().split('T')[0],
                  sales_decision: {
                    decision_type: decision,
                    old_price: salesChange?.differences.sales_price.old,
                    new_price: salesChange?.differences.sales_price.new,
                    old_date: salesChange?.differences.sales_date.old,
                    new_date: salesChange?.differences.sales_date.new,
                    decided_by: 'user', // TODO: Get actual user ID
                    decided_at: new Date().toISOString()
                  }
                }
              })
              .eq('property_composite_key', compositeKey)
              .eq('job_id', job.id);
            
            if (error) {
              console.error('Error updating sales history:', error);
            }
          } catch (updateError) {
            console.error('Failed to update sales history for property:', compositeKey, updateError);
          }
        }
        
        console.log(`✅ Saved ${salesDecisions.size} sales decisions to property records`);
      }
      
      // Update job with new file version info
      try {
        await jobService.update(job.id, {
          sourceFileStatus: result.errors > 0 ? 'error' : 'imported',
          totalProperties: result.processed,
          source_file_version: (job.source_file_version || 1) + 1,
          source_file_uploaded_at: new Date().toISOString()
        });
        console.log('✅ Job updated with new version info');
      } catch (updateError) {
        console.error('❌ Failed to update job:', updateError);
        addNotification('Data processed but job update failed', 'warning');
      }
      
      const totalProcessed = result.processed || 0;
      const errorCount = result.errors || 0;
      
      if (errorCount > 0) {
        addNotification(`❌ Processing completed with ${errorCount} errors. ${totalProcessed} records processed.`, 'warning');
      } else {
        addNotification(`✅ Successfully processed ${totalProcessed} records via ${detectedVendor} processor`, 'success');
        
        if (salesDecisions.size > 0) {
          addNotification(`💾 Saved ${salesDecisions.size} sales decisions`, 'success');
        }
      }
      
      // Close modal and clean up
      setShowResultsModal(false);
      setSourceFile(null);
      setSourceFileContent(null);
      setSalesDecisions(new Map());
      
      // Notify parent
      if (onFileProcessed) {
        onFileProcessed(result);
      }
      
    } catch (error) {
      console.error('❌ Processing failed:', error);
      addNotification(`Processing failed: ${error.message}`, 'error');
    } finally {
      setProcessing(false);
      setProcessingStatus('');
    }
  };

  const handleSourceFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setSourceFile(file);
    
    try {
      const content = await file.text();
      setSourceFileContent(content);
      
      const vendor = detectVendorType(content);
      if (vendor) {
        setDetectedVendor(vendor);
        addNotification(`✅ ${vendor} format detected`, 'success');
      } else {
        addNotification('⚠️ Could not detect vendor format', 'warning');
      }
    } catch (error) {
      addNotification(`Error reading file: ${error.message}`, 'error');
    }
  };

  const handleCodeFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setCodeFile(file);
    
    try {
      const content = await file.text();
      setCodeFileContent(content);
      addNotification('✅ Code file loaded', 'success');
    } catch (error) {
      addNotification(`Error reading code file: ${error.message}`, 'error');
    }
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
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
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
                <div className={`text-2xl font-bold ${hasClassChanges ? 'text-purple-600' : 'text-gray-500'}`}>
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
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Sales Changes Requiring Decisions:</h3>
                <div className="space-y-4 max-h-60 overflow-y-auto">
                  {details.salesChanges.map((change, idx) => {
                    const currentDecision = salesDecisions.get(change.property_composite_key);
                    
                    return (
                      <div key={idx} className="border border-blue-200 rounded-lg p-4 bg-blue-50">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h4 className="font-bold text-gray-900">
                              Property {change.property_block}-{change.property_lot}
                            </h4>
                            <p className="text-gray-600 text-sm">{change.property_location}</p>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-gray-600">Price Change</div>
                            <div className="text-sm font-bold text-red-600">
                              ${change.differences.sales_price.old?.toLocaleString() || 0} 
                            </div>
                            <div className="text-sm font-bold text-green-600">
                              → ${change.differences.sales_price.new?.toLocaleString() || 0}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {change.differences.sales_date.old || 'No Date'} → {change.differences.sales_date.new || 'No Date'}
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

            {/* Processing Status */}
            {processing && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  <span className="text-blue-800 font-medium">{processingStatus}</span>
                </div>
              </div>
            )}

            {/* Debug Info */}
            <div className="mt-6 p-4 bg-gray-100 rounded-lg">
              <h3 className="font-bold text-gray-900 mb-2">🔍 Debug Info:</h3>
              <div className="text-sm text-gray-700 space-y-1">
                <div>Vendor: {detectedVendor}</div>
                <div>Job ID: {job.id}</div>
                <div>Source File: {sourceFile?.name}</div>
                <div>Total Changes: {summary.missing + summary.changes + summary.deletions + summary.salesChanges + summary.classChanges}</div>
                <div>Using: current_properties view (latest versions only)</div>
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
                onClick={() => setShowResultsModal(false)}
                className="px-6 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 font-medium"
              >
                Acknowledge & Close
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

  // Get file status description
  const getFileStatus = (timestamp, type) => {
    if (!timestamp) return 'Never';
    
    const fileDate = new Date(timestamp);
    const jobDate = new Date(job.created_at);
    const timeDiff = Math.abs(fileDate - jobDate) / (1000 * 60);
    
    if (timeDiff <= 5) {
      return `Imported at Job Creation (${formatDate(timestamp)})`;
    } else {
      return `Updated via FileUpload (${formatDate(timestamp)})`;
    }
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
          📄 Source: {getFileStatus(job.source_file_uploaded_at || job.created_at, 'source')}
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
        )}
      </div>

      {/* Code File Section */}
      <div className="flex items-center gap-3 text-gray-300">
        <Settings className="w-4 h-4 text-green-400" />
        <span className="text-sm min-w-0 flex-1">
          ⚙️ Code: {getFileStatus(job.code_file_uploaded_at || job.created_at, 'code')}
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
      </div>

      {/* Results Modal */}
      <ResultsModal />
    </div>
  );
};

export default FileUploadButton;
