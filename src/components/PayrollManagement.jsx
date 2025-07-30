import React, { useState, useEffect } from 'react';
import { supabase, employeeService, jobService } from '../lib/supabaseClient';
import * as XLSX from 'xlsx';

const PayrollManagement = () => {
  const [activeTab, setActiveTab] = useState('current');
  const [payrollData, setPayrollData] = useState([]);
  const [payrollPeriod, setPayrollPeriod] = useState({
    startDate: '',
    endDate: '',
    expectedHours: 96 // Default for 07/15-07/31
  });
  const [uploadedFile, setUploadedFile] = useState(null);
  const [inspectionBonuses, setInspectionBonuses] = useState({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState('all');
  const [payrollHistory, setPayrollHistory] = useState([]);
  const [lastPayrollDate, setLastPayrollDate] = useState(null);
  const [bonusRate, setBonusRate] = useState(2.00);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [nameMatching, setNameMatching] = useState({});
  const [showMatchingModal, setShowMatchingModal] = useState(false);
  const [unmatchedNames, setUnmatchedNames] = useState([]);

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      // Load employees (only residential and management inspectors)
      const employeeData = await employeeService.getAll();
      const eligibleEmployees = employeeData.filter(emp => 
        emp.employment_status === 'active' && 
        ['residential', 'management'].includes(emp.inspector_type?.toLowerCase())
      );
      setEmployees(eligibleEmployees);

      // Load active jobs
      const jobData = await jobService.getAll();
      setJobs(jobData.filter(job => job.status === 'active'));

      // Load last payroll run date
      const { data: lastRun, error: lastRunError } = await supabase
        .from('payroll_periods')
        .select('end_date')
        .order('end_date', { ascending: false })
        .limit(1)
        .single();
      
      if (!lastRunError && lastRun) {
        setLastPayrollDate(lastRun.end_date);
        console.log('Last payroll run date:', lastRun.end_date);
      }

      // Load payroll history
      const { data: history, error } = await supabase
        .from('payroll_periods')
        .select('*')
        .order('end_date', { ascending: false })
        .limit(10);
      
      if (!error && history) {
        setPayrollHistory(history);
      }
    } catch (error) {
      console.error('Error loading initial data:', error);
      setError('Failed to load initial data');
    }
  };

  const calculateInspectionBonuses = async () => {
    setIsProcessing(true);
    setError(null);
    setSuccessMessage(null);
    
    try {
      // Determine the date range
      const startDate = lastPayrollDate || payrollPeriod.startDate;
      const endDate = payrollPeriod.endDate;
      
      console.log(`Calculating bonuses from ${startDate} to ${endDate}`);
      
      // Get all initials from eligible employees
      const validInitials = employees
        .filter(emp => emp.initials)
        .map(emp => emp.initials.toUpperCase().trim());
      
      console.log('Valid inspector initials:', validInitials);

      // Count total records first
      const { count, error: countError } = await supabase
        .from('inspection_data')
        .select('*', { count: 'exact', head: true })
        .gt('measure_date', startDate)
        .lte('measure_date', endDate)
        .in('measure_by', validInitials)
        .in('property_class', ['2', '3A']);

      if (countError) throw countError;
      
      console.log(`Total inspections to process: ${count}`);

      // Process in batches of 1000
      const batchSize = 1000;
      const batches = Math.ceil(count / batchSize);
      const allInspections = [];

      for (let i = 0; i < batches; i++) {
        const from = i * batchSize;
        const to = from + batchSize - 1;
        
        console.log(`Fetching batch ${i + 1}/${batches} (records ${from}-${to})`);
        
        let query = supabase
          .from('inspection_data')
          .select('measure_by, measure_date, property_class, property_composite_key, property_location, job_id')
          .gt('measure_date', startDate)
          .lte('measure_date', endDate)
          .in('measure_by', validInitials)
          .in('property_class', ['2', '3A'])
          .range(from, to);

        // Filter by job if selected
        if (selectedJob !== 'all') {
          query = query.eq('job_id', selectedJob);
        }

        const { data: batch, error: batchError } = await query;
        if (batchError) throw batchError;
        
        allInspections.push(...batch);
      }

      console.log(`Total inspections fetched: ${allInspections.length}`);

      // Group inspections by inspector
      const inspectorCounts = {};
      
      allInspections.forEach(inspection => {
        const initials = inspection.measure_by.toUpperCase().trim();
        
        if (!inspectorCounts[initials]) {
          inspectorCounts[initials] = {
            count: 0,
            details: []
          };
        }
        
        inspectorCounts[initials].count++;
        inspectorCounts[initials].details.push({
          property_id: inspection.property_composite_key,
          date: inspection.measure_date,
          class: inspection.property_class,
          location: inspection.property_location
        });
      });

      // Calculate bonuses by employee name
      const bonusResults = {};
      
      employees.forEach(employee => {
        const employeeName = `${employee.first_name} ${employee.last_name}`;
        const empInitials = employee.initials?.toUpperCase().trim();
        
        if (empInitials && inspectorCounts[empInitials]) {
          const count = inspectorCounts[empInitials].count;
          bonusResults[employeeName] = {
            initials: empInitials,
            inspections: count,
            bonus: count * bonusRate,
            details: inspectorCounts[empInitials].details
          };
        } else {
          bonusResults[employeeName] = {
            initials: empInitials || 'N/A',
            inspections: 0,
            bonus: 0,
            details: []
          };
        }
      });
      
      setInspectionBonuses(bonusResults);
      setSuccessMessage(`Successfully calculated bonuses for ${Object.keys(bonusResults).length} employees (${allInspections.length} total inspections)`);
    } catch (error) {
      console.error('Error calculating bonuses:', error);
      setError('Failed to calculate inspection bonuses: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const processUploadedFile = async (file) => {
    if (!file) return;
    
    setIsProcessing(true);
    setError(null);
    
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        
        // Parse employee data starting from row 6 (index 5)
        const parsedData = [];
        const unmatched = [];
        
        for (let i = 5; i < rawData.length; i++) {
          const row = rawData[i];
          if (row[0] && typeof row[0] === 'string' && !row[0].includes('TOTAL HOURS')) {
            const worksheetName = row[0].trim();
            
            // Try to match with database employees
            const dbEmployee = employees.find(emp => {
              const dbName = `${emp.last_name}, ${emp.first_name}`;
              const altDbName = `${emp.first_name} ${emp.last_name}`;
              return dbName.toLowerCase() === worksheetName.toLowerCase() ||
                     altDbName.toLowerCase() === worksheetName.toLowerCase() ||
                     worksheetName.toLowerCase().includes(emp.last_name.toLowerCase());
            });
            
            if (!dbEmployee) {
              unmatched.push(worksheetName);
            }
            
            parsedData.push({
              worksheetName: worksheetName,
              dbEmployee: dbEmployee,
              hours: row[1],
              vacaPerUnpaid: row[2],
              apptOT: row[3],
              fieldOT: row[4],
              total: row[5],
              comments: row[6],
              issues: []
            });
          }
        }
        
        // Validate the data
        parsedData.forEach((emp, index) => {
          if (emp.hours === 'same') {
            emp.issues.push(`🚨 "same" instead of hours`);
          } else if (typeof emp.hours === 'number' && emp.hours < 80 && !emp.comments?.toLowerCase().includes('part time')) {
            emp.issues.push(`⚠️ Low hours: ${emp.hours}`);
          }
          
          if (!emp.dbEmployee) {
            emp.issues.push(`❓ No database match found`);
          }
        });
        
        setPayrollData(parsedData);
        
        // If there are unmatched names, show matching modal
        if (unmatched.length > 0) {
          setUnmatchedNames(unmatched);
          setShowMatchingModal(true);
        }
        
        // Extract pay period from the sheet if available
        if (rawData[4] && rawData[4][0]) {
          const periodText = rawData[4][0];
          const periodMatch = periodText.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
          if (periodMatch) {
            const startDate = new Date(periodMatch[1]).toISOString().split('T')[0];
            const endDate = new Date(periodMatch[2]).toISOString().split('T')[0];
            setPayrollPeriod(prev => ({ ...prev, startDate, endDate }));
          }
        }
      };
      
      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error('Error processing file:', error);
      setError('Failed to process uploaded file: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const mergePayrollWithBonuses = () => {
    if (payrollData.length === 0) return [];
    
    return payrollData.map(emp => {
      let bonus = 0;
      let inspections = 0;
      
      if (emp.dbEmployee) {
        const employeeName = `${emp.dbEmployee.first_name} ${emp.dbEmployee.last_name}`;
        const bonusData = inspectionBonuses[employeeName];
        if (bonusData) {
          bonus = bonusData.bonus;
          inspections = bonusData.inspections;
        }
      }
      
      return {
        ...emp,
        calculatedFieldOT: bonus,
        inspectionCount: inspections
      };
    });
  };

  const exportToADP = () => {
    const exportData = [];
    
    if (payrollData.length > 0) {
      // Use merged payroll + bonus data
      const mergedData = mergePayrollWithBonuses();
      mergedData.forEach(emp => {
        exportData.push({
          name: emp.worksheetName,
          hours: typeof emp.hours === 'number' ? emp.hours : 0,
          inspectionCount: emp.inspectionCount,
          inspectionBonus: emp.calculatedFieldOT
        });
      });
    } else {
      // Use inspection bonuses only
      Object.entries(inspectionBonuses).forEach(([name, data]) => {
        exportData.push({
          name: name,
          hours: 0, // No hours data without worksheet
          inspectionCount: data.inspections,
          inspectionBonus: data.bonus
        });
      });
    }
    
    // Convert to CSV
    const headers = ['Employee Name', 'Regular Hours', 'Inspection Count', 'Field OT ($)'];
    const csvContent = [
      headers.join(','),
      ...exportData.map(row => [
        `"${row.name}"`,
        row.hours,
        row.inspectionCount,
        row.inspectionBonus.toFixed(2)
      ].join(','))
    ].join('\n');
    
    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LOJIK_payroll_${payrollPeriod.startDate}_to_${payrollPeriod.endDate}_with_bonuses.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const savePayrollPeriod = async () => {
    try {
      const totalBonuses = Object.values(inspectionBonuses).reduce((sum, emp) => sum + (emp.bonus || 0), 0);
      const totalInspections = Object.values(inspectionBonuses).reduce((sum, emp) => sum + emp.inspections, 0);
      
      const { data, error } = await supabase
        .from('payroll_periods')
        .insert({
          start_date: lastPayrollDate || payrollPeriod.startDate,
          end_date: payrollPeriod.endDate,
          expected_hours: payrollPeriod.expectedHours,
          total_employees: employees.length,
          total_bonuses: totalBonuses,
          total_inspections: totalInspections,
          created_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) throw error;
      
      // Save individual entries
      const entries = Object.entries(inspectionBonuses).map(([name, data]) => ({
        payroll_period_id: data.id,
        employee_name: name,
        employee_initials: data.initials,
        inspection_count: data.inspections,
        bonus_amount: data.bonus,
        bonus_rate: bonusRate
      }));
      
      if (entries.length > 0) {
        const { error: entriesError } = await supabase
          .from('payroll_entries')
          .insert(entries);
        
        if (entriesError) throw entriesError;
      }
      
      setSuccessMessage('Payroll period saved successfully! This date is now the new baseline for next payroll.');
      loadInitialData(); // Refresh to get new last payroll date
    } catch (error) {
      console.error('Error saving payroll period:', error);
      setError('Failed to save payroll period: ' + error.message);
    }
  };

  const getRowColor = (employee) => {
    if (employee.issues?.some(issue => issue.includes('🚨'))) return 'bg-red-50 border-red-200';
    if (employee.issues?.some(issue => issue.includes('⚠️'))) return 'bg-yellow-50 border-yellow-200';
    if (employee.issues?.some(issue => issue.includes('❓'))) return 'bg-gray-50 border-gray-200';
    return 'bg-white border-gray-200';
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Payroll Management</h1>
        <p className="text-gray-600">Office Manager chaos detector & inspection bonus calculator</p>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-800">{error}</p>
        </div>
      )}
      {successMessage && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-md">
          <p className="text-green-800">{successMessage}</p>
        </div>
      )}

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
            
            {lastPayrollDate && (
              <div className="mb-4 p-3 bg-blue-50 rounded-md">
                <p className="text-sm text-blue-800">
                  <strong>Last payroll date:</strong> {new Date(lastPayrollDate).toLocaleDateString()} 
                  (inspections after this date will be counted)
                </p>
              </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={payrollPeriod.startDate}
                  onChange={(e) => setPayrollPeriod(prev => ({ ...prev, startDate: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  disabled={!!lastPayrollDate}
                />
                {lastPayrollDate && (
                  <p className="text-xs text-gray-500 mt-1">Using last payroll date</p>
                )}
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
                  <option value={88}>88 hours (16th-30th)</option>
                  <option value={96}>96 hours (16th-31st)</option>
                  <option value={72}>72 hours (custom)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Job Filter</label>
                <select
                  value={selectedJob}
                  onChange={(e) => setSelectedJob(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="all">All Active Jobs</option>
                  {jobs.map(job => (
                    <option key={job.id} value={job.id}>
                      {job.ccdd} - {job.job_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="mt-4 flex space-x-3">
              <button
                onClick={calculateInspectionBonuses}
                disabled={isProcessing || !payrollPeriod.endDate}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {isProcessing ? 'Calculating...' : 'Calculate Inspection Bonuses'}
              </button>
              <button
                onClick={savePayrollPeriod}
                disabled={Object.keys(inspectionBonuses).length === 0}
                className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
              >
                Save Payroll Period
              </button>
            </div>
          </div>

          {/* File Upload Area */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">Upload Office Manager's Payroll Sheet</h2>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <div className="space-y-2">
                <div className="text-sm text-gray-600">Upload Excel file to match worksheet names and validate hours</div>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    setUploadedFile(file);
                    if (file) processUploadedFile(file);
                  }}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>
            </div>
          </div>

          {/* Payroll Data Review (if worksheet uploaded) */}
          {payrollData.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-xl font-semibold mb-4">Payroll Worksheet Review</h2>
              
              {/* Summary Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-blue-50 p-4 rounded-md">
                  <p className="text-sm text-blue-600">Total Employees</p>
                  <p className="text-2xl font-semibold text-blue-900">{payrollData.length}</p>
                </div>
                <div className="bg-red-50 p-4 rounded-md">
                  <p className="text-sm text-red-600">"Same" Entries</p>
                  <p className="text-2xl font-semibold text-red-900">
                    {payrollData.filter(emp => emp.hours === 'same').length}
                  </p>
                </div>
                <div className="bg-yellow-50 p-4 rounded-md">
                  <p className="text-sm text-yellow-600">Unmatched Names</p>
                  <p className="text-2xl font-semibold text-yellow-900">
                    {payrollData.filter(emp => !emp.dbEmployee).length}
                  </p>
                </div>
                <div className="bg-green-50 p-4 rounded-md">
                  <p className="text-sm text-green-600">Total Field Bonuses</p>
                  <p className="text-2xl font-semibold text-green-900">
                    ${mergePayrollWithBonuses().reduce((sum, emp) => sum + emp.calculatedFieldOT, 0).toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Employee Data Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Worksheet Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">DB Match</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Hours</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Inspections</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Field Bonus</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Issues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {mergePayrollWithBonuses().map((employee, index) => (
                      <tr key={index} className={getRowColor(employee)}>
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{employee.worksheetName}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">
                          {employee.dbEmployee ? (
                            <span className="text-green-600">✓ {employee.dbEmployee.initials}</span>
                          ) : (
                            <span className="text-red-600">✗ No match</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-900">
                          {typeof employee.hours === 'number' ? employee.hours : (
                            <span className="text-red-600 font-medium">{employee.hours}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-900">{employee.inspectionCount}</td>
                        <td className="px-4 py-2 text-sm font-medium text-green-600">
                          ${employee.calculatedFieldOT.toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          {employee.issues.map((issue, idx) => (
                            <div key={idx} className="text-xs mb-1">
                              {issue}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="mt-4">
                <button
                  onClick={exportToADP}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  Export Complete Payroll to ADP
                </button>
              </div>
            </div>
          )}

          {/* Inspection Bonus Summary (if no worksheet) */}
          {Object.keys(inspectionBonuses).length > 0 && payrollData.length === 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-xl font-semibold mb-4">Inspection Bonus Summary</h2>
              
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Employee</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Initials</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Inspections</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Field Bonus</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {Object.entries(inspectionBonuses).map(([name, data]) => (
                      <tr key={name} className={data.inspections > 0 ? 'bg-green-50' : 'bg-white'}>
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{name}</td>
                        <td className="px-4 py-2 text-sm text-gray-900">{data.initials}</td>
                        <td className="px-4 py-2 text-sm text-gray-900">{data.inspections}</td>
                        <td className="px-4 py-2 text-sm text-gray-900">${bonusRate.toFixed(2)}</td>
                        <td className="px-4 py-2 text-sm font-medium text-green-600">
                          ${data.bonus.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="mt-4">
                <button
                  onClick={exportToADP}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  Export Bonuses Only
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-xl font-semibold mb-4">Payroll History</h2>
          {payrollHistory.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Employees</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Total Inspections</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Total Bonuses</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {payrollHistory.map((period) => (
                    <tr key={period.id}>
                      <td className="px-4 py-2 text-sm text-gray-900">
                        {new Date(period.start_date).toLocaleDateString()} - {new Date(period.end_date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-900">{period.total_employees}</td>
                      <td className="px-4 py-2 text-sm text-gray-900">{period.total_inspections || 0}</td>
                      <td className="px-4 py-2 text-sm font-medium text-green-600">${period.total_bonuses?.toFixed(2) || '0.00'}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">
                        {new Date(period.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-600 text-center py-8">No payroll history found</p>
          )}
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
                value={bonusRate}
                onChange={(e) => setBonusRate(parseFloat(e.target.value) || 0)}
                className="w-32 px-3 py-2 border border-gray-300 rounded-md"
              />
              <span className="ml-2 text-sm text-gray-600">${bonusRate.toFixed(2)} per valid residential inspection (Class 2 & 3A)</span>
            </div>
            
            <div className="mt-6 p-4 bg-blue-50 rounded-md">
              <h3 className="text-sm font-medium text-blue-900 mb-2">Inspection Bonus Rules:</h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Only residential inspections (Class 2 & 3A) qualify for bonuses</li>
                <li>• Uses <strong>measure_date</strong> to determine inspection date</li>
                <li>• Uses <strong>measure_by</strong> for inspector initials</li>
                <li>• Only counts inspections after last payroll run date</li>
                <li>• Only for Residential and Management inspector types</li>
                <li>• Handles pagination for 28,000+ records automatically</li>
              </ul>
            </div>
            
            {lastPayrollDate && (
              <div className="mt-4 p-4 bg-gray-50 rounded-md">
                <h3 className="text-sm font-medium text-gray-700 mb-1">Current Settings</h3>
                <p className="text-sm text-gray-600">
                  Last payroll run: {new Date(lastPayrollDate).toLocaleDateString()}
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  Next payroll will count inspections after this date
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PayrollManagement;
