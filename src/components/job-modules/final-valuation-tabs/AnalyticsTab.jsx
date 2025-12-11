import React, { useState, useMemo } from 'react';
import { Download, TrendingUp, TrendingDown, AlertCircle, FileText, BarChart3 } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';

const AnalyticsTab = ({ jobData, properties, finalValuationData = {} }) => {
  const [selectedVCS, setSelectedVCS] = useState('all');
  const [selectedMethod, setSelectedMethod] = useState('all'); // 'all', 'market_data', 'cme'
  
  // Calculate statistics
  const statistics = useMemo(() => {
    const stats = {
      total: properties.length,
      withSales: 0,
      marketDataCount: 0,
      cmeCount: 0,
      noMethodCount: 0,
      avgCurrentAssessment: 0,
      avgProjectedValue: 0,
      totalCurrentAssessment: 0,
      totalProjectedAssessment: 0,
      increasesCount: 0,
      decreasesCount: 0,
      noChangeCount: 0,
      avgIncrease: 0,
      avgDecrease: 0,
      flaggedProperties: []
    };
    
    let currentSum = 0;
    let projectedSum = 0;
    let increaseSum = 0;
    let decreaseSum = 0;
    
    properties.forEach(prop => {
      // Count sales
      if (prop.sales_date && prop.values_norm_time) {
        stats.withSales++;
      }
      
      // Get final valuation data
      const finalData = finalValuationData[prop.property_composite_key];
      const currentValue = prop.values_mod_total || 0;
      const projectedValue = finalData?.final_recommended_value || currentValue;
      
      currentSum += currentValue;
      projectedSum += projectedValue;
      stats.totalCurrentAssessment += currentValue;
      stats.totalProjectedAssessment += projectedValue;
      
      // Count by method
      if (finalData?.final_method_used === 'market_data') {
        stats.marketDataCount++;
      } else if (finalData?.final_method_used === 'cme') {
        stats.cmeCount++;
      } else {
        stats.noMethodCount++;
      }
      
      // Count changes
      const change = projectedValue - currentValue;
      const changePercent = currentValue > 0 ? (change / currentValue) * 100 : 0;
      
      if (Math.abs(changePercent) < 0.1) {
        stats.noChangeCount++;
      } else if (change > 0) {
        stats.increasesCount++;
        increaseSum += changePercent;
      } else {
        stats.decreasesCount++;
        decreaseSum += changePercent;
      }
      
      // Flag properties needing review
      if (finalData) {
        // Large variance between methods
        if (finalData.cme_projected_assessment && finalData.projected_total) {
          const variance = Math.abs(finalData.cme_projected_assessment - finalData.projected_total);
          const varPercent = (variance / finalData.projected_total) * 100;
          
          if (varPercent > 20) {
            stats.flaggedProperties.push({
              property: prop,
              reason: `Method variance: ${varPercent.toFixed(1)}%`,
              severity: 'high'
            });
          }
        }
        
        // Large change from current
        if (Math.abs(changePercent) > 20) {
          stats.flaggedProperties.push({
            property: prop,
            reason: `Large change: ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}%`,
            severity: changePercent > 30 ? 'high' : 'medium'
          });
        }
        
        // High adjustment in CME
        if (finalData.cme_comparable_data) {
          try {
            const compData = JSON.parse(finalData.cme_comparable_data);
            const avgAdjustment = compData.reduce((sum, c) => sum + Math.abs(c.total_adjustment / c.original_price * 100), 0) / compData.length;
            
            if (avgAdjustment > 15) {
              stats.flaggedProperties.push({
                property: prop,
                reason: `High CME adjustments: ${avgAdjustment.toFixed(1)}% avg`,
                severity: 'medium'
              });
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    });
    
    stats.avgCurrentAssessment = stats.total > 0 ? currentSum / stats.total : 0;
    stats.avgProjectedValue = stats.total > 0 ? projectedSum / stats.total : 0;
    stats.avgIncrease = stats.increasesCount > 0 ? increaseSum / stats.increasesCount : 0;
    stats.avgDecrease = stats.decreasesCount > 0 ? decreaseSum / stats.decreasesCount : 0;
    
    return stats;
  }, [properties, finalValuationData]);

  // VCS-level breakdown
  const vcsSummary = useMemo(() => {
    const vcsGroups = {};
    
    properties.forEach(prop => {
      const vcs = prop.property_vcs || 'Unknown';
      if (!vcsGroups[vcs]) {
        vcsGroups[vcs] = {
          count: 0,
          currentTotal: 0,
          projectedTotal: 0,
          marketDataCount: 0,
          cmeCount: 0
        };
      }
      
      const finalData = finalValuationData[prop.property_composite_key];
      const currentValue = prop.values_mod_total || 0;
      const projectedValue = finalData?.final_recommended_value || currentValue;
      
      vcsGroups[vcs].count++;
      vcsGroups[vcs].currentTotal += currentValue;
      vcsGroups[vcs].projectedTotal += projectedValue;
      
      if (finalData?.final_method_used === 'market_data') {
        vcsGroups[vcs].marketDataCount++;
      } else if (finalData?.final_method_used === 'cme') {
        vcsGroups[vcs].cmeCount++;
      }
    });
    
    return Object.entries(vcsGroups).map(([vcs, data]) => ({
      vcs,
      ...data,
      avgCurrent: data.count > 0 ? data.currentTotal / data.count : 0,
      avgProjected: data.count > 0 ? data.projectedTotal / data.count : 0,
      change: data.projectedTotal - data.currentTotal,
      changePercent: data.currentTotal > 0 ? ((data.projectedTotal - data.currentTotal) / data.currentTotal) * 100 : 0
    })).sort((a, b) => a.vcs.localeCompare(b.vcs));
  }, [properties, finalValuationData]);

  // Export summary report
  const exportSummaryReport = () => {
    const wb = XLSX.utils.book_new();
    
    // Summary Sheet
    const summaryData = [
      ['FINAL VALUATION SUMMARY REPORT'],
      ['Job:', jobData.job_name],
      ['Municipality:', jobData.municipality],
      ['Generated:', new Date().toLocaleDateString()],
      [],
      ['OVERALL STATISTICS'],
      ['Total Properties', statistics.total],
      ['Properties with Sales Data', statistics.withSales],
      ['Market Data Method', statistics.marketDataCount],
      ['CME Method', statistics.cmeCount],
      ['No Method Applied', statistics.noMethodCount],
      [],
      ['ASSESSMENT VALUES'],
      ['Total Current Assessment', statistics.totalCurrentAssessment],
      ['Total Projected Assessment', statistics.totalProjectedAssessment],
      ['Net Change', statistics.totalProjectedAssessment - statistics.totalCurrentAssessment],
      ['Change %', ((statistics.totalProjectedAssessment - statistics.totalCurrentAssessment) / statistics.totalCurrentAssessment * 100).toFixed(2) + '%'],
      [],
      ['CHANGE DISTRIBUTION'],
      ['Increases', statistics.increasesCount, `${(statistics.increasesCount / statistics.total * 100).toFixed(1)}%`],
      ['Decreases', statistics.decreasesCount, `${(statistics.decreasesCount / statistics.total * 100).toFixed(1)}%`],
      ['No Change', statistics.noChangeCount, `${(statistics.noChangeCount / statistics.total * 100).toFixed(1)}%`],
      ['Avg Increase %', statistics.avgIncrease.toFixed(2) + '%'],
      ['Avg Decrease %', statistics.avgDecrease.toFixed(2) + '%']
    ];
    
    const summaryWS = XLSX.utils.aoa_to_sheet(summaryData);
    summaryWS['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 15 }];
    
    // VCS Summary Sheet
    const vcsData = [
      ['VCS BREAKDOWN'],
      [],
      ['VCS', 'Count', 'Current Total', 'Projected Total', 'Change', 'Change %', 'Market Data', 'CME']
    ];
    
    vcsSummary.forEach(vcs => {
      vcsData.push([
        vcs.vcs,
        vcs.count,
        vcs.currentTotal,
        vcs.projectedTotal,
        vcs.change,
        vcs.changePercent.toFixed(2) + '%',
        vcs.marketDataCount,
        vcs.cmeCount
      ]);
    });
    
    const vcsWS = XLSX.utils.aoa_to_sheet(vcsData);
    vcsWS['!cols'] = [
      { wch: 15 }, { wch: 10 }, { wch: 15 }, { wch: 15 },
      { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 12 }
    ];
    
    // Flagged Properties Sheet
    const flaggedData = [
      ['FLAGGED PROPERTIES FOR REVIEW'],
      [],
      ['Block', 'Lot', 'Qualifier', 'Address', 'Reason', 'Severity']
    ];
    
    statistics.flaggedProperties.forEach(item => {
      flaggedData.push([
        item.property.property_block,
        item.property.property_lot,
        item.property.property_qualifier,
        item.property.property_location,
        item.reason,
        item.severity.toUpperCase()
      ]);
    });
    
    const flaggedWS = XLSX.utils.aoa_to_sheet(flaggedData);
    flaggedWS['!cols'] = [
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 30 }, { wch: 40 }, { wch: 12 }
    ];
    
    // Apply styling
    [summaryWS, vcsWS, flaggedWS].forEach(ws => {
      const range = XLSX.utils.decode_range(ws['!ref']);
      
      // Header row style
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const headerCell = XLSX.utils.encode_cell({ r: 0, c: C });
        if (ws[headerCell]) {
          ws[headerCell].s = {
            font: { name: 'Leelawadee', sz: 12, bold: true },
            alignment: { horizontal: 'center' }
          };
        }
      }
      
      // Data style
      for (let R = range.s.r + 1; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cell = XLSX.utils.encode_cell({ r: R, c: C });
          if (ws[cell]) {
            ws[cell].s = {
              font: { name: 'Leelawadee', sz: 10 },
              alignment: { horizontal: 'center' }
            };
          }
        }
      }
    });
    
    XLSX.utils.book_append_sheet(wb, summaryWS, 'Summary');
    XLSX.utils.book_append_sheet(wb, vcsWS, 'VCS Breakdown');
    XLSX.utils.book_append_sheet(wb, flaggedWS, 'Flagged Properties');
    
    XLSX.writeFile(wb, `Final_Valuation_Summary_${jobData.job_name}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Export detailed property list
  const exportDetailedList = () => {
    const wb = XLSX.utils.book_new();
    
    const headers = [
      'Block', 'Lot', 'Qualifier', 'Address', 'VCS', 'Type Use', 'SFLA',
      'Current Assessment', 'Method Used', 'Market Data Value', 'CME Value',
      'Final Recommended', 'Change $', 'Change %', 'Notes'
    ];
    
    const data = [headers];
    
    properties.forEach(prop => {
      const finalData = finalValuationData[prop.property_composite_key];
      const currentValue = prop.values_mod_total || 0;
      const projectedValue = finalData?.final_recommended_value || currentValue;
      const change = projectedValue - currentValue;
      const changePercent = currentValue > 0 ? (change / currentValue) * 100 : 0;
      
      data.push([
        prop.property_block,
        prop.property_lot,
        prop.property_qualifier,
        prop.property_location,
        prop.property_vcs,
        prop.asset_type_use,
        prop.asset_sfla,
        currentValue,
        finalData?.final_method_used || 'None',
        finalData?.projected_total || '',
        finalData?.cme_projected_assessment || '',
        projectedValue,
        change,
        changePercent.toFixed(2) + '%',
        finalData?.final_notes || ''
      ]);
    });
    
    const ws = XLSX.utils.aoa_to_sheet(data);
    
    // Styling
    const range = XLSX.utils.decode_range(ws['!ref']);
    
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const headerCell = XLSX.utils.encode_cell({ r: 0, c: C });
      if (ws[headerCell]) {
        ws[headerCell].s = {
          font: { name: 'Leelawadee', sz: 10, bold: true },
          alignment: { horizontal: 'center' },
          fill: { fgColor: { rgb: 'E5E7EB' } }
        };
      }
    }
    
    for (let R = 1; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cell = XLSX.utils.encode_cell({ r: R, c: C });
        if (ws[cell]) {
          ws[cell].s = {
            font: { name: 'Leelawadee', sz: 10 },
            alignment: { horizontal: 'center' }
          };
        }
      }
    }
    
    ws['!cols'] = [
      { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 30 }, { wch: 10 },
      { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 12 }, { wch: 15 },
      { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 10 }, { wch: 30 }
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, 'Detailed List');
    XLSX.writeFile(wb, `Final_Valuation_Detail_${jobData.job_name}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Analytics & Reports</h2>
          <p className="text-sm text-gray-600 mt-1">
            Summary statistics, VCS breakdowns, and export capabilities
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportSummaryReport}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <FileText className="w-4 h-4" />
            Export Summary
          </button>
          <button
            onClick={exportDetailedList}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            <Download className="w-4 h-4" />
            Export Detailed List
          </button>
        </div>
      </div>

      {/* Overall Statistics */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600">Total Properties</div>
              <div className="text-3xl font-bold text-gray-900">{statistics.total.toLocaleString()}</div>
            </div>
            <BarChart3 className="w-8 h-8 text-blue-500" />
          </div>
          <div className="mt-4 text-sm text-gray-600">
            With Sales: {statistics.withSales.toLocaleString()}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600">Market Data</div>
              <div className="text-3xl font-bold text-purple-600">{statistics.marketDataCount.toLocaleString()}</div>
            </div>
            <FileText className="w-8 h-8 text-purple-500" />
          </div>
          <div className="mt-4 text-sm text-gray-600">
            {((statistics.marketDataCount / statistics.total) * 100).toFixed(1)}% of total
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600">CME</div>
              <div className="text-3xl font-bold text-green-600">{statistics.cmeCount.toLocaleString()}</div>
            </div>
            <TrendingUp className="w-8 h-8 text-green-500" />
          </div>
          <div className="mt-4 text-sm text-gray-600">
            {((statistics.cmeCount / statistics.total) * 100).toFixed(1)}% of total
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600">No Method</div>
              <div className="text-3xl font-bold text-gray-400">{statistics.noMethodCount.toLocaleString()}</div>
            </div>
            <AlertCircle className="w-8 h-8 text-gray-400" />
          </div>
          <div className="mt-4 text-sm text-gray-600">
            {((statistics.noMethodCount / statistics.total) * 100).toFixed(1)}% of total
          </div>
        </div>
      </div>

      {/* Assessment Impact */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Assessment Impact</h3>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <div className="text-sm text-gray-600 mb-1">Total Current Assessment</div>
            <div className="text-2xl font-bold text-gray-900">
              ${statistics.totalCurrentAssessment.toLocaleString()}
            </div>
            <div className="text-sm text-gray-500 mt-1">
              Avg: ${statistics.avgCurrentAssessment.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Total Projected Assessment</div>
            <div className="text-2xl font-bold text-blue-600">
              ${statistics.totalProjectedAssessment.toLocaleString()}
            </div>
            <div className="text-sm text-gray-500 mt-1">
              Avg: ${statistics.avgProjectedValue.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Net Change</div>
            <div className={`text-2xl font-bold ${
              statistics.totalProjectedAssessment >= statistics.totalCurrentAssessment
                ? 'text-red-600'
                : 'text-green-600'
            }`}>
              {statistics.totalProjectedAssessment >= statistics.totalCurrentAssessment ? '+' : ''}
              ${(statistics.totalProjectedAssessment - statistics.totalCurrentAssessment).toLocaleString()}
            </div>
            <div className="text-sm text-gray-500 mt-1">
              {((statistics.totalProjectedAssessment - statistics.totalCurrentAssessment) / statistics.totalCurrentAssessment * 100).toFixed(2)}%
            </div>
          </div>
        </div>
      </div>

      {/* Change Distribution */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Change Distribution</h3>
        <div className="grid grid-cols-3 gap-6">
          <div className="flex items-center gap-4">
            <TrendingUp className="w-12 h-12 text-red-500" />
            <div>
              <div className="text-2xl font-bold text-red-600">{statistics.increasesCount.toLocaleString()}</div>
              <div className="text-sm text-gray-600">Increases</div>
              <div className="text-xs text-gray-500">Avg: +{statistics.avgIncrease.toFixed(2)}%</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <TrendingDown className="w-12 h-12 text-green-500" />
            <div>
              <div className="text-2xl font-bold text-green-600">{statistics.decreasesCount.toLocaleString()}</div>
              <div className="text-sm text-gray-600">Decreases</div>
              <div className="text-xs text-gray-500">Avg: {statistics.avgDecrease.toFixed(2)}%</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 flex items-center justify-center">
              <div className="w-8 h-0.5 bg-gray-400"></div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-600">{statistics.noChangeCount.toLocaleString()}</div>
              <div className="text-sm text-gray-600">No Change</div>
              <div className="text-xs text-gray-500">&lt; 0.1%</div>
            </div>
          </div>
        </div>
      </div>

      {/* VCS Breakdown */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">VCS Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left font-semibold text-gray-700">VCS</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Count</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Current Total</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Projected Total</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Change</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Change %</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">Market Data</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">CME</th>
              </tr>
            </thead>
            <tbody>
              {vcsSummary.map(vcs => (
                <tr key={vcs.vcs} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{vcs.vcs}</td>
                  <td className="px-4 py-3 text-right">{vcs.count.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">${vcs.currentTotal.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">${vcs.projectedTotal.toLocaleString()}</td>
                  <td className={`px-4 py-3 text-right font-medium ${
                    vcs.change >= 0 ? 'text-red-600' : 'text-green-600'
                  }`}>
                    {vcs.change >= 0 ? '+' : ''}${vcs.change.toLocaleString()}
                  </td>
                  <td className={`px-4 py-3 text-right ${
                    vcs.changePercent >= 0 ? 'text-red-600' : 'text-green-600'
                  }`}>
                    {vcs.changePercent >= 0 ? '+' : ''}{vcs.changePercent.toFixed(2)}%
                  </td>
                  <td className="px-4 py-3 text-center">{vcs.marketDataCount}</td>
                  <td className="px-4 py-3 text-center">{vcs.cmeCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Flagged Properties */}
      {statistics.flaggedProperties.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-600" />
            Properties Flagged for Review ({statistics.flaggedProperties.length})
          </h3>
          <div className="space-y-2">
            {statistics.flaggedProperties.slice(0, 20).map((item, idx) => (
              <div
                key={idx}
                className={`p-3 rounded border ${
                  item.severity === 'high'
                    ? 'bg-red-50 border-red-200'
                    : 'bg-yellow-50 border-yellow-200'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-medium">
                      {item.property.property_block}-{item.property.property_lot}-{item.property.property_qualifier}
                    </span>
                    <span className="text-gray-600 ml-2">{item.property.property_location}</span>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-medium ${
                      item.severity === 'high' ? 'text-red-700' : 'text-yellow-700'
                    }`}>
                      {item.reason}
                    </div>
                    <div className="text-xs text-gray-500 uppercase mt-1">
                      {item.severity} Priority
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {statistics.flaggedProperties.length > 20 && (
              <div className="text-center text-sm text-gray-600 pt-2">
                ... and {statistics.flaggedProperties.length - 20} more. Export for full list.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsTab;
