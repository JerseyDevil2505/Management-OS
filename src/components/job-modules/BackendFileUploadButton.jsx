import React, { useState, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertTriangle, X, Database, Settings, RefreshCw } from 'lucide-react';
import { uploadFile, processFile, formatBackendError } from '../../services/backendService';

const BackendFileUploadButton = ({ job, onFileProcessed, isJobLoading = false, onDataRefresh }) => {
  const [sourceFile, setSourceFile] = useState(null);
  const [codeFile, setCodeFile] = useState(null);
  const [detectedVendor, setDetectedVendor] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [showProcessingModal, setShowProcessingModal] = useState(false);
  const [processingLogs, setProcessingLogs] = useState([]);
  const [backendProgress, setBackendProgress] = useState(null);
  const [backendError, setBackendError] = useState(null);

  // ===== NOTIFICATION SYSTEM =====
  
  const addNotification = (message, type = 'info') => {
    const notification = {
      id: Date.now(),
      message,
      type,
      timestamp: new Date().toISOString()
    };
    
    setNotifications(prev => [...prev.slice(-4), notification]);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
    }, 5000);
  };

  const addProcessingLog = (message, type = 'info', details = null) => {
    const log = {
      id: Date.now(),
      message,
      type,
      timestamp: new Date().toISOString(),
      details
    };
    
    setProcessingLogs(prev => [...prev, log]);
    console.log(`[${type.toUpperCase()}] ${message}`, details);
  };

  // ===== VENDOR DETECTION =====
  
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
      if (fileContent.includes('|')) {
        return 'Microsystems';
      }
    }
    
    // Fallback to content analysis
    const firstLine = fileContent.split('\n')[0];
    if (firstLine.includes('BLOCK') && firstLine.includes('LOT') && firstLine.includes('QUALIFIER')) {
      return 'BRT';
    } else if (firstLine.includes('Block') && firstLine.includes('Lot') && firstLine.includes('Qual')) {
      return 'Microsystems';
    }
    
    return 'Unknown';
  };

  // ===== FILE UPLOAD HANDLERS =====
  
  const handleSourceFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    setSourceFile(file);
    setBackendError(null);
    setProcessingLogs([]);
    
    addProcessingLog(`📁 Source file selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
    
    try {
      // Quick local detection for immediate feedback
      const content = await file.text();
      const vendor = detectVendorType(content, file.name);
      setDetectedVendor(vendor);
      
      if (vendor) {
        addNotification(`✅ Detected ${vendor} file format`, 'success');
        addProcessingLog(`🔍 Vendor detected: ${vendor}`);
      } else {
        addNotification('⚠️ Could not detect vendor type', 'warning');
        addProcessingLog('⚠️ Could not auto-detect vendor type');
      }
      
    } catch (error) {
      console.error('Error reading file:', error);
      addNotification('Error reading file', 'error');
      addProcessingLog(`❌ File read error: ${error.message}`, 'error');
    }
  };

  const handleCodeFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    setCodeFile(file);
    setBackendError(null);
    
    addProcessingLog(`📄 Code file selected: ${file.name}`);
    
    try {
      const content = await file.text();
      const vendor = detectVendorType(content, file.name);
      
      if (vendor) {
        setDetectedVendor(vendor);
        addNotification(`✅ Detected ${vendor} code file`, 'success');
        addProcessingLog(`🔍 Code file vendor detected: ${vendor}`);
      } else {
        addNotification('⚠️ Could not detect code file vendor', 'warning');
        addProcessingLog('⚠️ Could not auto-detect code file vendor');
      }
    } catch (error) {
      console.error('Error reading code file:', error);
      addNotification('Error reading code file', 'error');
      addProcessingLog(`❌ Code file read error: ${error.message}`, 'error');
    }
  };

  // ===== BACKEND PROCESSING =====
  
  const handleProcessWithBackend = async () => {
    if (!sourceFile) {
      addNotification('Please select a source file first', 'error');
      return;
    }

    if (!job?.id) {
      addNotification('Job ID not available', 'error');
      return;
    }

    setProcessing(true);
    setShowProcessingModal(true);
    setProcessingLogs([]);
    setBackendProgress(null);
    setBackendError(null);

    try {
      addProcessingLog('🚀 Starting backend processing...', 'info');
      
      // Step 1: Upload source file
      addProcessingLog('📤 Uploading source file to backend...', 'info');
      setProcessingStatus('Uploading source file...');
      
      const uploadResult = await uploadFile(sourceFile, job.id, 'source', {
        vendorType: detectedVendor,
        onProgress: (progress) => {
          setBackendProgress(progress);
          
          if (progress.type === 'upload_complete') {
            addProcessingLog(`✅ Source file uploaded successfully`, 'success', progress.fileInfo);
            setProcessingStatus('Source file uploaded successfully');
          }
        }
      });

      // Step 2: Upload code file if available
      if (codeFile) {
        addProcessingLog('📤 Uploading code file to backend...', 'info');
        setProcessingStatus('Uploading code file...');
        
        await uploadFile(codeFile, job.id, 'code', {
          vendorType: detectedVendor,
          onProgress: (progress) => {
            if (progress.type === 'upload_complete') {
              addProcessingLog(`✅ Code file uploaded successfully`, 'success', progress.fileInfo);
            }
          }
        });
      }

      // Step 3: Process source file
      addProcessingLog('⚙️ Processing source file...', 'info');
      setProcessingStatus('Processing source file...');
      
      const processResult = await processFile(job.id, {
        fileType: 'source',
        batchSize: 1000,
        onProgress: (progress) => {
          setBackendProgress(progress);
          
          switch (progress.type) {
            case 'file_parsed':
              addProcessingLog(`📋 File parsed: ${progress.totalLines} data rows found`, 'info');
              setProcessingStatus(`Processing ${progress.totalLines} records...`);
              break;
              
            case 'progress':
              const percentage = progress.percentage;
              addProcessingLog(`📊 Progress: ${progress.processed}/${progress.total} (${percentage}%)`, 'info');
              setProcessingStatus(`Processing: ${percentage}% complete`);
              break;
              
            case 'batch_error':
              addProcessingLog(`⚠️ Batch error at row ${progress.batchStart}: ${progress.error}`, 'warning');
              break;
              
            case 'processing_complete':
              addProcessingLog('🎉 File processing completed successfully!', 'success');
              setProcessingStatus('Processing completed successfully');
              break;
              
            case 'error':
              addProcessingLog(`❌ Processing error: ${progress.error}`, 'error');
              break;
          }
        }
      });

      // Step 4: Process code file if available
      if (codeFile) {
        addProcessingLog('⚙️ Processing code file...', 'info');
        setProcessingStatus('Processing code file...');
        
        await processFile(job.id, {
          fileType: 'code',
          onProgress: (progress) => {
            if (progress.type === 'codes_processed') {
              addProcessingLog(`✅ Code file processed: ${progress.totalCodes} codes loaded`, 'success');
            }
          }
        });
      }

      // Success!
      addProcessingLog('🏆 All processing completed successfully!', 'success');
      addNotification('✅ Files processed successfully via backend service', 'success');
      
      // Notify parent component
      if (onFileProcessed) {
        onFileProcessed({
          success: true,
          vendor: detectedVendor,
          uploadResult,
          processResult
        });
      }

      // Trigger data refresh
      if (onDataRefresh) {
        addProcessingLog('🔄 Refreshing data in application...', 'info');
        await onDataRefresh();
        addProcessingLog('✅ Data refresh completed', 'success');
      }

      // Auto-close modal after 3 seconds
      setTimeout(() => {
        setShowProcessingModal(false);
        setSourceFile(null);
        setCodeFile(null);
        setDetectedVendor(null);
      }, 3000);

    } catch (error) {
      console.error('Backend processing failed:', error);
      const formattedError = formatBackendError(error);
      setBackendError(formattedError);
      
      addProcessingLog(`❌ Backend processing failed: ${formattedError.message}`, 'error', formattedError);
      addNotification(`❌ Processing failed: ${formattedError.message}`, 'error');
      
      if (formattedError.isRetryable) {
        addNotification(`💡 ${formattedError.suggestion}`, 'info');
      }
      
    } finally {
      setProcessing(false);
      setProcessingStatus('');
      setBackendProgress(null);
    }
  };

  // ===== RENDER =====

  return (
    <div className="space-y-4">
      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="space-y-2">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className={`p-3 rounded-lg border-l-4 ${
                notification.type === 'success' ? 'bg-green-50 border-green-400 text-green-700' :
                notification.type === 'warning' ? 'bg-yellow-50 border-yellow-400 text-yellow-700' :
                notification.type === 'error' ? 'bg-red-50 border-red-400 text-red-700' :
                'bg-blue-50 border-blue-400 text-blue-700'
              }`}
            >
              <div className="flex justify-between items-start">
                <span className="text-sm">{notification.message}</span>
                <button
                  onClick={() => setNotifications(prev => prev.filter(n => n.id !== notification.id))}
                  className="text-gray-400 hover:text-gray-600 ml-2"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Backend Error Display */}
      {backendError && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-lg">
          <div className="flex">
            <AlertTriangle className="w-5 h-5 text-red-400 mr-3 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-red-800">{backendError.title}</h3>
              <p className="text-sm text-red-700 mt-1">{backendError.message}</p>
              {backendError.suggestion && (
                <p className="text-sm text-red-600 mt-2 italic">{backendError.suggestion}</p>
              )}
              <div className="text-xs text-red-500 mt-2">
                Operation: {backendError.operation} | Status: {backendError.status}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* File Upload Section */}
      <div className="bg-white border rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <Database className="w-5 h-5 mr-2 text-blue-600" />
          Backend File Processing
          <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
            Enhanced
          </span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Source File Upload */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              Source File (Required)
            </label>
            <input
              type="file"
              accept=".csv,.txt,.dat"
              onChange={handleSourceFileUpload}
              disabled={processing}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
            />
            {sourceFile && (
              <div className="flex items-center text-sm text-gray-600">
                <FileText className="w-4 h-4 mr-2" />
                {sourceFile.name} ({(sourceFile.size / 1024 / 1024).toFixed(2)}MB)
              </div>
            )}
          </div>

          {/* Code File Upload */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              Code File (Optional)
            </label>
            <input
              type="file"
              accept=".txt,.dat"
              onChange={handleCodeFileUpload}
              disabled={processing}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 disabled:opacity-50"
            />
            {codeFile && (
              <div className="flex items-center text-sm text-gray-600">
                <FileText className="w-4 h-4 mr-2" />
                {codeFile.name}
              </div>
            )}
          </div>
        </div>

        {/* Vendor Detection */}
        {detectedVendor && (
          <div className="mt-4 p-3 bg-blue-50 rounded-lg">
            <div className="flex items-center">
              <CheckCircle className="w-5 h-5 text-blue-600 mr-2" />
              <span className="text-sm font-medium text-blue-900">
                Vendor Type Detected: {detectedVendor}
              </span>
            </div>
          </div>
        )}

        {/* Processing Status */}
        {processing && processingStatus && (
          <div className="mt-4 p-3 bg-yellow-50 rounded-lg">
            <div className="flex items-center">
              <RefreshCw className="w-5 h-5 text-yellow-600 mr-2 animate-spin" />
              <span className="text-sm font-medium text-yellow-900">
                {processingStatus}
              </span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex space-x-4">
          <button
            onClick={handleProcessWithBackend}
            disabled={!sourceFile || processing || isJobLoading}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 font-medium shadow-lg hover:shadow-xl transition-all transform hover:scale-105"
          >
            {processing ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <>
                <Upload className="w-5 h-5" />
                <span>Process with Backend</span>
              </>
            )}
          </button>

          {processing && (
            <button
              onClick={() => setShowProcessingModal(true)}
              className="px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center space-x-2"
            >
              <Settings className="w-5 h-5" />
              <span>View Progress</span>
            </button>
          )}
        </div>
      </div>

      {/* Processing Modal */}
      {showProcessingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[70vh] overflow-hidden shadow-2xl flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 bg-gray-50 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Database className="w-5 h-5 text-blue-600" />
                  <h2 className="text-lg font-bold text-gray-900">
                    Backend Processing Progress
                  </h2>
                </div>
                <button
                  onClick={() => setShowProcessingModal(false)}
                  className="text-gray-400 hover:text-gray-600 p-1"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Progress Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Current Progress */}
              {backendProgress && (
                <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                  <div className="text-sm font-medium text-blue-900">
                    Current: {backendProgress.type}
                  </div>
                  {backendProgress.percentage && (
                    <div className="mt-2">
                      <div className="w-full bg-blue-200 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${backendProgress.percentage}%` }}
                        ></div>
                      </div>
                      <div className="text-xs text-blue-700 mt-1">
                        {backendProgress.percentage}% complete
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Processing Logs */}
              <div className="space-y-2">
                {processingLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`p-2 rounded text-sm ${
                      log.type === 'success' ? 'bg-green-50 text-green-700' :
                      log.type === 'warning' ? 'bg-yellow-50 text-yellow-700' :
                      log.type === 'error' ? 'bg-red-50 text-red-700' :
                      'bg-gray-50 text-gray-700'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <span>{log.message}</span>
                      <span className="text-xs opacity-75 ml-2">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {log.details && (
                      <pre className="text-xs mt-1 opacity-75 overflow-x-auto">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>

              {processingLogs.length === 0 && (
                <div className="text-center py-8">
                  <RefreshCw className="w-8 h-8 mx-auto mb-2 text-gray-400 animate-spin" />
                  <p className="text-gray-600">Initializing backend processing...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackendFileUploadButton;
