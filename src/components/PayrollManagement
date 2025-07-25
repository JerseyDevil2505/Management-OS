import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const PayrollManagement = () => {
  const [activeTab, setActiveTab] = useState('current');
  const [payrollData, setPayrollData] = useState([]);
  const [payrollPeriod, setPayrollPeriod] = useState({
    startDate: '',
    endDate: '',
    expectedHours: 88 // Bimonthly default
  });
  const [uploadedFile, setUploadedFile] = useState(null);
  const [validationResults, setValidationResults] = useState(null);
  const [inspectionBonuses, setInspectionBonuses] = useState({});
  const [isProcessing, setIsProcessing] = useState(false);

  // Mock payroll data from Office Manager's sheet
  const mockPayrollData = [
    { name: "Aguilar, Jared", hours: 40, fieldOT: 108, comments: "Part Time: Works M, W, F", issues: ["Part-time hours look correct"] },
    { name: "Baker, Jarett B", hours: 88, fieldOT: 376, comments: "", issues: [] },
    { name: "Bestine, Christopher", hours: 72, fieldOT: 162, comments: "Chris works M, T, W, Th", issues: ["72 hours seems low for full-time"] },
    { name: "Breining, Ronald", hours: 8, fieldOT: 0, comments: "", issues: ["⚠️ 8 hours - should this be 88?"] },
    { name: "Brogan, Michael", hours: "same", fieldOT: 0, comments: "", issues: ["🚨 'same' is not a number!"] },
    { name: "Burrows, Kyle J", hours: 80, fieldOT: 228, comments: "OUT OF PTO", issues: ["80 hours vs expected 88"] },
    { name: "Buscemi, Richard", hours: "same", fieldOT: 0, comments: "", issues: ["🚨 'same' is not a number!"] },
    { name: "Damico, Leann", hours: "same", fieldOT: 0, comments: "", issues: ["🚨 'same' is not a number!"] }
  ];

  // Mock inspection bonus data
  const mockInspectionBonuses = {
    "Baker, Jarett B": { inspections: 45, bonus: 90 },
    "Bestine, Christopher": { inspections: 32, bonus: 64 },
    "Burrows, Kyle J": { inspections: 38, bonus: 76 },
    "Aguilar, Jared": { inspections: 28, bonus: 56 }
  };

  useEffect(() => {
    // Set default payroll period (bimonthly)
    const today = new Date();
    const isFirstHalf = today.getDate() <= 15;
    
    if (isFirstHalf) {
      setPayrollPeriod({
        startDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
        endDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-15`,
        expectedHours: 80 // First half typically 80 hours
      });
    } else {
      setPayrollPeriod({
        startDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-16`,
        endDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-31`,
        expectedHours: 88 // Second half typically 88 hours
      });
    }

    // Load mock data
    setPayrollData(mockPayrollData);
    setInspectionBonuses(mockInspectionBonuses);
  }, []);

  const calculateInspectionBonuses = async () => {
    setIsProcessing(true);
    try {
      // Mock calculation - would query inspection_data in real app
      console.log('Calculating inspection bonuses for period:', payrollPeriod);
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Mock results
      const bonusResults = {};
      payrollData.forEach(employee => {
        if (mockInspectionBonuses[employee.name]) {
          bonusResults[employee.name] = mockInspectionBonuses[employee.name];
        }
      });
      
      setInspectionBonuses(bonusResults);
    } catch (error) {
      console.error('Error calculating bonuses:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const validatePayrollSheet = (data) => {
    const issues = [];
    const warnings = [];
    
    data.forEach((row, index) => {
      // Check for "same" entries
      if (row.hours === "same") {
        issues.push(`Row ${index + 1}: "${row.name}" has "same" instead of hours`);
      }
      
      // Check for obviously wrong hours (like 8 instead of 88)
      if (typeof row.hours === 'number' && row.hours < 20 && row.comments !== "Part Time") {
        warnings.push(`Row ${index + 1}: "${row.name}" has ${row.hours} hours - seems low`);
      }
      
      // Check expected hours for period
      if (typeof row.hours === 'number' && Math.abs(row.hours - payrollPeriod.expectedHours) > 10) {
        warnings.push(`Row ${index + 1}: "${row.name}" has ${row.hours} hours, expected ~${payrollPeriod.expectedHours}`);
      }
    });
    
    return { issues, warnings };
  };

  const exportToADP = () => {
    const adpData = payrollData.map(employee => {
      const bonus = inspectionBonuses[employee.name]?.bonus || 0;
      return {
        name: employee.name,
        hours: typeof employee.hours === 'number' ? employee.hours : 0,
        inspectionBonus: bonus,
        total: (typeof employee.hours === 'number' ? employee.hours : 0) + bonus
      };
    });
    
    // Convert to CSV
    const headers = ['Employee Name', 'Hours', 'Inspection Bonus', 'Total'];
    const csvContent = [
      headers.join(','),
      ...adpData.map(row => [row.name, row.hours, row.inspectionBonus, row.total].join(','))
    ].join('\n');
    
    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll_${payrollPeriod.startDate}_to_${payrollPeriod.endDate}.csv`;
    a.click();
  };

  const getRowColor = (employee) => {
    if (employee.issues.some(issue => issue.includes('🚨'))) return 'bg-red-50 border-red-200';
    if (employee.issues.some(issue => issue.includes('⚠️'))) return 'bg-yellow-50 border-yellow-200';
    return 'bg-white border-gray-200';
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Payroll Management</h1>
        <p className="text-gray-600">Office Manager chaos detector & inspection bonus calculator</p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('current')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'current'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Current Payroll
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'history'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Payroll History
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'settings'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Settings
          </button>
        </nav>
      </div>

      {/* Current Payroll Tab */}
      {activeTab === 'current' && (
        <div className="space-y-6">
          {/* Payroll Period Setup */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">Payroll Period Setup</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={payrollPeriod.startDate}
                  onChange={(e) => setPayrollPeriod(prev => ({ ...prev, startDate: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={payrollPeriod.endDate}
                  onChange={(e) => setPayrollPeriod(prev => ({ ...prev, endDate: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expected Hours</label>
                <select
                  value={payrollPeriod.expectedHours}
                  onChange={(e) => setPayrollPeriod(prev => ({ ...prev, expectedHours: parseInt(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value={80}>80 hours (1st-15th)</option>
                  <option value={88}>88 hours (16th-31st)</option>
                  <option value={72}>72 hours (custom)</option>
                </select>
              </div>
            </div>
            
            <div className="mt-4 flex space-x-3">
              <button
                onClick={calculateInspectionBonuses}
                disabled={isProcessing}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {isProcessing ? 'Calculating...' : 'Calculate Inspection Bonuses'}
              </button>
              <button
                onClick={exportToADP}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                Export to ADP
              </button>
            </div>
          </div>

          {/* File Upload Area */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">Office Manager's Payroll Sheet</h2>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <div className="space-y-2">
                <div className="text-sm text-gray-600">Upload Excel file from Office Manager</div>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setUploadedFile(e.target.files[0])}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>
            </div>
          </div>

          {/* Payroll Data Review */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">Payroll Data Review</h2>
            
            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-md">
                <p className="text-sm text-blue-600">Total Employees</p>
                <p className="text-2xl font-semibold text-blue-900">{payrollData.length}</p>
              </div>
              <div className="bg-red-50 p-4 rounded-md">
                <p className="text-sm text-red-600">Critical Issues</p>
                <p className="text-2xl font-semibold text-red-900">
                  {payrollData.filter(emp => emp.issues.some(issue => issue.includes('🚨'))).length}
                </p>
              </div>
              <div className="bg-yellow-50 p-4 rounded-md">
                <p className="text-sm text-yellow-600">Warnings</p>
                <p className="text-2xl font-semibold text-yellow-900">
                  {payrollData.filter(emp => emp.issues.some(issue => issue.includes('⚠️'))).length}
                </p>
              </div>
              <div className="bg-green-50 p-4 rounded-md">
                <p className="text-sm text-green-600">Total Inspection Bonus</p>
                <p className="text-2xl font-semibold text-green-900">
                  ${Object.values(inspectionBonuses).reduce((sum, emp) => sum + (emp.bonus || 0), 0)}
                </p>
              </div>
            </div>

            {/* Employee Data Table */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Employee</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Hours</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Field OT</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Inspections</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Bonus</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {payrollData.map((employee, index) => {
                    const bonusData = inspectionBonuses[employee.name];
                    return (
                      <tr key={index} className={getRowColor(employee)}>
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{employee.name}</td>
                        <td className="px-4 py-2 text-sm text-gray-900">
                          {typeof employee.hours === 'number' ? employee.hours : (
                            <span className="text-red-600 font-medium">{employee.hours}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-900">{employee.fieldOT}</td>
                        <td className="px-4 py-2 text-sm text-gray-900">
                          {bonusData ? bonusData.inspections : '-'}
                        </td>
                        <td className="px-4 py-2 text-sm font-medium text-green-600">
                          {bonusData ? `$${bonusData.bonus}` : '-'}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          {employee.issues.map((issue, idx) => (
                            <div key={idx} className={`text-xs px-2 py-1 rounded-full mb-1 ${
                              issue.includes('🚨') ? 'bg-red-100 text-red-800' :
                              issue.includes('⚠️') ? 'bg-yellow-100 text-yellow-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {issue}
                            </div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-600">Payroll history will appear here</p>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-xl font-semibold mb-4">Payroll Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Inspection Bonus Rate (per house)
              </label>
              <input
                type="number"
                step="0.01"
                defaultValue="2.00"
                className="w-32 px-3 py-2 border border-gray-300 rounded-md"
              />
              <span className="ml-2 text-sm text-gray-600">$2.00 per valid residential inspection</span>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payroll Submission Deadline
              </label>
              <input
                type="number"
                defaultValue="48"
                className="w-20 px-3 py-2 border border-gray-300 rounded-md"
              />
              <span className="ml-2 text-sm text-gray-600">hours before payday</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PayrollManagement;
