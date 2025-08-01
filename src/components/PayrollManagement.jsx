import React, { useState, useEffect } from 'react';
import { supabase, employeeService, jobService } from '../lib/supabaseClient';
import * as XLSX from 'xlsx';

const PayrollManagement = () => {
  const [activeTab, setActiveTab] = useState('current');
  const [payrollData, setPayrollData] = useState([]);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [inspectionBonuses, setInspectionBonuses] = useState({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState('all');
  const [leadDays, setLeadDays] = useState(2);
  const [bonusRate, setBonusRate] = useState(2.00);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [worksheetIssues, setWorksheetIssues] = useState([]);
  const [payrollPeriod, setPayrollPeriod] = useState({
    startDate: '',
    endDate: '',
    expectedHours: 0
  });
  const [lastProcessedEnd, setLastProcessedEnd] = useState(null);

  useEffect(() => {
    loadInitialData();
    calculateCurrentPayrollPeriod();
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

      // Get last processed payroll end date from inspection_data
      const { data: lastInspection, error } = await supabase
        .from('inspection_data')
        .select('payroll_period_end')
        .not('payroll_period_end', 'is', null)
        .order('payroll_period_end', { ascending: false })
        .limit(1)
        .single();
      
      if (!error && lastInspection) {
        setLastProcessedEnd(lastInspection.payroll_period_end);
      }
    } catch (error) {
      console.error('Error loading initial data:', error);
      setError('Failed to load initial data');
    }
  };

  const calculateCurrentPayrollPeriod = () => {
    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
    let startDate, endDate;
    
    // Determine which half of month we're in
    if (currentDay <= 15) {
      // First half - period is 1st to 15th
      startDate = new Date(currentYear, currentMonth, 1);
      endDate = new Date(currentYear, currentMonth, 15);
    } else {
      // Second half - period is 16th to end of month
      startDate = new Date(currentYear, currentMonth, 16);
      endDate = new Date(currentYear, currentMonth + 1, 0); // Last day of month
    }
    
    // Adjust end date if it falls on weekend
    const endDay = endDate.getDay();
    if (endDay === 6) { // Saturday
      endDate.setDate(endDate.getDate() - 1); // Move to Friday
    } else if (endDay === 0) { // Sunday
      endDate.setDate(endDate.getDate() - 2); // Move to Friday
    }
    
    // Calculate expected hours (weekdays * 8)
    const expectedHours = calculateExpectedHours(startDate, endDate);
    
    setPayrollPeriod({
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      expectedHours
    });
  };

  const calculateExpectedHours = (startDate, endDate) => {
    let start = new Date(startDate);
    let end = new Date(endDate);
    let weekdays = 0;
    
    while (start <= end) {
      const dayOfWeek = start.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday or Saturday
        weekdays++;
      }
      start.setDate(start.getDate() + 1);
    }
    
    return weekdays * 8;
  };

  const calculateInspectionBonuses = async () => {
    setIsProcessing(true);
    setError(null);
    setSuccessMessage(null);
    
    try {
      // Calculate the actual start date for bonus calculations
      // This is leadDays before the period start to catch orphaned inspections
      const periodStart = new Date(payrollPeriod.startDate);
      const bonusStartDate = new Date(periodStart);
      bonusStartDate.setDate(bonusStartDate.getDate() - leadDays);
      
      const startDate = lastProcessedEnd 
        ? new Date(new Date(lastProcessedEnd).getTime() + 86400000).toISOString().split('T')[0]
        : bonusStartDate.toISOString().split('T')[0];
      const endDate = payrollPeriod.endDate;
      
      console.log(`Payroll period: ${payrollPeriod.startDate} to ${endDate}`);
      console.log(`Counting inspections from: ${startDate} to ${endDate}`);
      
      // Get all initials from eligible employees
      const validInitials = employees
        .filter(emp => emp.initials)
        .map(emp => emp.initials.toUpperCase().trim());
      
      // Count total records first
      const { count, error: countError } = await supabase
        .from('inspection_data')
        .select('*', { count: 'exact', head: true })
        .gt('measure_date', startDate)
        .lte('measure_date', endDate)
        .in('measure_by', validInitials)
        .in('property_class', ['2', '3A'])
        .is('payroll_period_end', null); // Only unprocessed inspections

      if (countError) throw countError;
      
      console.log(`Total unprocessed inspections: ${count}`);

      // Process in batches
      const batchSize = 1000;
      const batches = Math.ceil(count / batchSize);
      const allInspections = [];

      for (let i = 0; i < batches; i++) {
        const from = i * batchSize;
        const to = from + batchSize - 1;
        
        let query = supabase
          .from('inspection_data')
          .select('id, measure_by, measure_date, property_class, property_composite_key, property_location, job_id')
          .gt('measure_date', startDate)
          .lte('measure_date', endDate)
          .in('measure_by', validInitials)
          .in('property_class', ['2', '3A'])
          .is('payroll_period_end', null)
          .range(from, to);

        if (selectedJob !== 'all') {
          query = query.eq('job_id', selectedJob);
        }

        const { data: batch, error: batchError } = await query;
        if (batchError) throw batchError;
        
        allInspections.push(...batch);
      }

      // Group inspections by inspector
      const inspectorCounts = {};
      
      allInspections.forEach(inspection => {
        const initials = inspection.measure_by.toUpperCase().trim();
        
        if (!inspectorCounts[initials]) {
          inspectorCounts[initials] = {
            count: 0,
            inspectionIds: [],
            details: []
          };
        }
        
        inspectorCounts[initials].count++;
        inspectorCounts[initials].inspectionIds.push(inspection.id);
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
            inspectionIds: inspectorCounts[empInitials].inspectionIds,
            details: inspectorCounts[empInitials].details
          };
        } else {
          bonusResults[employeeName] = {
            initials: empInitials || 'N/A',
            inspections: 0,
            bonus: 0,
            inspectionIds: [],
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
    setWorksheetIssues([]);
    
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { 
          type: 'array', 
          cellDates: true,
          cellFormulas: true 
        });
        
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        
        const issues = [];
        const parsedData = [];
        
        // Check for frozen panes
        if (firstSheet['!freeze']) {
          issues.push({
            type: 'error',
            message: '🚫 Frozen rows detected! Use the clean template without frozen rows.'
          });
        }
        
        // Validate structure
        if (!rawData[2] || rawData[2][0] !== 'EMPLOYEE') {
          issues.push({
            type: 'error',
            message: '🚫 Invalid worksheet structure. Row 3 should have headers starting with EMPLOYEE.'
          });
        }
        
        // Parse employee data starting from row 6 (index 5)
        let totalHoursSum = 0;
        let apptOTSum = 0;
        let formulaIssues = [];
        
        for (let i = 5; i < rawData.length; i++) {
          const row = rawData[i];
          if (row[0] && typeof row[0] === 'string' && !row[0].includes('TOTAL HOURS')) {
            const employeeName = row[0].trim();
            const hours = row[1];
            const apptOT = row[3] || 0;
            const fieldOT = row[4] || 0;
            const total = row[5] || 0;
            const comments = row[6] || '';
            
            // Check formula in total column
            const totalCell = firstSheet[`F${i+1}`];
            if (totalCell && typeof total === 'number' && total === 0 && !totalCell.f) {
              formulaIssues.push(`Row ${i+1}: ${employeeName} has hardcoded 0 in total column`);
            }
            
            // Try to match with database employees
            const dbEmployee = employees.find(emp => {
              const dbName = `${emp.last_name}, ${emp.first_name}`;
              const altDbName = `${emp.first_name} ${emp.last_name}`;
              return dbName.toLowerCase() === employeeName.toLowerCase() ||
                     altDbName.toLowerCase() === employeeName.toLowerCase() ||
                     employeeName.toLowerCase().includes(emp.last_name.toLowerCase());
            });
            
            const empData = {
              worksheetName: employeeName,
              dbEmployee: dbEmployee,
              hours: hours,
              apptOT: apptOT,
              fieldOT: fieldOT,
              total: total,
              comments: comments,
              issues: []
            };
            
            // Validation checks
            if (!dbEmployee) {
              empData.issues.push(`❓ No database match found`);
            } else {
              // Check hours for hourly employees
              if (hours !== 'same' && typeof hours === 'number') {
                totalHoursSum += hours;
                
                // Check if hours match expected for full-time
                if (!comments.toLowerCase().includes('part time') && 
                    !comments.toLowerCase().includes('pto') &&
                    hours !== payrollPeriod.expectedHours) {
                  empData.issues.push(`⚠️ Expected ${payrollPeriod.expectedHours} hours, got ${hours}`);
                }
                
                // Flag suspiciously low hours
                if (hours < 40 && !comments.toLowerCase().includes('part time')) {
                  empData.issues.push(`🚨 Suspiciously low hours: ${hours} (missing digit?)`);
                }
              } else if (hours === 'same' && dbEmployee.employment_type !== 'salary') {
                empData.issues.push(`⚠️ Shows "same" but employee might be hourly`);
              } else if (hours !== 'same' && dbEmployee.employment_type === 'salary') {
                empData.issues.push(`⚠️ Shows hours but employee might be salaried`);
              }
            }
            
            if (typeof apptOT === 'number') {
              apptOTSum += apptOT;
            }
            
            parsedData.push(empData);
          }
        }
        
        // Check totals row
        const totalsRowIndex = rawData.findIndex(row => 
          row[0] && row[0].toString().includes('TOTAL HOURS')
        );
        
        if (totalsRowIndex > -1) {
          const totalsRow = rawData[totalsRowIndex];
          const sheetTotalHours = totalsRow[1] || 0;
          const sheetApptOT = totalsRow[3] || 0;
          
          if (Math.abs(sheetTotalHours - totalHoursSum) > 0.01) {
            issues.push({
              type: 'error',
              message: `🚨 Total hours mismatch! Sheet shows ${sheetTotalHours}, calculated ${totalHoursSum}`
            });
          }
          
          if (Math.abs(sheetApptOT - apptOTSum) > 0.01) {
            issues.push({
              type: 'error',
              message: `🚨 Appt OT total mismatch! Sheet shows ${sheetApptOT}, calculated ${apptOTSum}`
            });
          }
        }
        
        // Add formula issues
        if (formulaIssues.length > 0) {
          issues.push({
            type: 'warning',
            message: `⚠️ Formula issues found in ${formulaIssues.length} rows`,
            details: formulaIssues
          });
        }
        
        setWorksheetIssues(issues);
        setPayrollData(parsedData);
        
        // Extract pay period if available
        if (rawData[4] && rawData[4][0]) {
          const periodText = rawData[4][0];
          const periodMatch = periodText.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
          if (periodMatch) {
            const extractedStart = new Date(periodMatch[1]).toISOString().split('T')[0];
            const extractedEnd = new Date(periodMatch[2]).toISOString().split('T')[0];
            
            // Verify it matches our calculated period
            if (extractedEnd !== payrollPeriod.endDate) {
              issues.push({
                type: 'warning',
                message: `📅 Period mismatch: Sheet shows ${periodMatch[2]}, expected ${payrollPeriod.endDate}`
              });
            }
          }
        }
        
        if (issues.some(issue => issue.type === 'error')) {
          setError('Critical issues found in worksheet. Please fix and re-upload.');
        } else {
          setSuccessMessage(`Processed ${parsedData.length} employees. ${issues.length} warnings found.`);
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
      
      // Update the total (Appt OT + Field Bonus)
      const newTotal = (emp.apptOT || 0) + bonus;
      
      return {
        ...emp,
        calculatedFieldOT: bonus,
        inspectionCount: inspections,
        calculatedTotal: newTotal
      };
    });
  };

  const exportToADP = () => {
    const mergedData = mergePayrollWithBonuses();
    const exportData = [];
    let totalHours = 0;
    let totalApptOT = 0;
    let totalFieldBonus = 0;
    let totalOT = 0;
    
    mergedData.forEach(emp => {
      const hours = emp.hours === 'same' ? 'same' : emp.hours;
      const apptOT = emp.apptOT || 0;
      const fieldBonus = emp.calculatedFieldOT || 0;
      const total = apptOT + fieldBonus;
      
      if (typeof emp.hours === 'number') {
        totalHours += emp.hours;
      }
      totalApptOT += apptOT;
      totalFieldBonus += fieldBonus;
      totalOT += total;
      
      exportData.push({
        name: emp.worksheetName,
        hours: hours,
        apptOT: apptOT,
        fieldBonus: fieldBonus,
        total: total
      });
    });
    
    // Create CSV with proper formatting
    const headers = ['Employee Name', 'Hours', 'Appt OT', 'Field Bonus', 'TOTAL OT'];
    const rows = exportData.map(row => [
      `"${row.name}"`,
      row.hours,
      row.apptOT.toFixed(2),
      row.fieldBonus.toFixed(2),
      row.total.toFixed(2)
    ]);
    
    // Add totals row
    rows.push(['', '', '', '', '']); // Empty row
    rows.push([
      '"TOTALS"',
      totalHours || '',
      totalApptOT.toFixed(2),
      totalFieldBonus.toFixed(2),
      totalOT.toFixed(2)
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
    
    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LOJIK_payroll_${payrollPeriod.endDate}_ADP.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const markInspectionsProcessed = async () => {
    try {
      // Collect all inspection IDs to update
      const allInspectionIds = [];
      Object.values(inspectionBonuses).forEach(data => {
        if (data.inspectionIds && data.inspectionIds.length > 0) {
          allInspectionIds.push(...data.inspectionIds);
        }
      });
      
      if (allInspectionIds.length === 0) {
        setError('No inspections to mark as processed');
        return;
      }
      
      // Update in batches
      const batchSize = 1000;
      for (let i = 0; i < allInspectionIds.length; i += batchSize) {
        const batch = allInspectionIds.slice(i, i + batchSize);
        
        const { error } = await supabase
          .from('inspection_data')
          .update({ payroll_period_end: payrollPeriod.endDate })
          .in('id', batch);
        
        if (error) throw error;
      }
      
      setSuccessMessage(`Successfully marked ${allInspectionIds.length} inspections as processed for period ending ${payrollPeriod.endDate}`);
      setLastProcessedEnd(payrollPeriod.endDate);
      
      // Clear bonuses after marking processed
      setInspectionBonuses({});
    } catch (error) {
      console.error('Error marking inspections as processed:', error);
      setError('Failed to mark inspections as processed: ' + error.message);
    }
  };

  const getRowColor = (employee) => {
    if (employee.issues?.some(issue => issue.includes('🚨'))) return 'bg-red-50';
    if (employee.issues?.some(issue => issue.includes('⚠️'))) return 'bg-yellow-50';
    if (employee.issues?.some(issue => issue.includes('❓'))) return 'bg-gray-50';
    return '';
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Payroll Management</h1>
            <p className="text-gray-600">Leann's chaos detector & inspection bonus calculator</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Today's Date</p>
            <p className="text-lg font-semibold text-gray-900">{new Date().toLocaleDateString()}</p>
          </div>
        </div>
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
          {/* Payroll Period Info */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Current Payroll Period</h2>
              <span className="px-3 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                Active
              </span>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Period</p>
                <p className="text-base font-semibold text-gray-900">
                  {payrollPeriod.startDate && payrollPeriod.endDate && (
                    <>
                      {new Date(payrollPeriod.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(payrollPeriod.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </>
                  )}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Expected Hours</p>
                <p className="text-base font-semibold text-gray-900">{payrollPeriod.expectedHours}</p>
                <p className="text-xs text-gray-500">Full-time employees</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Process By</p>
                <p className="text-base font-semibold text-gray-900">
                  {payrollPeriod.endDate && (
                    new Date(new Date(payrollPeriod.endDate).getTime() - (leadDays * 86400000)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  )}
                </p>
                <p className="text-xs text-gray-500">{leadDays} days early</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Last Processed</p>
                <p className="text-base font-semibold text-gray-900">
                  {lastProcessedEnd ? new Date(lastProcessedEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Never'}
                </p>
              </div>
            </div>
            
            {lastProcessedEnd && (
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                <p className="text-sm text-blue-800">
                  <span className="font-medium">Note:</span> Only inspections after {new Date(lastProcessedEnd).toLocaleDateString()} will be included
                </p>
              </div>
            )}
            {!lastProcessedEnd && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-md">
                <p className="text-sm text-amber-800">
                  <span className="font-medium">First Run:</span> Will count inspections from {leadDays} days before period start ({new Date(new Date(payrollPeriod.startDate).getTime() - (leadDays * 86400000)).toLocaleDateString()}) to catch any orphaned inspections
                </p>
              </div>
            )}
          </div>

          {/* Step 1: Upload Worksheet */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
              <div className="flex items-center">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-semibold">
                  1
                </div>
                <h2 className="ml-3 text-lg font-semibold text-gray-900">Upload Leann's Worksheet</h2>
              </div>
            </div>
            
            <div className="p-6">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-gray-400 transition-colors">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="mt-2 text-sm text-gray-600">Drop Excel file here or click to browse</p>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    setUploadedFile(file);
                    if (file) processUploadedFile(file);
                  }}
                  className="mt-4 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                />
              </div>
              
              {/* Worksheet Issues */}
              {worksheetIssues.length > 0 && (
                <div className="mt-6 space-y-3">
                  {worksheetIssues.map((issue, index) => (
                    <div key={index} className={`p-4 rounded-lg flex items-start ${
                      issue.type === 'error' 
                        ? 'bg-red-50 text-red-800 border border-red-200' 
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}>
                      <svg className={`flex-shrink-0 h-5 w-5 mr-2 ${
                        issue.type === 'error' ? 'text-red-400' : 'text-amber-400'
                      }`} fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      <div className="flex-1">
                        <p className="font-medium">{issue.message}</p>
                        {issue.details && (
                          <ul className="mt-2 text-sm space-y-1">
                            {issue.details.slice(0, 3).map((detail, idx) => (
                              <li key={idx}>• {detail}</li>
                            ))}
                            {issue.details.length > 3 && (
                              <li className="text-xs opacity-75">... and {issue.details.length - 3} more issues</li>
                            )}
                          </ul>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Step 2: Calculate Bonuses */}
          {payrollData.length > 0 && !worksheetIssues.some(i => i.type === 'error') && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-xl font-semibold mb-4">Step 2: Calculate Field Bonuses</h2>
              
              <div className="flex items-center space-x-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Job Filter</label>
                  <select
                    value={selectedJob}
                    onChange={(e) => setSelectedJob(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="all">All Active Jobs</option>
                    {jobs.map(job => (
                      <option key={job.id} value={job.id}>
                        {job.ccdd} - {job.job_name}
                      </option>
                    ))}
                  </select>
                </div>
                
                <button
                  onClick={calculateInspectionBonuses}
                  disabled={isProcessing}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {isProcessing ? 'Calculating...' : 'Calculate Inspection Bonuses'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Review and Export */}
          {payrollData.length > 0 && Object.keys(inspectionBonuses).length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-xl font-semibold mb-4">Step 3: Review and Export</h2>
              
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg border border-blue-200">
                  <p className="text-xs font-medium text-blue-600 uppercase tracking-wider">Employees</p>
                  <p className="mt-1 text-2xl font-bold text-blue-900">{payrollData.length}</p>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg border border-purple-200">
                  <p className="text-xs font-medium text-purple-600 uppercase tracking-wider">Total Hours</p>
                  <p className="mt-1 text-2xl font-bold text-purple-900">
                    {mergePayrollWithBonuses().reduce((sum, emp) => sum + (typeof emp.hours === 'number' ? emp.hours : 0), 0)}
                  </p>
                </div>
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 rounded-lg border border-orange-200">
                  <p className="text-xs font-medium text-orange-600 uppercase tracking-wider">Appt OT</p>
                  <p className="mt-1 text-2xl font-bold text-orange-900">
                    ${mergePayrollWithBonuses().reduce((sum, emp) => sum + (emp.apptOT || 0), 0).toFixed(2)}
                  </p>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg border border-green-200">
                  <p className="text-xs font-medium text-green-600 uppercase tracking-wider">Field Bonus</p>
                  <p className="mt-1 text-2xl font-bold text-green-900">
                    ${mergePayrollWithBonuses().reduce((sum, emp) => sum + emp.calculatedFieldOT, 0).toFixed(2)}
                  </p>
                </div>
                <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 p-4 rounded-lg border border-indigo-200">
                  <p className="text-xs font-medium text-indigo-600 uppercase tracking-wider">TOTAL OT</p>
                  <p className="mt-1 text-2xl font-bold text-indigo-900">
                    ${mergePayrollWithBonuses().reduce((sum, emp) => sum + emp.calculatedTotal, 0).toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Employee Data Table */}
              <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
                <table className="min-w-full divide-y divide-gray-300">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hours</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Appt OT</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Field Bonus</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-indigo-50">TOTAL OT</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Issues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {mergePayrollWithBonuses().map((employee, index) => (
                      <tr key={index} className={`hover:bg-gray-50 ${getRowColor(employee)}`}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {employee.worksheetName}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {employee.hours === 'same' ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              Salary
                            </span>
                          ) : (
                            <span className="font-mono">{employee.hours}</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-mono">
                          ${(employee.apptOT || 0).toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600 font-mono">
                          ${employee.calculatedFieldOT.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-indigo-600 bg-indigo-50 font-mono">
                          ${employee.calculatedTotal.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {employee.issues.length > 0 && (
                            <div className="space-y-1">
                              {employee.issues.map((issue, idx) => (
                                <div key={idx} className="text-xs">
                                  {issue}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="mt-6 flex items-center justify-between">
                <div className="flex space-x-3">
                  <button
                    onClick={exportToADP}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                  >
                    <svg className="mr-2 -ml-1 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export to ADP
                  </button>
                  <button
                    onClick={markInspectionsProcessed}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-purple-700 bg-purple-100 hover:bg-purple-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                  >
                    <svg className="mr-2 -ml-1 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Mark as Processed
                  </button>
                </div>
                <p className="text-sm text-gray-500">
                  <span className="font-medium">Remember:</span> Enter TOTAL OT column into ADP
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-xl font-semibold mb-4">Payroll Settings</h2>
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Inspection Bonus Rate
              </label>
              <div className="flex items-center space-x-2">
                <span className="text-gray-600">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={bonusRate}
                  onChange={(e) => setBonusRate(parseFloat(e.target.value) || 0)}
                  className="w-24 px-3 py-2 border border-gray-300 rounded-md"
                />
                <span className="text-sm text-gray-600">per residential inspection (Class 2 & 3A)</span>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Processing Lead Time
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={leadDays}
                  onChange={(e) => setLeadDays(parseInt(e.target.value) || 2)}
                  className="w-20 px-3 py-2 border border-gray-300 rounded-md"
                />
                <span className="text-sm text-gray-600">days before payroll period ends</span>
              </div>
            </div>
            
            <div className="p-4 bg-blue-50 rounded-md">
              <h3 className="text-sm font-medium text-blue-900 mb-2">How it works:</h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Payroll periods: 1st-15th and 16th-end of month</li>
                <li>• Weekend adjustment: If period ends on weekend, moves to Friday</li>
                <li>• Expected hours: Automatically calculated based on weekdays</li>
                <li>• Only counts Class 2 & 3A residential inspections</li>
                <li>• Tracks processed inspections to prevent double-counting</li>
                <li>• Validates Leann's worksheet for errors and inconsistencies</li>
              </ul>
            </div>
            
            <div className="p-4 bg-yellow-50 rounded-md">
              <h3 className="text-sm font-medium text-yellow-900 mb-2">Worksheet Requirements:</h3>
              <ul className="text-sm text-yellow-800 space-y-1">
                <li>• NO frozen rows (Leann!)</li>
                <li>• Consistent formulas in Total column (=Appt OT + Field OT)</li>
                <li>• "same" for salaried employees, hours for hourly</li>
                <li>• Accurate totals row with SUM formulas</li>
                <li>• Use the clean template provided</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PayrollManagement;
