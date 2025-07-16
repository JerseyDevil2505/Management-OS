import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Settings, AlertTriangle, CheckCircle, Download, Eye, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

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
  
  const sourceFileRef = useRef();
  const codeFileRef = useRef();

  // Load file timestamps and previous sales decisions on mount
  useEffect(() => {
    if (job?.id) {
      loadFileTimestamps();
      loadPreviousSalesDecisions();
    }
  }, [job?.id]);

  // Load current file timestamps
  const loadFileTimestamps = async () => {
    try {
      const { data, error } = await supabase
        .from('inspection_data')
        .select('source_file_uploaded_at, code_file_updated_at')
        .eq('job_id', job.id)
        .order('upload_date', { ascending: false })
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        // Use timestamps from latest upload
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

  // Load previous sales decisions
  const loadPreviousSalesDecisions = async () => {
    try {
      const { data, error } = await supabase
        .from('sales_decisions')
        .select('*')
        .eq('job_id', job.id);

      if (error) throw error;

      const decisionsMap = {};
      data.forEach(decision => {
        const key = `${decision.block}-${decision.lot}_${decision.qualifier || 'NONE'}-${decision.card || 'NONE'}-${decision.property_location || 'NONE'}`;
        decisionsMap[key] = decision;
      });

      setSalesDecisions(decisionsMap);
    } catch (error) {
      console.error('Error loading sales decisions:', error);
      setSalesDecisions({});
    }
  };

  // Format date for display - FIXED: Now shows Eastern Time
  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: 'numeric', 
      day: 'numeric', 
      year: '2-digit',
      timeZone: 'America/New_York' // Eastern Time
    });
  };

  // Handle file upload
  const handleFileUpload = async (file, type) => {
    if (!file) return;

    setIsUploading(true);
    setUploadType(type);

    try {
      // Read file content
      const fileContent = await readFileAsText(file);
      
      // Parse CSV data
      const Papa = await import('papaparse');
      const parsedData = Papa.parse(fileContent, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        delimitersToGuess: [',', '\t', '|', ';']
      });

      if (type === 'source') {
        // Generate comparison report for source files
        const report = await generateComparisonReport(parsedData.data, job.id);
        setComparisonReport(report);
        
        if (report.hasChanges) {
          setShowReport(true);
          setIsUploading(false);
          return; // Wait for user to review before processing
        }
      }

      // Process the file directly if no review needed
      await processFile(file, type, parsedData.data);
      
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

  // Process file after review (if needed)
  const processFile = async (file, type, data) => {
    try {
      setIsUploading(true);
      
      if (type === 'source') {
        // Save sales decisions first if any
        if (Object.keys(pendingSalesDecisions).length > 0) {
          await saveSalesDecisions();
        }

        // Import inspection data to database
        const result = await importInspectionData(job.id, data, file.name);
        
        // Update file timestamp
        await updateFileTimestamp(job.id, 'source_file_uploaded_at');
        
        console.log(`Imported ${result.imported} inspection records`);
        
      } else if (type === 'code') {
        // Handle code file update
        await updateCodeFile(job.id, file.name);
        
        // Update file timestamp
        await updateFileTimestamp(job.id, 'code_file_updated_at');
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

  // Generate comparison report
  const generateComparisonReport = async (newData, jobId) => {
    try {
      // Get previous data from database - REMOVED LIMIT
      const { data: previousData, error } = await supabase
        .from('inspection_data')
        .select('*')
        .eq('job_id', jobId)
        .order('upload_date', { ascending: false });
        // Removed limit to get ALL data for comparison

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

  // Compare two data sets
  const compareDataSets = (oldData, newData) => {
    const oldMap = new Map();
    const newMap = new Map();

    // Create maps with robust composite property keys
    oldData.forEach(row => {
      const key = `${row.block}-${row.lot}_${row.qualifier || 'NONE'}-${row.card || 'NONE'}-${row.property_location || 'NONE'}`;
      oldMap.set(key, row);
    });

    newData.forEach(row => {
      const key = `${row.BLOCK}-${row.LOT}_${row.QUALIFIER || 'NONE'}-${row.CARD || 'NONE'}-${row.PROPERTY_LOCATION || 'NONE'}`;
      newMap.set(key, row);
    });

    const removedProperties = [];
    const addedProperties = [];
    const classChanges = [];
    const salesChanges = [];

    // Find removed properties
    oldMap.forEach((oldRow, key) => {
      if (!newMap.has(key)) {
        const keyParts = key.split('-');
        const blockLot = keyParts[0].split('-');
        const qualifierCard = keyParts[1] ? keyParts[1].split('_')[0] : 'NONE';
        
        removedProperties.push({
          key,
          block: blockLot[0],
          lot: blockLot[1],
          qualifier: qualifierCard === 'NONE' ? null : qualifierCard,
          property_location: oldRow.property_location
        });
      }
    });

    // Find added properties and changes
    newMap.forEach((newRow, key) => {
      if (!oldMap.has(key)) {
        const keyParts = key.split('-');
        const blockLot = keyParts[0].split('-');
        const qualifierCard = keyParts[1] ? keyParts[1].split('_')[0] : 'NONE';
        
        addedProperties.push({
          key,
          block: newRow.BLOCK,
          lot: newRow.LOT,
          qualifier: qualifierCard === 'NONE' ? null : newRow.QUALIFIER,
          property_location: newRow.PROPERTY_LOCATION
        });
      } else {
        const oldRow = oldMap.get(key);
        
        // Check for property class changes
        if (oldRow.property_class !== newRow.PROPERTY_CLASS) {
          classChanges.push({
            key,
            block: newRow.BLOCK,
            lot: newRow.LOT,
            qualifier: newRow.QUALIFIER,
            property_location: newRow.PROPERTY_LOCATION,
            oldClass: oldRow.property_class,
            newClass: newRow.PROPERTY_CLASS
          });
        }

        // Check for sales changes
        const oldSale = {
          date: oldRow.sale_date,
          price: oldRow.sale_price,
          book: oldRow.sale_book,
          page: oldRow.sale_page,
          nu: oldRow.sale_nu
        };

        const newSale = {
          date: newRow.SALE_DATE,
          price: newRow.SALE_PRICE,
          book: newRow.SALE_BOOK,
          page: newRow.SALE_PAGE,
          nu: newRow.SALE_NU
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
            block: newRow.BLOCK,
            lot: newRow.LOT,
            qualifier: newRow.QUALIFIER,
            property_location: newRow.PROPERTY_LOCATION,
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
        decided_at: new Date().toISOString()
      }
    }));
  };

  // Save sales decisions to database
  const saveSalesDecisions = async () => {
    try {
      const decisions = Object.entries(pendingSalesDecisions).map(([key, decision]) => ({
        job_id: job.id,
        block: decision.block,
        lot: decision.lot,
        qualifier: decision.qualifier || null,
        decision_type: decision.decision,
        old_sale_data: decision.oldSale,
        new_sale_data: decision.newSale,
        decided_at: decision.decided_at,
        decided_by: 'current-user' // TODO: Get actual user ID
      }));

      // Upsert decisions
      const { error } = await supabase
        .from('sales_decisions')
        .upsert(decisions, { 
          onConflict: 'job_id,block,lot,qualifier',
          ignoreDuplicates: false 
        });

      if (error) throw error;

      console.log(`Saved ${decisions.length} sales decisions`);
    } catch (error) {
      console.error('Error saving sales decisions:', error);
      throw error;
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

  // Helper functions
  const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  };

  const importInspectionData = async (jobId, data, fileName) => {
    try {
      // Get the next version number
      const { data: existingVersions, error: versionError } = await supabase
        .from('inspection_data')
        .select('file_version')
        .eq('job_id', jobId)
        .order('file_version', { ascending: false })
        .limit(1);

      if (versionError) throw versionError;

      const nextVersion = (existingVersions?.[0]?.file_version || 0) + 1;

      // Prepare data for import
      const importData = data.map(row => ({
        job_id: jobId,
        file_version: nextVersion,
        upload_date: new Date().toISOString(),
        source_file_name: fileName,
        source_file_uploaded_at: new Date().toISOString(),
        
        // Property identification
        block: row.BLOCK,
        lot: row.LOT,
        qualifier: row.QUALIFIER || null,
        card: row.CARD || null,
        property_location: row.PROPERTY_LOCATION || null,
        
        // Inspector data
        measure_by: row.MEASUREBY || null,
        measure_date: row.MEASUREDT ? new Date(row.MEASUREDT).toISOString().split('T')[0] : null,
        list_by: row.LISTBY || null,
        list_date: row.LISTDT ? new Date(row.LISTDT).toISOString().split('T')[0] : null,
        price_by: row.PRICEBY || null,
        price_date: row.PRICEDT ? new Date(row.PRICEDT).toISOString().split('T')[0] : null,
        info_by_code: row.INFOBY || null,
        property_class: row.PROPERTY_CLASS || row.PROPCLASS || null,
        
        // Sales data
        sale_date: row.SALE_DATE ? new Date(row.SALE_DATE).toISOString().split('T')[0] : null,
        sale_price: row.SALE_PRICE || null,
        sale_book: row.SALE_BOOK || null,
        sale_page: row.SALE_PAGE || null,
        sale_nu: row.SALE_NU || null,
        
        // Settings from UI (would need to pass these in)
        project_start_date: new Date('2025-04-24').toISOString().split('T')[0], // TODO: Get from settings
        payroll_period_start: new Date('2025-06-01').toISOString().split('T')[0] // TODO: Get from settings
      }));

      // Import in batches to avoid payload limits
      const batchSize = 1000;
      let imported = 0;

      for (let i = 0; i < importData.length; i += batchSize) {
        const batch = importData.slice(i, i + batchSize);
        
        const { error } = await supabase
          .from('inspection_data')
          .insert(batch);

        if (error) throw error;
        imported += batch.length;
      }

      return { imported, total: data.length };

    } catch (error) {
      console.error('Import error:', error);
      throw error;
    }
  };

  // FIXED: Actually update the database timestamp fields
  const updateFileTimestamp = async (jobId, field) => {
    try {
      const timestamp = new Date().toISOString();
      
      // Update the most recent inspection_data record for this job
      const { error } = await supabase
        .from('inspection_data')
        .update({ [field]: timestamp })
        .eq('job_id', jobId)
        .order('upload_date', { ascending: false })
        .limit(1);

      if (error) throw error;
      
      console.log(`Updated ${field} for job ${jobId} to ${timestamp}`);
      return { success: true };
    } catch (error) {
      console.error(`Error updating ${field}:`, error);
      throw error;
    }
  };

  // FIXED: Actually process and store code file information
  const updateCodeFile = async (jobId, fileName) => {
    try {
      const timestamp = new Date().toISOString();
      
      // Update the code file info in the most recent inspection_data record
      const { error } = await supabase
        .from('inspection_data')
        .update({ 
          code_file_name: fileName,
          code_file_updated_at: timestamp 
        })
        .eq('job_id', jobId)
        .order('upload_date', { ascending: false })
        .limit(1);

      if (error) throw error;
      
      console.log(`Updated code file for job ${jobId}: ${fileName} at ${timestamp}`);
      return { success: true };
    } catch (error) {
      console.error(`Error updating code file:`, error);
      throw error;
    }
  };

  return (
    <div className="flex items-center gap-4">
      {/* Source File Section */}
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-blue-600" />
        <span className="text-sm text-gray-700">
          Source: Imported ({formatDate(fileTimestamps.source || job.created_at)})
        </span>
        <input
          ref={sourceFileRef}
          type="file"
          accept=".csv"
          onChange={(e) => handleFileUpload(e.target.files[0], 'source')}
          className="hidden"
        />
        <button
          onClick={() => sourceFileRef.current.click()}
          disabled={isUploading && uploadType === 'source'}
          className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 disabled:bg-gray-400 flex items-center gap-1"
        >
          {isUploading && uploadType === 'source' ? (
            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
          ) : (
            <Upload className="w-3 h-3" />
          )}
          Update
        </button>
      </div>

      {/* Code File Section */}
      <div className="flex items-center gap-2">
        <Settings className="w-4 h-4 text-green-600" />
        <span className="text-sm text-gray-700">
          Code: Current ({formatDate(fileTimestamps.code || job.created_at)})
        </span>
        <input
          ref={codeFileRef}
          type="file"
          accept=".txt,.json"
          onChange={(e) => handleFileUpload(e.target.files[0], 'code')}
          className="hidden"
        />
        <button
          onClick={() => codeFileRef.current.click()}
          disabled={isUploading && uploadType === 'code'}
          className="px-3 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600 disabled:bg-gray-400 flex items-center gap-1"
        >
          {isUploading && uploadType === 'code' ? (
            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
          ) : (
            <Upload className="w-3 h-3" />
          )}
          Update
        </button>
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
                  onClick={exportComparisonReport}
                  className="px-3 py-1 bg-green-500 text-white text-sm rounded hover:bg-green-600 flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  Export Excel
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
                            Previous decision: {change.existingDecision.decision_type === 'keep_old' ? 'Keep OLD sale' : 
                                               change.existingDecision.decision_type === 'use_new' ? 'Use NEW sale' : 'Keep BOTH sales'}
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
                            <div key={i} className="text-blue-700">
                              Block {change.block}, Lot {change.lot}: {change.oldClass} → {change.newClass}
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
                    
                    // Continue with processing
                    processFile(sourceFileRef.current.files[0], 'source', null);
                  }}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  Proceed with Upload
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
