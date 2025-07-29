{/* Billing Tab */}
            {activeTab === 'billing' && billingAnalytics && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">Summary for Billing</h3>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div>
                    <h4 className="text-md font-semibold text-gray-800 mb-4">Individual Classes</h4>
                    <div className="space-y-3">
                      {Object.entries(billingAnalytics.byClass)
                        .filter(([cls, data]) => data.total > 0)
                        .map(([cls, data]) => {
                          const isResidential = ['2', '3A'].includes(cls);
                          const isCommercial = ['4A', '4B', '4C'].includes(cls);
                          const colorClass = isResidential 
                            ? 'bg-green-50 border-green-200' 
                            : isCommercial 
                            ? 'bg-blue-50 border-blue-200'
                            : 'bg-gray-50 border-gray-200';
                          const textColor = isResidential 
                            ? 'text-green-600' 
                            : isCommercial 
                            ? 'text-blue-600' 
                            : 'text-gray-600';
                          const progressColor = isResidential ? 'green' : isCommercial ? 'blue' : 'gray';
                          
                          return (
                            <div key={cls} className={`p-4 rounded-lg border ${colorClass}`}>
                              <div className="flex justify-between items-center mb-2">
                                <div>
                                  <span className="font-medium text-gray-900">Class {cls}</span>
                                  {isResidential && <span className="ml-2 text-xs text-green-600 font-medium">Residential</span>}
                                  {isCommercial && <span className="ml-2 text-xs text-blue-600 font-medium">Commercial</span>}
                                </div>
                                <div className="text-right">
                                  <div className={`font-bold ${textColor}`}>{data.billable.toLocaleString()}</div>
                                  <div className="text-xs text-gray-500">of {data.total.toLocaleString()}</div>
                                </div>
                              </div>
                              <ProgressBar current={data.billable} total={data.total} color={progressColor} />
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-md font-semibold text-gray-800 mb-4">Grouped Categories</h4>
                    <div className="space-y-4">
                      <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                        <div className="flex justify-between items-center mb-2">
                          <div>
                            <span className="font-medium text-gray-900">Commercial (4A, 4B, 4C)</span>
                            <div className="text-xs text-gray-600">Commercial properties</div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-blue-600 text-xl">{billingAnalytics.grouped.commercial.toLocaleString()}</div>
                            <div className="text-xs text-blue-600">of {billingAnalytics.progressData.commercial.total.toLocaleString()}</div>
                          </div>
                        </div>
                        <ProgressBar 
                          current={billingAnalytics.progressData.commercial.billable} 
                          total={billingAnalytics.progressData.commercial.total} 
                          color="blue" 
                        />
                      </div>

                      <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <span className="font-medium text-gray-900">Exempt (15A-15F)</span>
                            <div className="text-xs text-gray-600">Tax-exempt properties</div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-purple-600 text-xl">{billingAnalytics.grouped.exempt.toLocaleString()}</div>
                            <div className="text-xs text-purple-600">of {billingAnalytics.progressData.exempt.total.toLocaleString()}</div>
                          </div>
                        </div>
                        <ProgressBar 
                          current={billingAnalytics.progressData.exempt.billable} 
                          total={billingAnalytics.progressData.exempt.total} 
                          color="purple" 
                        />
                      </div>

                      <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                        <div className="flex justify-between items-center mb-2">
                          <div>
                            <span className="font-medium text-gray-900">Railroad (5A, 5B)</span>
                            <div className="text-xs text-gray-600">Railroad properties</div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-green-600 text-xl">{billingAnalytics.grouped.railroad.toLocaleString()}</div>
                            <div className="text-xs text-green-600">of {billingAnalytics.progressData.railroad.total.toLocaleString()}</div>
                          </div>
                        </div>
                        <ProgressBar 
                          current={billingAnalytics.progressData.railroad.billable} 
                          total={billingAnalytics.progressData.railroad.total} 
                          color="green" 
                        />
                      </div>

                      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="flex justify-between items-center mb-2">
                          <div>
                            <span className="font-medium text-gray-900">Personal Property (6A, 6B)</span>
                            <div className="text-xs text-gray-600">Personal property</div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-gray-600 text-xl">{billingAnalytics.grouped.personalProperty.toLocaleString()}</div>
                            <div className="text-xs text-gray-600">of {billingAnalytics.progressData.personalProperty.total.toLocaleString()}</div>
                          </div>
                        </div>
                        <ProgressBar 
                          current={billingAnalytics.progressData.personalProperty.billable} 
                          total={billingAnalytics.progressData.personalProperty.total} 
                          color="gray" 
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Validation Tab */}
            {activeTab === 'validation' && validationReport && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">
                    Validation Report - Historical Reference
                  </h3>
                  {validationReport.summary.total_issues > 0 && (
                    <button
                      onClick={exportValidationReport}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
                    >
                      <Download className="w-4 h-4" />
                      <span>Export Report</span>
                    </button>
                  )}
                </div>

                {validationReport.summary.total_issues === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
                    <h4 className="text-lg font-semibold text-gray-900 mb-2">No Validation Issues</h4>
                    <p className="text-gray-600">All attempted inspections passed validation checks</p>
                    <p className="text-sm text-gray-500 mt-2">Properties not yet inspected are excluded from validation</p>
                  </div>
                ) : (
                  <>
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                      <h4 className="font-semibold text-yellow-800 mb-3">Inspector Summary - Historical View</h4>
                      <p className="text-sm text-yellow-700 mb-3">
                        These issues were identified during processing. Override decisions were made in the processing modal.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {validationReport.summary.inspector_breakdown.map((inspector, idx) => (
                          <div 
                            key={idx}
                            onClick={() => setSelectedInspectorIssues(
                              selectedInspectorIssues === inspector.inspector_code ? null : inspector.inspector_code
                            )}
                            className="p-3 bg-white rounded border cursor-pointer hover:bg-yellow-50 transition-colors"
                          >
                            <div className="flex justify-between items-center">
                              <div>
                                <div className="font-medium text-gray-900">{inspector.inspector_code}</div>
                                <div className="text-sm text-gray-600">{inspector.inspector_name}</div>
                              </div>
                              <div className="text-right">
                                <div className="font-bold text-red-600">{inspector.total_issues}</div>
                                <div className="text-xs text-gray-500">issues</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {selectedInspectorIssues && validationReport.detailed_issues[selectedInspectorIssues] && (
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <h4 className="font-semibold text-gray-900 mb-4">
                          Issues for {selectedInspectorIssues} - {validationReport.summary.inspector_breakdown.find(i => i.inspector_code === selectedInspectorIssues)?.inspector_name}
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Block</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Lot</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Qualifier</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Card</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Property Location</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Compound Issues</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {validationReport.detailed_issues[selectedInspectorIssues].map((issue, idx) => {
                                // Check if this issue has been overridden
                                const propertyKey = issue.composite_key || `${issue.block}-${issue.lot}-${issue.qualifier || ''}`;
                                const isOverridden = overrideMap && overrideMap[propertyKey]?.override_applied;
                                
                                return (
                                  <tr key={idx} className={`border-t border-gray-200 ${isOverridden ? 'bg-green-50' : ''}`}>
                                    <td className="px-3 py-2">{issue.block}</td>
                                    <td className="px-3 py-2">{issue.lot}</td>
                                    <td className="px-3 py-2">{issue.qualifier || '-'}</td>
                                    <td className="px-3 py-2">{issue.card}</td>
                                    <td className="px-3 py-2">{issue.property_location}</td>
                                    <td className={`px-3 py-2 ${isOverridden ? 'line-through text-gray-500' : 'text-red-600'}`}>
                                      {issue.warning_message}
                                    </td>
                                    <td className="px-3 py-2">
                                      {isOverridden ? (
                                        <div className="text-green-600 text-xs font-medium">
                                          ✅ Overridden: {overrideMap[propertyKey]?.override_reason}
                                        </div>
                                      ) : (
                                        <span className="text-red-600 text-xs font-medium">Not Overridden</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {!selectedInspectorIssues && (
                      <div className="text-center py-8 text-gray-500">
                        <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                        <p>Click on an inspector above to view detailed issues</p>
                        <p className="text-sm mt-2">This is a historical record of validation issues found during processing</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Missing Properties Report */}
            {activeTab === 'missing' && missingPropertiesReport && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">
                    Missing Properties Report - Not Added to Inspection Data
                  </h3>
                  {missingPropertiesReport.summary.total_missing > 0 && (
                    <button
                      onClick={() => exportMissingPropertiesReport()}
                      className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 flex items-center space-x-2"
                    >
                      <Download className="w-4 h-4" />
                      <span>Export Missing Report</span>
                    </button>
                  )}
                </div>

                {missingPropertiesReport.summary.total_missing === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
                    <h4 className="text-lg font-semibold text-gray-900 mb-2">All Properties Accounted For</h4>
                    <p className="text-gray-600">Every property record was successfully processed to inspection_data</p>
                    <p className="text-sm text-gray-500 mt-2">Total Records: {analytics?.totalRecords || 0} | Valid Inspections: {analytics?.validInspections || 0}</p>
                  </div>
                ) : (
                  <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-orange-600 font-medium">Total Missing</p>
                            <p className="text-2xl font-bold text-orange-800">{missingPropertiesReport.summary.total_missing}</p>
                          </div>
                          <AlertTriangle className="w-8 h-8 text-orange-500" />
                        </div>
                      </div>

                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-gray-600 font-medium">Uninspected</p>
                            <p className="text-2xl font-bold text-gray-800">{missingPropertiesReport.summary.uninspected_count}</p>
                            <p className="text-xs text-gray-500">No inspection attempt</p>
                          </div>
                          <Eye className="w-8 h-8 text-gray-500" />
                        </div>
                      </div>

                      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-red-600 font-medium">Validation Failed</p>
                            <p className="text-2xl font-bold text-red-800">{missingPropertiesReport.summary.validation_failed_count}</p>
                            <p className="text-xs text-red-500">Attempted but invalid</p>
                          </div>
                          <X className="w-8 h-8 text-red-500" />
                        </div>
                      </div>

                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-blue-600 font-medium">Success Rate</p>
                            <p className="import React, { useState, useEffect } from 'react';
import { Factory, Settings, Download, RefreshCw, AlertTriangle, CheckCircle, TrendingUp, DollarSign, Users, Calendar, X, ChevronDown, ChevronUp, Eye, FileText, Lock, Unlock, Save, Shield } from 'lucide-react';
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
  
  // NEW: Commercial inspection counts from inspection_data
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
    special: [] // NEW: For Microsystems V, N codes - valid but no validation reports
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
  
  // NEW: Add collapsible InfoBy configuration state
  const [showInfoByConfig, setShowInfoByConfig] = useState(false);
  const [detectedVendor, setDetectedVendor] = useState(null);
  
  // Inspector filtering and sorting
  const [inspectorFilter, setInspectorFilter] = useState('all');
  const [inspectorSort, setInspectorSort] = useState('alphabetical');
  
  // NEW: Processing modal state
  const [showProcessingModal, setShowProcessingModal] = useState(false);
  const [processingStage, setProcessingStage] = useState('');
  const [processingProgress, setProcessingProgress] = useState(0);
  const [pendingValidationIssues, setPendingValidationIssues] = useState([]);
  const [pendingOverrides, setPendingOverrides] = useState({});
  const [processingResults, setProcessingResults] = useState(null);
  
  // Existing override state (for reference/history)
  const [validationOverrides, setValidationOverrides] = useState([]);
  const [overrideMap, setOverrideMap] = useState({});
  
  // NEW: Override modal state (for post-processing if needed)
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [selectedOverrideProperty, setSelectedOverrideProperty] = useState(null);
  const [overrideReason, setOverrideReason] = useState('New Construction');

  // NEW: Smart data staleness detection
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

  // NEW: Load commercial inspection counts from inspection_data
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

  // NEW: Load vendor source from property_records
  const loadVendorSource = async () => {
    if (!jobData?.id || !latestFileVersion) return null;

    try {
      const { data: record, error } = await supabase
        .from('property_records')
        .select('vendor_source')
        .eq('job_id', jobData.id)
        .eq('file_version', latestFileVersion)
        .not('vendor_source', 'is', null)
        .limit(1)
        .single();

      if (!error && record?.vendor_source) {
        debugLog('VENDOR_SOURCE', `Detected vendor from property_records: ${record.vendor_source}`);
        setDetectedVendor(record.vendor_source);
        return record.vendor_source;
      }
      
      // Fallback to jobData vendor_type
      debugLog('VENDOR_SOURCE', `Using fallback vendor from jobData: ${jobData.vendor_type}`);
      setDetectedVendor(jobData.vendor_type);
      return jobData.vendor_type;
    } catch (error) {
      debugLog('VENDOR_SOURCE', 'Error loading vendor source, using fallback');
      return jobData.vendor_type;
    }
  };

  // FIXED: Enhanced InfoBy code loading with proper Microsystems cleaning
  const loadAvailableInfoByCodes = async () => {
    if (!jobData?.id) return;

    try {
      const { data: job, error } = await supabase
        .from('jobs')
        .select('parsed_code_definitions, vendor_type')
        .eq('id', jobData.id)
        .single();

      if (error || !job?.parsed_code_definitions) {
        debugLog('CODES', 'No parsed code definitions found for job');
        addNotification('No code definitions found. Upload code file first.', 'warning');
        return;
      }

      const codes = [];
      const vendor = job.vendor_type;

      if (vendor === 'BRT') {
        const sections = job.parsed_code_definitions.sections || job.parsed_code_definitions;
        
        debugLog('CODES', 'BRT sections available:', Object.keys(sections));
        
        // Look for InfoBy codes in Residential section, key 30, MAP - LOAD ALL CODES
        const residentialSection = sections['Residential'];
        if (residentialSection && residentialSection['30'] && residentialSection['30'].MAP) {
          debugLog('CODES', 'Found Residential[30].MAP, loading ALL InfoBy codes...');
          
          Object.keys(residentialSection['30'].MAP).forEach(key => {
            const item = residentialSection['30'].MAP[key];
            if (item && item.DATA && item.DATA.VALUE) {
              codes.push({
                code: item.KEY || item.DATA.KEY,
                description: item.DATA.VALUE,
                section: 'Residential[30]',
                vendor: 'BRT'
              });
              
              debugLog('CODES', `Found InfoBy code: ${item.KEY} = ${item.DATA.VALUE}`);
            }
          });
        } else {
          debugLog('CODES', 'Residential[30].MAP not found, structure:', residentialSection?.['30']);
        }

        // Fallback: Search all sections for inspection-related codes
        if (codes.length === 0) {
          debugLog('CODES', 'No codes found in Residential[30], searching all sections...');
          Object.keys(sections).forEach(sectionName => {
            const section = sections[sectionName];
            if (typeof section === 'object') {
              Object.keys(section).forEach(key => {
                const item = section[key];
                if (item && item.DATA && item.DATA.VALUE && 
                    (item.DATA.VALUE.includes('OWNER') || item.DATA.VALUE.includes('REFUSED') || 
                     item.DATA.VALUE.includes('AGENT') || item.DATA.VALUE.includes('ESTIMATED'))) {
                  codes.push({
                    code: item.KEY || item.DATA.KEY,
                    description: item.DATA.VALUE,
                    section: sectionName,
                    vendor: 'BRT'
                  });
                }
              });
            }
          });
        }

      } else if (vendor === 'Microsystems') {
        // FIXED: Enhanced Microsystems parsing with proper cleaning
        const fieldCodes = job.parsed_code_definitions.field_codes;
        const flatLookup = job.parsed_code_definitions.flat_lookup;
        
        debugLog('CODES', 'Microsystems parsed structure:', {
          hasFieldCodes: !!fieldCodes,
          hasFlatLookup: !!flatLookup,
          fieldCodesKeys: fieldCodes ? Object.keys(fieldCodes) : [],
          has140Category: !!(fieldCodes && fieldCodes['140']),
          rawKeys: Object.keys(job.parsed_code_definitions).filter(k => k.startsWith('140')).slice(0, 5)
        });

        if (fieldCodes && fieldCodes['140']) {
          // APPROACH 1: Read from clean structured field_codes['140']
          debugLog('CODES', 'Found 140 category in field_codes, loading InfoBy codes...');
          
          Object.keys(fieldCodes['140']).forEach(actualCode => {
            const codeData = fieldCodes['140'][actualCode];
            codes.push({
              code: actualCode, // Should be clean single letter like "A"
              description: codeData.description,
              section: 'InfoBy',
              vendor: 'Microsystems',
              storageCode: actualCode // Store clean single letter like "A"
            });
            
            debugLog('CODES', `✅ Clean InfoBy code: ${actualCode} = ${codeData.description}`);
          });
          
        } else if (flatLookup) {
          // APPROACH 2: Read from flat_lookup 
          debugLog('CODES', 'No field_codes[140], trying flat_lookup fallback...');
          
          Object.keys(flatLookup).forEach(code => {
            if (code.startsWith('140')) {
              const cleanCode = code.substring(3); // 140A -> A
              const description = flatLookup[code];
              codes.push({
                code: cleanCode,
                description: description,
                section: 'InfoBy',
                vendor: 'Microsystems',
                storageCode: cleanCode
              });
              
              debugLog('CODES', `✅ Clean InfoBy code: ${cleanCode} = ${description}`);
            }
          });
          
        } else {
          // APPROACH 3: FIXED Legacy format with aggressive cleaning
          debugLog('CODES', 'No structured format found, cleaning raw legacy format...');
          
          Object.keys(job.parsed_code_definitions).forEach(rawKey => {
            if (rawKey.startsWith('140')) {
              // AGGRESSIVE CLEANING: "140A   9999" -> "A"
              let cleanCode = rawKey.substring(3); // Remove "140" -> "A   9999"
              cleanCode = cleanCode.trim(); // Remove leading/trailing spaces -> "A   9999"
              cleanCode = cleanCode.split(/\s+/)[0]; // Split on whitespace, take first -> "A"
              
              const description = job.parsed_code_definitions[rawKey];
              
              codes.push({
                code: cleanCode, // Display clean single letter "A"
                description: description,
                section: 'InfoBy',
                vendor: 'Microsystems',
                storageCode: cleanCode // Store clean single letter "A"
              });
              
              debugLog('CODES', `✅ Cleaned InfoBy code: ${cleanCode} = ${description} (from raw: ${rawKey})`);
            }
          });
        }
      }

      setAvailableInfoByCodes(codes);
      debugLog('CODES', `✅ FINAL: Loaded ${codes.length} clean InfoBy codes from ${vendor}`, 
        codes.map(c => `${c.code}=${c.description}`));

      // Load existing category configuration
      await loadCategoriesFromDatabase(codes, vendor);

    } catch (error) {
      console.error('Error loading InfoBy codes:', error);
      addNotification('Error loading InfoBy codes from code file', 'error');
    }
  };

  // Load existing category configuration from database
  const loadCategoriesFromDatabase = async (codes, vendor) => {
    if (!jobData?.id) return;

    try {
      const { data: job, error } = await supabase
        .from('jobs')
        .select('infoby_category_config, workflow_stats')
        .eq('id', jobData.id)
        .single();

      if (!error && job?.infoby_category_config && Object.keys(job.infoby_category_config).length > 0) {
        setInfoByCategoryConfig(job.infoby_category_config);
        setOriginalCategoryConfig(job.infoby_category_config);
        debugLog('CATEGORIES', '✅ Loaded existing category config from infoby_category_config field');
      } else if (!error && job?.workflow_stats?.infoByCategoryConfig) {
        const oldConfig = job.workflow_stats.infoByCategoryConfig;
        setInfoByCategoryConfig(oldConfig);
        setOriginalCategoryConfig(oldConfig);
        debugLog('CATEGORIES', '✅ Migrated category config from workflow_stats');
        await saveCategoriesToDatabase(oldConfig);
      } else if (codes && codes.length > 0) {
        setDefaultCategoryConfig(vendor, codes);
      }
    } catch (error) {
      console.error('Error loading category config:', error);
    }
  };

  // Set default InfoBy category configurations
  const setDefaultCategoryConfig = (vendor, codes) => {
    const defaultConfig = { entry: [], refusal: [], estimation: [], invalid: [], priced: [], special: [] };

    if (vendor === 'BRT') {
      codes.forEach(item => {
        const desc = item.description.toUpperCase();
        if (desc.includes('OWNER') || desc.includes('SPOUSE') || desc.includes('TENANT') || desc.includes('AGENT')) {
          defaultConfig.entry.push(item.code);
        } else if (desc.includes('REFUSED')) {
          defaultConfig.refusal.push(item.code);
        } else if (desc.includes('ESTIMATED')) {
          defaultConfig.estimation.push(item.code);
        } else if (desc.includes('DOOR')) {
          defaultConfig.invalid.push(item.code);
        } else if (desc.includes('CONVERSION') || desc.includes('PRICED')) {
          defaultConfig.priced.push(item.code);
        }
      });
    } else if (vendor === 'Microsystems') {
      codes.forEach(item => {
        const storageCode = item.storageCode || item.code; // Use clean code
        const desc = item.description.toUpperCase();
        if (desc.includes('AGENT') || desc.includes('OWNER') || desc.includes('SPOUSE') || desc.includes('TENANT')) {
          defaultConfig.entry.push(storageCode);
        } else if (desc.includes('REFUSED')) {
          defaultConfig.refusal.push(storageCode);
        } else if (desc.includes('ESTIMATED') || desc.includes('VACANT')) {
          defaultConfig.estimation.push(storageCode);
        } else if (desc.includes('PRICED') || desc.includes('NARRATIVE') || desc.includes('ENCODED')) {
          defaultConfig.priced.push(storageCode);
        } else if (desc.includes('VACANT LAND') || desc.includes('NARRATIVE')) {
          // NEW: Special category for V (VACANT LAND) and N (NARRATIVE) - valid but no validation
          defaultConfig.special.push(storageCode);
        }
      });
    }

    setInfoByCategoryConfig(defaultConfig);
    setOriginalCategoryConfig(defaultConfig);
    setHasUnsavedChanges(true);
    debugLog('CATEGORIES', '✅ Set default category configuration', defaultConfig);
  };

  // Save category configuration to database
  const saveCategoriesToDatabase = async (config = null) => {
    if (!jobData?.id) return;

    const configToSave = config || infoByCategoryConfig;

    try {
      const { error } = await supabase
        .from('jobs')
        .update({ 
          infoby_category_config: {
            ...configToSave,
            vendor_type: jobData.vendor_type,
            last_updated: new Date().toISOString()
          }
        })
        .eq('id', jobData.id);

      if (error) throw error;
      
      setOriginalCategoryConfig(configToSave);
      setHasUnsavedChanges(false);
      
      debugLog('PERSISTENCE', '✅ Saved config to job record');
    } catch (error) {
      console.error('Error saving configuration:', error);
      addNotification('Error saving configuration', 'error');
    }
  };

  // NEW: Save complete analytics with overrides included
  const saveCompleteAnalytics = async (analyticsData, billingData, validationData, missingData, overrides) => {
    if (!jobData?.id) return;

    try {
      // Calculate final metrics with overrides included
      const finalAnalytics = {
        ...analyticsData,
        validInspections: analyticsData.validInspections + Object.keys(overrides).length,
        validationOverrideCount: Object.keys(overrides).length
      };

      // Save to workflow_stats
      const { error } = await supabase
        .from('jobs')
        .update({ 
          workflow_stats: {
            ...finalAnalytics,
            billingAnalytics: billingData,
            validationReport: validationData,
            missingPropertiesReport: missingData,
            validationOverrides: Object.values(overrides),
            overrideMap: overrides,
            lastProcessed: new Date().toISOString(),
            needsRefresh: false
          }
        })
        .eq('id', jobData.id);

      if (error) throw error;

      // Update App.js state
      if (onUpdateWorkflowStats) {
        onUpdateWorkflowStats({
          jobId: jobData.id,
          analytics: finalAnalytics,
          billingAnalytics: billingData,
          validationReport: validationData,
          missingPropertiesReport: missingData,
          validationOverrides: Object.values(overrides),
          overrideMap: overrides,
          totalValidationOverrides: Object.keys(overrides).length,
          lastProcessed: new Date().toISOString()
        });
      }

      debugLog('PERSISTENCE', '✅ Saved complete analytics with overrides included');
    } catch (error) {
      console.error('Error saving complete analytics:', error);
      addNotification('Error saving analytics', 'error');
    }
  };

  // Load persisted analytics on component mount
  const loadPersistedAnalytics = async () => {
    if (!jobData?.id) return;

    try {
      const { data: job, error } = await supabase
        .from('jobs')
        .select('workflow_stats')
        .eq('id', jobData.id)
        .single();

      if (!error && job?.workflow_stats && job.workflow_stats.totalRecords) {
        // Load the persisted analytics directly - no adjustment needed
        setAnalytics(job.workflow_stats);
        setBillingAnalytics(job.workflow_stats.billingAnalytics);
        setValidationReport(job.workflow_stats.validationReport);
        setMissingPropertiesReport(job.workflow_stats.missingPropertiesReport);
        setValidationOverrides(job.workflow_stats.validationOverrides || []);
        setOverrideMap(job.workflow_stats.overrideMap || {});
        
        setProcessed(true);
        setSettingsLocked(true);
        debugLog('PERSISTENCE', '✅ Loaded persisted analytics - counts already include overrides');
        addNotification('Previously processed analytics loaded', 'info');
      }
    } catch (error) {
      console.error('Error loading persisted analytics:', error);
    }
  };

  const loadProjectStartDate = async () => {
    if (!jobData?.id || !latestFileVersion) return;

    try {
      const { data: records, error } = await supabase
        .from('property_records')
        .select('project_start_date')
        .eq('job_id', jobData.id)
        .eq('file_version', latestFileVersion)
        .not('project_start_date', 'is', null)
        .limit(1)
        .single();

      if (!error && records?.project_start_date) {
        setProjectStartDate(records.project_start_date);
        setIsDateLocked(true);
        debugLog('START_DATE', `Loaded existing start date: ${records.project_start_date}`);
      }
    } catch (error) {
      debugLog('START_DATE', 'No existing start date found');
    }
  };

  const lockStartDate = async () => {
    if (!projectStartDate || !jobData?.id || !latestFileVersion) {
      addNotification('Please set a project start date first', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('property_records')
        .update({ project_start_date: projectStartDate })
        .eq('job_id', jobData.id)
        .eq('file_version', latestFileVersion);

      if (error) throw error;

      setIsDateLocked(true);
      addNotification('✅ Project start date locked and saved to all property records', 'success');
      debugLog('START_DATE', `Locked start date: ${projectStartDate}`);

    } catch (error) {
      console.error('Error locking start date:', error);
      addNotification('Error saving start date: ' + error.message, 'error');
    }
  };

  const unlockStartDate = () => {
    setIsDateLocked(false);
    addNotification('Project start date unlocked for editing', 'info');
  };

  // Reset session
  const resetSession = () => {
    setSessionId(null);
    setSettingsLocked(false);
    setProcessed(false);
    setAnalytics(null);
    setBillingAnalytics(null);
    setValidationReport(null);
    setCommercialCounts({ inspected: 0, priced: 0 });
    setMissingPropertiesReport(null);
    setValidationOverrides([]);
    setOverrideMap({});
    addNotification('🔄 Session reset - settings unlocked', 'info');
  };

  // Initialize data loading
  useEffect(() => {
    if (jobData?.id && latestFileVersion) {
      const loadAllData = async () => {
        await loadEmployeeData();
        await loadAvailableInfoByCodes();
        await loadProjectStartDate();
        await loadVendorSource();
        await loadPersistedAnalytics();
        await loadCommercialCounts();
        setLoading(false);
      };
      
      loadAllData();
    }
  }, [jobData?.id, latestFileVersion]);

  // Load data from App.js central hub if available
  useEffect(() => {
    if (jobData?.appData && !isDataStale) {
      debugLog('APP_INTEGRATION', '✅ Loading data from App.js central hub');
      setAnalytics(jobData.appData.analytics);
      setBillingAnalytics(jobData.appData.billingAnalytics);
      setValidationReport(jobData.appData.validationReport);
      setMissingPropertiesReport(jobData.appData.missingPropertiesReport);
      setValidationOverrides(jobData.appData.validationOverrides || []);
      setOverrideMap(jobData.appData.overrideMap || {});
      setProcessed(true);
      setSettingsLocked(true);
    }
  }, [jobData?.appData, isDataStale]);

  // Track unsaved changes
  useEffect(() => {
    const hasChanges = JSON.stringify(infoByCategoryConfig) !== JSON.stringify(originalCategoryConfig);
    setHasUnsavedChanges(hasChanges);
  }, [infoByCategoryConfig, originalCategoryConfig]);

  // ENHANCED: Process analytics with validation review modal
  const processAnalytics = async () => {
    if (!projectStartDate || !jobData?.id || !latestFileVersion) {
      addNotification('Project start date and job data required', 'error');
      return null;
    }

    try {
      setProcessingStage('Loading property data...');
      setProcessingProgress(10);
      
      // Get actual vendor from property_records
      const actualVendor = await loadVendorSource();
      
      debugLog('ANALYTICS', 'Starting analytics processing', { 
        jobId: jobData.id,
        fileVersion: latestFileVersion,
        startDate: projectStartDate,
        categoryConfig: infoByCategoryConfig,
        detectedVendor: actualVendor
      });

      // Get all valid InfoBy codes for validation
      const allValidCodes = [
        ...(infoByCategoryConfig.entry || []),
        ...(infoByCategoryConfig.refusal || []),
        ...(infoByCategoryConfig.estimation || []),
        ...(infoByCategoryConfig.priced || []),
        ...(infoByCategoryConfig.special || [])
      ];

      // Load ALL records using pagination to bypass Supabase 1000 limit
      let allRecords = [];
      let start = 0;
      const batchSize = 1000;
      
      setProcessingStage('Loading all property records...');
      
      while (true) {
        const { data: batchData, error: batchError } = await supabase
          .from('property_records')
          .select(`
            property_composite_key,
            property_block,
            property_lot,
            property_qualifier,
            property_addl_card,
            property_location,
            property_m4_class,
            inspection_info_by,
            inspection_list_by,
            inspection_list_date,
            inspection_measure_by,
            inspection_measure_date,
            inspection_price_by,
            inspection_price_date,
            values_mod_improvement
          `)
          .eq('job_id', jobData.id)
          .eq('file_version', latestFileVersion)
          .order('property_block', { ascending: true })
          .order('property_lot', { ascending: true })
          .range(start, start + batchSize - 1);
        
        if (batchError) throw batchError;
        if (!batchData || batchData.length === 0) break;
        
        allRecords = [...allRecords, ...batchData];
        setProcessingProgress(10 + Math.min(30, Math.floor((allRecords.length / propertyRecordsCount) * 30)));
        debugLog('ANALYTICS', `Loaded batch ${Math.floor(start/batchSize) + 1}: ${batchData.length} records (total: ${allRecords.length})`);
        
        start += batchSize;
        
        if (batchData.length < batchSize) break;
      }
      
      const rawData = allRecords;
      debugLog('ANALYTICS', `✅ Loaded ${rawData?.length || 0} property records for analysis`);

      setProcessingStage('Analyzing inspection data...');
      setProcessingProgress(40);

      const startDate = new Date(projectStartDate);
      const inspectorStats = {};
      const classBreakdown = {};
      const billingByClass = {};
      const propertyIssues = {};
      const inspectorIssuesMap = {};
      const inspectionDataBatch = [];
      const missingProperties = [];

      // Initialize class counters
      const allClasses = ['1', '2', '3A', '3B', '4A', '4B', '4C', '15A', '15B', '15C', '15D', '15E', '15F', '5A', '5B', '6A', '6B'];
      allClasses.forEach(cls => {
        classBreakdown[cls] = { total: 0, inspected: 0, entry: 0, refusal: 0, priced: 0 };
        billingByClass[cls] = { total: 0, inspected: 0, billable: 0 };
      });

      rawData.forEach((record, index) => {
        if (index % 100 === 0) {
          setProcessingProgress(40 + Math.floor((index / rawData.length) * 40));
        }

        const inspector = record.inspection_measure_by || 'UNASSIGNED';
        const propertyClass = record.property_m4_class || 'UNKNOWN';
        const infoByCode = record.inspection_info_by;
        const measuredDate = record.inspection_measure_date ? new Date(record.inspection_measure_date) : null;
        const listDate = record.inspection_list_date ? new Date(record.inspection_list_date) : null;
        const priceDate = record.inspection_price_date ? new Date(record.inspection_price_date) : null;
        const propertyKey = record.property_composite_key;

        // Track this property's processing status
        let wasAddedToInspectionData = false;
        let reasonNotAdded = '';

        // Always count ALL properties for denominators
        if (classBreakdown[propertyClass]) {
          classBreakdown[propertyClass].total++;
          billingByClass[propertyClass].total++;
        }

        // Skip UNASSIGNED for inspector analytics
        if (inspector === 'UNASSIGNED') {
          reasonNotAdded = 'Inspector UNASSIGNED';
          missingProperties.push({
            composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: record.property_addl_card || '1',
            property_location: record.property_location || '',
            property_class: propertyClass,
            reason: reasonNotAdded,
            inspector: inspector,
            info_by_code: infoByCode,
            measure_date: record.inspection_measure_date,
            validation_issues: []
          });
          return;
        }

        // Skip inspections before project start date
        if (measuredDate && measuredDate < startDate) {
          reasonNotAdded = 'Inspection date before project start date';
          missingProperties.push({
            composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: record.property_addl_card || '1',
            property_location: record.property_location || '',
            property_class: propertyClass,
            reason: reasonNotAdded,
            inspector: inspector,
            info_by_code: infoByCode,
            measure_date: record.inspection_measure_date,
            validation_issues: []
          });
          return;
        }

        // Skip inspectors with invalid initials
        if (!employeeData[inspector]) {
          reasonNotAdded = `Inspector ${inspector} not found in employee database`;
          missingProperties.push({
            composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            property_location: record.property_location || '',
            property_class: propertyClass,
            reason: reasonNotAdded,
            inspector: inspector,
            info_by_code: infoByCode,
            measure_date: record.inspection_measure_date,
            validation_issues: []
          });
          return;
        }

        // Initialize inspector stats
        if (!inspectorStats[inspector]) {
          const employeeInfo = employeeData[inspector] || {};
          inspectorStats[inspector] = {
            name: employeeInfo.name || inspector,
            fullName: employeeInfo.fullName || inspector,
            inspector_type: employeeInfo.inspector_type,
            totalInspected: 0,
            residentialInspected: 0,
            commercialInspected: 0,
            entry: 0,
            refusal: 0,
            priced: 0,
            allWorkDays: new Set(),
            residentialWorkDays: new Set(),
            commercialWorkDays: new Set(),
            pricingWorkDays: new Set()
          };
          inspectorIssuesMap[inspector] = [];
        }

        // Check for any inspection attempt
        const hasAnyInspectionAttempt = (
          (record.inspection_measure_by && record.inspection_measure_by.trim() !== '') ||
          record.inspection_measure_date ||
          record.inspection_info_by ||
          record.inspection_list_by ||
          record.inspection_price_by
        );

        if (!hasAnyInspectionAttempt) {
          reasonNotAdded = 'No inspection attempt - completely uninspected';
          missingProperties.push({
            composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            property_location: record.property_location || '',
            property_class: propertyClass,
            reason: reasonNotAdded,
            inspector: inspector,
            info_by_code: infoByCode,
            measure_date: record.inspection_measure_date,
            validation_issues: []
          });
          return;
        }

        // Validate attempted inspections
        let isValidInspection = true;
        let hasValidMeasuredBy = inspector && inspector !== 'UNASSIGNED' && inspector.trim() !== '';
        let hasValidMeasuredDate = measuredDate && measuredDate >= startDate;
        
        // Vendor-specific validation logic
        let hasValidInfoBy;
        let normalizedInfoBy;
        
        if (actualVendor === 'BRT') {
          normalizedInfoBy = infoByCode?.toString().padStart(2, '0');
          const normalizedValidCodes = allValidCodes.map(code => code.toString().padStart(2, '0'));
          hasValidInfoBy = normalizedInfoBy && normalizedValidCodes.includes(normalizedInfoBy);
        } else if (actualVendor === 'Microsystems') {
          normalizedInfoBy = infoByCode;
          hasValidInfoBy = infoByCode && allValidCodes.includes(infoByCode);
        } else {
          normalizedInfoBy = infoByCode?.toString().padStart(2, '0');
          const normalizedValidCodes = allValidCodes.map(code => code.toString().padStart(2, '0'));
          hasValidInfoBy = (infoByCode && allValidCodes.includes(infoByCode)) || 
                          (normalizedInfoBy && normalizedValidCodes.includes(normalizedInfoBy));
        }
        
        // Compound validation messages per property
        const addValidationIssue = (message) => {
          if (!propertyIssues[propertyKey]) {
            propertyIssues[propertyKey] = {
              block: record.property_block,
              lot: record.property_lot,
              qualifier: record.property_qualifier || '',
              card: record.property_addl_card || '1',
              property_location: record.property_location || '',
              inspector: inspector,
              issues: []
            };
          }
          propertyIssues[propertyKey].issues.push(message);
          isValidInspection = false;
        };

        // Core validation rules
        if (!hasValidInfoBy) {
          addValidationIssue(`Invalid InfoBy code: ${infoByCode}`);
        }
        if (!hasValidMeasuredBy) {
          addValidationIssue('Missing or invalid inspector');
        }
        if (!hasValidMeasuredDate) {
          addValidationIssue('Missing or invalid measure date');
        }

        // Business logic validation
        const isEntryCode = (infoByCategoryConfig.entry || []).includes(actualVendor === 'BRT' ? normalizedInfoBy || infoByCode : infoByCode);
        const isRefusalCode = (infoByCategoryConfig.refusal || []).includes(actualVendor === 'BRT' ? normalizedInfoBy || infoByCode : infoByCode);
        const isEstimationCode = (infoByCategoryConfig.estimation || []).includes(actualVendor === 'BRT' ? normalizedInfoBy || infoByCode : infoByCode);
        const isPricedCode = (infoByCategoryConfig.priced || []).includes(actualVendor === 'BRT' ? normalizedInfoBy || infoByCode : infoByCode);
        const isSpecialCode = (infoByCategoryConfig.special || []).includes(actualVendor === 'BRT' ? normalizedInfoBy || infoByCode : infoByCode);
        const hasListingData = record.inspection_list_by && record.inspection_list_date;

        // Skip validation for special codes
        if (!isSpecialCode) {
          if (isRefusalCode && !hasListingData) {
            addValidationIssue(`Refusal code ${infoByCode} but missing listing data`);
          }
          if (isEntryCode && !hasListingData) {
            addValidationIssue(`Entry code ${infoByCode} but missing listing data`);
          }
          if (isEstimationCode && hasListingData) {
            addValidationIssue(`Estimation code ${infoByCode} but has listing data`);
          }
        }

        // Inspector type validation
        const isCommercialProperty = ['4A', '4B', '4C'].includes(propertyClass);
        const isResidentialProperty = ['2', '3A'].includes(propertyClass);
        const isResidentialInspector = employeeData[inspector]?.inspector_type === 'residential';
        
        if (isCommercialProperty && isResidentialInspector) {
          addValidationIssue(`Residential inspector on commercial property`);
        }

        // Zero improvement validation
        if (record.values_mod_improvement === 0 && !hasListingData) {
          addValidationIssue('Zero improvement property missing listing data');
        }

        // Process valid inspections
        if (isValidInspection && hasValidInfoBy && hasValidMeasuredBy && hasValidMeasuredDate) {
          
          // Count for manager progress
          if (classBreakdown[propertyClass]) {
            classBreakdown[propertyClass].inspected++;
            billingByClass[propertyClass].inspected++;
            billingByClass[propertyClass].billable++;
          }

          // Inspector analytics
          inspectorStats[inspector].totalInspected++;
            
          const workDayString = measuredDate.toISOString().split('T')[0];
          inspectorStats[inspector].allWorkDays.add(workDayString);

          if (isResidentialProperty) {
            inspectorStats[inspector].residentialInspected++;
            inspectorStats[inspector].residentialWorkDays.add(workDayString);
            
            // Individual inspector credit
            if (isEntryCode && record.inspection_list_by === inspector) {
              inspectorStats[inspector].entry++;
            } else if (isRefusalCode && record.inspection_list_by === inspector) {
              inspectorStats[inspector].refusal++;
            }
            
            // Global metrics
            if (isEntryCode && classBreakdown[propertyClass]) {
              classBreakdown[propertyClass].entry++;
            } else if (isRefusalCode && classBreakdown[propertyClass]) {
              classBreakdown[propertyClass].refusal++;
            }
          }
          
          if (isCommercialProperty) {
            inspectorStats[inspector].commercialInspected++;
            inspectorStats[inspector].commercialWorkDays.add(workDayString);
          }

          // Pricing logic
          if (isCommercialProperty) {
            const currentVendor = actualVendor || jobData.vendor_type;

            if (currentVendor === 'BRT' && 
                record.inspection_price_by && 
                record.inspection_price_by.trim() !== '' &&
                priceDate && 
                priceDate >= startDate) {
              
              inspectorStats[inspector].priced++;
              inspectorStats[inspector].pricingWorkDays.add(priceDate.toISOString().split('T')[0]);
              if (classBreakdown[propertyClass]) {
                classBreakdown[propertyClass].priced++;
              }
              
            } else if (currentVendor === 'Microsystems' && isPricedCode) {
              inspectorStats[inspector].priced++;
              if (classBreakdown[propertyClass]) {
                classBreakdown[propertyClass].priced++;
              }
            }
          }

          // Prepare for inspection_data UPSERT
          const inspectionRecord = {
            job_id: jobData.id,
            file_version: latestFileVersion,
            property_composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: record.property_addl_card || '1',
            property_location: record.property_location || '',
            property_class: propertyClass,
            measure_by: inspector,
            measure_date: record.inspection_measure_date,
            info_by_code: infoByCode,
            list_by: record.inspection_list_by,
            list_date: record.inspection_list_date,
            price_by: record.inspection_price_by,
            price_date: record.inspection_price_date,
            project_start_date: projectStartDate,
            source_file_name: record.source_file_name,
            upload_date: new Date().toISOString(),
            validation_report: propertyIssues[propertyKey] ? {
              issues: propertyIssues[propertyKey].issues,
              severity: propertyIssues[propertyKey].issues.length > 2 ? 'high' : 'medium'
            } : null
          };

          inspectionDataBatch.push(inspectionRecord);
          wasAddedToInspectionData = true;
        }

        // Track properties that didn't make it to inspection_data
        if (!wasAddedToInspectionData) {
          const reasons = [];
          if (!hasValidInfoBy) reasons.push(`Invalid InfoBy code: ${infoByCode}`);
          if (!hasValidMeasuredBy) reasons.push('Missing/invalid inspector');
          if (!hasValidMeasuredDate) reasons.push('Missing/invalid measure date');
          if (propertyIssues[propertyKey]?.issues) reasons.push(...propertyIssues[propertyKey].issues);
          
          reasonNotAdded = `Failed validation: ${reasons.join(', ')}`;
          
          missingProperties.push({
            composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            property_location: record.property_location || '',
            property_class: propertyClass,
            reason: reasonNotAdded,
            inspector: inspector,
            info_by_code: infoByCode,
            measure_date: record.inspection_measure_date,
            validation_issues: propertyIssues[propertyKey]?.issues || []
          });
        }
      });

      setProcessingStage('Calculating inspector metrics...');
      setProcessingProgress(80);

      // Calculate inspector rates and averages
      Object.keys(inspectorStats).forEach(inspector => {
        const stats = inspectorStats[inspector];
        
        // Convert Sets to counts
        stats.fieldDays = stats.allWorkDays.size;
        stats.residentialFieldDays = stats.residentialWorkDays.size;
        stats.commercialFieldDays = stats.commercialWorkDays.size;
        stats.pricingDays = stats.pricingWorkDays.size;
        
        // Entry/Refusal rates
        if (stats.residentialInspected > 0) {
          stats.entryRate = Math.round((stats.entry / stats.residentialInspected) * 100);
          stats.refusalRate = Math.round((stats.refusal / stats.residentialInspected) * 100);
        } else {
          stats.entryRate = 0;
          stats.refusalRate = 0;
        }

        // Type-specific daily averages
        if (stats.inspector_type?.toLowerCase() === 'residential') {
          stats.dailyAverage = stats.residentialFieldDays > 0 ? 
            Math.round(stats.residentialInspected / stats.residentialFieldDays) : 0;
        } else if (stats.inspector_type?.toLowerCase() === 'commercial') {
          stats.commercialAverage = stats.commercialFieldDays > 0 ? 
            Math.round(stats.commercialInspected / stats.commercialFieldDays) : 0;
          const currentVendor = actualVendor || jobData.vendor_type;
          if (currentVendor === 'BRT') {
            stats.pricingAverage = stats.pricingDays > 0 ? 
              Math.round(stats.priced / stats.pricingDays) : 0;
          } else {
            stats.pricingAverage = null;
          }
        } else if (stats.inspector_type?.toLowerCase() === 'management') {
          stats.dailyAverage = stats.fieldDays > 0 ? 
            Math.round(stats.totalInspected / stats.fieldDays) : 0;
        }

        // Clean up Sets
        delete stats.allWorkDays;
        delete stats.residentialWorkDays;
        delete stats.commercialWorkDays;
        delete stats.pricingWorkDays;
      });

      // Create compound validation report
      const validationIssues = [];
      Object.keys(propertyIssues).forEach(propertyKey => {
        const property = propertyIssues[propertyKey];
        const compoundMessage = property.issues.join(' | ');
        
        const issue = {
          block: property.block,
          lot: property.lot,
          qualifier: property.qualifier,
          card: property.card,
          property_location: property.property_location,
          warning_message: compoundMessage,
          inspector: property.inspector,
          severity: property.issues.length > 2 ? 'high' : 'medium',
          composite_key: propertyKey
        };
        
        validationIssues.push(issue);
        
        if (!inspectorIssuesMap[property.inspector]) {
          inspectorIssuesMap[property.inspector] = [];
        }
        inspectorIssuesMap[property.inspector].push(issue);
      });

      // Calculate job-level totals - DON'T include overrides yet
      const totalInspected = Object.values(inspectorStats).reduce((sum, stats) => sum + stats.totalInspected, 0);
      
      // CORRECT GLOBAL ENTRY RATE CALCULATION
      const totalClass2And3A = classBreakdown['2'].total + classBreakdown['3A'].total;
      const totalEntry = classBreakdown['2'].entry + classBreakdown['3A'].entry;
      const totalRefusal = classBreakdown['2'].refusal + classBreakdown['3A'].refusal;

      debugLog('ENTRY_RATE_FIX', 'Global entry rate calculation', {
        totalEntry,
        totalClass2And3A,
        expectedRate: totalClass2And3A > 0 ? Math.round((totalEntry / totalClass2And3A) * 100) : 0
      });

      // Commercial percentage calculations
      const totalCommercialProperties = ['4A', '4B', '4C'].reduce((sum, cls) => sum + (classBreakdown[cls]?.total || 0), 0);
      const totalCommercialInspected = ['4A', '4B', '4C'].reduce((sum, cls) => sum + (classBreakdown[cls]?.inspected || 0), 0);
      const totalPriced = Object.values(inspectorStats).reduce((sum, stats) => sum + stats.priced, 0);

      const validationReportData = {
        summary: {
          total_inspectors: Object.keys(inspectorIssuesMap).filter(k => inspectorIssuesMap[k].length > 0).length,
          total_issues: validationIssues.length,
          inspector_breakdown: Object.keys(inspectorIssuesMap)
            .filter(inspector => inspectorIssuesMap[inspector].length > 0)
            .map(inspector => ({
              inspector_code: inspector,
              inspector_name: inspectorStats[inspector]?.fullName || inspector,
              total_issues: inspectorIssuesMap[inspector].length
            }))
        },
        detailed_issues: inspectorIssuesMap
      };

      // Create missing properties report
      const missingPropertiesReportData = {
        summary: {
          total_missing: missingProperties.length,
          uninspected_count: missingProperties.filter(p => p.reason.includes('No inspection attempt')).length,
          validation_failed_count: missingProperties.filter(p => p.reason.includes('Failed validation')).length,
          by_reason: missingProperties.reduce((acc, prop) => {
            const reason = prop.reason;
            acc[reason] = (acc[reason] || 0) + 1;
            return acc;
          }, {}),
          by_inspector: missingProperties.reduce((acc, prop) => {
            const inspector = prop.inspector || 'UNASSIGNED';
            acc[inspector] = (acc[inspector] || 0) + 1;
            return acc;
          }, {})
        },
        detailed_missing: missingProperties
      };

      // Analytics result WITHOUT overrides yet
      const analyticsResult = {
        totalRecords: rawData.length,
        validInspections: totalInspected,
        inspectorStats,
        classBreakdown,
        validationIssues: validationIssues.length,
        processingDate: new Date().toISOString(),
        
        // Correct global entry/refusal rates
        jobEntryRate: totalClass2And3A > 0 ? Math.round((totalEntry / totalClass2And3A) * 100) : 0,
        jobRefusalRate: totalClass2And3A > 0 ? Math.round((totalRefusal / totalClass2And3A) * 100) : 0,
        
        // Commercial metrics
        commercialInspections: totalCommercialInspected,
        commercialPricing: totalPriced,
        totalCommercialProperties,
        commercialCompletePercent: totalCommercialProperties > 0 ? Math.round((totalCommercialInspected / totalCommercialProperties) * 100) : 0,
        pricingCompletePercent: totalCommercialProperties > 0 ? Math.round((totalPriced / totalCommercialProperties) * 100) : 0
      };

      // Billing analytics with progress calculations
      const billingResult = {
        byClass: billingByClass,
        grouped: {
          commercial: ['4A', '4B', '4C'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0),
          exempt: ['15A', '15B', '15C', '15D', '15E', '15F'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0),
          railroad: ['5A', '5B'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0),
          personalProperty: ['6A', '6B'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0)
        },
        progressData: {
          commercial: {
            total: ['4A', '4B', '4C'].reduce((sum, cls) => sum + (billingByClass[cls]?.total || 0), 0),
            billable: ['4A', '4B', '4C'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0)
          },
          exempt: {
            total: ['15A', '15B', '15C', '15D', '15E', '15F'].reduce((sum, cls) => sum + (billingByClass[cls]?.total || 0), 0),
            billable: ['15A', '15B', '15C', '15D', '15E', '15F'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0)
          },
          railroad: {
            total: ['5A', '5B'].reduce((sum, cls) => sum + (billingByClass[cls]?.total || 0), 0),
            billable: ['5A', '5B'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0)
          },
          personalProperty: {
            total: ['6A', '6B'].reduce((sum, cls) => sum + (billingByClass[cls]?.total || 0), 0),
            billable: ['6A', '6B'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0)
          }
        },
        totalBillable: Object.values(billingByClass).reduce((sum, cls) => sum + cls.billable, 0)
      };

      setProcessingProgress(90);

      // Return results along with inspection data to be saved
      return { 
        analyticsResult, 
        billingResult, 
        validationReportData, 
        missingPropertiesReportData,
        inspectionDataBatch,
        validationIssues 
      };

    } catch (error) {
      console.error('Error processing analytics:', error);
      addNotification('Error processing analytics: ' + error.message, 'error');
      return null;
    }
  };

  // Handle InfoBy category assignment
  const handleCategoryAssignment = (category, code, isAssigned) => {
    if (settingsLocked) return;
    
    const newConfig = {
      ...infoByCategoryConfig,
      [category]: isAssigned 
        ? infoByCategoryConfig[category].filter(c => c !== code)
        : [...infoByCategoryConfig[category], code]
    };
    
    setInfoByCategoryConfig(newConfig);
  };

  // NEW: Handle override decision in processing modal
  const handleProcessingOverride = (propertyKey, reason) => {
    setPendingOverrides(prev => ({
      ...prev,
      [propertyKey]: {
        override_applied: true,
        override_reason: reason,
        override_by: 'Manager',
        override_date: new Date().toISOString()
      }
    }));
  };

  // NEW: Complete processing with overrides
  const completeProcessingWithOverrides = async () => {
    if (!processingResults) return;

    try {
      setProcessingStage('Applying validation decisions...');
      setProcessingProgress(95);

      const { 
        analyticsResult, 
        billingResult, 
        validationReportData, 
        missingPropertiesReportData,
        inspectionDataBatch 
      } = processingResults;

      // Apply overrides to inspection data batch
      const finalInspectionBatch = inspectionDataBatch.map(record => {
        if (pendingOverrides[record.property_composite_key]) {
          return {
            ...record,
            ...pendingOverrides[record.property_composite_key]
          };
        }
        return record;
      });

      // Add override records to batch
      Object.keys(pendingOverrides).forEach(propertyKey => {
        const existingRecord = finalInspectionBatch.find(r => r.property_composite_key === propertyKey);
        if (!existingRecord) {
          // Find the original property data
          const validationIssue = processingResults.validationIssues.find(issue => issue.composite_key === propertyKey);
          if (validationIssue) {
            finalInspectionBatch.push({
              job_id: jobData.id,
              file_version: latestFileVersion,
              property_composite_key: propertyKey,
              block: validationIssue.block,
              lot: validationIssue.lot,
              qualifier: validationIssue.qualifier || '',
              card: validationIssue.card || '1',
              property_location: validationIssue.property_location || '',
              property_class: 'UNKNOWN', // We'd need to track this
              project_start_date: projectStartDate,
              upload_date: new Date().toISOString(),
              ...pendingOverrides[propertyKey]
            });
          }
        }
      });

      // UPSERT to inspection_data table
      if (finalInspectionBatch.length > 0) {
        debugLog('PERSISTENCE', `Upserting ${finalInspectionBatch.length} records to inspection_data (includes ${Object.keys(pendingOverrides).length} overrides)`);
        
        const { error: upsertError } = await supabase
          .from('inspection_data')
          .upsert(finalInspectionBatch, {
            onConflict: 'job_id,property_composite_key,file_version'
          });

        if (upsertError) {
          console.error('Error upserting to inspection_data:', upsertError);
          addNotification('Warning: Could not save to inspection_data table', 'warning');
        } else {
          debugLog('PERSISTENCE', '✅ Successfully upserted to inspection_data');
        }
      }

      // Update analytics with override counts
      const finalAnalytics = {
        ...analyticsResult,
        validInspections: analyticsResult.validInspections + Object.keys(pendingOverrides).length,
        validationOverrideCount: Object.keys(pendingOverrides).length
      };

      // Recalculate entry/refusal rates if overrides affect residential properties
      // This is simplified - in production you'd track which class each override affects

      // Save complete analytics
      await saveCompleteAnalytics(
        finalAnalytics,
        billingResult,
        validationReportData,
        missingPropertiesReportData,
        pendingOverrides
      );

      // Update local state
      setAnalytics(finalAnalytics);
      setBillingAnalytics(billingResult);
      setValidationReport(validationReportData);
      setMissingPropertiesReport(missingPropertiesReportData);
      setValidationOverrides(Object.values(pendingOverrides));
      setOverrideMap(pendingOverrides);

      // Reload commercial counts
      await loadCommercialCounts();

      setProcessingProgress(100);
      setProcessingStage('Processing complete!');
      
      setTimeout(() => {
        setShowProcessingModal(false);
        setProcessed(true);
        addNotification(`✅ Processing completed! ${finalAnalytics.validInspections} valid inspections (includes ${Object.keys(pendingOverrides).length} overrides)`, 'success');
      }, 1000);

    } catch (error) {
      console.error('Error completing processing:', error);
      addNotification('Error completing processing: ' + error.message, 'error');
      setShowProcessingModal(false);
    }
  };

  // NEW: Start processing session with modal
  const startProcessingSession = async () => {
    if (!isDateLocked) {
      addNotification('Please lock the project start date first', 'error');
      return;
    }

    if (hasUnsavedChanges) {
      addNotification('Please save InfoBy category configuration first', 'error');
      return;
    }

    const allValidCodes = [
      ...infoByCategoryConfig.entry,
      ...infoByCategoryConfig.refusal,
      ...infoByCategoryConfig.estimation,
      ...infoByCategoryConfig.priced,
      ...infoByCategoryConfig.special
    ];

    if (allValidCodes.length === 0) {
      addNotification('Please configure InfoBy categories first', 'error');
      return;
    }

    const newSessionId = crypto.randomUUID();
    setSessionId(newSessionId);
    setSettingsLocked(true);
    setProcessing(true);
    setProcessed(false);
    setShowProcessingModal(true);
    setPendingOverrides({});
    setPendingValidationIssues([]);

    try {
      debugLog('SESSION', 'Starting processing session', { 
        sessionId: newSessionId,
        startDate: projectStartDate,
        categoryConfig: infoByCategoryConfig 
      });

      const results = await processAnalytics();
      if (!results) {
        throw new Error('Analytics processing failed');
      }

      setProcessingResults(results);
      
      // If there are validation issues, show them in the modal
      if (results.validationIssues && results.validationIssues.length > 0) {
        setPendingValidationIssues(results.validationIssues);
        setProcessingStage('Review validation issues');
        setProcessingProgress(100);
      } else {
        // No validation issues, complete immediately
        await completeProcessingWithOverrides();
      }

    } catch (error) {
      console.error('Error in processing session:', error);
      addNotification('Processing session failed: ' + error.message, 'error');
      setSettingsLocked(false);
      setSessionId(null);
      setShowProcessingModal(false);
    } finally {
      setProcessing(false);
    }
  };

  const exportValidationReport = () => {
    if (!validationReport || !validationReport.detailed_issues) return;

    let csvContent = "Inspector,Total Issues,Inspector Name\n";
    
    validationReport.summary.inspector_breakdown.forEach(inspector => {
      csvContent += `"${inspector.inspector_code}","${inspector.total_issues}","${inspector.inspector_name}"\n`;
    });

    csvContent += "\n\nDetailed Issues:\n";
    csvContent += "Inspector,Block,Lot,Qualifier,Card,Property Location,Warning Message\n";
    
    Object.keys(validationReport.detailed_issues).forEach(inspector => {
      const issues = validationReport.detailed_issues[inspector];
      issues.forEach(issue => {
        csvContent += `"${inspector}","${issue.block}","${issue.lot}","${issue.qualifier}","${issue.card}","${issue.property_location}","${issue.warning_message}"\n`;
      });
    });

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Inspection_Validation_Report_${jobData.ccdd || jobData.ccddCode}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    addNotification('📊 Validation report exported', 'success');
  };

  const exportMissingPropertiesReport = () => {
    if (!missingPropertiesReport || !missingPropertiesReport.detailed_missing) return;

    let csvContent = "Summary\n";
    csvContent += `Total Missing Properties,${missingPropertiesReport.summary.total_missing}\n`;
    csvContent += `Uninspected Count,${missingPropertiesReport.summary.uninspected_count}\n`;
    csvContent += `Validation Failed Count,${missingPropertiesReport.summary.validation_failed_count}\n\n`;

    csvContent += "Breakdown by Reason\n";
    csvContent += "Reason,Count\n";
    Object.entries(missingPropertiesReport.summary.by_reason).forEach(([reason, count]) => {
      csvContent += `"${reason}","${count}"\n`;
    });

    csvContent += "\nBreakdown by Inspector\n";
    csvContent += "Inspector,Count\n";
    Object.entries(missingPropertiesReport.summary.by_inspector).forEach(([inspector, count]) => {
      csvContent += `"${inspector}","${count}"\n`;
    });

    csvContent += "\nDetailed Missing Properties\n";
    csvContent += "Block,Lot,Qualifier,Card,Property Location,Class,Inspector,InfoBy Code,Measure Date,Reason\n";
    
    missingPropertiesReport.detailed_missing.forEach(property => {
      csvContent += `"${property.block}","${property.lot}","${property.qualifier}","${property.card || '1'}","${property.property_location}","${property.property_class}","${property.inspector}","${property.info_by_code || ''}","${property.measure_date || ''}","${property.reason}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Missing_Properties_Report_${jobData.ccdd || jobData.ccddCode}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    addNotification('📊 Missing properties report exported', 'success');
  };

  // ENHANCED: Progress bar component
  const ProgressBar = ({ current, total, color = 'blue' }) => {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    const colorClasses = {
      blue: 'bg-blue-500',
      green: 'bg-green-500',
      purple: 'bg-purple-500',
      gray: 'bg-gray-500'
    };

    return (
      <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
        <div 
          className={`${colorClasses[color]} h-2 rounded-full transition-all duration-500 ease-out`}
          style={{ width: `${percentage}%` }}
        ></div>
        <div className="text-xs text-gray-500 mt-1 text-right">{percentage}%</div>
      </div>
    );
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
