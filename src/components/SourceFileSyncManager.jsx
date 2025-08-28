/**
 * SourceFileSyncManager - Component for managing source file synchronization
 * Handles cases where jobs.source_file_content is updated and property_records need reprocessing
 */

import React, { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw, CheckCircle, XCircle, Info } from 'lucide-react';
import { propertyService } from '../lib/supabaseClient.js';

const SourceFileSyncManager = ({ job, onReprocessComplete, className = '' }) => {
  const [syncStatus, setSyncStatus] = useState(null);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);

  // Check sync status on component mount and when job changes
  useEffect(() => {
    if (job?.id) {
      checkSyncStatus();
    }
  }, [job?.id]);

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { message, type, timestamp }]);
  };

  const checkSyncStatus = async () => {
    try {
      const status = await propertyService.checkJobReprocessingStatus(job.id);
      setSyncStatus(status);
      
      if (status.needsReprocessing) {
        addLog(`${status.recordsNeedingReprocessing} records need reprocessing`, 'warning');
      } else if (status.hasSourceFile) {
        addLog('Source file and property records are in sync', 'success');
      } else {
        addLog('No source file content available', 'warning');
      }
    } catch (error) {
      setError(error.message);
      addLog(`Error checking sync status: ${error.message}`, 'error');
    }
  };

  const handleTriggerReprocessing = async (force = false) => {
    if (!job?.id) return;
    
    setIsReprocessing(true);
    setError(null);
    addLog(`${force ? 'Force ' : ''}triggering reprocessing...`, 'info');
    
    try {
      // First trigger the database-level reprocessing
      const result = await propertyService.triggerJobReprocessing(job.id, force);
      addLog(result.message, result.success ? 'success' : 'error');
      
      if (result.success && (result.records_needing_reprocessing > 0 || force)) {
        // Then actually reprocess using the application processors
        addLog('Starting manual reprocessing with application processors...', 'info');
        
        const processResult = await propertyService.manualReprocessFromSource(job.id);
        addLog(`Reprocessing complete: ${processResult.processed} records processed`, 'success');
        
        if (processResult.errors > 0) {
          addLog(`Warning: ${processResult.errors} errors occurred during reprocessing`, 'warning');
        }
        
        // Refresh sync status
        await checkSyncStatus();
        
        // Notify parent component
        if (onReprocessComplete) {
          onReprocessComplete(processResult);
        }
      }
    } catch (error) {
      setError(error.message);
      addLog(`Reprocessing failed: ${error.message}`, 'error');
    } finally {
      setIsReprocessing(false);
    }
  };

  const getSyncStatusColor = () => {
    if (!syncStatus) return 'gray';
    if (syncStatus.error) return 'red';
    if (syncStatus.needsReprocessing) return 'orange';
    if (syncStatus.hasSourceFile) return 'green';
    return 'gray';
  };

  const getSyncStatusIcon = () => {
    if (!syncStatus) return <Info className="w-4 h-4" />;
    if (syncStatus.error) return <XCircle className="w-4 h-4" />;
    if (syncStatus.needsReprocessing) return <AlertTriangle className="w-4 h-4" />;
    if (syncStatus.hasSourceFile) return <CheckCircle className="w-4 h-4" />;
    return <Info className="w-4 h-4" />;
  };

  const getSyncStatusMessage = () => {
    if (!syncStatus) return 'Checking sync status...';
    if (syncStatus.error) return `Error: ${syncStatus.error}`;
    if (syncStatus.needsReprocessing) {
      return `${syncStatus.recordsNeedingReprocessing} records need reprocessing`;
    }
    if (syncStatus.hasSourceFile) return 'Source file and property records are in sync';
    return 'No source file content available';
  };

  if (!job) {
    return null;
  }

  return (
    <div className={`bg-white rounded-lg border border-gray-200 p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <RefreshCw className="w-5 h-5" />
          Source File Sync Status
        </h3>
        <button
          onClick={checkSyncStatus}
          disabled={isReprocessing}
          className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50"
        >
          Refresh Status
        </button>
      </div>

      {/* Sync Status Display */}
      <div className={`flex items-center gap-2 p-3 rounded-md mb-4 ${
        getSyncStatusColor() === 'green' ? 'bg-green-50 text-green-800' :
        getSyncStatusColor() === 'orange' ? 'bg-orange-50 text-orange-800' :
        getSyncStatusColor() === 'red' ? 'bg-red-50 text-red-800' :
        'bg-gray-50 text-gray-800'
      }`}>
        {getSyncStatusIcon()}
        <span className="font-medium">{getSyncStatusMessage()}</span>
      </div>

      {/* Sync Details */}
      {syncStatus && (
        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div>
            <span className="font-medium text-gray-600">Has Source File:</span>
            <span className={`ml-2 ${syncStatus.hasSourceFile ? 'text-green-600' : 'text-red-600'}`}>
              {syncStatus.hasSourceFile ? 'Yes' : 'No'}
            </span>
          </div>
          <div>
            <span className="font-medium text-gray-600">Records Needing Reprocessing:</span>
            <span className={`ml-2 ${syncStatus.recordsNeedingReprocessing > 0 ? 'text-orange-600' : 'text-green-600'}`}>
              {syncStatus.recordsNeedingReprocessing}
            </span>
          </div>
          {syncStatus.sourceFileParsedAt && (
            <div className="col-span-2">
              <span className="font-medium text-gray-600">Last Parsed:</span>
              <span className="ml-2 text-gray-800">
                {new Date(syncStatus.sourceFileParsedAt).toLocaleString()}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      {syncStatus?.hasSourceFile && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => handleTriggerReprocessing(false)}
            disabled={isReprocessing || !syncStatus.needsReprocessing}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {isReprocessing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Reprocess Changed Records
          </button>
          
          <button
            onClick={() => handleTriggerReprocessing(true)}
            disabled={isReprocessing}
            className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {isReprocessing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
            Force Reprocess All
          </button>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
          <div className="flex items-center gap-2 text-red-800">
            <XCircle className="w-4 h-4" />
            <span className="font-medium">Error:</span>
          </div>
          <p className="text-red-700 mt-1 text-sm">{error}</p>
        </div>
      )}

      {/* Activity Log */}
      {logs.length > 0 && (
        <div className="border-t border-gray-200 pt-4">
          <h4 className="font-medium text-gray-900 mb-2">Activity Log</h4>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {logs.slice(-10).map((log, index) => (
              <div key={index} className={`text-xs flex items-center gap-2 ${
                log.type === 'error' ? 'text-red-600' :
                log.type === 'warning' ? 'text-orange-600' :
                log.type === 'success' ? 'text-green-600' :
                'text-gray-600'
              }`}>
                <span className="font-mono text-gray-500">{log.timestamp}</span>
                <span>{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Helper Text */}
      <div className="mt-4 p-3 bg-blue-50 rounded-md">
        <p className="text-sm text-blue-800">
          <strong>How it works:</strong> When the source file content in jobs table is updated, 
          property records are automatically marked for reprocessing. Use the buttons above to 
          reprocess records using the stored source file content.
        </p>
      </div>
    </div>
  );
};

export default SourceFileSyncManager;
