import React, { useState, useEffect, useMemo } from 'react';
import { Calculator, Download, FileSpreadsheet } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import * as XLSX from 'xlsx-js-style';

const RatableComparisonTab = ({ jobData, properties, onUpdateJobCache }) => {
  const [activeSubTab, setActiveSubTab] = useState('comparison');
  const [saveStatus, setSaveStatus] = useState(''); // 'saving' or 'saved'

  // Calculate years for ratable comparison
  // If end_date = '2026-01-01': yearPriorToDueYear = 2025
  const yearPriorToDueYear = useMemo(() => {
    if (!jobData?.end_date) return new Date().getFullYear();
    // Extract year directly from date string to avoid timezone issues
    const endYear = parseInt(jobData.end_date.substring(0, 4));
    return endYear - 1;
  }, [jobData?.end_date]);

  // Calculate current year totals based on individual class values
  const currentYearCalculatedTotals = useMemo(() => {
    const totalCount = (jobData?.current_class_1_count || 0) +
                       (jobData?.current_class_2_count || 0) +
                       (jobData?.current_class_3a_count || 0) +
                       (jobData?.current_class_3b_count || 0) +
                       (jobData?.current_class_4_count || 0) +
                       (jobData?.current_class_6_count || 0);

    const totalTotal = (jobData?.current_class_1_total || 0) +
                       (jobData?.current_class_2_total || 0) +
                       (jobData?.current_class_3a_total || 0) +
                       (jobData?.current_class_3b_total || 0) +
                       (jobData?.current_class_4_total || 0);

    const commercialBasePct = totalTotal > 0
      ? ((jobData?.current_class_4_total || 0) / totalTotal) * 100
      : 0;

    return { totalCount, totalTotal, commercialBasePct };
  }, [jobData]);

  // Use jobData directly for current year and rate calculator data
  const currentYearData = useMemo(() => ({
    class_1_count: jobData?.current_class_1_count || 0,
    class_1_total: jobData?.current_class_1_total || 0,
    class_1_abatements: jobData?.current_class_1_abatements || 0,
    class_2_count: jobData?.current_class_2_count || 0,
    class_2_total: jobData?.current_class_2_total || 0,
    class_2_abatements: jobData?.current_class_2_abatements || 0,
    class_3a_count: jobData?.current_class_3a_count || 0,
    class_3a_total: jobData?.current_class_3a_total || 0,
    class_3b_count: jobData?.current_class_3b_count || 0,
    class_3b_total: jobData?.current_class_3b_total || 0,
    class_4_count: jobData?.current_class_4_count || 0,
    class_4_total: jobData?.current_class_4_total || 0,
    class_4_abatements: jobData?.current_class_4_abatements || 0,
    class_6_count: jobData?.current_class_6_count || 0,
    class_6_total: jobData?.current_class_6_total || 0,
    total_count: currentYearCalculatedTotals.totalCount,
    total_total: currentYearCalculatedTotals.totalTotal,
    commercial_base_pct: currentYearCalculatedTotals.commercialBasePct
  }), [jobData]);

  const rateCalcData = useMemo(() => ({
    budget: jobData?.rate_calc_budget || 0,
    currentRate: jobData?.rate_calc_current_rate || 0,
    bufferForLoss: jobData?.rate_calc_buffer_for_loss || 0
  }), [jobData]);

  // Calculate projected ratable base from properties (using CAMA total)
  const projectedRatableBase = useMemo(() => {
    const summary = {
      '1': { count: 0, total: 0 },
      '2': { count: 0, total: 0 },
      '3A': { count: 0, total: 0 },
      '3B': { count: 0, total: 0 },
      '4ABC': { count: 0, total: 0 },
      '6ABC': { count: 0, total: 0 }
    };

    properties.forEach(property => {
      const isTaxable = property.property_facility !== 'EXEMPT';
      if (!isTaxable) return;

      const camaTotal = property.values_cama_total || 0;
      const propertyClass = property.property_cama_class || '';

      if (propertyClass === '1') {
        summary['1'].count++;
        summary['1'].total += camaTotal;
      } else if (propertyClass === '2') {
        summary['2'].count++;
        summary['2'].total += camaTotal;
      } else if (propertyClass === '3A') {
        summary['3A'].count++;
        summary['3A'].total += camaTotal;
      } else if (propertyClass === '3B') {
        summary['3B'].count++;
        summary['3B'].total += camaTotal;
      } else if (['4A', '4B', '4C'].includes(propertyClass)) {
        summary['4ABC'].count++;
        summary['4ABC'].total += camaTotal;
      } else if (['6A', '6B'].includes(propertyClass)) {
        summary['6ABC'].count++;
        summary['6ABC'].total += camaTotal;
      }
    });

    const totalCount = Object.values(summary).reduce((sum, item) => sum + item.count, 0);
    const totalTotal = Object.values(summary).reduce((sum, item) => sum + item.total, 0);

    return { ...summary, totalCount, totalTotal };
  }, [properties]);

  // Handle current year data input changes with save feedback
  const handleCurrentYearChange = async (field, value) => {
    const numValue = parseFloat(value.replace(/,/g, '')) || 0;

    try {
      setSaveStatus('saving');
      const updateData = { [field]: numValue };

      const { error } = await supabase
        .from('jobs')
        .update(updateData)
        .eq('id', jobData.id);

      if (error) throw error;

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 2000); // Clear after 2 seconds

      if (onUpdateJobCache) onUpdateJobCache();
    } catch (error) {
      console.error('Error saving current year data:', error);
      setSaveStatus('');
      alert('Error saving data: ' + error.message);
    }
  };

  // Handle rate calc input changes with save feedback
  const handleRateCalcChange = async (field, value) => {
    const numValue = parseFloat(value) || 0;

    try {
      setSaveStatus('saving');
      const updateData = {};
      if (field === 'budget') updateData.rate_calc_budget = numValue;
      if (field === 'currentRate') updateData.rate_calc_current_rate = numValue;
      if (field === 'bufferForLoss') updateData.rate_calc_buffer_for_loss = numValue;

      const { error } = await supabase
        .from('jobs')
        .update(updateData)
        .eq('id', jobData.id);

      if (error) throw error;

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 2000); // Clear after 2 seconds

      if (onUpdateJobCache) onUpdateJobCache();
    } catch (error) {
      console.error('Error saving rate calc data:', error);
      setSaveStatus('');
      alert('Error saving data: ' + error.message);
    }
  };

  // Export all data to Excel
  const exportToExcel = () => {
    const workbook = XLSX.utils.book_new();

    // Sheet 1: Ratable Comparison
    const comparisonData = [
      ['Ratable Base Comparison'],
      [],
      ['Current Ratable Base', '', '', '', 'Projected Ratable Base', '', '', '', 'DIFFERENCE'],
      ['', 'Count', 'AVG ASMT', 'AVG TAX', '', 'Count', 'AVG ASMT', 'AVG TAX', ''],
      ['Class 1', currentYearData.class_1_count, '', '', 'Class 1', projectedRatableBase['1'].count, '', '', ''],
      ['Abatements', currentYearData.class_1_abatements, '', '', 'Abatements', 0, '', '', ''],
      ['Adjusted Abatements', 0, '', '', 'Adjusted Abatements', 0, '', '', ''],
      ['', '', currentYearData.class_1_total, '', '', '', projectedRatableBase['1'].total, '', ''],
      ['Class 2', currentYearData.class_2_count, '', '', 'Class 2', projectedRatableBase['2'].count, '', '', ''],
      ['Abatements', currentYearData.class_2_abatements, '', '', 'Abatements', 0, '', '', ''],
      ['Adjusted Abatements', 0, '', '', 'Adjusted Abatements', 0, '', '', ''],
      ['', '', currentYearData.class_2_total, '', '', '', projectedRatableBase['2'].total, '', ''],
      ['Class 3A\'s', currentYearData.class_3a_count, '', '', 'Class 3A\'s', projectedRatableBase['3A'].count, '', '', ''],
      ['Class 3A\'s (NET)', '', currentYearData.class_3a_total, '', 'Class 3A\'s (NET)', '', projectedRatableBase['3A'].total, '', ''],
      ['Class 3B\'s', currentYearData.class_3b_count, '', '', 'Class 3B\'s', projectedRatableBase['3B'].count, '', '', ''],
      ['Class 4A,B,C', currentYearData.class_4_count, '', '', 'Class 4A,B,C', projectedRatableBase['4ABC'].count, '', '', ''],
      ['Abatements', currentYearData.class_4_abatements, '', '', 'Abatements', 0, '', '', ''],
      ['Adjusted Abatements', 0, '', '', 'Adjusted Abatements', 0, '', '', ''],
      ['Class 4\'s (NET)', '', currentYearData.class_4_total, '', 'Class 4\'s (NET)', '', projectedRatableBase['4ABC'].total, '', ''],
      ['6A,B,C', currentYearData.class_6_count, '0 (Not/After Ratio Applied)', '', '6A,B,C', projectedRatableBase['6ABC'].count, '0 (Not/After Ratio Applied)', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['Total Ratables', currentYearData.total_count, currentYearData.total_total, '', 'Total Ratables', projectedRatableBase.totalCount, projectedRatableBase.totalTotal, '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['Commercial Base', '', currentYearData.commercial_base_pct, '', 'Commercial Base', '', '', '', '']
    ];

    const ws1 = XLSX.utils.aoa_to_sheet(comparisonData);
    XLSX.utils.book_append_sheet(workbook, ws1, 'Ratable Comparison');

    // Sheet 2: Rate Calculator
    const netRatables = projectedRatableBase.totalTotal * (1 - rateCalcData.bufferForLoss / 100);
    const estimatedRate = netRatables > 0 ? rateCalcData.budget / netRatables : 0;

    const rateCalcDataSheet = [
      ['Tax Rate Calculator'],
      [],
      ['BUDGET', rateCalcData.budget],
      ['CURRENT RATE', rateCalcData.currentRate],
      [],
      ['Class 1\'s', projectedRatableBase['1'].total],
      ['Abatements', 0],
      ['Adjusted Abatements', 0],
      ['', projectedRatableBase['1'].total],
      [],
      ['Class 2\'s', projectedRatableBase['2'].total],
      ['Abatements', 0],
      ['Adjusted Abatements', 0],
      ['', projectedRatableBase['2'].total],
      [],
      ['Class 3A\'s', projectedRatableBase['3A'].total],
      ['Abatements', 0],
      ['Adjusted Abatements', 0],
      ['', projectedRatableBase['3A'].total],
      [],
      ['Class 3B\'s', projectedRatableBase['3B'].total],
      [],
      ['Class 4A,B,C', projectedRatableBase['4ABC'].total],
      ['Abatements', 0],
      ['Adjusted Abatements', 0],
      ['', projectedRatableBase['4ABC'].total],
      [],
      ['6A,B,C', projectedRatableBase['6ABC'].total],
      [],
      ['Total Ratables', projectedRatableBase.totalTotal],
      ['Buffer for Loss', rateCalcData.bufferForLoss + '%', rateCalcData.bufferForLoss > 0 ? projectedRatableBase.totalTotal * (rateCalcData.bufferForLoss / 100) : 0],
      ['Net Ratables', netRatables],
      [],
      ['Estimated Rate', estimatedRate.toFixed(3)]
    ];

    const ws2 = XLSX.utils.aoa_to_sheet(rateCalcDataSheet);
    XLSX.utils.book_append_sheet(workbook, ws2, 'Rate Calculator');

    XLSX.writeFile(workbook, `Ratable_Analysis_${jobData.job_name}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const subTabs = [
    { id: 'comparison', label: 'Ratable Comparison', icon: FileSpreadsheet },
    { id: 'rate-calc', label: 'Rate Calculator', icon: Calculator }
  ];

  return (
    <div className="space-y-4">
      {/* Header with Export and Save Status */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Ratable Comparison & Rate Calculator</h2>
          <p className="text-sm text-gray-600 mt-1">
            Compare current vs projected ratables and calculate tax rates
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveStatus === 'saving' && (
            <span className="text-sm text-blue-600 flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              Saving...
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-sm text-green-600 flex items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Saved
            </span>
          )}
          <button
            onClick={exportToExcel}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Download className="w-4 h-4" />
            Export Analysis
          </button>
        </div>
      </div>

      {/* Sub-Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {subTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`
                  whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm inline-flex items-center gap-2
                  ${isActive
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeSubTab === 'comparison' && (
        <div className="space-y-4">
          {/* Comparison Table */}
          <div className="bg-white rounded-lg border border-gray-300 overflow-hidden">
            <div className="grid grid-cols-2 gap-8 p-6">
              {/* Current Year Side */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-4">Current Ratable Base</h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-xs font-semibold text-gray-700 pb-2 border-b">
                    <div></div>
                    <div className="text-right">Count</div>
                    <div className="text-right">AVG ASMT</div>
                  </div>
                  
                  {/* Class 1 */}
                  <div className="space-y-1">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-sm font-medium py-1">Class 1</div>
                      <input
                        type="number"
                        defaultValue={currentYearData.class_1_count}
                        onBlur={(e) => handleCurrentYearChange('current_class_1_count', e.target.value)}
                        className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                      />
                      <input
                        type="number"
                        defaultValue={currentYearData.class_1_total}
                        onBlur={(e) => handleCurrentYearChange('current_class_1_total', e.target.value)}
                        className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 pl-4">
                      <div className="py-1">Abatements</div>
                      <input
                        type="number"
                        defaultValue={currentYearData.class_1_abatements}
                        onBlur={(e) => handleCurrentYearChange('current_class_1_abatements', e.target.value)}
                        className="text-xs text-right px-2 py-0.5 border border-gray-300 rounded h-6"
                      />
                      <div></div>
                    </div>
                  </div>

                  {/* Class 2 */}
                  <div className="space-y-1">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-sm font-medium py-1">Class 2</div>
                      <input
                        type="number"
                        defaultValue={currentYearData.class_2_count}
                        onBlur={(e) => handleCurrentYearChange('current_class_2_count', e.target.value)}
                        className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                      />
                      <input
                        type="number"
                        defaultValue={currentYearData.class_2_total}
                        onBlur={(e) => handleCurrentYearChange('current_class_2_total', e.target.value)}
                        className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 pl-4">
                      <div className="py-1">Abatements</div>
                      <input
                        type="number"
                        defaultValue={currentYearData.class_2_abatements}
                        onBlur={(e) => handleCurrentYearChange('current_class_2_abatements', e.target.value)}
                        className="text-xs text-right px-2 py-0.5 border border-gray-300 rounded h-6"
                      />
                      <div></div>
                    </div>
                  </div>

                  {/* Class 3A's */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-sm font-medium py-1">Class 3A's (NET)</div>
                    <input
                      type="number"
                      defaultValue={currentYearData.class_3a_count}
                      onBlur={(e) => handleCurrentYearChange('current_class_3a_count', e.target.value)}
                      className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                    />
                    <input
                      type="number"
                      defaultValue={currentYearData.class_3a_total}
                      onBlur={(e) => handleCurrentYearChange('current_class_3a_total', e.target.value)}
                      className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                    />
                  </div>

                  {/* Class 3B's */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-sm font-medium py-1">Class 3B's</div>
                    <input
                      type="number"
                      defaultValue={currentYearData.class_3b_count}
                      onBlur={(e) => handleCurrentYearChange('current_class_3b_count', e.target.value)}
                      className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                    />
                    <input
                      type="number"
                      defaultValue={currentYearData.class_3b_total}
                      onBlur={(e) => handleCurrentYearChange('current_class_3b_total', e.target.value)}
                      className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                    />
                  </div>

                  {/* Class 4A,B,C */}
                  <div className="space-y-1">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-sm font-medium py-1">Class 4A,B,C (NET)</div>
                      <input
                        type="number"
                        defaultValue={currentYearData.class_4_count}
                        onBlur={(e) => handleCurrentYearChange('current_class_4_count', e.target.value)}
                        className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                      />
                      <input
                        type="number"
                        defaultValue={currentYearData.class_4_total}
                        onBlur={(e) => handleCurrentYearChange('current_class_4_total', e.target.value)}
                        className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 pl-4">
                      <div className="py-1">Abatements</div>
                      <input
                        type="number"
                        defaultValue={currentYearData.class_4_abatements}
                        onBlur={(e) => handleCurrentYearChange('current_class_4_abatements', e.target.value)}
                        className="text-xs text-right px-2 py-0.5 border border-gray-300 rounded h-6"
                      />
                      <div></div>
                    </div>
                  </div>

                  {/* Class 6A,B,C */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-sm font-medium py-1">6A,B,C</div>
                    <input
                      type="number"
                      defaultValue={currentYearData.class_6_count}
                      onBlur={(e) => handleCurrentYearChange('current_class_6_count', e.target.value)}
                      className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                    />
                    <div className="text-sm text-right text-xs text-gray-500 py-1">Not/After Ratio Applied</div>
                  </div>

                  {/* Total - CALCULATED */}
                  <div className="grid grid-cols-3 gap-2 pt-3 border-t-2 border-gray-300 font-bold">
                    <div className="text-sm py-1">Total Ratables</div>
                    <div className="text-sm text-right px-2 py-1 bg-gray-100 rounded border border-gray-300">
                      {currentYearData.total_count.toLocaleString()}
                    </div>
                    <div className="text-base text-right px-2 py-1 bg-gray-100 rounded border border-gray-300">
                      ${currentYearData.total_total.toLocaleString()}
                    </div>
                  </div>

                  {/* Commercial Base - CALCULATED */}
                  <div className="grid grid-cols-3 gap-2 pt-2 mt-2 border-t border-gray-200">
                    <div className="text-sm font-medium py-1">Commercial Base</div>
                    <div></div>
                    <div className="text-sm text-right px-2 py-1 bg-gray-100 rounded border border-gray-300">
                      {currentYearData.commercial_base_pct.toFixed(2)}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Projected Year Side */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-4">Projected Ratable Base</h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-xs font-semibold text-gray-700 pb-2 border-b">
                    <div></div>
                    <div className="text-right">Count</div>
                    <div className="text-right">AVG ASMT</div>
                  </div>
                  
                  {/* Class 1 */}
                  <div className="space-y-1">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-sm font-medium py-1">Class 1</div>
                      <div className="text-sm text-right px-2 py-1">{projectedRatableBase['1'].count.toLocaleString()}</div>
                      <div className="text-sm text-right px-2 py-1">${projectedRatableBase['1'].total.toLocaleString()}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 pl-4">
                      <div className="py-1">Abatements</div>
                      <div className="text-right px-2 py-1">0</div>
                      <div></div>
                    </div>
                  </div>

                  {/* Class 2 */}
                  <div className="space-y-1">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-sm font-medium py-1">Class 2</div>
                      <div className="text-sm text-right px-2 py-1">{projectedRatableBase['2'].count.toLocaleString()}</div>
                      <div className="text-sm text-right px-2 py-1">${projectedRatableBase['2'].total.toLocaleString()}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 pl-4">
                      <div className="py-1">Abatements</div>
                      <div className="text-right px-2 py-1">0</div>
                      <div></div>
                    </div>
                  </div>

                  {/* Class 3A's */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-sm font-medium py-1">Class 3A's (NET)</div>
                    <div className="text-sm text-right px-2 py-1">{projectedRatableBase['3A'].count.toLocaleString()}</div>
                    <div className="text-sm text-right px-2 py-1">${projectedRatableBase['3A'].total.toLocaleString()}</div>
                  </div>

                  {/* Class 3B's */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-sm font-medium py-1">Class 3B's</div>
                    <div className="text-sm text-right px-2 py-1">{projectedRatableBase['3B'].count.toLocaleString()}</div>
                    <div className="text-sm text-right px-2 py-1">${projectedRatableBase['3B'].total.toLocaleString()}</div>
                  </div>

                  {/* Class 4A,B,C */}
                  <div className="space-y-1">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-sm font-medium py-1">Class 4A,B,C (NET)</div>
                      <div className="text-sm text-right px-2 py-1">{projectedRatableBase['4ABC'].count.toLocaleString()}</div>
                      <div className="text-sm text-right px-2 py-1">${projectedRatableBase['4ABC'].total.toLocaleString()}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 pl-4">
                      <div className="py-1">Abatements</div>
                      <div className="text-right px-2 py-1">0</div>
                      <div></div>
                    </div>
                  </div>

                  {/* Class 6A,B,C */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-sm font-medium py-1">6A,B,C</div>
                    <div className="text-sm text-right px-2 py-1">{projectedRatableBase['6ABC'].count.toLocaleString()}</div>
                    <div className="text-sm text-right text-xs text-gray-500 py-1">Not/After Ratio Applied</div>
                  </div>

                  {/* Total */}
                  <div className="grid grid-cols-3 gap-2 pt-3 border-t-2 border-gray-300 font-bold">
                    <div className="text-sm py-1">Total Ratables</div>
                    <div className="text-sm text-right px-2 py-1">{projectedRatableBase.totalCount.toLocaleString()}</div>
                    <div className="text-base text-right px-2 py-1">${projectedRatableBase.totalTotal.toLocaleString()}</div>
                  </div>

                  {/* Commercial Base - Calculate */}
                  <div className="grid grid-cols-3 gap-2 pt-2 mt-2 border-t border-gray-200">
                    <div className="text-sm font-medium py-1">Commercial Base</div>
                    <div></div>
                    <div className="text-sm text-right px-2 py-1">
                      {projectedRatableBase.totalTotal > 0
                        ? ((projectedRatableBase['4ABC'].total / projectedRatableBase.totalTotal) * 100).toFixed(2)
                        : 0}%
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeSubTab === 'rate-calc' && (
        <div className="space-y-4">
          {/* Rate Calculator */}
          <div className="bg-white rounded-lg border border-gray-300 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-6">Tax Rate Calculator</h3>
            
            {/* Budget and Current Rate Inputs */}
            <div className="grid grid-cols-2 gap-6 mb-8">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">BUDGET</label>
                <input
                  type="number"
                  value={rateCalcData.budget}
                  onChange={(e) => handleRateCalcChange('budget', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-lg font-bold"
                  placeholder="Enter budget"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">CURRENT RATE</label>
                <input
                  type="number"
                  step="0.001"
                  value={rateCalcData.currentRate}
                  onChange={(e) => handleRateCalcChange('currentRate', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-lg font-bold"
                  placeholder="Enter current rate"
                />
              </div>
            </div>

            {/* Class Breakdown */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-700">Projected Ratables by Class</h4>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="font-medium text-gray-700">Class 1's</div>
                <div className="text-right font-semibold">${projectedRatableBase['1'].total.toLocaleString()}</div>
                
                <div className="font-medium text-gray-700">Class 2's</div>
                <div className="text-right font-semibold">${projectedRatableBase['2'].total.toLocaleString()}</div>
                
                <div className="font-medium text-gray-700">Class 3A's</div>
                <div className="text-right font-semibold">${projectedRatableBase['3A'].total.toLocaleString()}</div>
                
                <div className="font-medium text-gray-700">Class 3B's</div>
                <div className="text-right font-semibold">${projectedRatableBase['3B'].total.toLocaleString()}</div>
                
                <div className="font-medium text-gray-700">Class 4A,B,C</div>
                <div className="text-right font-semibold">${projectedRatableBase['4ABC'].total.toLocaleString()}</div>
                
                <div className="font-medium text-gray-700">6A,B,C</div>
                <div className="text-right font-semibold">${projectedRatableBase['6ABC'].total.toLocaleString()}</div>
              </div>

              {/* Totals */}
              <div className="pt-4 mt-4 border-t-2 border-gray-300">
                <div className="grid grid-cols-2 gap-4 text-base font-bold">
                  <div>Total Ratables</div>
                  <div className="text-right">${projectedRatableBase.totalTotal.toLocaleString()}</div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Buffer for Loss</span>
                    <input
                      type="number"
                      step="0.01"
                      value={rateCalcData.bufferForLoss}
                      onChange={(e) => handleRateCalcChange('bufferForLoss', e.target.value)}
                      className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                      placeholder="0.00"
                    />
                    <span className="text-sm">%</span>
                  </div>
                  <div className="text-right text-sm">
                    ${((projectedRatableBase.totalTotal * rateCalcData.bufferForLoss) / 100).toLocaleString()}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-3 text-base font-bold">
                  <div>Net Ratables</div>
                  <div className="text-right">
                    ${(projectedRatableBase.totalTotal * (1 - rateCalcData.bufferForLoss / 100)).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Estimated Rate */}
              <div className="pt-4 mt-4 border-t-4 border-blue-600 bg-blue-50 p-4 rounded-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-lg font-bold text-blue-900">Estimated Rate</div>
                  <div className="text-right text-2xl font-bold text-blue-600">
                    {(rateCalcData.budget / (projectedRatableBase.totalTotal * (1 - rateCalcData.bufferForLoss / 100))).toFixed(3)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RatableComparisonTab;
