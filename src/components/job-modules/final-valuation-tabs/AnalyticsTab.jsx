import React, { useState, useMemo, useEffect } from 'react';
import { Download, Save, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import * as XLSX from 'xlsx-js-style';

const AnalyticsTab = ({ jobData, properties }) => {
  const [savedRuns, setSavedRuns] = useState([]);
  const [currentRunName, setCurrentRunName] = useState('');
  const [selectedRun, setSelectedRun] = useState(null);

  // Load saved runs
  useEffect(() => {
    if (jobData?.id) {
      loadSavedRuns();
    }
  }, [jobData?.id]);

  const loadSavedRuns = async () => {
    try {
      const { data, error } = await supabase
        .from('analytics_runs')
        .select('*')
        .eq('job_id', jobData.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSavedRuns(data || []);
    } catch (error) {
      console.error('Error loading saved runs:', error);
    }
  };

  // Calculate year prior to due year for sales period determination
  const yearPriorToDueYear = useMemo(() => {
    if (!jobData?.end_date) return new Date().getFullYear();
    const endYear = parseInt(jobData.end_date.substring(0, 4));
    return endYear - 1;
  }, [jobData?.end_date]);

  // Determine sales period for a property
  const getSalesPeriod = (salesDate) => {
    if (!salesDate) return null;
    
    const saleDate = new Date(salesDate);
    const assessmentYear = parseInt(jobData.end_date.substring(0, 4));

    // CSP (Current Sale Period): 10/1 of prior year → 12/31 of assessment year
    // For assessment date 1/1/2026 (stored as 12/31/2025): 10/1/2024 → 12/31/2025
    const cspStart = new Date(assessmentYear - 1, 9, 1);
    const cspEnd = new Date(assessmentYear, 11, 31);

    // PSP (Prior Sale Period): 10/1 of two years prior → 9/30 of prior year
    const pspStart = new Date(assessmentYear - 2, 9, 1);
    const pspEnd = new Date(assessmentYear - 1, 8, 30);

    // HSP (Historical Sale Period): 10/1 of three years prior → 9/30 of two years prior
    const hspStart = new Date(assessmentYear - 3, 9, 1);
    const hspEnd = new Date(assessmentYear - 2, 8, 30);
    
    if (saleDate >= cspStart && saleDate <= cspEnd) return 'CSP';
    if (saleDate >= pspStart && saleDate <= pspEnd) return 'PSP';
    if (saleDate >= hspStart && saleDate <= hspEnd) return 'HSP';
    return null;
  };

  // Calculate VCS analytics
  const vcsAnalytics = useMemo(() => {
    const vcsGroups = {};

    properties.forEach(prop => {
      // Prefer new_vcs (updated assignments) over property_vcs (original from file)
      const vcs = prop.new_vcs || prop.property_vcs || 'Unknown';
      
      if (!vcsGroups[vcs]) {
        vcsGroups[vcs] = {
          count: 0,
          oldLandTotal: 0,
          oldTotalValue: 0,
          newLandTotal: 0,
          newTotalValue: 0,
          hspSales: [],
          pspSales: [],
          cspSales: []
        };
      }
      
      const group = vcsGroups[vcs];
      group.count++;
      
      // Old (current) land allocation
      const currentLand = prop.values_mod_land || 0;
      const currentTotal = prop.values_mod_total || 0;
      group.oldLandTotal += currentLand;
      group.oldTotalValue += currentTotal;
      
      // New (projected) land allocation - using CAMA values
      const newLand = prop.values_cama_land || 0;
      const newTotal = prop.values_cama_total || 0;
      group.newLandTotal += newLand;
      group.newTotalValue += newTotal;
      
      // Sales ratios by period
      if (prop.sales_date && prop.values_norm_time && newTotal > 0) {
        const salesPeriod = getSalesPeriod(prop.sales_date);
        const ratio = (newTotal / prop.values_norm_time) * 100;
        
        if (salesPeriod === 'HSP') {
          group.hspSales.push(ratio);
        } else if (salesPeriod === 'PSP') {
          group.pspSales.push(ratio);
        } else if (salesPeriod === 'CSP') {
          group.cspSales.push(ratio);
        }
      }
    });
    
    // Calculate percentages and averages
    const results = Object.entries(vcsGroups).map(([vcs, data]) => {
      const oldLandPct = data.oldTotalValue > 0 ? (data.oldLandTotal / data.oldTotalValue) * 100 : 0;
      const newLandPct = data.newTotalValue > 0 ? (data.newLandTotal / data.newTotalValue) * 100 : 0;
      const delta = newLandPct - oldLandPct;
      
      const avgHSP = data.hspSales.length > 0 
        ? data.hspSales.reduce((a, b) => a + b, 0) / data.hspSales.length 
        : null;
      const avgPSP = data.pspSales.length > 0 
        ? data.pspSales.reduce((a, b) => a + b, 0) / data.pspSales.length 
        : null;
      const avgCSP = data.cspSales.length > 0 
        ? data.cspSales.reduce((a, b) => a + b, 0) / data.cspSales.length 
        : null;
      
      return {
        vcs,
        count: data.count,
        oldLandPct,
        newLandPct,
        delta,
        hsp: avgHSP,
        psp: avgPSP,
        csp: avgCSP
      };
    }).sort((a, b) => a.vcs.localeCompare(b.vcs));
    
    // Calculate totals
    const totalCount = results.reduce((sum, r) => sum + r.count, 0);
    const totalOldLand = Object.values(vcsGroups).reduce((sum, g) => sum + g.oldLandTotal, 0);
    const totalOldValue = Object.values(vcsGroups).reduce((sum, g) => sum + g.oldTotalValue, 0);
    const totalNewLand = Object.values(vcsGroups).reduce((sum, g) => sum + g.newLandTotal, 0);
    const totalNewValue = Object.values(vcsGroups).reduce((sum, g) => sum + g.newTotalValue, 0);
    
    const avgOldLandPct = totalOldValue > 0 ? (totalOldLand / totalOldValue) * 100 : 0;
    const avgNewLandPct = totalNewValue > 0 ? (totalNewLand / totalNewValue) * 100 : 0;
    const avgDelta = avgNewLandPct - avgOldLandPct;
    
    // Calculate true averages for sales ratios (across all properties, not VCS averages)
    const allHSP = Object.values(vcsGroups).flatMap(g => g.hspSales);
    const allPSP = Object.values(vcsGroups).flatMap(g => g.pspSales);
    const allCSP = Object.values(vcsGroups).flatMap(g => g.cspSales);
    
    const avgHSP = allHSP.length > 0 ? allHSP.reduce((a, b) => a + b, 0) / allHSP.length : null;
    const avgPSP = allPSP.length > 0 ? allPSP.reduce((a, b) => a + b, 0) / allPSP.length : null;
    const avgCSP = allCSP.length > 0 ? allCSP.reduce((a, b) => a + b, 0) / allCSP.length : null;
    
    return {
      data: results,
      totals: {
        count: totalCount,
        oldLandPct: avgOldLandPct,
        newLandPct: avgNewLandPct,
        delta: avgDelta,
        hsp: avgHSP,
        psp: avgPSP,
        csp: avgCSP
      }
    };
  }, [properties, jobData?.end_date]);

  // Save current run
  const handleSaveRun = async () => {
    if (!currentRunName.trim()) {
      alert('Please enter a name for this run');
      return;
    }

    try {
      const runData = {
        job_id: jobData.id,
        run_name: currentRunName,
        run_data: vcsAnalytics,
        created_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('analytics_runs')
        .insert(runData);

      if (error) throw error;

      setCurrentRunName('');
      loadSavedRuns();
      alert('Run saved successfully!');
    } catch (error) {
      console.error('Error saving run:', error);
      alert('Error saving run: ' + error.message);
    }
  };

  // Delete a saved run
  const handleDeleteRun = async (runId) => {
    if (!window.confirm('Are you sure you want to delete this run?')) return;

    try {
      const { error } = await supabase
        .from('analytics_runs')
        .delete()
        .eq('id', runId);

      if (error) throw error;
      
      if (selectedRun?.id === runId) setSelectedRun(null);
      loadSavedRuns();
    } catch (error) {
      console.error('Error deleting run:', error);
      alert('Error deleting run: ' + error.message);
    }
  };

  // Export to Excel
  const exportToExcel = (data = vcsAnalytics) => {
    const workbook = XLSX.utils.book_new();

    const headers = ['VCS', 'Count', 'Old%All', 'New%AL', 'Delta', 'HSP', 'PSP', 'CSP'];
    const rows = [headers];

    data.data.forEach(row => {
      rows.push([
        row.vcs,
        row.count,
        row.oldLandPct / 100, // Convert to decimal for Excel percentage
        row.newLandPct / 100,
        row.delta / 100,
        row.hsp !== null ? row.hsp / 100 : '',
        row.psp !== null ? row.psp / 100 : '',
        row.csp !== null ? row.csp / 100 : ''
      ]);
    });

    // Add totals row
    rows.push([
      '',
      data.totals.count,
      data.totals.oldLandPct / 100,
      data.totals.newLandPct / 100,
      data.totals.delta / 100,
      data.totals.hsp !== null ? data.totals.hsp / 100 : '',
      data.totals.psp !== null ? data.totals.psp / 100 : '',
      data.totals.csp !== null ? data.totals.csp / 100 : ''
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const range = XLSX.utils.decode_range(worksheet['!ref']);

    // Format header
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: C });
      worksheet[cellAddress].s = {
        font: { bold: true },
        alignment: { horizontal: 'center' },
        fill: { fgColor: { rgb: 'E5E7EB' } }
      };
    }

    // Format data rows
    for (let R = 1; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (worksheet[cellAddress]) {
          worksheet[cellAddress].s = {
            alignment: { horizontal: 'center' }
          };
          
          // Apply percentage format to columns 2-7 (C, D, E, F, G, H in 0-indexed)
          if (C >= 2 && C <= 7) {
            worksheet[cellAddress].z = '0%';
          }
        }
      }
    }

    // Format totals row (last row) with bold
    const totalsRow = range.e.r;
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: totalsRow, c: C });
      if (worksheet[cellAddress]) {
        worksheet[cellAddress].s = {
          ...worksheet[cellAddress].s,
          font: { bold: true },
          fill: { fgColor: { rgb: 'DBEAFE' } }
        };
      }
    }

    worksheet['!cols'] = Array(8).fill({ wch: 12 });

    XLSX.utils.book_append_sheet(workbook, worksheet, 'VCS Analysis');
    XLSX.writeFile(workbook, `VCS_Analysis_${jobData.job_name}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const displayData = selectedRun ? selectedRun.run_data : vcsAnalytics;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">VCS Analysis (XSP-PSP-CSP)</h2>
          <p className="text-sm text-gray-600 mt-1">
            Analyze land allocations and sales ratios by VCS code
          </p>
        </div>
        <button
          onClick={() => exportToExcel(displayData)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Download className="w-4 h-4" />
          Export to Excel
        </button>
      </div>

      {/* Save Run Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-4">
          <input
            type="text"
            value={currentRunName}
            onChange={(e) => setCurrentRunName(e.target.value)}
            placeholder="Enter run name..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
          />
          <button
            onClick={handleSaveRun}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            <Save className="w-4 h-4" />
            Save Current Run
          </button>
        </div>
      </div>

      {/* Saved Runs */}
      {savedRuns.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Saved Runs</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedRun(null)}
              className={`px-3 py-2 rounded-lg border ${
                !selectedRun 
                  ? 'bg-blue-600 text-white border-blue-600' 
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Current Data
            </button>
            {savedRuns.map(run => (
              <div key={run.id} className="flex items-center gap-1">
                <button
                  onClick={() => setSelectedRun(run)}
                  className={`px-3 py-2 rounded-l-lg border ${
                    selectedRun?.id === run.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {run.run_name}
                </button>
                <button
                  onClick={() => handleDeleteRun(run.id)}
                  className="px-2 py-2 bg-red-100 text-red-600 rounded-r-lg border border-l-0 border-red-300 hover:bg-red-200"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          {selectedRun && (
            <div className="mt-2 text-sm text-gray-600">
              Viewing run from: {new Date(selectedRun.created_at).toLocaleString()}
            </div>
          )}
        </div>
      )}

      {/* VCS Analysis Table */}
      <div className="bg-white rounded-lg border border-gray-300 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-100 border-b border-gray-300">
            <tr>
              <th className="px-4 py-3 text-center text-sm font-bold text-gray-700">VCS</th>
              <th className="px-4 py-3 text-center text-sm font-bold text-gray-700">Count</th>
              <th className="px-4 py-3 text-center text-sm font-bold text-gray-700">Old%All</th>
              <th className="px-4 py-3 text-center text-sm font-bold text-gray-700">New%AL</th>
              <th className="px-4 py-3 text-center text-sm font-bold text-gray-700">Delta</th>
              <th className="px-4 py-3 text-center text-sm font-bold text-gray-700" style={{ backgroundColor: '#FED7AA' }}>HSP</th>
              <th className="px-4 py-3 text-center text-sm font-bold text-gray-700" style={{ backgroundColor: '#D1ECF1' }}>PSP</th>
              <th className="px-4 py-3 text-center text-sm font-bold text-gray-700" style={{ backgroundColor: '#D4EDDA' }}>CSP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {displayData.data.map((row) => (
              <tr key={row.vcs} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-center font-medium text-gray-900">{row.vcs}</td>
                <td className="px-4 py-2 text-center">{row.count}</td>
                <td className="px-4 py-2 text-center">{row.oldLandPct.toFixed(0)}%</td>
                <td className="px-4 py-2 text-center">{row.newLandPct.toFixed(0)}%</td>
                <td className="px-4 py-2 text-center">{row.delta.toFixed(0)}%</td>
                <td className="px-4 py-2 text-center" style={{ backgroundColor: '#FED7AA' }}>{row.hsp !== null ? `${row.hsp.toFixed(0)}%` : '-'}</td>
                <td className="px-4 py-2 text-center" style={{ backgroundColor: '#D1ECF1' }}>{row.psp !== null ? `${row.psp.toFixed(0)}%` : '-'}</td>
                <td className="px-4 py-2 text-center" style={{ backgroundColor: '#D4EDDA' }}>{row.csp !== null ? `${row.csp.toFixed(0)}%` : '-'}</td>
              </tr>
            ))}
            {/* Totals Row */}
            <tr className="bg-blue-50 border-t-2 border-blue-300 font-bold">
              <td className="px-4 py-3 text-center text-gray-900">TOTALS</td>
              <td className="px-4 py-3 text-center">{displayData.totals.count.toLocaleString()}</td>
              <td className="px-4 py-3 text-center">{displayData.totals.oldLandPct.toFixed(0)}%</td>
              <td className="px-4 py-3 text-center">{displayData.totals.newLandPct.toFixed(0)}%</td>
              <td className="px-4 py-3 text-center">{displayData.totals.delta.toFixed(0)}%</td>
              <td className="px-4 py-3 text-center" style={{ backgroundColor: '#FED7AA' }}>{displayData.totals.hsp !== null ? `${displayData.totals.hsp.toFixed(0)}%` : '-'}</td>
              <td className="px-4 py-3 text-center" style={{ backgroundColor: '#D1ECF1' }}>{displayData.totals.psp !== null ? `${displayData.totals.psp.toFixed(0)}%` : '-'}</td>
              <td className="px-4 py-3 text-center" style={{ backgroundColor: '#D4EDDA' }}>{displayData.totals.csp !== null ? `${displayData.totals.csp.toFixed(0)}%` : '-'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AnalyticsTab;
