import React, { useState, useEffect, useMemo } from 'react';
import { Calculator, Download, FileSpreadsheet, Save } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import * as XLSX from 'xlsx-js-style';

const RatableComparisonTab = ({ jobData, properties, onUpdateJobCache }) => {
  const [activeSubTab, setActiveSubTab] = useState('comparison');
  const [saveStatus, setSaveStatus] = useState(''); // 'saving' or 'saved'
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Local state for current year data (editable)
  const [localCurrentYear, setLocalCurrentYear] = useState({
    class_1_count: 0,
    class_1_total: 0,
    class_1_abatements: 0,
    class_2_count: 0,
    class_2_total: 0,
    class_2_abatements: 0,
    class_3a_count: 0,
    class_3a_total: 0,
    class_3b_count: 0,
    class_3b_total: 0,
    class_4_count: 0,
    class_4_total: 0,
    class_4_abatements: 0,
    class_6_count: 0,
    class_6_total: 0
  });

  // Local state for rate calculator data (editable)
  const [localRateCalc, setLocalRateCalc] = useState({
    budget: 0,
    currentRate: 0,
    bufferForLoss: 0
  });

  // Initialize local state from jobData
  useEffect(() => {
    if (jobData) {
      setLocalCurrentYear({
        class_1_count: jobData.current_class_1_count || 0,
        class_1_total: jobData.current_class_1_total || 0,
        class_1_abatements: jobData.current_class_1_abatements || 0,
        class_2_count: jobData.current_class_2_count || 0,
        class_2_total: jobData.current_class_2_total || 0,
        class_2_abatements: jobData.current_class_2_abatements || 0,
        class_3a_count: jobData.current_class_3a_count || 0,
        class_3a_total: jobData.current_class_3a_total || 0,
        class_3b_count: jobData.current_class_3b_count || 0,
        class_3b_total: jobData.current_class_3b_total || 0,
        class_4_count: jobData.current_class_4_count || 0,
        class_4_total: jobData.current_class_4_total || 0,
        class_4_abatements: jobData.current_class_4_abatements || 0,
        class_6_count: jobData.current_class_6_count || 0,
        class_6_total: jobData.current_class_6_total || 0
      });

      setLocalRateCalc({
        budget: jobData.rate_calc_budget || 0,
        currentRate: jobData.rate_calc_current_rate || 0,
        bufferForLoss: jobData.rate_calc_buffer_for_loss || 0
      });

      setHasUnsavedChanges(false);
    }
  }, [jobData?.id]); // Reset when job changes

  // Calculate years for ratable comparison
  const yearPriorToDueYear = useMemo(() => {
    if (!jobData?.end_date) return new Date().getFullYear();
    const endYear = parseInt(jobData.end_date.substring(0, 4));
    return endYear - 1;
  }, [jobData?.end_date]);

  // Calculate current year totals based on LOCAL state values
  const currentYearCalculatedTotals = useMemo(() => {
    const totalCount = localCurrentYear.class_1_count +
                       localCurrentYear.class_2_count +
                       localCurrentYear.class_3a_count +
                       localCurrentYear.class_3b_count +
                       localCurrentYear.class_4_count +
                       localCurrentYear.class_6_count;

    const totalTotal = localCurrentYear.class_1_total +
                       localCurrentYear.class_2_total +
                       localCurrentYear.class_3a_total +
                       localCurrentYear.class_3b_total +
                       localCurrentYear.class_4_total;

    const commercialBasePct = totalTotal > 0
      ? (localCurrentYear.class_4_total / totalTotal) * 100
      : 0;

    return { totalCount, totalTotal, commercialBasePct };
  }, [localCurrentYear]);

  // Get previous projected values for delta tracking
  const previousProjected = useMemo(() => ({
    class_1_count: jobData?.previous_projected_class_1_count || 0,
    class_1_total: jobData?.previous_projected_class_1_total || 0,
    class_2_count: jobData?.previous_projected_class_2_count || 0,
    class_2_total: jobData?.previous_projected_class_2_total || 0,
    class_3a_count: jobData?.previous_projected_class_3a_count || 0,
    class_3a_total: jobData?.previous_projected_class_3a_total || 0,
    class_3b_count: jobData?.previous_projected_class_3b_count || 0,
    class_3b_total: jobData?.previous_projected_class_3b_total || 0,
    class_4_count: jobData?.previous_projected_class_4_count || 0,
    class_4_total: jobData?.previous_projected_class_4_total || 0,
    class_6_count: jobData?.previous_projected_class_6_count || 0,
    class_6_total: jobData?.previous_projected_class_6_total || 0,
    total_count: jobData?.previous_projected_total_count || 0,
    total_total: jobData?.previous_projected_total_total || 0
  }), [jobData]);

  // Get vendor type for consolidation logic
  const vendorType = jobData?.vendor_type || 'BRT';

  // Helper function to format delta display
  const formatDelta = (currentValue, previousValue) => {
    if (!previousValue || previousValue === 0) return null;

    const delta = currentValue - previousValue;
    const percentChange = (delta / previousValue) * 100;

    if (delta === 0) return null;

    const deltaColor = delta > 0 ? 'text-green-600' : 'text-red-600';
    const sign = delta > 0 ? '+' : '';

    return (
      <div className={`text-[10px] ${deltaColor} font-normal mt-0.5`}>
        {sign}${Math.abs(delta).toLocaleString()} ({sign}{percentChange.toFixed(1)}%)
      </div>
    );
  };

  // Formatting helpers
  const formatCount = (value) => {
    const num = parseFloat(value) || 0;
    return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
  };

  const formatAvgAsmt = (value) => {
    const num = parseFloat(value) || 0;
    return '$' + num.toLocaleString('en-US', { maximumFractionDigits: 0 });
  };

  const formatBudget = (value) => {
    const num = parseFloat(value) || 0;
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatTaxRate = (value) => {
    const num = parseFloat(value) || 0;
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  };

  // Consolidate properties by grouping additional cards
  const consolidateProperties = (allProperties) => {
    const grouped = {};

    allProperties.forEach(property => {
      const baseKey = `${property.property_block}-${property.property_lot}-${property.property_qualifier || 'NONE'}-${property.property_location || 'NONE'}`;

      if (!grouped[baseKey]) {
        grouped[baseKey] = {
          mainCard: null,
          additionalCards: [],
          maxCard: 1,
          totalCardSF: 0
        };
      }

      const card = property.property_addl_card;
      const isMainCard = vendorType === 'BRT'
        ? (!card || card === '1')
        : (!card || card.toUpperCase() === 'M');

      if (isMainCard) {
        grouped[baseKey].mainCard = property;
      } else {
        grouped[baseKey].additionalCards.push(property);
        grouped[baseKey].totalCardSF += property.asset_sfla || 0;
      }

      if (card) {
        const cardNum = vendorType === 'BRT'
          ? parseInt(card.match(/\d+/)?.[0] || '1')
          : (card.toUpperCase() === 'M' ? 1 : (card.charCodeAt(0) - 64));
        grouped[baseKey].maxCard = Math.max(grouped[baseKey].maxCard, cardNum);
      }
    });

    return Object.values(grouped).map(group => ({
      ...group.mainCard,
      _maxCard: group.maxCard,
      _totalCardSF: group.totalCardSF
    })).filter(p => p.property_composite_key);
  };

  // Calculate projected ratable base from CONSOLIDATED properties
  const projectedRatableBase = useMemo(() => {
    const summary = {
      '1': { count: 0, total: 0 },
      '2': { count: 0, total: 0 },
      '3A': { count: 0, total: 0 },
      '3B': { count: 0, total: 0 },
      '4ABC': { count: 0, total: 0 },
      '6ABC': { count: 0, total: 0 }
    };

    const consolidated = consolidateProperties(properties);

    consolidated.forEach(property => {
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
  }, [properties, vendorType]);

  // Handle local state changes for current year
  const handleLocalCurrentYearChange = (field, value) => {
    const numValue = parseFloat(value.replace(/[,$]/g, '')) || 0;
    setLocalCurrentYear(prev => ({ ...prev, [field]: numValue }));
    setHasUnsavedChanges(true);
  };

  // Handle local state changes for rate calculator
  const handleLocalRateCalcChange = (field, value) => {
    const numValue = parseFloat(value.replace(/[,$]/g, '')) || 0;
    setLocalRateCalc(prev => ({ ...prev, [field]: numValue }));
    setHasUnsavedChanges(true);
  };

  // Manual save function
  const handleManualSave = async () => {
    try {
      setSaveStatus('saving');

      const updateData = {
        current_class_1_count: localCurrentYear.class_1_count,
        current_class_1_total: localCurrentYear.class_1_total,
        current_class_1_abatements: localCurrentYear.class_1_abatements,
        current_class_2_count: localCurrentYear.class_2_count,
        current_class_2_total: localCurrentYear.class_2_total,
        current_class_2_abatements: localCurrentYear.class_2_abatements,
        current_class_3a_count: localCurrentYear.class_3a_count,
        current_class_3a_total: localCurrentYear.class_3a_total,
        current_class_3b_count: localCurrentYear.class_3b_count,
        current_class_3b_total: localCurrentYear.class_3b_total,
        current_class_4_count: localCurrentYear.class_4_count,
        current_class_4_total: localCurrentYear.class_4_total,
        current_class_4_abatements: localCurrentYear.class_4_abatements,
        current_class_6_count: localCurrentYear.class_6_count,
        current_class_6_total: localCurrentYear.class_6_total,
        rate_calc_budget: localRateCalc.budget,
        rate_calc_current_rate: localRateCalc.currentRate,
        rate_calc_buffer_for_loss: localRateCalc.bufferForLoss
      };

      const { error } = await supabase
        .from('jobs')
        .update(updateData)
        .eq('id', jobData.id);

      if (error) throw error;

      setSaveStatus('saved');
      setHasUnsavedChanges(false);
      setTimeout(() => setSaveStatus(''), 2000);

      if (onUpdateJobCache) onUpdateJobCache();
    } catch (error) {
      console.error('Error saving data:', error);
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
      ['Class 1', localCurrentYear.class_1_count, '', '', 'Class 1', projectedRatableBase['1'].count, '', '', ''],
      ['Abatements', localCurrentYear.class_1_abatements, '', '', 'Abatements', 0, '', '', ''],
      ['Adjusted Abatements', 0, '', '', 'Adjusted Abatements', 0, '', '', ''],
      ['', '', localCurrentYear.class_1_total, '', '', '', projectedRatableBase['1'].total, '', ''],
      ['Class 2', localCurrentYear.class_2_count, '', '', 'Class 2', projectedRatableBase['2'].count, '', '', ''],
      ['Abatements', localCurrentYear.class_2_abatements, '', '', 'Abatements', 0, '', '', ''],
      ['Adjusted Abatements', 0, '', '', 'Adjusted Abatements', 0, '', '', ''],
      ['', '', localCurrentYear.class_2_total, '', '', '', projectedRatableBase['2'].total, '', ''],
      ['Class 3A\'s', localCurrentYear.class_3a_count, '', '', 'Class 3A\'s', projectedRatableBase['3A'].count, '', '', ''],
      ['Class 3A\'s (NET)', '', localCurrentYear.class_3a_total, '', 'Class 3A\'s (NET)', '', projectedRatableBase['3A'].total, '', ''],
      ['Class 3B\'s', localCurrentYear.class_3b_count, '', '', 'Class 3B\'s', projectedRatableBase['3B'].count, '', '', ''],
      ['Class 4A,B,C', localCurrentYear.class_4_count, '', '', 'Class 4A,B,C', projectedRatableBase['4ABC'].count, '', '', ''],
      ['Abatements', localCurrentYear.class_4_abatements, '', '', 'Abatements', 0, '', '', ''],
      ['Adjusted Abatements', 0, '', '', 'Adjusted Abatements', 0, '', '', ''],
      ['Class 4\'s (NET)', '', localCurrentYear.class_4_total, '', 'Class 4\'s (NET)', '', projectedRatableBase['4ABC'].total, '', ''],
      ['6A,B,C', localCurrentYear.class_6_count, '0 (Not/After Ratio Applied)', '', '6A,B,C', projectedRatableBase['6ABC'].count, '0 (Not/After Ratio Applied)', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['Total Ratables', currentYearCalculatedTotals.totalCount, currentYearCalculatedTotals.totalTotal, '', 'Total Ratables', projectedRatableBase.totalCount, projectedRatableBase.totalTotal, '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['Commercial Base', '', currentYearCalculatedTotals.commercialBasePct, '', 'Commercial Base', '', '', '', '']
    ];

    const ws1 = XLSX.utils.aoa_to_sheet(comparisonData);
    XLSX.utils.book_append_sheet(workbook, ws1, 'Ratable Comparison');

    // Sheet 2: Rate Calculator
    const netRatables = projectedRatableBase.totalTotal * (1 - localRateCalc.bufferForLoss / 100);
    const estimatedRate = netRatables > 0 ? localRateCalc.budget / netRatables : 0;

    const rateCalcDataSheet = [
      ['Tax Rate Calculator'],
      [],
      ['BUDGET', localRateCalc.budget],
      ['CURRENT RATE', localRateCalc.currentRate],
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
      ['Buffer for Loss', localRateCalc.bufferForLoss + '%', localRateCalc.bufferForLoss > 0 ? projectedRatableBase.totalTotal * (localRateCalc.bufferForLoss / 100) : 0],
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
      {/* Header with Export, Save, and Save Status */}
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
          <button
            onClick={handleManualSave}
            disabled={!hasUnsavedChanges}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              hasUnsavedChanges
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            <Save className="w-4 h-4" />
            Save Changes
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
                    <div className="text-right">Net Taxable Value</div>
                  </div>
                  
                  {/* Class 1 */}
                  <div className="space-y-1">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-sm font-medium py-1">Class 1</div>
                      <input
                        type="text"
                        value={formatCount(localCurrentYear.class_1_count)}
                        onChange={(e) => handleLocalCurrentYearChange('class_1_count', e.target.value)}
                        className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                      />
                      <input
                        type="text"
                        value={formatAvgAsmt(localCurrentYear.class_1_total)}
                        onChange={(e) => handleLocalCurrentYearChange('class_1_total', e.target.value)}
                        className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 pl-4">
                      <div className="py-1">Abatements</div>
                      <input
                        type="text"
                        value={formatCount(localCurrentYear.class_1_abatements)}
                        onChange={(e) => handleLocalCurrentYearChange('class_1_abatements', e.target.value)}
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
                        type="text"
                        value={formatCount(localCurrentYear.class_2_count)}
                        onChange={(e) => handleLocalCurrentYearChange('class_2_count', e.target.value)}
                        className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                      />
                      <input
                        type="text"
                        value={formatAvgAsmt(localCurrentYear.class_2_total)}
                        onChange={(e) => handleLocalCurrentYearChange('class_2_total', e.target.value)}
                        className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 pl-4">
                      <div className="py-1">Abatements</div>
                      <input
                        type="text"
                        value={formatCount(localCurrentYear.class_2_abatements)}
                        onChange={(e) => handleLocalCurrentYearChange('class_2_abatements', e.target.value)}
                        className="text-xs text-right px-2 py-0.5 border border-gray-300 rounded h-6"
                      />
                      <div></div>
                    </div>
                  </div>

                  {/* Class 3A's */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-sm font-medium py-1">Class 3A's (NET)</div>
                    <input
                      type="text"
                      value={formatCount(localCurrentYear.class_3a_count)}
                      onChange={(e) => handleLocalCurrentYearChange('class_3a_count', e.target.value)}
                      className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                    />
                    <input
                      type="text"
                      value={formatAvgAsmt(localCurrentYear.class_3a_total)}
                      onChange={(e) => handleLocalCurrentYearChange('class_3a_total', e.target.value)}
                      className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                    />
                  </div>

                  {/* Class 3B's */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-sm font-medium py-1">Class 3B's</div>
                    <input
                      type="text"
                      value={formatCount(localCurrentYear.class_3b_count)}
                      onChange={(e) => handleLocalCurrentYearChange('class_3b_count', e.target.value)}
                      className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                    />
                    <input
                      type="text"
                      value={formatAvgAsmt(localCurrentYear.class_3b_total)}
                      onChange={(e) => handleLocalCurrentYearChange('class_3b_total', e.target.value)}
                      className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                    />
                  </div>

                  {/* Class 4A,B,C */}
                  <div className="space-y-1">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-sm font-medium py-1">Class 4A,B,C (NET)</div>
                      <input
                        type="text"
                        value={formatCount(localCurrentYear.class_4_count)}
                        onChange={(e) => handleLocalCurrentYearChange('class_4_count', e.target.value)}
                        className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                      />
                      <input
                        type="text"
                        value={formatAvgAsmt(localCurrentYear.class_4_total)}
                        onChange={(e) => handleLocalCurrentYearChange('class_4_total', e.target.value)}
                        className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 pl-4">
                      <div className="py-1">Abatements</div>
                      <input
                        type="text"
                        value={formatCount(localCurrentYear.class_4_abatements)}
                        onChange={(e) => handleLocalCurrentYearChange('class_4_abatements', e.target.value)}
                        className="text-xs text-right px-2 py-0.5 border border-gray-300 rounded h-6"
                      />
                      <div></div>
                    </div>
                  </div>

                  {/* Class 6A,B,C */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-sm font-medium py-1">6A,B,C</div>
                    <input
                      type="text"
                      value={formatCount(localCurrentYear.class_6_count)}
                      onChange={(e) => handleLocalCurrentYearChange('class_6_count', e.target.value)}
                      className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                    />
                    <input
                      type="text"
                      value={formatAvgAsmt(localCurrentYear.class_6_total)}
                      onChange={(e) => handleLocalCurrentYearChange('class_6_total', e.target.value)}
                      className="text-sm text-right px-2 py-0.5 border border-gray-300 rounded h-7"
                    />
                  </div>

                  {/* Total - CALCULATED */}
                  <div className="grid grid-cols-3 gap-2 pt-3 border-t-2 border-gray-300 font-bold">
                    <div className="text-sm py-1">Total Ratables</div>
                    <div className="text-sm text-right px-2 py-1 bg-gray-100 rounded border border-gray-300">
                      {formatCount(currentYearCalculatedTotals.totalCount)}
                    </div>
                    <div className="text-base text-right px-2 py-1 bg-gray-100 rounded border border-gray-300">
                      {formatAvgAsmt(currentYearCalculatedTotals.totalTotal)}
                    </div>
                  </div>

                  {/* Commercial Base - CALCULATED */}
                  <div className="grid grid-cols-3 gap-2 pt-2 mt-2 border-t border-gray-200">
                    <div className="text-sm font-medium py-1">Commercial Base</div>
                    <div></div>
                    <div className="text-sm text-right px-2 py-1 bg-gray-100 rounded border border-gray-300">
                      {currentYearCalculatedTotals.commercialBasePct.toFixed(2)}%
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
                    <div className="text-right">Net Taxable Value</div>
                  </div>
                  
                  {/* Class 1 */}
                  <div className="space-y-1">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-sm font-medium py-1">Class 1</div>
                      <div className="text-sm text-right px-2 py-1">{formatCount(projectedRatableBase['1'].count)}</div>
                      <div className="text-sm text-right px-2 py-1">
                        {formatAvgAsmt(projectedRatableBase['1'].total)}
                        {formatDelta(projectedRatableBase['1'].total, previousProjected.class_1_total)}
                      </div>
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
                      <div className="text-sm text-right px-2 py-1">{formatCount(projectedRatableBase['2'].count)}</div>
                      <div className="text-sm text-right px-2 py-1">
                        {formatAvgAsmt(projectedRatableBase['2'].total)}
                        {formatDelta(projectedRatableBase['2'].total, previousProjected.class_2_total)}
                      </div>
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
                    <div className="text-sm text-right px-2 py-1">{formatCount(projectedRatableBase['3A'].count)}</div>
                    <div className="text-sm text-right px-2 py-1">
                      {formatAvgAsmt(projectedRatableBase['3A'].total)}
                      {formatDelta(projectedRatableBase['3A'].total, previousProjected.class_3a_total)}
                    </div>
                  </div>

                  {/* Class 3B's */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-sm font-medium py-1">Class 3B's</div>
                    <div className="text-sm text-right px-2 py-1">{formatCount(projectedRatableBase['3B'].count)}</div>
                    <div className="text-sm text-right px-2 py-1">
                      {formatAvgAsmt(projectedRatableBase['3B'].total)}
                      {formatDelta(projectedRatableBase['3B'].total, previousProjected.class_3b_total)}
                    </div>
                  </div>

                  {/* Class 4A,B,C */}
                  <div className="space-y-1">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-sm font-medium py-1">Class 4A,B,C (NET)</div>
                      <div className="text-sm text-right px-2 py-1">{formatCount(projectedRatableBase['4ABC'].count)}</div>
                      <div className="text-sm text-right px-2 py-1">
                        {formatAvgAsmt(projectedRatableBase['4ABC'].total)}
                        {formatDelta(projectedRatableBase['4ABC'].total, previousProjected.class_4_total)}
                      </div>
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
                    <div className="text-sm text-right px-2 py-1">{formatCount(projectedRatableBase['6ABC'].count)}</div>
                    <div className="text-sm text-right px-2 py-1">
                      {formatAvgAsmt(projectedRatableBase['6ABC'].total)}
                      {formatDelta(projectedRatableBase['6ABC'].total, previousProjected.class_6_total)}
                    </div>
                  </div>

                  {/* Total */}
                  <div className="grid grid-cols-3 gap-2 pt-3 border-t-2 border-gray-300 font-bold">
                    <div className="text-sm py-1">Total Ratables</div>
                    <div className="text-sm text-right px-2 py-1">{formatCount(projectedRatableBase.totalCount)}</div>
                    <div className="text-base text-right px-2 py-1">
                      {formatAvgAsmt(projectedRatableBase.totalTotal)}
                      {formatDelta(projectedRatableBase.totalTotal, previousProjected.total_total)}
                    </div>
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
                  type="text"
                  value={formatBudget(localRateCalc.budget)}
                  onChange={(e) => handleLocalRateCalcChange('budget', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-lg font-bold"
                  placeholder="Enter budget"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">CURRENT RATE</label>
                <input
                  type="text"
                  value={formatTaxRate(localRateCalc.currentRate)}
                  onChange={(e) => handleLocalRateCalcChange('currentRate', e.target.value)}
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
                <div className="text-right font-semibold">{formatAvgAsmt(projectedRatableBase['1'].total)}</div>
                
                <div className="font-medium text-gray-700">Class 2's</div>
                <div className="text-right font-semibold">{formatAvgAsmt(projectedRatableBase['2'].total)}</div>
                
                <div className="font-medium text-gray-700">Class 3A's</div>
                <div className="text-right font-semibold">{formatAvgAsmt(projectedRatableBase['3A'].total)}</div>
                
                <div className="font-medium text-gray-700">Class 3B's</div>
                <div className="text-right font-semibold">{formatAvgAsmt(projectedRatableBase['3B'].total)}</div>
                
                <div className="font-medium text-gray-700">Class 4A,B,C</div>
                <div className="text-right font-semibold">{formatAvgAsmt(projectedRatableBase['4ABC'].total)}</div>
                
                <div className="font-medium text-gray-700">6A,B,C</div>
                <div className="text-right font-semibold">{formatAvgAsmt(projectedRatableBase['6ABC'].total)}</div>
              </div>

              {/* Totals */}
              <div className="pt-4 mt-4 border-t-2 border-gray-300">
                <div className="grid grid-cols-2 gap-4 text-base font-bold">
                  <div>Total Ratables</div>
                  <div className="text-right">{formatAvgAsmt(projectedRatableBase.totalTotal)}</div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Buffer for Loss</span>
                    <input
                      type="text"
                      value={localRateCalc.bufferForLoss}
                      onChange={(e) => handleLocalRateCalcChange('bufferForLoss', e.target.value)}
                      className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                      placeholder="0.00"
                    />
                    <span className="text-sm">%</span>
                  </div>
                  <div className="text-right text-sm">
                    {formatAvgAsmt((projectedRatableBase.totalTotal * localRateCalc.bufferForLoss) / 100)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-3 text-base font-bold">
                  <div>Net Ratables</div>
                  <div className="text-right">
                    {formatAvgAsmt(projectedRatableBase.totalTotal * (1 - localRateCalc.bufferForLoss / 100))}
                  </div>
                </div>
              </div>

              {/* Estimated Rate */}
              <div className="pt-4 mt-4 border-t-4 border-blue-600 bg-blue-50 p-4 rounded-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-lg font-bold text-blue-900">Estimated Rate</div>
                  <div className="text-right text-2xl font-bold text-blue-600">
                    {formatTaxRate(localRateCalc.budget / (projectedRatableBase.totalTotal * (1 - localRateCalc.bufferForLoss / 100)))}
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
