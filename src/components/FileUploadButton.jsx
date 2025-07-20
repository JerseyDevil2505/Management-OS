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

  // Get descriptive status for file timestamps
  const getFileStatus = (timestamp, type) => {
    if (!timestamp) return 'Never';
    
    // Check if this is from initial job creation (within 5 minutes of job creation)
    const fileDate = new Date(timestamp);
    const jobDate = new Date(job.created_at);
    const timeDiff = Math.abs(fileDate - jobDate) / (1000 * 60); // Difference in minutes
    
    if (timeDiff <= 5) {
      return `Imported at Job Creation (${formatDate(timestamp)})`;
    } else {
      return `Updated via FileUpload (${formatDate(timestamp)})`;
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
        // Parse CSV data for comparison
        const Papa = await import('papaparse');
        const parsedData = Papa.parse(fileContent, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          delimitersToGuess: [',', '\t', '|', ';']
        });

        // Generate comparison report for source files
        const report = await generateComparisonReport(parsedData.data, job.id);
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

  // Process file using the proven processors (like AdminJobManagement)
  const processFile = async (file, type, fileContent) => {
    try {
      setIsUploading(true);
      
      if (type === 'source') {
        // Save sales decisions first if any
        if (Object.keys(pendingSalesDecisions).length > 0) {
          await saveSalesDecisions();
        }

        // Use the same proven method as AdminJobManagement
        const result = await propertyService.importCSVData(
          fileContent,
          null, // Code file content - not updated during source file uploads
          job.id,
          new Date().getFullYear(),
          job.ccdd || job.ccddCode,
          job.vendor,
          {
            source_file_name: file.name,
            source_file_version_id: crypto.randomUUID(),
            source_file_uploaded_at: new Date().toISOString(),
            source_file_as_of_date: asOfDates.source
          }
        );
        
        console.log(`Imported ${result.processed} property records`);
        
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
        
        // Reprocess with new code file
        const result = await propertyService.importCSVData(
          sourceFileContent,
          fileContent,
          job.id,
          new Date().getFullYear(),
          job.ccdd || job.ccddCode,
          job.vendor,
          {
            code_file_name: file.name,
            code_file_updated_at: new Date().toISOString(),
            code_file_as_of_date: asOfDates.code
          }
        );

        console.log(`Reprocessed ${result.processed} property records with new code file`);
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

  // Generate comparison report using property_records table
  const generateComparisonReport = async (newData, jobId) => {
    try {
      // Get previous data from property_records table (unified table)
      const { data: previousData, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('job_id', jobId)
        .order('upload_date', { ascending: false });

      if (error) throw error;

      if (!previousData || previousData.length === 0) {
        return { hasChanges: false, isFirstUpload: true };
      }

      // Compare data sets
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

  // Compare two data sets (updated for property_records field names)
  const compareDataSets = (oldData, newData) => {
    const oldMap = new Map();
    const newMap = new Map();

    // Get job year and CCDD for composite key generation
    const jobYear = new Date(job.created_at).getFullYear();
    const jobCCDD = job.ccdd || job.ccddCode || '0000';

    // Create maps with composite property keys
    oldData.forEach(row => {
      const key = row.property_composite_key || 
        `${jobYear}${jobCCDD}-${row.property_block}-${row.property_lot}_${row.property_qualifier || 'NONE'}-${row.property_addl_card || 'NONE'}-${row.property_location || 'NONE'}`;
      oldMap.set(key, row);
    });

    newData.forEach(row => {
      // Handle both BRT and Microsystems formats
      const block = row.BLOCK || row.Block;
      const lot = row.LOT || row.Lot;
      const qualifier = row.QUALIFIER || row.Qual;
      const card = row.CARD || row.Bldg;
      const location = row.PROPERTY_LOCATION || row.Location;
      
      const key = `${jobYear}${jobCCDD}-${block}-${lot}_${qualifier || 'NONE'}-${card || 'NONE'}-${location || 'NONE'}`;
      newMap.set(key, row);
    });

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
      const block = newRow.BLOCK || newRow.Block;
      const lot = newRow.LOT || newRow.Lot;
      const qualifier = newRow.QUALIFIER || newRow.Qual;
      const location = newRow.PROPERTY_LOCATION || newRow.Location;
      
      if (!oldMap.has(key)) {
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

        const newSale = {
          date: newRow.CURRENTSALE_DATE || newRow['Sale Date'],
          price: newRow.CURRENTSALE_PRICE || newRow['Sale Price'],
          book: newRow.CURRENTSALE_DEEDBOOK || newRow['Sale Book'],
          page: newRow.CURRENTSALE_DEEDPAGE || newRow['Sale Page'],
          nu: newRow.CURRENTSALE_NUC || newRow['Sale Nu']
        };

        // Check if sales data actually changed
        const salesChanged = oldSale.date !== newSale.date || 
                           oldSale.price !== newSale.price || 
                           oldSale.book !== newSale.book || 
                           oldSale.page !== newSale.page ||
                           oldSale.nu !== newSale.nu;

        if (salesChanged) {
          // Check if we have a previous decision for this property
          const existingDecision = salesDecisions[key];
          
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
