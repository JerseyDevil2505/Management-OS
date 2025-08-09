import React, { useRef } from 'react';
import { 
  AlertCircle, 
  RefreshCw,
  Download,
  Check,
  X,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';

const DataQualityTab = ({ 
  // Props from parent
  properties,
  jobData,
  vendorType,
  codeDefinitions,
  isLoading,
  loadingProgress,
  loadedCount,
  totalPropertyCount,
  
  // State and functions from parent
  checkResults,
  setCheckResults,
  qualityScore,
  setQualityScore,
  issueStats,
  setIssueStats,
  customChecks,
  setCustomChecks,
  currentCustomCheck,
  setCurrentCustomCheck,
  runHistory,
  setRunHistory,
  dataQualityActiveSubTab,
  setDataQualityActiveSubTab,
  availableFields,
  expandedCategories,
  setExpandedCategories,
  isRunningChecks,
  setIsRunningChecks,
  showDetailsModal,
  setShowDetailsModal,
  modalData,
  setModalData,
  
  // Functions from parent
  runQualityChecks,
  exportToExcel,
  getCheckTitle,
  showPropertyDetails,
  toggleQualityCategory,
  saveCustomChecksToDb
}) => {

  // Refs for uncontrolled inputs (the fix we just did!)
  const customCheckNameInputRef = useRef(null);
  const customCheckSeveritySelectRef = useRef(null);

  // Custom check functions (moved from parent)
  const addConditionToCustomCheck = () => {
    setCurrentCustomCheck(prev => ({
      ...prev,
      conditions: [...prev.conditions, { logic: 'AND', field: '', operator: '=', value: '' }]
    }));
  };
  
  const updateCustomCheckCondition = (index, field, value) => {
    setCurrentCustomCheck(prev => ({
      ...prev,
      conditions: prev.conditions.map((cond, i) => 
        i === index ? { ...cond, [field]: value } : cond
      )
    }));
  };
  
  const removeCustomCheckCondition = (index) => {
    setCurrentCustomCheck(prev => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== index)
    }));
  };
  
  const saveCustomCheck = () => {
    const checkName = customCheckNameInputRef.current?.value;
    const checkSeverity = customCheckSeveritySelectRef.current?.value;
    
    if (!checkName || currentCustomCheck.conditions.some(c => !c.field)) {
      alert('Please complete all fields before saving');
      return;
    }
    
    const newCheck = {
      ...currentCustomCheck,
      name: checkName,
      severity: checkSeverity,
      id: Date.now()
    };
    
    setCustomChecks(prev => [...prev, newCheck]);
    
    // Reset the form
    customCheckNameInputRef.current.value = '';
    customCheckSeveritySelectRef.current.value = 'warning';
    setCurrentCustomCheck({
      name: '',
      severity: 'warning',
      conditions: [{ logic: 'IF', field: '', operator: '=', value: '' }]
    });
    
    // Save to database
    saveCustomChecksToDb([...customChecks, newCheck]);
  };
  
  const deleteCustomCheck = (checkId) => {
    setCustomChecks(prev => prev.filter(check => check.id !== checkId));
    saveCustomChecksToDb(customChecks.filter(check => check.id !== checkId));
  };
  
  const runCustomCheck = async (check) => {
    const results = { custom: [] };
    
    for (const property of properties) {
      let conditionMet = true;
      
      for (let i = 0; i < check.conditions.length; i++) {
        const condition = check.conditions[i];
            
        // Handle raw_data fields
        let fieldValue;
        if (condition.field.startsWith('raw_data.')) {
          const rawFieldName = condition.field.replace('raw_data.', '');
          fieldValue = property.raw_data ? property.raw_data[rawFieldName] : null;
        } else {
          fieldValue = property[condition.field];
        }
        const compareValue = condition.value;
        let thisConditionMet = false;
        
        switch (condition.operator) {
          case '=':
            thisConditionMet = fieldValue == compareValue;
            break;
          case '!=':
            thisConditionMet = fieldValue != compareValue;
            break;
          case '>':
            thisConditionMet = parseFloat(fieldValue) > parseFloat(compareValue);
            break;
          case '<':
            thisConditionMet = parseFloat(fieldValue) < parseFloat(compareValue);
            break;
          case '>=':
            thisConditionMet = parseFloat(fieldValue) >= parseFloat(compareValue);
            break;
          case '<=':
            thisConditionMet = parseFloat(fieldValue) <= parseFloat(compareValue);
            break;
          case 'is null':
            thisConditionMet = !fieldValue || fieldValue === '';
            break;
          case 'is not null':
            thisConditionMet = fieldValue && fieldValue !== '';
            break;
          case 'contains':
            thisConditionMet = fieldValue && fieldValue.toString().toLowerCase().includes(compareValue.toLowerCase());
            break;
          case 'is one of':
            const validValues = compareValue.split(',').map(v => v.trim());
            thisConditionMet = validValues.includes(fieldValue);
            break;
          case 'is not one of':
            const invalidValues = compareValue.split(',').map(v => v.trim());
            thisConditionMet = !invalidValues.includes(fieldValue);
            break;
        }
        
        if (i === 0) {
          conditionMet = thisConditionMet;
        } else {
          if (condition.logic === 'AND') {
            conditionMet = conditionMet && thisConditionMet;
          } else if (condition.logic === 'OR') {
            conditionMet = conditionMet || thisConditionMet;
          }
        }
      }
      
      if (conditionMet) {
        results.custom.push({
          check: `custom_${check.id}`,
          severity: check.severity,
          property_key: property.property_composite_key,
          message: check.name,
          details: property
        });
      }
    }
    
    // Merge with existing results
    setCheckResults(prev => ({
      ...prev,
      custom: [...(prev.custom || []), ...results.custom]
    }));
    
    // Update stats
    const newStats = {
      critical: results.custom.filter(i => i.severity === 'critical').length,
      warning: results.custom.filter(i => i.severity === 'warning').length,
      info: results.custom.filter(i => i.severity === 'info').length,
      total: results.custom.length
    };
    
    setIssueStats(prev => ({
      critical: prev.critical + newStats.critical,
      warning: prev.warning + newStats.warning,
      info: prev.info + newStats.info,
      total: prev.total + newStats.total
    }));
    
    console.log(`✅ Custom check "${check.name}" found ${results.custom.length} issues`);
  };
  
  const runAllCustomChecks = async () => {
    // Clear existing custom results
    setCheckResults(prev => ({ ...prev, custom: [] }));
    
    for (const check of customChecks) {
      await runCustomCheck(check);
    }
  };

  return (
    <div className="tab-content">
      {/* Sub-tab Navigation */}
      <div className="flex gap-1 border-b border-gray-300 mb-6">
        <button
          onClick={() => setDataQualityActiveSubTab('overview')}
          className={`px-4 py-2 font-medium text-sm transition-all ${
            dataQualityActiveSubTab === 'overview'
              ? 'border-b-2 border-blue-500 text-blue-600 -mb-[1px] bg-blue-50'
              : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setDataQualityActiveSubTab('standard')}
          className={`px-4 py-2 font-medium text-sm transition-all ${
            dataQualityActiveSubTab === 'standard'
              ? 'border-b-2 border-blue-500 text-blue-600 -mb-[1px] bg-blue-50'
              : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
          }`}
        >
          Standard Checks
        </button>
        <button
          onClick={() => setDataQualityActiveSubTab('custom')}
          className={`px-4 py-2 font-medium text-sm transition-all ${
            dataQualityActiveSubTab === 'custom'
              ? 'border-b-2 border-blue-500 text-blue-600 -mb-[1px] bg-blue-50'
              : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
          }`}
        >
          Custom Checks
        </button>
        <button
          onClick={() => setDataQualityActiveSubTab('history')}
          className={`px-4 py-2 font-medium text-sm transition-all ${
            dataQualityActiveSubTab === 'history'
              ? 'border-b-2 border-blue-500 text-blue-600 -mb-[1px] bg-blue-50'
              : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
          }`}
        >
          Run History
        </button>
      </div>
      
      {/* Sub-tab Content */}
      {dataQualityActiveSubTab === 'overview' && (
        <div>
          {/* Header Section */}
          <div className="mb-6">
            <h3 className="text-2xl font-bold text-gray-800 mb-2">
              Data Quality Analysis
            </h3>
            <p className="text-gray-600">
              {isLoading 
                ? `Loading ${loadedCount.toLocaleString()} of ${totalPropertyCount.toLocaleString()} properties...`
                : `Analyzing ${properties.length.toLocaleString()} properties for data integrity issues`
              }
            </p>
          </div>

          {/* Loading Progress Bar */}
          {isLoading && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Loading Properties</span>
                <span className="text-sm font-medium text-blue-600">{loadingProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 ease-out"
                  style={{ width: `${loadingProgress}%` }}
                >
                  <div className="h-full bg-white bg-opacity-30 animate-pulse"></div>
                </div>
              </div>
              <div className="mt-2 text-center text-sm text-gray-600">
                {loadedCount > 0 && (
                  <span>
                    Loaded {loadedCount.toLocaleString()} properties
                    {loadedCount < totalPropertyCount && 
                      ` • ${Math.ceil((totalPropertyCount - loadedCount) / 1000)} batches remaining`
                    }
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 mb-6">
            <button 
              onClick={runQualityChecks}
              disabled={isRunningChecks || isLoading}
              className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-all ${
                isRunningChecks || isLoading
                  ? 'bg-gray-400 text-white cursor-not-allowed' 
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              <RefreshCw size={16} className={isRunningChecks ? 'animate-spin' : ''} />
              {isRunningChecks ? 'Running Analysis...' : 'Run Analysis'}
            </button>
            
            <button 
              onClick={exportToExcel}
              disabled={Object.keys(checkResults).length === 0}
              className={`px-4 py-2 bg-white border-2 border-blue-600 text-blue-600 rounded-lg font-medium hover:bg-blue-50 transition-all flex items-center gap-2 ${
                Object.keys(checkResults).length === 0 ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <Download size={16} />
              Export to Excel
            </button>
          </div>

          {/* Metrics Cards Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Properties</div>
              <div className="text-2xl font-bold text-gray-800">{properties.length.toLocaleString()}</div>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Properties with Issues</div>
              <div className="text-2xl font-bold text-red-600">{issueStats.total}</div>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Critical Issues</div>
              <div className="text-2xl font-bold text-red-600">{issueStats.critical}</div>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Warnings</div>
              <div className="text-2xl font-bold text-yellow-600">{issueStats.warning}</div>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Info Messages</div>
              <div className="text-2xl font-bold text-blue-600">{issueStats.info}</div>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4 bg-gradient-to-br from-green-50 to-green-100">
              <div className="text-xs text-gray-600 uppercase tracking-wide mb-1">Data Quality Score</div>
              <div className="text-2xl font-bold text-green-700">{qualityScore ? `${qualityScore}%` : '—'}</div>
            </div>
          </div>
        </div>
      )}
      
      {/* Standard Checks Tab */}
      {dataQualityActiveSubTab === 'standard' && (
        <div>
          {/* Check Results */}
          {Object.keys(checkResults).length > 0 ? (
            <div>
              <h4 className="text-lg font-semibold text-gray-800 mb-4">
                Check Results by Category
              </h4>
              
              {Object.entries(checkResults).map(([category, issues]) => {
                // Add null check and skip empty categories
                if (!issues || issues.length === 0) return null;
                
                const isExpanded = expandedCategories.includes(category);
                const criticalCount = issues.filter(i => i.severity === 'critical').length;
                const warningCount = issues.filter(i => i.severity === 'warning').length;
                const infoCount = issues.filter(i => i.severity === 'info').length;
                const uniquePropertiesWithIssues = new Set(issues.map(i => i.property_key)).size;
                const passCount = properties.length - uniquePropertiesWithIssues;
                
                return (
                  <div key={category} className="bg-white border border-gray-200 rounded-lg mb-3 overflow-hidden">
                    <div
                      onClick={() => toggleQualityCategory(category)}
                      className="p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors flex justify-between items-center"
                    >
                      <div className="flex items-center gap-2">
                        <ChevronRight
                          size={20}
                          className={`text-gray-500 transform transition-transform ${
                            isExpanded ? 'rotate-90' : ''
                          }`}
                        />
                        <span className="font-semibold text-gray-800 capitalize">
                          {category.replace(/_/g, ' ')} Checks ({issues.length} issues)
                        </span>
                      </div>
                      
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        {criticalCount > 0 && (
                          <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                            {criticalCount} Critical
                          </span>
                        )}
                        {warningCount > 0 && (
                          <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-semibold">
                            {warningCount} Warning
                          </span>
                        )}
                        {infoCount > 0 && (
                          <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                            {infoCount} Info
                          </span>
                        )}
                        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                          {passCount.toLocaleString()} Pass
                        </span>
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="p-4 border-t border-gray-200">
                        {Object.entries(
                          issues.reduce((acc, issue) => {
                            if (!acc[issue.check]) acc[issue.check] = [];
                            acc[issue.check].push(issue);
                            return acc;
                          }, {})
                        ).map(([checkType, checkIssues]) => (
                          <div
                            key={checkType}
                            className="p-3 bg-gray-50 rounded-lg mb-2 flex justify-between items-center"
                          >
                            <span className="text-sm text-gray-700">
                              {getCheckTitle(checkType)}
                            </span>
                            <div className="flex items-center gap-3">
                              <span className={`text-sm font-semibold ${
                                checkIssues[0].severity === 'critical' ? 'text-red-600' :
                                checkIssues[0].severity === 'warning' ? 'text-yellow-600' : 
                                'text-blue-600'
                              }`}>
                                {checkIssues.length} properties
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  showPropertyDetails(checkType, category);
                                }}
                                className="px-3 py-1 text-xs bg-white border border-blue-600 text-blue-600 rounded hover:bg-blue-50 transition-colors"
                              >
                                View Details
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
              <AlertCircle size={48} className="text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-800 mb-2">
                No Analysis Run Yet
              </h3>
              <p className="text-gray-600">
                Click "Run Analysis" in the Overview tab to check for data quality issues.
              </p>
            </div>
          )}
        </div>
      )}
      
      {/* Custom Checks Tab */}
      {dataQualityActiveSubTab === 'custom' && (
        <div>
          <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Custom Check Builder</h3>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Check Name</label>
                  <input 
                    ref={customCheckNameInputRef}
                    type="text"
                    placeholder="e.g., Missing Tax ID for Commercial"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Severity</label>
                  <select 
                    ref={customCheckSeveritySelectRef}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    defaultValue="warning"
                    onClick={(e) => e.stopPropagation()}
                  >  
                    <option value="critical">Critical</option>
                    <option value="warning">Warning</option>
                    <option value="info">Info</option>
                  </select>
                </div>
              </div>
              
              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Conditions</label>
                {currentCustomCheck.conditions.map((condition, index) => (
                  <div key={index} className="flex gap-2 items-center mb-2">
                    <select 
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      value={condition.logic}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateCustomCheckCondition(index, 'logic', e.target.value)}
                      disabled={index === 0}
                    >
                      <option>IF</option>
                      <option>AND</option>
                      <option>OR</option>
                    </select>
                    
                    <select 
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1"
                      value={condition.field}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateCustomCheckCondition(index, 'field', e.target.value)}
                    >
                      <option value="">-- Select Field --</option>
                      
                      <optgroup label="Property Identification">
                        <option value="property_block">Block</option>
                        <option value="property_lot">Lot</option>
                        <option value="property_qualifier">Qualifier</option>
                        <option value="property_card">Card</option>
                        <option value="property_location">Location</option>
                        <option value="property_m4_class">M4 Class</option>
                        <option value="property_cama_class">CAMA Class</option>
                        <option value="property_vcs">VCS Code</option>
                        <option value="property_facility">Facility</option>
                      </optgroup>
                      
                      <optgroup label="Values">
                        <option value="values_mod_improvement">Mod Improvement</option>
                        <option value="values_mod_land">Mod Land</option>
                        <option value="values_mod_total">Mod Total</option>
                        <option value="values_cama_improvement">CAMA Improvement</option>
                        <option value="values_cama_land">CAMA Land</option>
                        <option value="values_cama_total">CAMA Total</option>
                        <option value="values_norm_time">Normalized Time Value</option>
                        <option value="values_norm_size">Normalized Size Value</option>
                      </optgroup>
                      
                      <optgroup label="Asset Information">
                        <option value="asset_building_class">Building Class</option>
                        <option value="asset_design_style">Design Style</option>
                        <option value="asset_type_use">Type Use</option>
                        <option value="asset_sfla">Living Area (SFLA)</option>
                        <option value="asset_year_built">Year Built</option>
                        <option value="asset_lot_acre">Lot Acres</option>
                        <option value="asset_lot_sf">Lot Square Feet</option>
                        <option value="asset_lot_frontage">Lot Frontage</option>
                        <option value="asset_ext_cond">Exterior Condition</option>
                        <option value="asset_int_cond">Interior Condition</option>
                        <option value="asset_zoning">Zoning</option>
                        <option value="asset_map_page">Map Page</option>
                        <option value="asset_key_page">Key Page</option>
                      </optgroup>
                      
                      <optgroup label="Sale Information">
                        <option value="sale_date">Sale Date</option>
                        <option value="sale_price">Sale Price</option>
                        <option value="sale_nu">Sale NU</option>
                        <option value="sale_book">Sale Book</option>
                        <option value="sale_page">Sale Page</option>
                      </optgroup>
                      
                      <optgroup label="Market Analysis">
                        <option value="location_analysis">Location Analysis</option>
                        <option value="newVCS">New VCS</option>
                      </optgroup>
                      
                      {availableFields.length > 0 && (
                        <optgroup label={`Raw Data Fields (${vendorType || 'Vendor'})`}>
                          {availableFields.map(field => (
                            <option key={field} value={`raw_data.${field}`}>
                              {field}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>

                    <select 
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      value={condition.operator}
                      onChange={(e) => updateCustomCheckCondition(index, 'operator', e.target.value)}
                    >
                      <option value="=">=</option>
                      <option value="!=">!=</option>
                      <option value=">">&gt;</option>
                      <option value="<">&lt;</option>
                      <option value=">=">&gt;=</option>
                      <option value="<=">&lt;=</option>
                      <option value="is null">is null</option>
                      <option value="is not null">is not null</option>
                      <option value="contains">contains</option>
                      <option value="is one of">is one of</option>
                      <option value="is not one of">is not one of</option>
                    </select>
                    
                    <input 
                      type="text" 
                      placeholder="Value"
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1"
                      value={condition.value}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateCustomCheckCondition(index, 'value', e.target.value);
                      }}
                      disabled={condition.operator === 'is null' || condition.operator === 'is not null'}
                    />      
                    
                    <button 
                      type="button"
                      className="p-2 text-red-500 hover:bg-red-50 rounded"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCustomCheckCondition(index);
                      }}
                      disabled={currentCustomCheck.conditions.length === 1}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
                
                <button
                  type="button"
                  className="text-blue-600 text-sm hover:text-blue-700 mt-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    addConditionToCustomCheck();
                  }}
                >
                  + Add Condition
                </button>
              </div>
              
              <div className="flex justify-end gap-2 pt-4 border-t">
                <button
                  type="button" 
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    saveCustomCheck();
                  }}
                >
                  Save Custom Check
                </button>
              </div>
            </div>
          </div>
          
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Saved Custom Checks</h3>
              {customChecks.length > 0 && (
                <button
                  type="button"
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    runAllCustomChecks();
                  }}
                >
                  Run All Custom Checks
                </button>
              )}
            </div>
            
            {customChecks.length > 0 ? (
              <div className="space-y-2">
                {customChecks.map((check) => (
                  <div key={check.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <div className="font-medium text-gray-800">{check.name}</div>
                      <div className="text-sm text-gray-600">
                        {check.conditions.length} condition{check.conditions.length !== 1 ? 's' : ''} • 
                        <span className={`ml-1 font-medium ${
                          check.severity === 'critical' ? 'text-red-600' :
                          check.severity === 'warning' ? 'text-yellow-600' :
                          'text-blue-600'
                        }`}>
                          {check.severity}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          runCustomCheck(check);
                        }}
                      >
                        Run
                      </button>
                      <button
                        type="button" 
                        className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteCustomCheck(check.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">No custom checks saved yet</p>
            )}
          </div>
        </div>
      )}
      
      {/* Run History Tab */}
      {dataQualityActiveSubTab === 'history' && (
        <div>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Run Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Properties Analyzed
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Issues Found
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quality Score
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {runHistory.length > 0 ? (
                  runHistory.map((run, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {new Date(run.date).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {run.propertyCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="text-red-600 font-medium">{run.criticalCount}</span> Critical,{' '}
                        <span className="text-yellow-600 font-medium">{run.warningCount}</span> Warning,{' '}
                        <span className="text-blue-600 font-medium">{run.infoCount}</span> Info
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="font-medium text-green-600">{run.qualityScore}%</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" className="px-4 py-8 text-center text-gray-500">
                      No analysis runs yet. Run an analysis to see history.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataQualityTab;
