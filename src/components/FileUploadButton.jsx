import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Settings, AlertTriangle, CheckCircle, Download, Eye, X, Calendar } from 'lucide-react';
import { supabase, propertyService } from '../lib/supabaseClient';

const FileUploadButton = ({ job, onFileProcessed }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadType, setUploadType] = useState(null);
  const [comparisonReport, setComparisonReport] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [salesDecisions, setSalesDecisions] = useState({});
  const [pendingSalesDecisions, setPendingSalesDecisions] = useState({});
  const [fileTimestamps, setFileTimestamps] = useState({
    source: null,
    code: null
  });
  const [asOfDates, setAsOfDates] = useState({
    source: new Date().toISOString().split('T')[0], // Default to today
    code: new Date().toISOString().split('T')[0]
  });
  const [selectedFiles, setSelectedFiles] = useState({
    source: null,
    code: null
  });
  
  const sourceFileRef = useRef();
  const codeFileRef = useRef();

  // Load file timestamps and previous sales decisions on mount
  useEffect(() => {
    if (job?.id) {
      loadFileTimestamps();
      loadPreviousSalesDecisions();
    }
  }, [job?.id]);

  // Load current file timestamps from property_records table
  const loadFileTimestamps = async () => {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('source_file_uploaded_at, code_file_updated_at')
        .eq('job_id', job.id)
        .order('upload_date', { ascending: false })
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        setFileTimestamps({
          source: data[0].source_file_uploaded_at,
          code: data[0].code_file_updated_at
        });
      } else {
        // Fallback to job creation date (no uploads yet)
        setFileTimestamps({
          source: job.created_at,
          code: job.created_at
        });
      }
    } catch (error) {
      console.error('Error loading file timestamps:', error);
      // Fall back to job creation date
      setFileTimestamps({
        source: job.created_at,
        code: job.created_at
      });
    }
  };

  // Load previous sales decisions from sales_history JSONB field
  const loadPreviousSalesDecisions = async () => {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('property_composite_key, sales_history')
        .eq('job_id', job.id)
        .not('sales_history', 'is', null);

      if (error) throw error;

      const decisionsMap = {};
      data.forEach(record => {
        if (record.sales_history?.decisions?.length > 0) {
          // Get the most recent decision
          const latestDecision = record.sales_history.decisions[record.sales_history.decisions.length - 1];
          decisionsMap[record.property_composite_key] = latestDecision;
        }
      });

      setSalesDecisions(decisionsMap);
    } catch (error) {
      console.error('Error loading sales decisions:', error);
      setSalesDecisions({});
    }
  };

  // Save complete comparison report for audit trail
  const saveComparisonReport = async (reportData) => {
    try {
      const reportRecord = {
        job_id: job.id,
        report_date: new Date().toISOString(),
        report_data: reportData,
        status: 'pending_review',
        generated_by: 'current-user', // TODO: Get actual user ID
        reviewed_by: null,
        reviewed_date: null
      };

      const { error } = await supabase
        .from('comparison_reports') // You'll need to create this table
        .insert([reportRecord]);

      if (error) throw error;
      
      console.log('Comparison report saved for audit trail');
    } catch (error) {
      console.error('Error saving comparison report:', error);
      // Don't fail the upload if report saving fails
    }
  };

  // Mark comparison report as reviewed
  const markReportAsReviewed = async (reportId) => {
    try {
      const { error } = await supabase
        .from('comparison_reports')
        .update({
          status: 'acknowledged',
          reviewed_by: 'current-user', // TODO: Get actual user ID
          reviewed_date: new Date().toISOString()
        })
        .eq('id', reportId);

      if (error) throw error;
      console.log('Report marked as reviewed');
    } catch (error) {
      console.error('Error marking report as reviewed:', error);
    }
  };

  // Export all comparison reports for this job as CSV
  const exportAllReports = async () => {
    try {
      const { data: reports, error } = await supabase
        .from('comparison_reports')
        .select('*')
        .eq('job_id', job.id)
        .order('report_date', { ascending: false });

      if (error) throw error;

      if (!reports || reports.length === 0) {
        alert('No comparison reports found for this job.');
        return;
      }

      // Flatten all reports into CSV rows
      const csvData = [];
      csvData.push(['Report_Date', 'Change_Type', 'Block', 'Lot', 'Qualifier', 'Property_Location', 'Old_Value', 'New_Value', 'Status', 'Reviewed_By', 'Reviewed_Date']);

      reports.forEach(report => {
        const reportDate = new Date(report.report_date).toLocaleDateString();
        const reportData = report.report_data;

        // Add removed properties
        reportData.removedProperties?.forEach(prop => {
          csvData.push([
            reportDate,
            'Property_Removed',
            prop.block,
            prop.lot,
            prop.qualifier || '',
            prop.property_location || '',
            'Property_Existed',
            'Property_Removed',
            report.status,
            report.reviewed_by || '',
            report.reviewed_date ? new Date(report.reviewed_date).toLocaleDateString() : ''
          ]);
        });

        // Add added properties
        reportData.addedProperties?.forEach(prop => {
          csvData.push([
            reportDate,
            'Property_Added',
            prop.block,
            prop.lot,
            prop.qualifier || '',
            prop.property_location || '',
            'Property_Not_Existed',
            'Property_Added',
            report.status,
            report.reviewed_by || '',
            report.reviewed_date ? new Date(report.reviewed_date).toLocaleDateString() : ''
          ]);
        });

        // Add class changes
        reportData.classChanges?.forEach(change => {
          csvData.push([
            reportDate,
            'Class_Change',
            change.block,
            change.lot,
            change.qualifier || '',
            change.property_location || '',
            change.oldClass || '',
            change.newClass || '',
            report.status,
            report.reviewed_by || '',
            report.reviewed_date ? new Date(report.reviewed_date).toLocaleDateString() : ''
          ]);
        });

        // Add sales changes
        reportData.salesChanges?.forEach(change => {
          const oldSaleValue = change.oldSale.price ? `$${change.oldSale.price.toLocaleString()} (${change.oldSale.date})` : 'No_Sale';
          const newSaleValue = change.newSale.price ? `$${change.newSale.price.toLocaleString()} (${change.newSale.date})` : 'No_Sale';
          
          csvData.push([
            reportDate,
            'Sales_Change',
            change.block,
            change.lot,
            change.qualifier || '',
            change.property_location || '',
            oldSaleValue,
            newSaleValue,
            change.hasExistingDecision ? 'Reviewed' : report.status,
            report.reviewed_by || '',
            report.reviewed_date ? new Date(report.reviewed_date).toLocaleDateString() : ''
          ]);
        });
      });

      // Convert to CSV and download
      const csvContent = csvData.map(row => row.map(field => `"${field}"`).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `${job.name}_All_Comparison_Reports_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (error) {
      console.error('Error exporting reports:', error);
      alert('Error exporting reports: ' + error.message);
    }
  };

  // Format date for display - Eastern Time
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

  // UPDATED: Get descriptive status for file timestamps using version logic
  const getFileStatus = (timestamp, type) => {
    if (!timestamp) return 'Never';
    
    // NEW: Use version logic instead of timing
    const version = type === 'source' ? job.source_file_version : job.code_file_version;
    
    if (version === 1) {
      return `Imported at Job Creation (${formatDate(timestamp)})`;
    } else {
      return `Updated via FileUpload (${type} v${version}) (${formatDate(timestamp)})`;
    }
  };

  // Handle file upload
  const handleFileUpload = async (file, type) => {
    if (!file) return;

    // Store the selected file
    setSelectedFiles(prev => ({
      ...prev,
      [type]: file
    }));
  };

  // Clear selected file
  const clearSelectedFile = (type) => {
    setSelectedFiles(prev => ({
      ...prev,
      [type]: null
    }));
    
    // Clear the file input
    if (type === 'source') {
      sourceFileRef.current.value = '';
    } else {
      codeFileRef.current.value = '';
    }
  };

  // Process the selected file (triggered by user confirmation)
  const processSelectedFile = async (type) => {
    const file = selectedFiles[type];
    if (!file) return;

    setIsUploading(true);
    setUploadType(type);

    try {
      // Read file content
      const fileContent = await readFileAsText(file);
      
      if (type === 'source') {
        // Generate comparison report for source files
        const report = await generateComparisonReport(fileContent, job.id);
        setComparisonReport(report);
        
        if (report.hasChanges) {
          // Save the comparison report for audit trail
          await saveComparisonReport(report);
          setShowReport(true);
          setIsUploading(false);
          return; // Wait for user to review before processing
        }
      }

      // Process the file directly if no review needed
      await processFile(file, type, fileContent);
      
      // Clear the selected file after successful processing
      clearSelectedFile(type);
      
    } catch (error) {
      console.error('File upload error:', error);
      alert(`Error uploading ${type} file: ${error.message}`);
    } finally {
      if (!showReport) {
        setIsUploading(false);
        setUploadType(null);
      }
    }
  };

  // Enhanced upsert process with version tracking and permanent tracking
  const processFile = async (file, type, fileContent) => {
    try {
      setIsUploading(true);
      
      if (type === 'source') {
        // Save sales decisions first if any
        if (Object.keys(pendingSalesDecisions).length > 0) {
          await saveSalesDecisions();
        }

        // ENHANCED: Smart upsert approach with proper version tracking
        await performSmartUpsert(fileContent, file.name);
        
      } else if (type === 'code') {
        // For code file updates, we need to reprocess with the new code file
        // Get the most recent source file content first
        const { data: latestRecord, error } = await supabase
          .from('property_records')
          .select('raw_data, source_file_name')
          .eq('job_id', job.id)
          .order('upload_date', { ascending: false })
          .limit(1);

        if (error || !latestRecord?.[0]) {
          throw new Error('Could not find source data to reprocess with new code file');
        }

        // Reconstruct source file content from raw_data
        const sourceFileContent = reconstructSourceFile(latestRecord);
        
        // Enhanced: Smart upsert for code file updates too
        await performSmartUpsert(sourceFileContent, latestRecord[0].source_file_name, fileContent, file.name);
      }

      // Refresh timestamps
      await loadFileTimestamps();

      // Notify parent component
      if (onFileProcessed) {
        onFileProcessed(type, file.name);
      }

      alert(`✅ ${type === 'source' ? 'Source' : 'Code'} file updated successfully!`);
      
    } catch (error) {
      console.error('File processing error:', error);
      alert(`Error processing ${type} file: ${error.message}`);
    } finally {
      setIsUploading(false);
      setUploadType(null);
      setShowReport(false);
      setPendingSalesDecisions({});
    }
  };

  // FIXED: Smart upsert with proper version tracking
  const performSmartUpsert = async (sourceFileContent, sourceFileName, codeFileContent = null, codeFileName = null) => {
    try {
      console.log('🔄 Starting smart upsert with version tracking...');
      
      // 1. Get current version numbers from jobs table
      const { data: currentJob, error: jobError } = await supabase
        .from('jobs')
        .select('source_file_version, code_file_version')
        .eq('id', job.id)
        .single();
      
      if (jobError) throw jobError;
      
      // 2. Calculate new version numbers
      const newSourceVersion = (currentJob.source_file_version || 1) + 1;
      const newCodeVersion = codeFileContent ? (currentJob.code_file_version || 1) + 1 : currentJob.code_file_version;
      
      console.log(`📊 Version tracking: Source ${currentJob.source_file_version || 1} → ${newSourceVersion}, Code ${currentJob.code_file_version || 1} → ${newCodeVersion}`);
      
      // 3. Delete ALL existing records for this job (clean slate approach)
      console.log('🗑️ Clearing existing property records for clean import...');
      const { error: deleteError } = await supabase
        .from('property_records')
        .delete()
        .eq('job_id', job.id);
      
      if (deleteError) {
        console.error('Error deleting existing records:', deleteError);
        throw deleteError;
      }
      
      // 4. Process new data using proven processors with version info
      console.log('⚙️ Processing new data through processors...');
      const result = await propertyService.importCSVData(
        sourceFileContent,
        codeFileContent,
        job.id,
        new Date(job.created_at).getFullYear(),
        job.ccdd || job.ccddCode,
        job.vendor,
        {
          source_file_name: sourceFileName,
          source_file_version_id: crypto.randomUUID(),
          source_file_uploaded_at: new Date().toISOString(),
          source_file_as_of_date: asOfDates.source,
          code_file_name: codeFileName,
          code_file_updated_at: codeFileContent ? new Date().toISOString() : null,
          code_file_as_of_date: codeFileContent ? asOfDates.code : null,
          file_version: newSourceVersion,
          is_fileupload_update: true // Flag to indicate this is an update
        }
      );
      
      console.log(`✅ Processors completed: ${result.processed} records processed`);
      
      // 5. Update job with new version numbers and file info
      const jobUpdateFields = {
        source_file_version: newSourceVersion,
        source_file_uploaded_at: new Date().toISOString()
      };
      
      if (codeFileContent) {
        jobUpdateFields.code_file_version = newCodeVersion;
        jobUpdateFields.code_file_uploaded_at = new Date().toISOString();
      }
      
      const { error: jobUpdateError } = await supabase
        .from('jobs')
        .update(jobUpdateFields)
        .eq('id', job.id);
      
      if (jobUpdateError) {
        console.error('Error updating job versions:', jobUpdateError);
        throw jobUpdateError;
      }
      
      console.log(`🎯 Upsert complete with version tracking: ${result.processed} records imported`);
      console.log(`📝 Job updated: Source v${newSourceVersion}, Code v${newCodeVersion}`);
      
      return {
        processed: result.processed,
        sourceVersion: newSourceVersion,
        codeVersion: newCodeVersion
      };
      
    } catch (error) {
      console.error('Smart upsert error:', error);
      throw error;
    }
  };

  // Reconstruct source file content from raw_data (for code file updates)
  const reconstructSourceFile = (records) => {
    if (!records || records.length === 0) return '';
    
    const firstRecord = records[0];
    const rawData = firstRecord.raw_data;
    
    // This is a simplified reconstruction - in practice, you might want to
    // store the original file content or have a more sophisticated method
    const headers = Object.keys(rawData);
    const headerLine = headers.join(',');
    const dataLine = headers.map(h => rawData[h] || '').join(',');
    
    return `${headerLine}\n${dataLine}`;
  };

  // FIXED: Generate comparison report using processor header logic
  const generateComparisonReport = async (newFileContent, jobId) => {
    try {
      // Get ALL previous data from property_records table (no limit for large jobs)
      let allPreviousData = [];
      let from = 0;
      const batchSize = 1000;
      
      while (true) {
        const { data: batchData, error: batchError } = await supabase
          .from('property_records')
          .select('*')
          .eq('job_id', jobId)
          .order('upload_date', { ascending: false })
          .range(from, from + batchSize - 1);
        
        if (batchError) throw batchError;
        
        if (!batchData || batchData.length === 0) break;
        
        allPreviousData = [...allPreviousData, ...batchData];
        
        if (batchData.length < batchSize) break; // Last batch
        
        from += batchSize;
      }
      
      const previousData = allPreviousData;

      if (!previousData || previousData.length === 0) {
        return { hasChanges: false, isFirstUpload: true };
      }

      // FIXED: Parse new data using the same logic as the processor
      const newData = parseFileWithProcessorLogic(newFileContent, job.vendor);
      
      // Compare data sets using consistent header logic
      const comparison = compareDataSets(previousData, newData);
      
      return {
        hasChanges: comparison.totalChanges > 0,
        isFirstUpload: false,
        ...comparison
      };

    } catch (error) {
      console.error('Comparison error:', error);
      return { hasChanges: false, error: error.message };
    }
  };

  // NEW: Parse file using the same header logic as the processors
  const parseFileWithProcessorLogic = (fileContent, vendor) => {
    console.log('🔍 Parsing file with processor header logic for vendor:', vendor);
    
    if (vendor === 'Microsystems') {
      // Use the SAME logic as microsystems-processor.js
      const lines = fileContent.split('\n').filter(line => line.trim());
      if (lines.length < 2) {
        throw new Error('File must have at least header and one data row');
      }
      
      // Parse headers and rename duplicates (SAME AS PROCESSOR)
      const originalHeaders = lines[0].split('|');
      const renamedHeaders = renameDuplicateHeaders(originalHeaders);
      
      console.log(`📋 Found ${renamedHeaders.length} headers with duplicates renamed`);
      console.log('🔄 Duplicate mapping:', {
        'Location': renamedHeaders.indexOf('Location'),
        'Location2': renamedHeaders.indexOf('Location2'),
        'Land Value': renamedHeaders.indexOf('Land Value'),
        'Land Value2': renamedHeaders.indexOf('Land Value2'),
        'Impr Value': renamedHeaders.indexOf('Impr Value'),
        'Impr Value2': renamedHeaders.indexOf('Impr Value2'),
        'Totl Value': renamedHeaders.indexOf('Totl Value'),
        'Totl Value2': renamedHeaders.indexOf('Totl Value2')
      });
      
      // Parse data rows with renamed headers
      const records = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split('|');
        
        if (values.length !== renamedHeaders.length) {
          console.warn(`Row ${i} has ${values.length} values but ${renamedHeaders.length} headers - possibly broken pipes`);
          continue;
        }
        
        // Create record object with renamed headers (SAME AS PROCESSOR)
        const record = {};
        renamedHeaders.forEach((header, index) => {
          record[header] = values[index] || null;
        });
        
        records.push(record);
      }
      
      console.log(`✅ Parsed ${records.length} records using processor logic`);
      return records;
      
    } else if (vendor === 'BRT') {
      // For BRT, parse as CSV (no duplicate header issues)
      const lines = fileContent.split('\n').filter(line => line.trim());
      if (lines.length < 2) {
        throw new Error('File must have at least header and one data row');
      }
      
      const headers = lines[0].split(',');
      const records = [];
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const record = {};
        headers.forEach((header, index) => {
          record[header] = values[index] || null;
        });
        records.push(record);
      }
      
      return records;
    }
    
    throw new Error(`Unsupported vendor: ${vendor}`);
  };

  // NEW: Rename duplicate headers (SAME LOGIC AS PROCESSOR)
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

  // FIXED: Compare two data sets using consistent composite key generation
  const compareDataSets = (oldData, newData) => {
    console.log('🔍 Comparing datasets with processor-consistent logic...');
    
    const oldMap = new Map();
    const newMap = new Map();

    // Get job year and CCDD for composite key generation
    const jobYear = new Date(job.created_at).getFullYear();
    const jobCCDD = job.ccdd || job.ccddCode || '0000';

    // Create maps with composite property keys from existing database records
    oldData.forEach(row => {
      const key = row.property_composite_key; // Use the stored composite key directly
      oldMap.set(key, row);
    });

    // FIXED: Create new data map using the SAME composite key logic as the processor
    newData.forEach(row => {
      let key;
      
      if (job.vendor === 'Microsystems') {
        // Use processor logic for Microsystems (with renamed headers)
        const block = row['Block'];
        const lot = row['Lot'];
        const qualifier = row['Qual'];
        const card = row['Bldg'];
        const location = row['Location']; // This now uses the FIRST Location due to header renaming
        
        key = `${jobYear}${jobCCDD}-${block}-${lot}_${(qualifier || '').trim() || 'NONE'}-${(card || '').trim() || 'NONE'}-${(location || '').trim() || 'NONE'}`;
      } else if (job.vendor === 'BRT') {
        // Use processor logic for BRT
        const block = row['BLOCK'];
        const lot = row['LOT'];
        const qualifier = row['QUALIFIER'];
        const card = row['CARD'];
        const location = row['PROPERTY_LOCATION'];
        
        key = `${jobYear}${jobCCDD}-${block}-${lot}_${(qualifier || '').trim() || 'NONE'}-${(card || '').trim() || 'NONE'}-${(location || '').trim() || 'NONE'}`;
      }
      
      newMap.set(key, row);
    });

    console.log(`📊 Comparison: ${oldMap.size} existing records vs ${newMap.size} new records`);
    console.log('🔍 Sample keys - Old:', Array.from(oldMap.keys()).slice(0, 3));
    console.log('🔍 Sample keys - New:', Array.from(newMap.keys()).slice(0, 3));

    const removedProperties = [];
    const addedProperties = [];
    const classChanges = [];
    const salesChanges = [];

    // Find removed properties
    oldMap.forEach((oldRow, key) => {
      if (!newMap.has(key)) {
        removedProperties.push({
          key,
          block: oldRow.property_block,
          lot: oldRow.property_lot,
          qualifier: oldRow.property_qualifier,
          property_location: oldRow.property_location
        });
      }
    });

    // Find added properties and changes
    newMap.forEach((newRow, key) => {
      if (!oldMap.has(key)) {
        // Extract identifiers based on vendor
        let block, lot, qualifier, location;
        if (job.vendor === 'Microsystems') {
          block = newRow['Block'];
          lot = newRow['Lot'];
          qualifier = newRow['Qual'];
          location = newRow['Location'];
        } else {
          block = newRow['BLOCK'];
          lot = newRow['LOT'];
          qualifier = newRow['QUALIFIER'];
          location = newRow['PROPERTY_LOCATION'];
        }
        
        addedProperties.push({
          key,
          block,
          lot,
          qualifier,
          property_location: location
        });
      } else {
        const oldRow = oldMap.get(key);
        
        // Check for property class changes with vendor-specific logic
        const oldClass = getClassComparison(oldRow, 'old');
        const newClass = getClassComparison(newRow, 'new');
        
        if (hasClassChanged(oldClass, newClass)) {
          let block, lot, qualifier, location;
          if (job.vendor === 'Microsystems') {
            block = newRow['Block'];
            lot = newRow['Lot'];
            qualifier = newRow['Qual'];
            location = newRow['Location'];
          } else {
            block = newRow['BLOCK'];
            lot = newRow['LOT'];
            qualifier = newRow['QUALIFIER'];
            location = newRow['PROPERTY_LOCATION'];
          }
          
          classChanges.push({
            key,
            block,
            lot,
            qualifier,
            property_location: location,
            oldClass: formatClassDisplay(oldClass),
            newClass: formatClassDisplay(newClass),
            vendor: job.vendor
          });
        }

        // Check for sales changes
        const oldSale = {
          date: oldRow.sales_date,
          price: oldRow.sales_price,
          book: oldRow.sales_book,
          page: oldRow.sales_page,
          nu: oldRow.sales_nu
        };

        let newSale;
        if (job.vendor === 'Microsystems') {
          newSale = {
            date: newRow['Sale Date'],
            price: newRow['Sale Price'],
            book: newRow['Sale Book'],
            page: newRow['Sale Page'],
            nu: newRow['Sale Nu']
          };
        } else {
          newSale = {
            date: newRow['CURRENTSALE_DATE'],
            price: newRow['CURRENTSALE_PRICE'],
            book: newRow['CURRENTSALE_DEEDBOOK'],
            page: newRow['CURRENTSALE_DEEDPAGE'],
            nu: newRow['CURRENTSALE_NUC']
          };
        }

        // Check if sales data actually changed
        const salesChanged = oldSale.date !== newSale.date || 
                           oldSale.price !== newSale.price || 
                           oldSale.book !== newSale.book || 
                           oldSale.page !== newSale.page ||
                           oldSale.nu !== newSale.nu;

        if (salesChanged) {
          // Check if we have a previous decision for this property
          const existingDecision = salesDecisions[key];
          
          let block, lot, qualifier, location;
          if (job.vendor === 'Microsystems') {
            block = newRow['Block'];
            lot = newRow['Lot'];
            qualifier = newRow['Qual'];
            location = newRow['Location'];
          } else {
            block = newRow['BLOCK'];
            lot = newRow['LOT'];
            qualifier = newRow['QUALIFIER'];
            location = newRow['PROPERTY_LOCATION'];
          }
          
          salesChanges.push({
            key,
            block,
            lot,
            qualifier,
            property_location: location,
            oldSale,
            newSale,
            hasExistingDecision: !!existingDecision,
            existingDecision: existingDecision || null
          });
        }
      }
    });

    console.log(`📈 Comparison results: ${removedProperties.length} removed, ${addedProperties.length} added, ${classChanges.length} class changes, ${salesChanges.length} sales changes`);

    return {
      removedProperties,
      addedProperties,
      classChanges,
      salesChanges,
      totalChanges: removedProperties.length + addedProperties.length + classChanges.length + salesChanges.length
    };
  };

  // Vendor-specific class comparison logic
  const getClassComparison = (row, type) => {
    if (type === 'old') {
      // From property_records table
      return {
        cama: row.property_cama_class,
        m4: row.property_m4_class
      };
    } else {
      // From new file data
      if (job.vendor === 'BRT') {
        return {
          cama: row.PROPCLASS,
          m4: row.PROPERTY_CLASS
        };
      } else if (job.vendor === 'Microsystems') {
        return {
          cama: null, // Microsystems doesn't have CAMA class
          m4: row.Class
        };
      }
    }
    return { cama: null, m4: null };
  };

  // Check if class has changed based on vendor
  const hasClassChanged = (oldClass, newClass) => {
    if (job.vendor === 'BRT') {
      // For BRT, check both CAMA and M4 classes
      return (oldClass.cama !== newClass.cama) || (oldClass.m4 !== newClass.m4);
    } else if (job.vendor === 'Microsystems') {
      // For Microsystems, only check M4 class
      return oldClass.m4 !== newClass.m4;
    }
    return false;
  };

  // Format class display for reporting
  const formatClassDisplay = (classObj) => {
    if (job.vendor === 'BRT') {
      return `CAMA: ${classObj.cama || 'N/A'}, M4: ${classObj.m4 || 'N/A'}`;
    } else if (job.vendor === 'Microsystems') {
      return `M4: ${classObj.m4 || 'N/A'}`;
    }
    return 'Unknown';
  };

  // Handle sales decision
  const handleSalesDecision = (propertyKey, decision, salesChange) => {
    setPendingSalesDecisions(prev => ({
      ...prev,
      [propertyKey]: {
        decision,
        oldSale: salesChange.oldSale,
        newSale: salesChange.newSale,
        block: salesChange.block,
        lot: salesChange.lot,
        qualifier: salesChange.qualifier,
        decided_at: new Date().toISOString(),
        decided_by: 'current-user' // TODO: Get actual user ID
      }
    }));
  };

  // Save sales decisions to sales_history JSONB field in property_records
  const saveSalesDecisions = async () => {
    try {
      for (const [propertyKey, decision] of Object.entries(pendingSalesDecisions)) {
        // Get the current record
        const { data: currentRecord, error: fetchError } = await supabase
          .from('property_records')
          .select('sales_history, sales_date, sales_price, sales_book, sales_page, sales_nu')
          .eq('property_composite_key', propertyKey)
          .single();

        if (fetchError) {
          console.error(`Error fetching record for ${propertyKey}:`, fetchError);
          continue;
        }

        // Build the sales history object
        const currentSalesHistory = currentRecord.sales_history || {};
        
        // Add the current sale to previous_sales if we're replacing it
        const previousSales = currentSalesHistory.previous_sales || [];
        if (decision.decision === 'use_new' && currentRecord.sales_price) {
          previousSales.push({
            date: currentRecord.sales_date,
            price: currentRecord.sales_price,
            book: currentRecord.sales_book,
            page: currentRecord.sales_page,
            nu: currentRecord.sales_nu,
            replaced_on: decision.decided_at,
            decision: decision.decision
          });
        }

        // Add the decision to the decisions array
        const decisions = currentSalesHistory.decisions || [];
        decisions.push({
          timestamp: decision.decided_at,
          type: decision.decision,
          reason: getDecisionReason(decision.decision),
          decided_by: decision.decided_by,
          old_sale: decision.oldSale,
          new_sale: decision.newSale
        });

        // Determine which sale data to keep in the main fields
        let salesUpdate = {};
        if (decision.decision === 'use_new') {
          salesUpdate = {
            sales_date: decision.newSale.date ? new Date(decision.newSale.date).toISOString().split('T')[0] : null,
            sales_price: decision.newSale.price,
            sales_book: decision.newSale.book,
            sales_page: decision.newSale.page,
            sales_nu: decision.newSale.nu
          };
        }
        // For 'keep_old' or 'keep_both', we don't update the main sales fields

        // Update the record with sales history and potentially new sales data
        const { error: updateError } = await supabase
          .from('property_records')
          .update({
            sales_history: {
              ...currentSalesHistory,
              previous_sales: previousSales,
              decisions: decisions
            },
            ...salesUpdate
          })
          .eq('property_composite_key', propertyKey);

        if (updateError) {
          console.error(`Error updating sales history for ${propertyKey}:`, updateError);
        }
      }

      console.log(`Saved ${Object.keys(pendingSalesDecisions).length} sales decisions to sales_history`);
    } catch (error) {
      console.error('Error saving sales decisions:', error);
      throw error;
    }
  };

  // Get human-readable decision reason
  const getDecisionReason = (decisionType) => {
    switch (decisionType) {
      case 'keep_old': return 'Keep original sale data';
      case 'use_new': return 'Use new sale data';
      case 'keep_both': return 'Keep both sales for analysis';
      default: return 'Unknown decision';
    }
  };

  // Export comparison report to Excel
  const exportComparisonReport = async () => {
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();

      // Summary sheet
      const summaryData = [
        ['Comparison Report Summary'],
        ['Generated', new Date().toLocaleString()],
        ['Job', job.job_name || job.name],
        [''],
        ['Change Type', 'Count'],
        ['Properties Removed', comparisonReport.removedProperties?.length || 0],
        ['Properties Added', comparisonReport.addedProperties?.length || 0],
        ['Class Changes', comparisonReport.classChanges?.length || 0],
        ['Sales Changes', comparisonReport.salesChanges?.length || 0],
      ];

      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

      // Sales changes sheet
      if (comparisonReport.salesChanges && comparisonReport.salesChanges.length > 0) {
        const salesData = [
          ['Block', 'Lot', 'Qualifier', 'Property Location', 'Old Sale Date', 'Old Sale Price', 'New Sale Date', 'New Sale Price', 'Review Status']
        ];

        comparisonReport.salesChanges.forEach(change => {
          salesData.push([
            change.block,
            change.lot,
            change.qualifier || '',
            change.property_location || '',
            change.oldSale.date || '',
            change.oldSale.price || '',
            change.newSale.date || '',
            change.newSale.price || '',
            change.hasExistingDecision ? 'Previously Reviewed' : 'Needs Review'
          ]);
        });

        const salesSheet = XLSX.utils.aoa_to_sheet(salesData);
        salesSheet['!cols'] = [
          { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 35 },
          { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 20 }
        ];
        XLSX.utils.book_append_sheet(workbook, salesSheet, 'Sales Changes');
      }

      // Property changes sheet
      if (comparisonReport.removedProperties?.length > 0 || comparisonReport.addedProperties?.length > 0) {
        const propertyData = [
          ['Change Type', 'Block', 'Lot', 'Qualifier', 'Property Location']
        ];

        comparisonReport.removedProperties?.forEach(prop => {
          propertyData.push(['REMOVED', prop.block, prop.lot, prop.qualifier || '', prop.property_location || '']);
        });

        comparisonReport.addedProperties?.forEach(prop => {
          propertyData.push(['ADDED', prop.block, prop.lot, prop.qualifier || '', prop.property_location || '']);
        });

        const propertySheet = XLSX.utils.aoa_to_sheet(propertyData);
        propertySheet['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 35 }];
        XLSX.utils.book_append_sheet(workbook, propertySheet, 'Property Changes');
      }

      // Download file
      const fileName = `${job.job_name || job.name}_Comparison_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);

    } catch (error) {
      console.error('Export error:', error);
      alert('Error exporting report: ' + error.message);
    }
  };

  // Helper function to read file as text
  const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  };

  return (
    <div className="space-y-3">
      {/* Source File Section */}
      <div className="flex items-center gap-3 text-gray-300">
        <FileText className="w-4 h-4 text-blue-400" />
        <span className="text-sm min-w-0 flex-1">
          📄 Source: {getFileStatus(fileTimestamps.source || job.created_at, 'source')}
        </span>
        
        {/* As Of Date */}
        <div className="flex items-center gap-2">
          <Calendar className="w-3 h-3 text-blue-400" />
          <span className="text-xs text-gray-400">As of:</span>
          <input
            type="date"
            value={asOfDates.source}
            onChange={(e) => setAsOfDates(prev => ({ ...prev, source: e.target.value }))}
            className="px-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-gray-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        
        {/* File Selection */}
        <input
          ref={sourceFileRef}
          type="file"
          accept=".csv,.txt"
          onChange={(e) => handleFileUpload(e.target.files[0], 'source')}
          className="hidden"
        />
        
        {!selectedFiles.source ? (
          <button
            onClick={() => sourceFileRef.current.click()}
            disabled={isUploading}
            className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:bg-gray-500 flex items-center gap-1"
          >
            <Upload className="w-3 h-3" />
            Select File
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 bg-opacity-20 border border-blue-500 rounded px-2 py-1">
              <span className="text-xs text-blue-300 font-medium">{selectedFiles.source.name}</span>
            </div>
            <button
              onClick={() => clearSelectedFile('source')}
              className="text-red-400 hover:text-red-300 p-1"
              title="Remove selected file"
            >
              <X className="w-3 h-3" />
            </button>
            <button
              onClick={() => processSelectedFile('source')}
              disabled={isUploading && uploadType === 'source'}
              className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:bg-gray-500 flex items-center gap-1"
            >
              {isUploading && uploadType === 'source' ? (
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
              ) : (
                <CheckCircle className="w-3 h-3" />
              )}
              Update
            </button>
          </div>
        )}
      </div>

      {/* Code File Section */}
      <div className="flex items-center gap-3 text-gray-300">
        <Settings className="w-4 h-4 text-green-400" />
        <span className="text-sm min-w-0 flex-1">
          ⚙️ Code: {getFileStatus(fileTimestamps.code || job.created_at, 'code')}
        </span>
        
        {/* As Of Date */}
        <div className="flex items-center gap-2">
          <Calendar className="w-3 h-3 text-green-400" />
          <span className="text-xs text-gray-400">As of:</span>
          <input
            type="date"
            value={asOfDates.code}
            onChange={(e) => setAsOfDates(prev => ({ ...prev, code: e.target.value }))}
            className="px-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-gray-300 focus:ring-1 focus:ring-green-500 focus:border-green-500"
          />
        </div>
        
        {/* File Selection */}
        <input
          ref={codeFileRef}
          type="file"
          accept=".txt,.json"
          onChange={(e) => handleFileUpload(e.target.files[0], 'code')}
          className="hidden"
        />
        
        {!selectedFiles.code ? (
          <button
            onClick={() => codeFileRef.current.click()}
            disabled={isUploading}
            className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:bg-gray-500 flex items-center gap-1"
          >
            <Upload className="w-3 h-3" />
            Select File
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <div className="bg-green-600 bg-opacity-20 border border-green-500 rounded px-2 py-1">
              <span className="text-xs text-green-300 font-medium">{selectedFiles.code.name}</span>
            </div>
            <button
              onClick={() => clearSelectedFile('code')}
              className="text-red-400 hover:text-red-300 p-1"
              title="Remove selected file"
            >
              <X className="w-3 h-3" />
            </button>
            <button
              onClick={() => processSelectedFile('code')}
              disabled={isUploading && uploadType === 'code'}
              className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:bg-gray-500 flex items-center gap-1"
            >
              {isUploading && uploadType === 'code' ? (
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
              ) : (
                <CheckCircle className="w-3 h-3" />
              )}
              Update
            </button>
          </div>
        )}
      </div>

      {/* Comparison Report Modal */}
      {showReport && comparisonReport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-6xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                File Comparison Report
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={exportAllReports}
                  className="px-3 py-1 bg-purple-500 text-white text-sm rounded hover:bg-purple-600 flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  Export All Reports
                </button>
                <button
                  onClick={exportComparisonReport}
                  className="px-3 py-1 bg-green-500 text-white text-sm rounded hover:bg-green-600 flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  Export This Report
                </button>
                <button
                  onClick={() => setShowReport(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-3 bg-red-50 rounded">
                  <div className="text-2xl font-bold text-red-600">{comparisonReport.removedProperties?.length || 0}</div>
                  <div className="text-sm text-gray-600">Properties Removed</div>
                </div>
                <div className="text-center p-3 bg-green-50 rounded">
                  <div className="text-2xl font-bold text-green-600">{comparisonReport.addedProperties?.length || 0}</div>
                  <div className="text-sm text-gray-600">Properties Added</div>
                </div>
                <div className="text-center p-3 bg-blue-50 rounded">
                  <div className="text-2xl font-bold text-blue-600">{comparisonReport.classChanges?.length || 0}</div>
                  <div className="text-sm text-gray-600">Class Changes</div>
                </div>
                <div className="text-center p-3 bg-orange-50 rounded">
                  <div className="text-2xl font-bold text-orange-600">{comparisonReport.salesChanges?.length || 0}</div>
                  <div className="text-sm text-gray-600">Sales Changes</div>
                </div>
              </div>

              {/* Sales Changes Section */}
              {comparisonReport.salesChanges && comparisonReport.salesChanges.length > 0 && (
                <div className="border-t pt-4">
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    💰 Sales Changes Requiring Review:
                    <span className="text-sm text-gray-600">
                      ({comparisonReport.salesChanges.filter(c => !c.hasExistingDecision).length} need review, 
                       {comparisonReport.salesChanges.filter(c => c.hasExistingDecision).length} auto-handled)
                    </span>
                  </h4>
                  
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {comparisonReport.salesChanges.map((change, index) => (
                      <div key={index} className={`p-4 border rounded-lg ${
                        change.hasExistingDecision ? 'bg-yellow-50 border-yellow-200' : 'bg-orange-50 border-orange-200'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium">
                            Block {change.block}, Lot {change.lot}
                            {change.qualifier && ` (${change.qualifier})`}
                          </div>
                          {change.hasExistingDecision && (
                            <div className="flex items-center gap-1 text-sm text-yellow-700">
                              <Eye className="w-3 h-3" />
                              Previously Reviewed
                            </div>
                          )}
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 mb-3">
                          <div className="text-sm">
                            <span className="text-red-600 font-medium">OLD SALE:</span>
                            <div>${change.oldSale.price?.toLocaleString() || 'N/A'}</div>
                            <div>{change.oldSale.date || 'No date'}</div>
                            <div>Book {change.oldSale.book || 'N/A'}, Page {change.oldSale.page || 'N/A'}</div>
                          </div>
                          <div className="text-sm">
                            <span className="text-green-600 font-medium">NEW SALE:</span>
                            <div>${change.newSale.price?.toLocaleString() || 'N/A'}</div>
                            <div>{change.newSale.date || 'No date'}</div>
                            <div>Book {change.newSale.book || 'N/A'}, Page {change.newSale.page || 'N/A'}</div>
                          </div>
                        </div>

                        {change.hasExistingDecision ? (
                          <div className="text-sm text-yellow-700 bg-yellow-100 p-2 rounded">
                            Previous decision: {change.existingDecision.type === 'keep_old' ? 'Keep OLD sale' : 
                                               change.existingDecision.type === 'use_new' ? 'Use NEW sale' : 'Keep BOTH sales'}
                            <button
                              onClick={() => handleSalesDecision(change.key, 'review_again', change)}
                              className="ml-2 text-blue-600 hover:text-blue-800 underline"
                            >
                              Change Decision
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSalesDecision(change.key, 'keep_old', change)}
                              className={`px-3 py-1 text-xs rounded ${
                                pendingSalesDecisions[change.key]?.decision === 'keep_old' 
                                  ? 'bg-red-600 text-white' 
                                  : 'bg-red-100 text-red-600 hover:bg-red-200'
                              }`}
                            >
                              Prioritize Old Sale
                            </button>
                            <button
                              onClick={() => handleSalesDecision(change.key, 'use_new', change)}
                              className={`px-3 py-1 text-xs rounded ${
                                pendingSalesDecisions[change.key]?.decision === 'use_new' 
                                  ? 'bg-green-600 text-white' 
                                  : 'bg-green-100 text-green-600 hover:bg-green-200'
                              }`}
                            >
                              Keep New Sale
                            </button>
                            <button
                              onClick={() => handleSalesDecision(change.key, 'keep_both', change)}
                              className={`px-3 py-1 text-xs rounded ${
                                pendingSalesDecisions[change.key]?.decision === 'keep_both' 
                                  ? 'bg-blue-600 text-white' 
                                  : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                              }`}
                            >
                              Keep BOTH
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Other Changes Summary */}
              {(comparisonReport.removedProperties?.length > 0 || 
                comparisonReport.addedProperties?.length > 0 || 
                comparisonReport.classChanges?.length > 0) && (
                <div className="border-t pt-4">
                  <h4 className="font-semibold mb-3">📋 Other Changes (Auto-flagged):</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    {comparisonReport.removedProperties?.length > 0 && (
                      <div className="bg-red-50 p-3 rounded">
                        <div className="font-medium text-red-800 mb-2">Removed Properties ({comparisonReport.removedProperties.length})</div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {comparisonReport.removedProperties.slice(0, 5).map((prop, i) => (
                            <div key={i} className="text-red-700">Block {prop.block}, Lot {prop.lot}</div>
                          ))}
                          {comparisonReport.removedProperties.length > 5 && (
                            <div className="text-red-600">... and {comparisonReport.removedProperties.length - 5} more</div>
                          )}
                        </div>
                      </div>
                    )}

                    {comparisonReport.addedProperties?.length > 0 && (
                      <div className="bg-green-50 p-3 rounded">
                        <div className="font-medium text-green-800 mb-2">Added Properties ({comparisonReport.addedProperties.length})</div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {comparisonReport.addedProperties.slice(0, 5).map((prop, i) => (
                            <div key={i} className="text-green-700">Block {prop.block}, Lot {prop.lot}</div>
                          ))}
                          {comparisonReport.addedProperties.length > 5 && (
                            <div className="text-green-600">... and {comparisonReport.addedProperties.length - 5} more</div>
                          )}
                        </div>
                      </div>
                    )}

                    {comparisonReport.classChanges?.length > 0 && (
                      <div className="bg-blue-50 p-3 rounded">
                        <div className="font-medium text-blue-800 mb-2">Class Changes ({comparisonReport.classChanges.length})</div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {comparisonReport.classChanges.slice(0, 5).map((change, i) => (
                            <div key={i} className="text-blue-700 text-xs">
                              <div className="font-medium">Block {change.block}, Lot {change.lot}</div>
                              <div className="text-blue-600">
                                OLD: {change.oldClass}
                              </div>
                              <div className="text-blue-600">
                                NEW: {change.newClass}
                              </div>
                            </div>
                          ))}
                          {comparisonReport.classChanges.length > 5 && (
                            <div className="text-blue-600">... and {comparisonReport.classChanges.length - 5} more</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  onClick={() => {
                    setShowReport(false);
                    setPendingSalesDecisions({});
                  }}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    // Check if all sales changes have decisions
                    const needsReview = comparisonReport.salesChanges?.filter(c => !c.hasExistingDecision) || [];
                    const pendingCount = Object.keys(pendingSalesDecisions).length;
                    
                    if (needsReview.length > 0 && pendingCount < needsReview.length) {
                      alert(`Please make decisions for all ${needsReview.length} sales changes before proceeding.`);
                      return;
                    }
                    
                    // Mark report as reviewed in audit trail
                    if (comparisonReport.reportId) {
                      markReportAsReviewed(comparisonReport.reportId);
                    }
                    
                    // Continue with processing
                    processSelectedFile('source');
                  }}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  Mark Reviewed & Proceed
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileUploadButton;
