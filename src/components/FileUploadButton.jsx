import React, { useState, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertTriangle, X, Database, Target, Calendar, Settings } from 'lucide-react';
import { jobService, propertyService } from '../lib/supabaseClient';

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

  // FIXED: Comparison logic with exact processor composite key matching
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
      const { data: dbRecords, error: dbError } = await propertyService.supabase
        .from('property_records')
        .select('property_composite_key, property_block, property_lot, property_location, sales_price, sales_date')
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
      
      [...sourceKeys].filter(key => dbKeys.has(key)).forEach(key => {
        const sourceRecord = sourceKeyMap.get(key);
        const dbRecord = dbKeyMap.get(key);
        
        // Check for sales changes
        const sourceSalesPrice = parseFloat(String(sourceRecord[detectedVendor === 'BRT' ? 'CURRENTSALE_PRICE' : 'Sale Price'] || 0).replace(/[,$]/g, '')) || 0;
        const dbSalesPrice = parseFloat(dbRecord.sales_price || 0);
        
        const sourceSalesDate = sourceRecord[detectedVendor === 'BRT' ? 'CURRENTSALE_DATE' : 'Sale Date'];
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
        
        // Add other field changes if needed
        // For now, focus on sales changes as primary comparison
      });
      
      const results = {
        summary: {
          missing: missing.length,
          changes: changes.length,
          deletions: deletions.length,
          salesChanges: salesChanges.length // FIXED: Always include count
        },
        details: {
          missing,
          changes,
          deletions,
          salesChanges
        }
      };
      
      console.log('📊 Comparison Results:', results.summary);
      
      setComparison(results);
      setComparisonStatus('Analysis complete');
      
      // Only show modal if there are actual changes to review
      const hasAnyChanges = results.summary.missing > 0 || 
                           results.summary.changes > 0 || 
                           results.summary.deletions > 0 || 
                           results.summary.salesChanges > 0;
      
      if (hasAnyChanges) {
        setShowComparisonModal(true);
      } else {
        // Just show a success notification for no changes
        addNotification('✅ No changes detected - files match database perfectly', 'success');
      }
      
    } catch (error) {
      console.error('Comparison error:', error);
      addNotification(`Comparison failed: ${error.message}`, 'error');
      setComparisonStatus('Comparison failed');
    } finally {
      setComparing(false);
    }
  };

  // Insert new records when user clicks button
  const handleInsertNewRecords = async () => {
    if (!comparison?.details?.missing?.length) {
      addNotification('No new records to insert', 'info');
      return;
    }
    
    try {
      setProcessing(true);
      setProcessingStatus(`Inserting ${comparison.details.missing.length} new records...`);
      
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
          source_file_uploaded_at: new Date().toISOString()
        }
      );
      
      const expectedRecords = comparison.details.missing.length;
      const actualProcessed = result.processed || 0;
      const isPartialSuccess = actualProcessed < expectedRecords && actualProcessed > 0;
      
      if (isPartialSuccess) {
        const missing = expectedRecords - actualProcessed;
        addNotification(
          `⚠️ Partial Insert: ${actualProcessed} of ${expectedRecords} records inserted. ${missing} failed.`,
          'warning'
        );
      } else if (result.errors > 0) {
        addNotification(`❌ Insert failed: ${result.errors} errors`, 'error');
      } else {
        addNotification(`✅ Successfully inserted ${actualProcessed} records`, 'success');
        
        // Update job
        await jobService.update(job.id, {
          sourceFileStatus: 'imported',
          totalProperties: actualProcessed
        });
        
        // Refresh comparison to show updated state
        setShowComparisonModal(false);
        await performComparison();
      }
      
    } catch (error) {
      console.error('Insert error:', error);
      addNotification(`Insert failed: ${error.message}`, 'error');
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

  // Comparison Modal Component
  const ComparisonModal = () => {
    if (!comparison) return null;
    
    const { summary, details } = comparison;
    const hasNewRecords = summary.missing > 0;
    const hasChanges = summary.changes > 0;
    const hasDeletions = summary.deletions > 0;
    const hasSalesChanges = summary.salesChanges > 0;
    
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {/* New Records Card with Insert Button */}
              <div className={`p-4 rounded-lg border-2 ${hasNewRecords ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${hasNewRecords ? 'text-green-600' : 'text-gray-500'}`}>
                    {summary.missing || 0}
                  </div>
                  <div className="text-sm text-gray-600">New Records</div>
                  {hasNewRecords && !processing && (
                    <button
                      onClick={handleInsertNewRecords}
                      className="mt-2 px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium"
                    >
                      Insert {summary.missing}
                    </button>
                  )}
                  {processing && (
                    <div className="mt-2 text-xs text-green-600">Processing...</div>
                  )}
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

              {/* FIXED: Sales Changes Card - Always shows count */}
              <div className={`p-4 rounded-lg border-2 ${hasSalesChanges ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${hasSalesChanges ? 'text-blue-600' : 'text-gray-500'}`}>
                    {summary.salesChanges || 0}
                  </div>
                  <div className="text-sm text-gray-600">Sales Changes</div>
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
            {(hasNewRecords || hasChanges || hasDeletions || hasSalesChanges) && (
              <div className="space-y-4">
                {/* New Records Section */}
                {hasNewRecords && details.missing && (
                  <div className="border border-green-200 rounded-lg p-4">
                    <h3 className="font-bold text-green-800 mb-2">
                      🆕 New Records to Insert ({details.missing.length})
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
                      💰 Sales Changes ({details.salesChanges.length})
                    </h3>
                    <div className="max-h-32 overflow-y-auto">
                      <div className="space-y-2 text-sm">
                        {details.salesChanges.slice(0, 3).map((change, idx) => (
                          <div key={idx} className="border-l-2 border-blue-400 pl-2">
                            <div className="font-medium text-gray-800">
                              {change.property_block}-{change.property_lot}
                            </div>
                            <div className="text-gray-600">
                              Price: ${change.differences.sales_price.old.toLocaleString()} → ${change.differences.sales_price.new.toLocaleString()}
                            </div>
                          </div>
                        ))}
                        {details.salesChanges.length > 3 && (
                          <div className="text-gray-500 italic">
                            ...and {details.salesChanges.length - 3} more changes
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
            {!hasNewRecords && !hasChanges && !hasDeletions && !hasSalesChanges && (
              <div className="text-center py-8">
                <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-gray-900 mb-2">✅ Files Match Database</h3>
                <p className="text-gray-600">All data is current and synchronized.</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end">
            <button
              onClick={() => setShowComparisonModal(false)}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
            >
              Close
            </button>
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

      {/* Comparison Modal */}
      {showComparisonModal && <ComparisonModal />}
    </div>
  );
};

export default FileUploadButton;
