import React, { useState, useEffect } from 'react';
import { Factory, Settings, Download, RefreshCw, AlertTriangle, CheckCircle, TrendingUp, DollarSign, Users, Calendar, X, ChevronDown, ChevronUp, Eye, FileText, Lock, Unlock, Save } from 'lucide-react';
import { supabase, jobService } from '../../lib/supabaseClient';

const ProductionTracker = ({ jobData, onBackToJobs, latestFileVersion, propertyRecordsCount, onUpdateWorkflowStats }) => {
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [processed, setProcessed] = useState(false);
  const [employeeData, setEmployeeData] = useState({});
  const [analytics, setAnalytics] = useState(null);
  const [billingAnalytics, setBillingAnalytics] = useState(null);
  const [validationReport, setValidationReport] = useState(null);
  const [missingPropertiesReport, setMissingPropertiesReport] = useState(null);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [notifications, setNotifications] = useState([]);
  
  // Commercial inspection counts from inspection_data
  const [commercialCounts, setCommercialCounts] = useState({
    inspected: 0,
    priced: 0
  });
  
  // Settings state - Enhanced InfoBy category configuration
  const [availableInfoByCodes, setAvailableInfoByCodes] = useState([]);
  const [infoByCategoryConfig, setInfoByCategoryConfig] = useState({
    entry: [],
    refusal: [],
    estimation: [],
    invalid: [],
    priced: [],
    special: []
  });
  const [originalCategoryConfig, setOriginalCategoryConfig] = useState({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [projectStartDate, setProjectStartDate] = useState('');
  const [isDateLocked, setIsDateLocked] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [settingsLocked, setSettingsLocked] = useState(false);

  // UI state
  const [activeTab, setActiveTab] = useState('analytics');
  const [selectedInspectorIssues, setSelectedInspectorIssues] = useState(null);
  
  // Add collapsible InfoBy configuration state
  const [showInfoByConfig, setShowInfoByConfig] = useState(false);
  const [detectedVendor, setDetectedVendor] = useState(null);
  
  // Inspector filtering and sorting
  const [inspectorFilter, setInspectorFilter] = useState('all');
  const [inspectorSort, setInspectorSort] = useState('alphabetical');
  
  // Override modal state
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [selectedOverrideProperty, setSelectedOverrideProperty] = useState(null);
  const [overrideReason, setOverrideReason] = useState('New Construction');
  const [overrideMap, setOverrideMap] = useState({});
  const [validationOverrides, setValidationOverrides] = useState([]);

  // Smart data staleness detection
  const currentWorkflowStats = jobData?.appData;
  const isDataStale = currentWorkflowStats?.needsRefresh && 
                     currentWorkflowStats?.lastFileUpdate > currentWorkflowStats?.lastProcessed;

  const addNotification = (message, type = 'info') => {
    const id = Date.now();
    const notification = { id, message, type, timestamp: new Date() };
    setNotifications(prev => [...prev, notification]);
    
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  // Debug logging
  const debugLog = (section, message, data = null) => {
    console.log(`🔍 [${section}] ${message}`, data || '');
  };

  // Load commercial inspection counts from inspection_data
  const loadCommercialCounts = async () => {
    if (!jobData?.id || !latestFileVersion) return;

    try {
      // Count inspected commercial properties (4A, 4B, 4C)
      const { data: inspectedData, error: inspectedError } = await supabase
        .from('inspection_data')
        .select('property_composite_key')
        .eq('job_id', jobData.id)
        .eq('file_version', latestFileVersion)
        .in('property_class', ['4A', '4B', '4C'])
        .not('measure_by', 'is', null)
        .not('measure_date', 'is', null);

      if (inspectedError) throw inspectedError;

      // Count priced commercial properties
      const { data: pricedData, error: pricedError } = await supabase
        .from('inspection_data')
        .select('property_composite_key')
        .eq('job_id', jobData.id)
        .eq('file_version', latestFileVersion)
        .in('property_class', ['4A', '4B', '4C'])
        .not('price_by', 'is', null)
        .not('price_date', 'is', null);

      if (pricedError) throw pricedError;

      setCommercialCounts({
        inspected: inspectedData?.length || 0,
        priced: pricedData?.length || 0
      });

      debugLog('COMMERCIAL_COUNTS', 'Loaded commercial counts from inspection_data', {
        inspected: inspectedData?.length || 0,
        priced: pricedData?.length || 0,
        totalCommercial: jobData.totalCommercial
      });

    } catch (error) {
      console.error('Error loading commercial counts:', error);
      debugLog('COMMERCIAL_COUNTS', 'Error loading commercial counts');
    }
  };

  // Load employee data for inspector details
  const loadEmployeeData = async () => {
    try {
      const { data: employees, error } = await supabase
        .from('employees')
        .select('id, first_name, last_name, inspector_type, employment_status, initials');

      if (error) throw error;

      const employeeMap = {};
      employees.forEach(emp => {
        const initials = emp.initials || `${emp.first_name.charAt(0)}${emp.last_name.charAt(0)}`;
        employeeMap[initials] = {
          id: emp.id,
          name: `${emp.first_name} ${emp.last_name}`,
          fullName: `${emp.last_name}, ${emp.first_name}`,
          inspector_type: emp.inspector_type,
          initials: initials
        };
      });

      setEmployeeData(employeeMap);
      debugLog('EMPLOYEES', 'Loaded employee data with types', { 
        count: Object.keys(employeeMap).length,
        inspectorTypes: Object.values(employeeMap).reduce((acc, emp) => {
          const type = emp.inspector_type || 'untyped';
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        }, {})
      });
    } catch (error) {
      console.error('Error loading employee data:', error);
      addNotification('Error loading employee data', 'error');
    }
  };

  // Initialize data loading
  useEffect(() => {
    if (jobData?.id && latestFileVersion) {
      loadEmployeeData();
      loadCommercialCounts();
      setLoading(false);
    }
  }, [jobData?.id, latestFileVersion]);

  // Load data from App.js central hub if available
  useEffect(() => {
    if (jobData?.appData) {
      debugLog('APP_INTEGRATION', '✅ Loading data from App.js central hub');
      setAnalytics(jobData.appData.analytics);
      setBillingAnalytics(jobData.appData.billingAnalytics);
      setValidationReport(jobData.appData.validationReport);
      setMissingPropertiesReport(jobData.appData.missingPropertiesReport);
      setProcessed(true);
      setSettingsLocked(true);
    }
  }, [jobData?.appData]);

  // Simple placeholder for processing
  const startProcessingSession = async () => {
    setProcessing(true);
    
    // Simulate processing
    setTimeout(() => {
      setProcessing(false);
      setProcessed(true);
      addNotification('✅ Processing completed successfully!', 'success');
    }, 2000);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-3"></div>
          <span className="text-gray-600">Loading production data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
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
                onClick={() => setNotifications(prev => prev.filter(n => n.id !== notification.id))}
                className="ml-2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border-2 border-blue-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Factory className="w-8 h-8 mr-3 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Production Tracker</h1>
              <p className="text-gray-600">
                {jobData.name} - Fresh Rebuild Testing
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg border shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Properties</p>
                <p className="text-2xl font-bold text-blue-600">{propertyRecordsCount?.toLocaleString() || '0'}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-blue-500" />
            </div>
          </div>
          
          <div className="bg-white p-4 rounded-lg border shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Inspections</p>
                <p className="text-2xl font-bold text-green-600">{analytics?.validInspections?.toLocaleString() || '0'}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg border shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Commercial Complete</p>
                <p className="text-2xl font-bold text-blue-600">
                  {jobData.totalcommercial > 0 ? Math.round((commercialCounts.inspected / jobData.totalcommercial) * 100) : 0}%
                </p>
              </div>
              <Factory className="w-8 h-8 text-blue-500" />
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg border shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Processing Status</p>
                <p className="text-2xl font-bold text-purple-600">{processed ? 'Complete' : 'Ready'}</p>
              </div>
              <Settings className="w-8 h-8 text-purple-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Simple Settings Panel */}
      <div className="bg-white rounded-lg border shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
          <Settings className="w-5 h-5 mr-2" />
          Fresh Rebuild - Basic Controls
        </h3>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-600">Click to test processing functionality</p>
          </div>
          
          <button
            onClick={startProcessingSession}
            disabled={processing}
            className={`px-6 py-2 rounded-lg flex items-center space-x-2 transition-all ${
              processed 
                ? 'bg-green-600 text-white hover:bg-green-700'
                : processing
                ? 'bg-yellow-600 text-white'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {processing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : processed ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>
              {processing ? 'Processing...' : processed ? 'Processed ✓' : 'Start Processing'}
            </span>
          </button>
        </div>
      </div>

      {/* Simple Results Display */}
      {processed && (
        <div className="bg-white rounded-lg border shadow-sm p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Processing Results</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <h4 className="font-semibold text-green-800">✅ Success</h4>
              <p className="text-green-600">Fresh rebuild working correctly</p>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <h4 className="font-semibold text-blue-800">📊 Data Loaded</h4>
              <p className="text-blue-600">All components initialized</p>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
              <h4 className="font-semibold text-purple-800">🚀 Ready</h4>
              <p className="text-purple-600">Can add full functionality</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionTracker;
