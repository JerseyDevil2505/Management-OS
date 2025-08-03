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
  const [bonusRate] = useState(2.00);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [worksheetIssues, setWorksheetIssues] = useState([]);
  const [payrollPeriod, setPayrollPeriod] = useState({
    startDate: '',
    endDate: '',
    processedDate: new Date().toISOString().split('T')[0],
    expectedHours: 0
  });
  const [lastProcessedInfo, setLastProcessedInfo] = useState(null);
  const [archivedPeriods, setArchivedPeriods] = useState([]);

  // Helper functions
  const calculateExpectedHours = (startDate, endDate) => {
    if (!startDate || !endDate) return 0;
    
    let start = new Date(startDate);
    let end = new Date(endDate);
    let weekdays = 0;
    
    while (start <= end) {
      const dayOfWeek = start.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        weekdays++;
      }
      start.setDate(start.getDate() + 1);
    }
    
    return weekdays * 8;
  };

  const getStandardExpectedHours = (endDate) => {
    if (!endDate) return 0;
    
    const end = new Date(endDate);
    const day = end.getDate();
    const month = end.getMonth();
    const year = end.getFullYear();
    
    let periodStart, periodEnd;
    
    if (day <= 15) {
      periodStart = new Date(year, month, 1);
      periodEnd = new Date(year, month, 15);
    } else {
      periodStart = new Date(year, month, 16);
      periodEnd = new Date(year, month + 1, 0);
    }
    
    return calculateExpectedHours(periodStart, periodEnd);
  };

  // Helper function to get next payroll period
  const getNextPayrollPeriod = (currentEndDate) => {
    const end = new Date(currentEndDate);
    const day = end.getDate();
    const month = end.getMonth();
    const year = end.getFullYear();
    
    let nextEnd, nextStart;
    
    if (day <= 15) {
      // Current period was 1-15, next is 16-end
      nextStart = new Date(year, month, 16);
      nextEnd = new Date(year, month + 1, 0); // Last day of month
    } else {
      // Current period was 16-end, next is 1-15 of next month
      nextStart = new Date(year, month + 1, 1);
      nextEnd = new Date(year, month + 1, 15);
    }
    
    return {
      startDate: nextStart.toISOString().split('T')[0],
      endDate: nextEnd.toISOString().split('T')[0],
      expectedHours: calculateExpectedHours(nextStart, nextEnd)
    };
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (payrollPeriod.endDate) {
      const hours = getStandardExpectedHours(payrollPeriod.endDate);
      setPayrollPeriod(prev => ({ ...prev, expectedHours: hours }));
    }
  }, [payrollPeriod.endDate]);

  const loadInitialData = async () => {
    try {
      const employeeData = await employeeService.getAll();
      const eligibleEmployees = employeeData.filter(emp => 
        emp.employment_status === 'active' && 
        ['residential', 'management'].includes(emp.inspector_type?.toLowerCase())
      );
      setEmployees(eligibleEmployees);

      const jobData = await jobService.getAll();
      setJobs(jobData.filter(job => job.status === 'active'));

      // Get last processed info
      const { data: lastInspection, error } = await supabase
        .from('inspection_data')
        .select('payroll_period_end, payroll_processed_date')
        .not('payroll_period_end', 'is', null)
        .order('payroll_period_end', { ascending: false })
        .limit(1)
        .single();
      
      if (!error && lastInspection) {
        // Try to get the processing date from localStorage
        const storedInfo = localStorage.getItem('lastPayrollProcessed');
        if (storedInfo) {
          const parsed = JSON.parse(storedInfo);
          if (parsed.endDate === lastInspection.payroll_period_end) {
            setLastProcessedInfo(parsed);
          }
        }
      }
      
      // Load archived periods
      const { data: archived, error: archiveError } = await supabase
        .from('payroll_periods')
        .select('*')
        .order('end_date', { ascending: false })
        .limit(12); // Last 12 periods
      
      if (!archiveError && archived) {
        setArchivedPeriods(archived);
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
      const startDate = payrollPeriod.startDate;
      const endDate = payrollPeriod.endDate;
      
      console.log(`Calculating bonuses from ${startDate} to ${endDate}`);
      
      // First, let's do a simple test query
      console.log('Testing basic query...');
      const { data: testData, error: testError } = await supabase
        .from('inspection_data')
        .select('id')
        .limit(1);
      
      if (testError) {
        console.error('Basic test query failed:', testError);
        throw new Error(`Cannot access inspection_data table: ${testError.message}`);
      }
      console.log('Basic query succeeded, found:', testData);
      
      // Now test with date filter
      console.log('Testing with date filter...');
      const { data: dateTest, error: dateError } = await supabase
        .from('inspection_data')
        .select('measure_date, property_class')
        .gte('measure_date', startDate)
        .lte('measure_date', endDate)
        .limit(5);
      
      if (dateError) {
        console.error('Date filter query failed:', dateError);
        throw new Error(`Date filter error: ${dateError.message}`);
      }
      console.log('Date filter succeeded, sample data:', dateTest);
      
      // Now test without property class filter
      console.log('Testing without property class filter...');
      const { count: noFilterCount, error: noFilterError } = await supabase
        .from('inspection_data')
        .select('*', { count: 'exact', head: true })
        .gte('measure_date', startDate)
        .lte('measure_date', endDate);
      
      if (noFilterError) {
        console.error('No filter count failed:', noFilterError);
      } else {
        console.log(`Count without property class filter: ${noFilterCount}`);
      }
      
      // Get ALL inspections with class 2 or 3A in the date range
      // Don't filter by employee initials - we'll match them up after
      const { count, error: countError } = await supabase
        .from('inspection_data')
        .select('*', { count: 'exact', head: true })
        .gte('measure_date', startDate)
        .lte('measure_date', endDate)
        .in('property_class', ['2', '3A']);

      if (countError) {
        console.error('Count query error:', countError);
        throw new Error(`Database error: ${countError.message} (${countError.code})`);
      }
      
      console.log(`Total inspections to process: ${count}`);

      const batchSize = 1000;
      const batches = Math.ceil(count / batchSize);
      const allInspections = [];

      for (let i = 0; i < batches; i++) {
        const from = i * batchSize;
        const to = from + batchSize - 1;
        
        let query = supabase
          .from('inspection_data')
          .select('id, measure_by, measure_date, property_class, property_composite_key, property_location, job_id')
          .gte('measure_date', startDate)
          .lte('measure_date', endDate)
          .in('property_class', ['2', '3A'])
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

      // Debug: Show all unique initials found
      console.log('=== INITIALS MATCHING DEBUG ===');
      console.log('Unique initials found in inspections:', Object.keys(inspectorCounts).sort());
      console.log('Employee initials in database:', employees.map(e => e.initials).filter(Boolean).sort());
      
      // Calculate bonuses by employee name - now we match after getting all inspections
      const bonusResults = {};
      const matchedInitials = [];
      const unmatchedInitials = [];
      
      employees.forEach(employee => {
        const employeeName = `${employee.first_name} ${employee.last_name}`;
        const empInitials = employee.initials?.toUpperCase().trim();
        
        if (empInitials && inspectorCounts[empInitials]) {
          const count = inspectorCounts[empInitials].count;
          matchedInitials.push(`${empInitials} → ${employeeName} (${count} inspections)`);
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
      
      // Also include any inspectors not in employee list (to catch mismatches)
      Object.keys(inspectorCounts).forEach(initials => {
        const hasEmployee = employees.some(emp => emp.initials?.toUpperCase().trim() === initials);
        if (!hasEmployee) {
          unmatchedInitials.push(`${initials} (${inspectorCounts[initials].count} inspections)`);
          bonusResults[`Unknown Inspector (${initials})`] = {
            initials: initials,
            inspections: inspectorCounts[initials].count,
            bonus: inspectorCounts[initials].count * bonusRate,
            inspectionIds: inspectorCounts[initials].inspectionIds,
            details: inspectorCounts[initials].details
          };
        }
      });
      
      console.log('\nMatched initials:');
      matchedInitials.forEach(match => console.log(`  ✓ ${match}`));
      
      if (unmatchedInitials.length > 0) {
        console.log('\nUnmatched initials (no employee found):');
        unmatchedInitials.forEach(unmatched => console.log(`  ✗ ${unmatched}`));
      }
      
      console.log('\nTotal inspections by initials:');
      Object.entries(inspectorCounts)
        .sort((a, b) => b[1].count - a[1].count)
        .forEach(([initials, data]) => {
          console.log(`  ${initials}: ${data.count} inspections = $${(data.count * bonusRate).toFixed(2)}`);
        });
      console.log('=== END DEBUG ===\n');
      
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
            type: 'suggestion',
            message: 'The worksheet has frozen rows. While this works, a clean template without frozen rows is easier to process.',
            emailText: 'Note: The worksheet has frozen rows. If you\'d like, I can provide a clean template that\'s a bit easier for the system to process.'
          });
        }
        
        // Parse employee data
        let totalHoursSum = 0;
        let apptOTSum = 0;
        let formulaIssues = [];
        let rowsStartIndex = -1;
        
        // Find where employee data starts (look for EMPLOYEE header)
        for (let i = 0; i < Math.min(10, rawData.length); i++) {
          if (rawData[i] && rawData[i][0] === 'EMPLOYEE') {
            rowsStartIndex = i + 3; // Data typically starts 3 rows after header
            break;
          }
        }
        
        if (rowsStartIndex === -1) {
          issues.push({
            type: 'error',
            message: 'Could not find employee data in the worksheet.',
            emailText: 'I couldn\'t locate the employee data section. Please make sure the worksheet has "EMPLOYEE" as a column header.'
          });
          setWorksheetIssues(issues);
          setIsProcessing(false);
          return;
        }
        
        // Process employee rows
        for (let i = rowsStartIndex; i < rawData.length; i++) {
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
              formulaIssues.push({
                row: i+1,
                employee: employeeName
              });
            }
            
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
            
            if (!dbEmployee) {
              empData.issues.push(`No database match found`);
            } else {
              if (hours !== 'same' && typeof hours === 'number') {
                totalHoursSum += hours;
                
                if (!comments.toLowerCase().includes('part time') && 
                    !comments.toLowerCase().includes('pto') &&
                    hours !== payrollPeriod.expectedHours &&
                    Math.abs(hours - payrollPeriod.expectedHours) > 8) {
                  empData.issues.push(`Expected ${payrollPeriod.expectedHours} hours, showing ${hours}`);
                }
                
                if (hours < 40 && !comments.toLowerCase().includes('part time')) {
                  empData.issues.push(`Low hours: ${hours} - please verify`);
                }
              }
            }
            
            if (typeof apptOT === 'number') {
              apptOTSum += apptOT;
            }
            
            parsedData.push(empData);
          }
        }
        
        // Check totals
        const totalsRowIndex = rawData.findIndex(row => 
          row[0] && row[0].toString().includes('TOTAL HOURS')
        );
        
        if (totalsRowIndex > -1) {
          const totalsRow = rawData[totalsRowIndex];
          const sheetTotalHours = totalsRow[1] || 0;
          const sheetApptOT = totalsRow[3] || 0;
          
          if (Math.abs(sheetTotalHours - totalHoursSum) > 0.01) {
            issues.push({
              type: 'warning',
              message: `Total hours shows ${sheetTotalHours}, but individual hours add up to ${totalHoursSum}`,
              emailText: `Quick note: The total hours row shows ${sheetTotalHours}, but when I add up the individual hours I get ${totalHoursSum}. Might want to double-check the SUM formula.`
            });
          }
        }
        
        // Add formula issues if any
        if (formulaIssues.length > 0) {
          const issueList = formulaIssues.map(f => `Row ${f.row}: ${f.employee}`).join('\n');
          issues.push({
            type: 'suggestion',
            message: `Found ${formulaIssues.length} rows with hardcoded zeros in the total column`,
            emailText: `I noticed ${formulaIssues.length} rows have hardcoded zeros in the Total column instead of formulas:\n\n${issueList}\n\nThese should have the formula =D+E to automatically calculate totals.`,
            details: formulaIssues
          });
        }
        
        // Check period in worksheet
        if (rawData[4] && rawData[4][0]) {
          const periodText = rawData[4][0];
          const periodMatch = periodText.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
          if (periodMatch) {
            const sheetEndDate = periodMatch[2];
            const expectedPeriod = getPayrollPeriod(payrollPeriod.endDate);
            
            // Don't flag if it's just a formatting difference
            const sheetEnd = new Date(sheetEndDate);
            const expectedEnd = new Date(payrollPeriod.endDate);
            if (sheetEnd.getTime() === expectedEnd.getTime()) {
              // Dates match, just formatted differently
            } else {
              issues.push({
                type: 'info',
                message: `Worksheet shows period ending ${sheetEndDate}`,
                emailText: `The worksheet shows period ending ${sheetEndDate}. Just confirming this matches what you intended.`
              });
            }
          }
        }
        
        setWorksheetIssues(issues);
        setPayrollData(parsedData);
        
        if (issues.length === 0) {
          setSuccessMessage(`Processed ${parsedData.length} employees successfully - worksheet looks good!`);
        } else {
          setSuccessMessage(`Processed ${parsedData.length} employees. Found ${issues.length} items to review.`);
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
    
    const headers = ['Employee Name', 'Hours', 'Appt OT', 'Field Bonus', 'TOTAL OT'];
    const rows = exportData.map(row => [
      `"${row.name}"`,
      row.hours,
      row.apptOT.toFixed(2),
      row.fieldBonus.toFixed(2),
      row.total.toFixed(2)
    ]);
    
    rows.push(['', '', '', '', '']);
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
      
      // Update inspections with period end and processed date
      const batchSize = 1000;
      for (let i = 0; i < allInspectionIds.length; i += batchSize) {
        const batch = allInspectionIds.slice(i, i + batchSize);
        
        const { error } = await supabase
          .from('inspection_data')
          .update({ 
            payroll_period_end: payrollPeriod.endDate,
            payroll_processed_date: payrollPeriod.processedDate 
          })
          .in('id', batch);
        
        if (error) throw error;
      }
      
      // Calculate totals for archiving
      const mergedData = mergePayrollWithBonuses();
      const totalHours = mergedData.reduce((sum, emp) => sum + (typeof emp.hours === 'number' ? emp.hours : 0), 0);
      const totalApptOT = mergedData.reduce((sum, emp) => sum + (emp.apptOT || 0), 0);
      const totalFieldBonus = mergedData.reduce((sum, emp) => sum + emp.calculatedFieldOT, 0);
      const totalOT = mergedData.reduce((sum, emp) => sum + emp.calculatedTotal, 0);
      
      // Save to payroll_periods
      const { data: periodData, error: periodError } = await supabase
        .from('payroll_periods')
        .insert({
          period_name: getPayrollPeriod(payrollPeriod.endDate),
          start_date: payrollPeriod.startDate,
          end_date: payrollPeriod.endDate,
          processed_date: payrollPeriod.processedDate,
          bonus_calculation_start: payrollPeriod.startDate,
          total_hours: totalHours,
          total_appt_ot: totalApptOT,
          total_field_bonus: totalFieldBonus,
          total_ot: totalOT,
          inspection_count: allInspectionIds.length,
          expected_hours: payrollPeriod.expectedHours,
          status: 'completed',
          total_amount: totalOT, // For compatibility with existing columns
          processing_settings: {
            bonus_rate: bonusRate,
            employee_count: mergedData.length,
            worksheet_issues: worksheetIssues
          }
        })
        .select()
        .single();
      
      if (periodError) throw periodError;
      
      // Save individual entries to payroll_entries
      for (const emp of mergedData) {
        if (emp.dbEmployee) {
          const { error: entryError } = await supabase
            .from('payroll_entries')
            .insert({
              payroll_period_id: periodData.id,
              employee_id: emp.dbEmployee.id,
              hours: typeof emp.hours === 'number' ? emp.hours : null,
              hours_type: emp.hours === 'same' ? 'salary' : 'regular',
              appt_ot: emp.apptOT || 0,
              field_bonus: emp.calculatedFieldOT || 0,
              total_ot: emp.calculatedTotal || 0,
              inspection_count: emp.inspectionCount || 0,
              amount: emp.calculatedTotal || 0, // For compatibility
              bonus_amount: emp.calculatedFieldOT || 0, // For compatibility
              final_amount: emp.calculatedTotal || 0, // For compatibility
              notes: emp.issues.length > 0 ? emp.issues.join('; ') : null
            });
          
          if (entryError) {
            console.error('Error saving payroll entry:', entryError);
          }
        }
      }
      
      // Save processing info to localStorage (for backwards compatibility)
      const processInfo = {
        startDate: payrollPeriod.startDate,
        endDate: payrollPeriod.endDate,
        processedDate: payrollPeriod.processedDate,
        inspectionCount: allInspectionIds.length
      };
      localStorage.setItem('lastPayrollProcessed', JSON.stringify(processInfo));
      
      setSuccessMessage(`Successfully marked ${allInspectionIds.length} inspections as processed for period ending ${payrollPeriod.endDate}`);
      
      // Auto-populate next period
      const nextPeriod = getNextPayrollPeriod(payrollPeriod.endDate);
      setPayrollPeriod({
        startDate: payrollPeriod.processedDate, // Start from when we processed
        endDate: nextPeriod.endDate,
        processedDate: new Date().toISOString().split('T')[0], // Today
        expectedHours: nextPeriod.expectedHours
      });
      
      // Clear current data for next run
      setPayrollData([]);
      setInspectionBonuses({});
      setWorksheetIssues([]);
      setUploadedFile(null);
      
      // Reload to show archive
      loadInitialData();
    } catch (error) {
      console.error('Error marking inspections as processed:', error);
      setError('Failed to mark inspections as processed: ' + error.message);
    }
  };

  const generateEmailFeedback = () => {
    if (worksheetIssues.length === 0) return '';
    
    let email = `Hi,\n\nI've reviewed the payroll worksheet and found a few items:\n\n`;
    
    worksheetIssues.forEach((issue, index) => {
      email += `${index + 1}. ${issue.emailText}\n\n`;
      if (issue.details && issue.type === 'suggestion') {
        // For formula issues, list all affected rows
        const details = issue.details;
        details.forEach(d => {
          email += `   - Row ${d.row}: ${d.employee}\n`;
        });
        email += '\n';
      }
    });
    
    email += `Let me know if you have any questions!\n\nThanks`;
    
    return email;
  };

  const copyEmailToClipboard = () => {
    const email = generateEmailFeedback();
    navigator.clipboard.writeText(email);
    setSuccessMessage('Email text copied to clipboard!');
  };

  const getRowColor = (employee) => {
    if (employee.issues?.length > 0) return 'bg-amber-50';
    return '';
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Payroll Management</h1>
            <p className="text-gray-600">Calculate inspection bonuses and validate payroll worksheets</p>
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

      {/* Last Processed Info */}
      {lastProcessedInfo && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="text-sm font-medium text-blue-900 mb-2">Last Payroll Processed:</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-blue-700">Period:</span>
              <span className="ml-2 font-medium text-blue-900">
                {new Date(lastProcessedInfo.startDate).toLocaleDateString()} - {new Date(lastProcessedInfo.endDate).toLocaleDateString()}
              </span>
            </div>
            <div>
              <span className="text-blue-700">Processed on:</span>
              <span className="ml-2 font-medium text-blue-900">
                {new Date(lastProcessedInfo.processedDate).toLocaleDateString()}
              </span>
            </div>
            <div>
              <span className="text-blue-700">Inspections:</span>
              <span className="ml-2 font-medium text-blue-900">{lastProcessedInfo.inspectionCount}</span>
            </div>
          </div>
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
            onClick={() => setActiveTab('archive')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'archive'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Archive
          </button>
        </nav>
      </div>

      {/* Current Payroll Tab */}
      {activeTab === 'current' && (
        <div className="space-y-6">
        {/* Payroll Period Setup */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Payroll Period Setup</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Bonus Calculation Dates</p>
              <div className="flex items-center space-x-2">
                <div>
                  <label className="text-xs text-gray-500">Start</label>
                  <input 
                    type="date" 
                    value={payrollPeriod.startDate}
                    onChange={(e) => setPayrollPeriod(prev => ({ ...prev, startDate: e.target.value }))}
                    className="block px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">End</label>
                  <input 
                    type="date" 
                    value={payrollPeriod.endDate}
                    onChange={(e) => setPayrollPeriod(prev => ({ ...prev, endDate: e.target.value }))}
                    className="block px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Processing Date</p>
              <input 
                type="date" 
                value={payrollPeriod.processedDate}
                onChange={(e) => setPayrollPeriod(prev => ({ ...prev, processedDate: e.target.value }))}
                className="block px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500">When you run payroll</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Payroll Period</p>
              <p className="text-base font-semibold text-gray-900">
                {getPayrollPeriod(payrollPeriod.endDate) || 'Set end date'}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Expected Hours</p>
              <p className="text-base font-semibold text-gray-900">{payrollPeriod.expectedHours}</p>
              <p className="text-xs text-gray-500">Full-time employees</p>
            </div>
          </div>
        </div>

        {/* Step 1: Upload Worksheet */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <div className="flex items-center">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-semibold">
                1
              </div>
              <h2 className="ml-3 text-lg font-semibold text-gray-900">Upload Payroll Worksheet</h2>
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
            
            {/* Worksheet Feedback */}
            {worksheetIssues.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-900">Worksheet Review</h3>
                  <button
                    onClick={copyEmailToClipboard}
                    className="text-sm text-blue-600 hover:text-blue-500"
                  >
                    Copy as Email
                  </button>
                </div>
                <div className="space-y-3">
                  {worksheetIssues.map((issue, index) => (
                    <div key={index} className={`p-4 rounded-lg border ${
                      issue.type === 'error' 
                        ? 'bg-red-50 text-red-800 border-red-200' 
                        : issue.type === 'warning'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : issue.type === 'suggestion'
                        ? 'bg-blue-50 text-blue-800 border-blue-200'
                        : 'bg-gray-50 text-gray-800 border-gray-200'
                    }`}>
                      <p className="font-medium">{issue.message}</p>
                      {issue.details && (
                        <div className="mt-2 text-sm">
                          {issue.details.map((detail, idx) => (
                            <div key={idx}>• Row {detail.row}: {detail.employee}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Calculate Bonuses - ALWAYS VISIBLE */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <div className="flex items-center">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-semibold">
                2
              </div>
              <h2 className="ml-3 text-lg font-semibold text-gray-900">Calculate Field Bonuses</h2>
            </div>
          </div>
          
          <div className="p-6">
            {!payrollData.length && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                <p className="text-sm text-blue-800">
                  <span className="font-medium">Tip:</span> You can calculate bonuses before uploading the worksheet to preview the amounts
                </p>
              </div>
            )}
            
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
                disabled={isProcessing || !payrollPeriod.startDate || !payrollPeriod.endDate}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {isProcessing ? 'Calculating...' : `Calculate Bonuses ($${bonusRate}/inspection)`}
              </button>
            </div>
          </div>
        </div>

        {/* Step 3: Review and Export - ALWAYS VISIBLE when bonuses calculated */}
        {Object.keys(inspectionBonuses).length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
              <div className="flex items-center">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-semibold">
                  3
                </div>
                <h2 className="ml-3 text-lg font-semibold text-gray-900">
                  {payrollData.length > 0 ? 'Review and Export' : 'Bonus Preview'}
                </h2>
              </div>
            </div>
            
            <div className="p-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg border border-blue-200">
                  <p className="text-xs font-medium text-blue-600 uppercase tracking-wider">Employees</p>
                  <p className="mt-1 text-2xl font-bold text-blue-900">{payrollData.length || Object.keys(inspectionBonuses).length}</p>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg border border-purple-200">
                  <p className="text-xs font-medium text-purple-600 uppercase tracking-wider">Total Hours</p>
                  <p className="mt-1 text-2xl font-bold text-purple-900">
                    {payrollData.length > 0 
                      ? mergePayrollWithBonuses().reduce((sum, emp) => sum + (typeof emp.hours === 'number' ? emp.hours : 0), 0)
                      : '-'
                    }
                  </p>
                </div>
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 rounded-lg border border-orange-200">
                  <p className="text-xs font-medium text-orange-600 uppercase tracking-wider">Appt OT</p>
                  <p className="mt-1 text-2xl font-bold text-orange-900">
                    {payrollData.length > 0 
                      ? `$${mergePayrollWithBonuses().reduce((sum, emp) => sum + (emp.apptOT || 0), 0).toFixed(2)}`
                      : '-'
                    }
                  </p>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg border border-green-200">
                  <p className="text-xs font-medium text-green-600 uppercase tracking-wider">Field Bonus</p>
                  <p className="mt-1 text-2xl font-bold text-green-900">
                    ${payrollData.length > 0 
                      ? mergePayrollWithBonuses().reduce((sum, emp) => sum + emp.calculatedFieldOT, 0).toFixed(2)
                      : Object.values(inspectionBonuses).reduce((sum, emp) => sum + emp.bonus, 0).toFixed(2)
                    }
                  </p>
                </div>
                <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 p-4 rounded-lg border border-indigo-200">
                  <p className="text-xs font-medium text-indigo-600 uppercase tracking-wider">TOTAL OT</p>
                  <p className="mt-1 text-2xl font-bold text-indigo-900">
                    {payrollData.length > 0 
                      ? `$${mergePayrollWithBonuses().reduce((sum, emp) => sum + emp.calculatedTotal, 0).toFixed(2)}`
                      : `$${Object.values(inspectionBonuses).reduce((sum, emp) => sum + emp.bonus, 0).toFixed(2)}`
                    }
                  </p>
                </div>
              </div>

              {/* Employee Data Table */}
              <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
                <table className="min-w-full divide-y divide-gray-300">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                      {payrollData.length > 0 && (
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hours</th>
                      )}
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {payrollData.length > 0 ? 'Appt OT' : 'Initials'}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {payrollData.length > 0 ? 'Field Bonus' : 'Inspections'}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-indigo-50">
                        {payrollData.length > 0 ? 'TOTAL OT' : 'Field Bonus'}
                      </th>
                      {payrollData.length > 0 && (
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Notes</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {payrollData.length > 0 ? (
                      mergePayrollWithBonuses().map((employee, index) => (
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
                          <td className="px-6 py-4 text-sm text-gray-600">
                            {employee.issues.join('; ')}
                          </td>
                        </tr>
                      ))
                    ) : (
                      Object.entries(inspectionBonuses)
                        .sort((a, b) => a[0].localeCompare(b[0]))
                        .map(([name, data], index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {data.initials}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-mono">
                              {data.inspections}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-green-600 bg-green-50 font-mono">
                              ${data.bonus.toFixed(2)}
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
              
              <div className="mt-6 flex items-center justify-between">
                <div className="flex space-x-3">
                  {payrollData.length > 0 ? (
                    <>
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
                    </>
                  ) : (
                    <div className="text-sm text-gray-600">
                      <svg className="inline-block w-4 h-4 mr-1 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Upload worksheet to export and process payroll
                    </div>
                  )}
                </div>
                <p className="text-sm text-gray-500">
                  {payrollData.length > 0 
                    ? <><span className="font-medium">Remember:</span> Enter TOTAL OT column into ADP</>
                    : `Total Field Bonuses: $${Object.values(inspectionBonuses).reduce((sum, emp) => sum + emp.bonus, 0).toFixed(2)}`
                  }
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Archive Tab */}
      {activeTab === 'archive' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Payroll Archive</h2>
          
          {archivedPeriods.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No archived payroll periods found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Period</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Processed</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employees</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hours</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Appt OT</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Field Bonus</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total OT</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Inspections</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {archivedPeriods.map((period) => (
                    <tr key={period.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {period.period_name || `${new Date(period.start_date).toLocaleDateString()} - ${new Date(period.end_date).toLocaleDateString()}`}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(period.processed_date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {period.processing_settings?.employee_count || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {period.total_hours || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        ${(period.total_appt_ot || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        ${(period.total_field_bonus || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        ${(period.total_ot || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {period.inspection_count || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PayrollManagement;
