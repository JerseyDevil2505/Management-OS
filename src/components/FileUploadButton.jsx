import React, { useState, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertTriangle, X, Database, Target, Calendar, Settings, Download } from 'lucide-react';
import { jobService, propertyService, supabase } from '../lib/supabaseClient';

const FileUploadButton = ({ job, onFileProcessed }) => {
  const [sourceFile, setSourceFile] = useState(null);
  const [codeFile, setCodeFile] = useState(null);
  const [detectedVendor, setDetectedVendor] = useState(null);
  const [sourceFileContent, setSourceFileContent] = useState(null);
  const [codeFileContent, setCodeFileContent] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [showComparisonModal, setShowComparisonModal] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [comparisonStatus, setComparisonStatus] = useState('');
  
  // NEW: Sales decisions state
  const [salesDecisions, setSalesDecisions] = useState(new Map());
  const [showSalesDecisionModal, setShowSalesDecisionModal] = useState(false);
  const [pendingSalesChanges, setPendingSalesChanges] = useState([]);

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

  // FIXED: Date parsing to handle MM/DD/YYYY vs ISO formats
  const parseDate = (dateString) => {
    if (!dateString || dateString.trim() === '') return null;
    
    // Handle MM/DD/YYYY format from source files
    if (dateString.includes('/')) {
      const [month, day, year] = dateString.split('/');
      if (month && day && year) {
        const date = new Date(year, month - 1, day);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0]; // Return as YYYY-MM-DD
        }
      }
    }
    
    // Handle ISO format or other standard formats
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
    
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

  // NEW: Save comparison report to database
  const saveComparisonReport = async (comparisonResults, salesDecisions) => {
    try {
      const reportData = {
        summary: comparisonResults.summary,
        details: comparisonResults.details,
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

  // NEW: Export comparison results to Excel
  const exportComparisonReport = () => {
    if (!comparison) return;

    const exportData = {
      summary: comparison.summary,
      timestamp: new Date().toISOString(),
      job: job.name,
      vendor: detectedVendor,
      sales_decisions: Object.fromEntries(salesDecisions)
    };

    // Create CSV content for download
    let csvContent = "Type,Block,Lot,Location,Details\n";
    
    // Add new records
    if (comparison.details.missing?.length > 0) {
      comparison.details.missing.forEach(record => {
        const blockField = detectedVendor === 'BRT' ? 'BLOCK' : 'Block';
        const lotField = detectedVendor === 'BRT' ? 'LOT' : 'Lot';
        const locationField = detectedVendor === 'BRT' ? 'PROPERTY_LOCATION' : 'Location';
        csvContent += `New Record,${record[blockField]},${record[lotField]},${record[locationField] || 'No Address'},New property\n`;
      });
    }

    // Add sales changes with decisions
    if (comparison.details.salesChanges?.length > 0) {
      comparison.details.salesChanges.forEach(change => {
        const decision = salesDecisions.get(change.property_composite_key) || 'Keep New (default)';
        csvContent += `Sales Change,${change.property_block},${change.property_lot},${change.property_location},Price: $${change.differences.sales_price.old} → $${change.differences.sales_price.new} | Decision: ${decision}\n`;
      });
    }

    // Download the file
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comparison_report_${job.name}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    addNotification('📊 Comparison report exported', 'success');
  };

  // ENHANCED: Comparison logic with sales changes, class changes, and fixed date comparison
  const performComparison = async () => {
    if (!sourceFileContent || !job) return;
    
    try {
      setComparing(true);
      setComparisonStatus('Analyzing files...');
      
      // Parse source file
      const sourceRecords = parseSourceFile(sourceFileContent, detectedVendor);
      console.log(`📊 Parsed ${sourceRecords.length} source records`);
      
      // Get current database records
      setComparisonStatus('Fetching database records...');
      const { data: dbRecords, error: dbError } = await supabase
        .from('property_records')
        .select('property_composite_key, property_block, property_lot, property_location, sales_price, sales_date, property_m4_class, property_cama_class')
        .eq('job_id', job.id);
      
      if (dbError) {
        throw new Error(`Database fetch failed: ${dbError.message}`);
      }
      
      console.log(`📊 Found ${dbRecords.length} database records`);
      
      // Generate composite keys for source records using EXACT processor logic
      setComparisonStatus('Generating composite keys...');
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
      setComparisonStatus('Comparing records...');
      
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
        
        // FIXED: Check for sales changes with proper date parsing
        const sourceSalesPrice = parseFloat(String(sourceRecord[detectedVendor === 'BRT' ? 'CURRENTSALE_PRICE' : 'Sale Price'] || 0).replace(/[,$]/g, '')) || 0;
        const dbSalesPrice = parseFloat(dbRecord.sales_price || 0);
        
        const sourceSalesDate = parseDate(sourceRecord[detectedVendor === 'BRT' ? 'CURRENTSALE_DATE' : 'Sale Date']);
        const dbSalesDate = dbRecord.sales_date;
        
        if (Math.abs(sourceSalesPrice - dbSalesPrice) > 0.01 || sourceSalesDate !== dbSalesDate) {
          salesChanges.push({
            property_composite_key: key,
            property_block: dbRecord.property_block,
            property_lot: dbRecord.property_lot,
            property_location: dbRecord.property_location,
            differences: {
              sales_price: { old: dbSalesPrice, new: sourceSalesPrice },
              sales_date: { old: dbSalesDate, new: sourceSalesDate }
            }
          });
        }
        
        // NEW: Check for class changes
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
      
      setComparison(results);
      setComparisonStatus('Analysis complete');
      
      // Check if sales changes need decisions
      if (salesChanges.length > 0) {
        setPendingSalesChanges(salesChanges);
        setShowSalesDecisionModal(true);
      } else {
        // Only show modal if there are actual changes to review
        const hasAnyChanges = results.summary.missing > 0 || 
                             results.summary.changes > 0 || 
                             results.summary.deletions > 0 || 
                             results.summary.classChanges > 0;
        
        if (hasAnyChanges) {
          setShowComparisonModal(true);
        } else {
          // Just show a success notification for no changes
          addNotification('✅ No changes detected - files match database perfectly', 'success');
        }
      }
      
    } catch (error) {
      console.error('Comparison error:', error);
      addNotification(`Comparison failed: ${error.message}`, 'error');
      setComparisonStatus('Comparison failed');
    } finally {
      setComparing(false);
    }
  };

  // NEW: Handle sales decisions
  const handleSalesDecision = (propertyKey, decision) => {
    setSalesDecisions(prev => new Map(prev.set(propertyKey, decision)));
  };

  // NEW: Complete sales decision process
  const completeSalesDecisions = () => {
    // Set default decisions for any unhandled sales changes
    pendingSalesChanges.forEach(change => {
      if (!salesDecisions.has(change.property_composite_key)) {
        salesDecisions.set(change.property_composite_key, 'Keep New');
      }
    });
    
    setShowSalesDecisionModal(false);
    setShowComparisonModal(true);
  };

  // ENHANCED: Process changes with sales decisions storage
  const handleProcessChanges = async () => {
    if (!sourceFile || !sourceFileContent) {
      addNotification('Please select a source file first', 'error');
      return;
    }
    
    try {
      setProcessing(true);
      setProcessingStatus(`Processing ${detectedVendor} data via processor...`);
      
      // Save comparison report first
      await saveComparisonReport(comparison, salesDecisions);
      
      console.log('🚀 Calling processor with same params as AdminJobManagement...');
      
      // FIXED: Call the EXACT SAME processor method as AdminJobManagement
      const result = await propertyService.importCSVData(
        sourceFileContent,
        codeFileContent,
        job.id,
        job.year_created || new Date().getFullYear(),
        job.ccdd || job.ccddCode,
        detectedVendor,
        {
          source_file_name: sourceFile.name,
          source_file_version_id: crypto.randomUUID(),
          source_file_uploaded_at: new Date().toISOString(),
          file_version: (job.source_file_version || 1) + 1
        }
      );
      
      console.log('📊 Processor completed with result:', result);
      
      // NEW: Store sales decisions in sales_history for affected properties
      if (salesDecisions.size > 0) {
        setProcessingStatus('Saving sales decisions...');
        
        const salesDecisionUpdates = Array.from(salesDecisions.entries()).map(([compositeKey, decision]) => {
          const salesChange = comparison.details.salesChanges.find(sc => sc.property_composite_key === compositeKey);
          return {
            property_composite_key: compositeKey,
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
          };
        });
        
        // Update sales_history for each affected property
        for (const update of salesDecisionUpdates) {
          try {
            const { error } = await supabase
              .from('property_records')
              .update({ 
                sales_history: update.sales_history 
              })
              .eq('property_composite_key', update.property_composite_key)
              .eq('job_id', job.id);
            
            if (error) {
              console.error('Error updating sales history:', error);
            }
          } catch (updateError) {
            console.error('Failed to update sales history for property:', update.property_composite_key, updateError);
          }
        }
        
        console.log(`✅ Saved ${salesDecisionUpdates.length} sales decisions to property records`);
      }
      
      const totalProcessed = result.processed || 0;
      const errorCount = result.errors || 0;
      const warnings = result.warnings || [];
      
      if (errorCount > 0) {
        addNotification(`❌ Processing completed with ${errorCount} errors. ${totalProcessed} records processed.`, 'warning');
      } else {
        addNotification(`✅ Successfully processed ${totalProcessed} records via ${detectedVendor} processor`, 'success');
        
        if (salesDecisions.size > 0) {
          addNotification(`💾 Saved ${salesDecisions.size} sales decisions`, 'success');
        }
      }
      
      // Show warnings if any
      if (warnings.length > 0) {
        warnings.slice(0, 3).forEach(warning => {
          addNotification(`⚠️ ${warning}`, 'warning');
        });
      }
      
      // FIXED: Update job with new file version info
      try {
        await jobService.update(job.id, {
          sourceFileStatus: errorCount > 0 ? 'error' : 'imported',
          totalProperties: totalProcessed,
          source_file_version: (job.source_file_version || 1) + 1,
          source_file_uploaded_at: new Date().toISOString()
        });
        console.log('✅ Job updated with new version info');
      } catch (updateError) {
        console.error('❌ Failed to update job:', updateError);
        addNotification('Data processed but job update failed', 'warning');
      }
      
      // Close modal and refresh
      setShowComparisonModal(false);
      
      // Clear decisions for next comparison
      setSalesDecisions(new Map());
      setPendingSalesChanges([]);
      
      // Give processor time to complete, then refresh comparison for next upload
      setTimeout(async () => {
        console.log('🔄 Refreshing after processing...');
        if (onFileProcessed) {
          onFileProcessed(result);
        }
      }, 2000);
      
    } catch (error) {
      console.error('❌ Processor call failed:', error);
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

  // NEW: Sales Decision Modal Component
  const SalesDecisionModal = () => {
    if (!pendingSalesChanges.length) return null;
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Target className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-bold text-gray-900">Sales Change Decisions</h2>
              </div>
            </div>
            <p className="text-gray-600 mt-2">
              Review each sales change and decide how to handle it for valuation purposes.
            </p>
          </div>

          <div className="p-6">
            <div className="space-y-4">
              {pendingSalesChanges.map((change, idx) => {
                const currentDecision = salesDecisions.get(change.property_composite_key);
                
                return (
                  <div key={idx} className="border border-blue-200 rounded-lg p-4 bg-blue-50">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-bold text-gray-900">
                          {change.property_block}-{change.property_lot}
                        </h3>
                        <p className="text-gray-600 text-sm">{change.property_location}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-gray-600">Price Change</div>
                        <div className="font-medium">
                          ${change.differences.sales_price.old?.toLocaleString()} → ${change.differences.sales_price.new?.toLocaleString()}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex space-x-3">
                      <button
                        onClick={() => handleSalesDecision(change.property_composite_key, 'Keep Old')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium ${
                          currentDecision === 'Keep Old' 
                            ? 'bg-red-600 text-white' 
                            : 'bg-red-100 text-red-800 hover:bg-red-200'
                        }`}
                      >
                        Keep Old (${change.differences.sales_price.old?.toLocaleString()})
                      </button>
                      
                      <button
                        onClick={() => handleSalesDecision(change.property_composite_key, 'Keep New')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium ${
                          currentDecision === 'Keep New' 
                            ? 'bg-green-600 text-white' 
                            : 'bg-green-100 text-green-800 hover:bg-green-200'
                        }`}
                      >
                        Keep New (${change.differences.sales_price.new?.toLocaleString()})
                      </button>
                      
                      <button
                        onClick={() => handleSalesDecision(change.property_composite_key, 'Keep Both')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium ${
                          currentDecision === 'Keep Both' 
                            ? 'bg-blue-600 text-white' 
                            : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                        }`}
                      >
                        Keep Both
                      </button>
                    </div>
                    
                    {currentDecision && (
                      <div className="mt-2 text-sm text-green-600 font-medium">
                        ✓ Decision: {currentDecision}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between">
            <div className="text-sm text-gray-600">
              {salesDecisions.size} of {pendingSalesChanges.length} decisions made
            </div>
            <button
              onClick={completeSalesDecisions}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Continue with Decisions
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Comparison Modal Component
  const ComparisonModal = () => {
    if (!comparison) return null;
    
    const { summary, details } = comparison;
    const hasNewRecords = summary.missing > 0;
    const hasChanges = summary.changes > 0;
    const hasDeletions = summary.deletions > 0;
    const hasSalesChanges = summary.salesChanges > 0;
    const hasClassChanges = summary.classChanges > 0;
    const hasAnyChanges = hasNewRecords || hasChanges || hasDeletions || hasSalesChanges || hasClassChanges;
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <FileText className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-bold text-gray-900">File Comparison Results</h2>
              </div>
              <button
                onClick={() => setShowComparisonModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          <div className="p-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              {/* New Records Card */}
              <div className={`p-4 rounded-lg border-2 ${hasNewRecords ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${hasNewRecords ? 'text-green-600' : 'text-gray-500'}`}>
                    {summary.missing || 0}
                  </div>
                  <div className="text-sm text-gray-600">New Records</div>
                </div>
              </div>

              {/* Changes Card */}
              <div className={`p-4 rounded-lg border-2 ${hasChanges ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${hasChanges ? 'text-yellow-600' : 'text-gray-500'}`}>
                    {summary.changes || 0}
                  </div>
                  <div className="text-sm text-gray-600">Changes</div>
                </div>
              </div>

              {/* Deletions Card */}
              <div className={`p-4 rounded-lg border-2 ${hasDeletions ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${hasDeletions ? 'text-red-600' : 'text-gray-500'}`}>
                    {summary.deletions || 0}
                  </div>
                  <div className="text-sm text-gray-600">Deletions</div>
                </div>
              </div>

              {/* Sales Changes Card */}
              <div className={`p-4 rounded-lg border-2 ${hasSalesChanges ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${hasSalesChanges ? 'text-blue-600' : 'text-gray-500'}`}>
                    {summary.salesChanges || 0}
                  </div>
                  <div className="text-sm text-gray-600">Sales Changes</div>
                  {hasSalesChanges && (
                    <div className="text-xs text-green-600 mt-1">✓ Decisions Made</div>
                  )}
                </div>
              </div>

              {/* NEW: Class Changes Card */}
              <div className={`p-4 rounded-lg border-2 ${hasClassChanges ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${hasClassChanges ? 'text-purple-600' : 'text-gray-500'}`}>
                    {summary.classChanges || 0}
                  </div>
                  <div className="text-sm text-gray-600">Class Changes</div>
                </div>
              </div>
            </div>

            {/* Processing Status */}
            {processing && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  <span className="text-blue-800 font-medium">{processingStatus}</span>
                </div>
              </div>
            )}

            {/* Detailed Results */}
            {hasAnyChanges && (
              <div className="space-y-4">
                {/* New Records Section */}
                {hasNewRecords && details.missing && (
                  <div className="border border-green-200 rounded-lg p-4">
                    <h3 className="font-bold text-green-800 mb-2">
                      🆕 New Records to Process ({details.missing.length})
                    </h3>
                    <div className="max-h-32 overflow-y-auto">
                      <div className="grid grid-cols-1 gap-1 text-sm">
                        {details.missing.slice(0, 5).map((record, idx) => {
                          const blockField = detectedVendor === 'BRT' ? 'BLOCK' : 'Block';
                          const lotField = detectedVendor === 'BRT' ? 'LOT' : 'Lot';
                          const locationField = detectedVendor === 'BRT' ? 'PROPERTY_LOCATION' : 'Location';
                          
                          return (
                            <div key={idx} className="text-gray-700">
                              {record[blockField]}-{record[lotField]} • {record[locationField] || 'No Address'}
                            </div>
                          );
                        })}
                        {details.missing.length > 5 && (
                          <div className="text-gray-500 italic">
                            ...and {details.missing.length - 5} more records
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Sales Changes Section */}
                {hasSalesChanges && details.salesChanges && (
                  <div className="border border-blue-200 rounded-lg p-4">
                    <h3 className="font-bold text-blue-800 mb-2">
                      💰 Sales Changes with Decisions ({details.salesChanges.length})
                    </h3>
                    <div className="max-h-32 overflow-y-auto">
                      <div className="space-y-2 text-sm">
                        {details.salesChanges.slice(0, 3).map((change, idx) => {
                          const decision = salesDecisions.get(change.property_composite_key) || 'Keep New (default)';
                          return (
                            <div key={idx} className="border-l-2 border-blue-400 pl-2">
                              <div className="font-medium text-gray-800">
                                {change.property_block}-{change.property_lot}
                              </div>
                              <div className="text-gray-600">
                                Price: ${change.differences.sales_price.old.toLocaleString()} → ${change.differences.sales_price.new.toLocaleString()}
                              </div>
                              <div className="text-green-600 font-medium">Decision: {decision}</div>
                            </div>
                          );
                        })}
                        {details.salesChanges.length > 3 && (
                          <div className="text-gray-500 italic">
                            ...and {details.salesChanges.length - 3} more changes
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* NEW: Class Changes Section */}
                {hasClassChanges && details.classChanges && (
                  <div className="border border-purple-200 rounded-lg p-4">
                    <h3 className="font-bold text-purple-800 mb-2">
                      🏷️ Class Changes ({details.classChanges.length})
                    </h3>
                    <div className="max-h-32 overflow-y-auto">
                      <div className="space-y-2 text-sm">
                        {details.classChanges.slice(0, 3).map((change, idx) => (
                          <div key={idx} className="border-l-2 border-purple-400 pl-2">
                            <div className="font-medium text-gray-800">
                              {change.property_block}-{change.property_lot}
                            </div>
                            {change.changes.map((classChange, changeIdx) => (
                              <div key={changeIdx} className="text-gray-600">
                                {classChange.field}: {classChange.old} → {classChange.new}
                              </div>
                            ))}
                          </div>
                        ))}
                        {details.classChanges.length > 3 && (
                          <div className="text-gray-500 italic">
                            ...and {details.classChanges.length - 3} more changes
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Deletions Section */}
                {hasDeletions && details.deletions && (
                  <div className="border border-red-200 rounded-lg p-4">
                    <h3 className="font-bold text-red-800 mb-2">
                      🗑️ Records to Delete ({details.deletions.length})
                    </h3>
                    <div className="max-h-32 overflow-y-auto">
                      <div className="grid grid-cols-1 gap-1 text-sm">
                        {details.deletions.slice(0, 5).map((record, idx) => (
                          <div key={idx} className="text-red-700">
                            {record.property_block}-{record.property_lot} • {record.property_location || 'No Address'}
                          </div>
                        ))}
                        {details.deletions.length > 5 && (
                          <div className="text-red-500 italic">
                            ...and {details.deletions.length - 5} more deletions
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* No Changes State */}
            {!hasAnyChanges && (
              <div className="text-center py-8">
                <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-gray-900 mb-2">✅ Files Match Database</h3>
                <p className="text-gray-600">All data is current and synchronized.</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between">
            <div className="flex space-x-3">
              <button
                onClick={() => setShowComparisonModal(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                Cancel
              </button>
              
              {/* NEW: Export Report Button */}
              {hasAnyChanges && (
                <button
                  onClick={exportComparisonReport}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Export Report</span>
                </button>
              )}
            </div>
            
            {/* FIXED: Process Changes Button */}
            {hasAnyChanges && (
              <button
                onClick={handleProcessChanges}
                disabled={processing}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {processing ? 'Processing...' : `🔄 Process All Changes (${detectedVendor} Processor)`}
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
      <div className="fixed top-4 right-4 z-50 space-y-2">
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

      {/* Source File Section - COMPACT DARK FORMAT */}
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
          disabled={comparing}
          className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:bg-gray-500 flex items-center gap-1"
        >
          <Upload className="w-3 h-3" />
          {sourceFile ? sourceFile.name.substring(0, 10) + '...' : 'Select File'}
        </button>
        
        {sourceFile && (
          <button
            onClick={performComparison}
            disabled={comparing}
            className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:bg-gray-500 flex items-center gap-1"
          >
            {comparing ? (
              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
            ) : (
              <CheckCircle className="w-3 h-3" />
            )}
            Compare
          </button>
        )}
      </div>

      {/* Code File Section - COMPACT DARK FORMAT */}
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
          className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 flex items-center gap-1"
        >
          <Upload className="w-3 h-3" />
          {codeFile ? codeFile.name.substring(0, 10) + '...' : 'Select File'}
        </button>
      </div>

      {/* Sales Decision Modal */}
      {showSalesDecisionModal && <SalesDecisionModal />}

      {/* Comparison Modal */}
      {showComparisonModal && <ComparisonModal />}
    </div>
  );
};

export default FileUploadButton;
