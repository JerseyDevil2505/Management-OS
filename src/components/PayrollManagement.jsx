import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as XLSX from 'xlsx-js-style';

const PayrollManagement = ({ 
  employees = [], 
  jobs = [], 
  archivedPeriods = [], 
  dataRecency: propDataRecency = [],
  onDataUpdate,
  onRefresh 
}) => {
  const [activeTab, setActiveTab] = useState('current');
  const [payrollData, setPayrollData] = useState([]);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [inspectionBonuses, setInspectionBonuses] = useState({});
  const [isProcessing, setIsProcessing] = useState(false);
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
  const [dataRecency, setDataRecency] = useState([]);
  const [isLoadingRecency, setIsLoadingRecency] = useState(false);

  // Helper function to parse dates properly (avoiding timezone issues)
  const parseLocalDate = (dateStr) => {
    if (!dateStr) return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    // Create date at noon to avoid timezone issues
    return new Date(year, month - 1, day, 12, 0, 0);
  };

  // Helper function to format dates for display
  const formatDateForDisplay = (dateStr) => {
    if (!dateStr) return '';
    
    let date;
    // Handle different date formats
    if (typeof dateStr === 'string' && dateStr.includes(' ')) {
      // PostgreSQL timestamp format: "2025-08-04 17:00:00.968"
      // Replace space with 'T' to make it ISO format
      date = new Date(dateStr.replace(' ', 'T'));
    } else if (typeof dateStr === 'string' && dateStr.includes('T')) {
      // ISO timestamp like 2025-01-15T12:00:00
      date = new Date(dateStr);
    } else if (typeof dateStr === 'string' && dateStr.includes('-')) {
      // Date string like 2025-01-15
      date = parseLocalDate(dateStr);
    } else {
      // Fallback to direct parsing
      date = new Date(dateStr);
    }
    
    if (!date || isNaN(date.getTime())) return 'Invalid Date';
    return date.toLocaleDateString('en-US');
  };

  // Helper functions
  const calculateExpectedHours = (startDate, endDate) => {
    if (!startDate || !endDate) return 0;
    
    let start = parseLocalDate(startDate);
    let end = parseLocalDate(endDate);
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
    
    const end = parseLocalDate(endDate);
    const day = end.getDate();
    const month = end.getMonth();
    const year = end.getFullYear();
    
    let periodStart, periodEnd;
    
    if (day <= 15) {
      periodStart = new Date(year, month, 1, 12, 0, 0);
      periodEnd = new Date(year, month, 15, 12, 0, 0);
    } else {
      periodStart = new Date(year, month, 16, 12, 0, 0);
      periodEnd = new Date(year, month + 1, 0, 12, 0, 0);
    }
    
    return calculateExpectedHours(
      periodStart.toISOString().split('T')[0], 
      periodEnd.toISOString().split('T')[0]
    );
  };

  // Helper function to get next payroll period
  const getNextPayrollPeriod = (currentEndDate) => {
    const end = parseLocalDate(currentEndDate);
    const day = end.getDate();
    const month = end.getMonth();
    const year = end.getFullYear();
    
    let nextEnd, nextStart;
    
    if (day <= 15) {
      nextStart = new Date(year, month, 16, 12, 0, 0);
      nextEnd = new Date(year, month + 1, 0, 12, 0, 0);
    } else {
      nextStart = new Date(year, month + 1, 1, 12, 0, 0);
      nextEnd = new Date(year, month + 1, 15, 12, 0, 0);
    }
    
    return {
      startDate: nextStart.toISOString().split('T')[0],
      endDate: nextEnd.toISOString().split('T')[0],
      expectedHours: calculateExpectedHours(nextStart.toISOString().split('T')[0], nextEnd.toISOString().split('T')[0])
    };
  };

  // Helper function to format payroll period display
  const getPayrollPeriod = (endDate) => {
    if (!endDate) return '';
    
    const end = parseLocalDate(endDate);
    const day = end.getDate();
    const month = end.getMonth();
    const year = end.getFullYear();
    
    let periodStart;
    
    if (day <= 15) {
      periodStart = new Date(year, month, 1, 12, 0, 0);
    } else {
      periodStart = new Date(year, month, 16, 12, 0, 0);
    }
    
    const startStr = periodStart.toLocaleDateString('en-US');
    const endStr = end.toLocaleDateString('en-US');
    
    return `${startStr} - ${endStr}`;
  };

  // Fetch data recency for all active jobs
  const fetchDataRecency = async () => {
    setIsLoadingRecency(true);
    setError(null);
    
    try {
      // Use jobs from props instead of fetching
      const activeJobs = jobs; // jobs prop is already filtered for active
      
      if (!jobs || jobs.length === 0) {
        setDataRecency([]);
        return;
      }
      
      // Get latest upload date for each job
      const recencyData = await Promise.all(
        jobs.map(async (job) => {
          const { data: latestUpload, error: uploadError } = await supabase
            .from('inspection_data')
            .select('upload_date')
            .eq('job_id', job.id)
            .order('upload_date', { ascending: false })
            .limit(1)
            .single();
          
          let lastUploadDate = null;
          let daysAgo = null;
          let status = 'no-data';
          
          if (!uploadError && latestUpload?.upload_date) {
            lastUploadDate = latestUpload.upload_date;
            // Handle different date formats - upload_date might be YYYY-MM-DD or a timestamp
            let uploadDate;
            if (lastUploadDate.includes('T')) {
              // It's a timestamp like 2025-01-15T12:00:00
              uploadDate = new Date(lastUploadDate);
            } else if (lastUploadDate.includes('-')) {
              // It's a date string like 2025-01-15
              uploadDate = parseLocalDate(lastUploadDate);
            } else {
              // Fallback to direct parsing
              uploadDate = new Date(lastUploadDate);
            }
            
            const today = new Date();
            today.setHours(12, 0, 0, 0);
            daysAgo = Math.floor((today - uploadDate) / (1000 * 60 * 60 * 24));
            
            if (daysAgo <= 7) {
              status = 'current';
            } else if (daysAgo <= 30) {
              status = 'aging';
            } else {
              status = 'stale';
            }
          }
          
          return {
            id: job.id,
            jobName: job.job_name,
            ccdd: job.ccdd,
            lastUploadDate,
            daysAgo,
            status
          };
        })
      );
      
      // Sort by most recent first, then no data at the end
      recencyData.sort((a, b) => {
        if (a.status === 'no-data' && b.status !== 'no-data') return 1;
        if (a.status !== 'no-data' && b.status === 'no-data') return -1;
        if (a.daysAgo === null) return 1;
        if (b.daysAgo === null) return -1;
        return a.daysAgo - b.daysAgo;
      });
      
      setDataRecency(recencyData);
    } catch (error) {
      console.error('Error fetching data recency:', error);
      setError('Failed to load data recency information. Please try again.');
    } finally {
      setIsLoadingRecency(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (activeTab === 'recency') {
      fetchDataRecency();
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (payrollPeriod.endDate) {
      const hours = getStandardExpectedHours(payrollPeriod.endDate);
      setPayrollPeriod(prev => ({ ...prev, expectedHours: hours }));
    }
  }, [payrollPeriod.endDate]); // eslint-disable-line react-hooks/exhaustive-deps

const loadInitialData = async () => {
    try {
      // Just check localStorage for last processed info
      const { data: lastInspection, error } = await supabase
        .from('inspection_data')
        .select('payroll_period_end, payroll_processed_date')
        .not('payroll_period_end', 'is', null)
        .order('payroll_period_end', { ascending: false })
        .limit(1)
        .single();
      
      if (!error && lastInspection) {
        const storedInfo = localStorage.getItem('lastPayrollProcessed');
        if (storedInfo) {
          const parsed = JSON.parse(storedInfo);
          if (parsed.endDate === lastInspection.payroll_period_end) {
            setLastProcessedInfo(parsed);
          }
        }
      }
    } catch (error) {
      console.error('Error loading last processed info:', error);
      // Don't set error for this, it's not critical
    }
  };
  const calculateInspectionBonuses = async () => {
    setIsProcessing(true);
    setError(null);
    setSuccessMessage(null);
    
    try {
      const startDate = payrollPeriod.startDate;
      const endDate = payrollPeriod.endDate;
      
      let query = supabase
        .from('inspection_data')
        .select('id, measure_by, measure_date, property_class, property_composite_key, property_location, job_id')
        .gte('measure_date', startDate)
        .lte('measure_date', endDate)
        .in('property_class', ['2', '3A'])
        .limit(5000);

      if (selectedJob !== 'all') {
        query = query.eq('job_id', selectedJob);
      } else if (jobs.length > 0) {
        // Only include inspections from PPA jobs (jobs prop is pre-filtered)
        query = query.in('job_id', jobs.map(j => j.id));
      }

      const startTime = Date.now();
      const { data: allInspections, error: queryError } = await query;
      const queryTime = Date.now() - startTime;

      if (queryError) {
        console.error('Query error:', queryError);
        throw new Error(`Database error: ${queryError.message}`);
      }

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

      const bonusResults = {};
      
      Object.entries(inspectorCounts).forEach(([initials, data]) => {
        bonusResults[initials] = {
          initials: initials,
          inspections: data.count,
          bonus: data.count * bonusRate,
          inspectionIds: data.inspectionIds,
          details: data.details
        };
      });

      setInspectionBonuses(bonusResults);
      setSuccessMessage(`Successfully calculated bonuses for ${Object.keys(bonusResults).length} inspectors (${allInspections.length} total inspections)`);
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
        
        let totalHoursSum = 0;
        let apptOTSum = 0;
        let rowsStartIndex = -1;
        
        for (let i = 0; i < Math.min(10, rawData.length); i++) {
          if (rawData[i] && rawData[i][0] === 'EMPLOYEE') {
            rowsStartIndex = i + 2;
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

        for (let i = rowsStartIndex; i < rawData.length; i++) {
          const row = rawData[i];
          if (row[0] && typeof row[0] === 'string' && !row[0].includes('TOTAL HOURS')) {
            const employeeName = row[0].trim();
            const initials = row[1] || null;
            const hours = row[2];
            const timeOff = row[3] || '';
            const apptOT = row[4] || 0;
            const fieldOT = row[5] || 0;
            const total = row[6] || 0;
            const comments = row[7] || '';

            const empData = {
              worksheetName: employeeName,
              initials: initials,
              hours: hours,
              timeOff: timeOff,
              apptOT: apptOT,
              fieldOT: fieldOT,
              total: total,
              comments: comments,
              issues: []
            };
            
            const calculatedTotal = (typeof apptOT === 'number' ? apptOT : 0) + (typeof fieldOT === 'number' ? fieldOT : 0);
            if (typeof total === 'number' && Math.abs(total - calculatedTotal) > 0.01) {
              empData.issues.push(`TOTAL formula error: Shows $${total} but should be $${calculatedTotal} (${apptOT} + ${fieldOT})`);
            }
            
            // Check for missing, undefined, or invalid hours first
            if (hours === undefined || hours === null || hours === '') {
              empData.issues.push(`Missing hours data`);
            } else if (typeof hours === 'number' && hours < 0) {
              empData.issues.push(`Negative hours (${hours}) - please check`);
            } else if (typeof hours === 'number' && !isNaN(hours)) {
              totalHoursSum += hours;
              
              // Look up the employee in our employees data to check their actual status
              const employee = employees.find(emp => {
                const empFullName = `${emp.last_name}, ${emp.first_name}`.toLowerCase();
                const worksheetName = employeeName.toLowerCase();
                return worksheetName.includes(emp.last_name.toLowerCase()) && 
                       worksheetName.includes(emp.first_name.toLowerCase());
              });
              
              // Use employment_status from database
              const isPartTime = employee && employee.employment_status === 'part_time';
              
              // Simple check: if not part-time and hours don't match expected, flag it
              if (!isPartTime && hours !== payrollPeriod.expectedHours) {
                empData.issues.push(`Shows ${hours} hours instead of expected ${payrollPeriod.expectedHours}`);
              }
              
              if (hours === 0) {
                empData.issues.push(`Zero hours recorded`);
              }
            } else if (hours !== 'same' && hours !== 'Salary') {
              // It's not a number and not "same"/"Salary"
              empData.issues.push(`Invalid hours value: "${hours}"`);
            }
            
            if (typeof apptOT === 'number' && !isNaN(apptOT)) {
              apptOTSum += apptOT;
            }
            
            parsedData.push(empData);
          }
        }

        const totalsRowIndex = rawData.findIndex(row => 
          row[0] && row[0].toString().includes('TOTAL HOURS')
        );
        
        if (totalsRowIndex > -1) {
          const totalsRow = rawData[totalsRowIndex];
          const sheetTotalHours = totalsRow[2] || 0;
          const sheetApptOT = totalsRow[4] || 0;

          if (totalHoursSum > 0 && Math.abs(sheetTotalHours - totalHoursSum) > 0.01) {
            issues.push({
              type: 'warning',
              message: `Total hours shows ${sheetTotalHours}, but individual hours add up to ${totalHoursSum}`,
              emailText: `Quick note: The total hours row shows ${sheetTotalHours}, but when I add up the individual hours I get ${totalHoursSum}. Might want to double-check the SUM formula.`
            });
          }
          
          if (Math.abs(sheetApptOT - apptOTSum) > 0.01) {
            issues.push({
              type: 'warning',
              message: `Total Appt OT shows $${sheetApptOT}, but individual amounts add up to $${apptOTSum}`,
              emailText: `The Appt OT total shows $${sheetApptOT}, but individual amounts sum to $${apptOTSum}. Please check the SUM formula.`
            });
          }
        }
        
        setWorksheetIssues(issues);
        setPayrollData(parsedData);
        
        const employeesWithIssues = parsedData.filter(emp => emp.issues.length > 0).length;

        if (issues.length === 0 && employeesWithIssues === 0) {
          setSuccessMessage(`Processed ${parsedData.length} employees successfully - worksheet looks good!`);
        } else {
          setSuccessMessage(`Processed ${parsedData.length} employees. Found ${issues.length + employeesWithIssues} items to review.`);
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
      
      if (emp.initials && inspectionBonuses[emp.initials]) {
        const bonusData = inspectionBonuses[emp.initials];
        bonus = bonusData.bonus;
        inspections = bonusData.inspections;
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
    const rows = [];

    // Column headers
    const headers = ['Employee Name', 'Hours', 'Appt OT', 'Field Bonus', 'TOTAL OT'];
    rows.push(headers);

    // Add employee data rows
    mergedData.forEach(emp => {
      const hours = emp.hours === 'same' || emp.hours === 'Salary' ? 'same' : emp.hours;
      const apptOT = emp.apptOT || 0;
      const fieldBonus = emp.calculatedFieldOT || 0;
      const total = apptOT + fieldBonus;

      rows.push([
        emp.worksheetName,
        hours,
        apptOT,
        fieldBonus,
        total
      ]);
    });

    // Blank row
    rows.push([]);

    // Totals row with formulas
    const firstDataRow = 2; // Row 2 in Excel (after header row)
    const lastDataRow = mergedData.length + 1; // Last employee row
    const totalsRow = [];
    totalsRow[0] = 'TOTALS';

    // Hours total (sum only numeric values, skip 'same' and 'Salary')
    totalsRow[1] = {
      f: `SUMIF(B${firstDataRow}:B${lastDataRow},">0")`,
      t: 'n'
    };

    // Appt OT total
    totalsRow[2] = {
      f: `SUM(C${firstDataRow}:C${lastDataRow})`,
      t: 'n',
      z: '0.00'
    };

    // Field Bonus total
    totalsRow[3] = {
      f: `SUM(D${firstDataRow}:D${lastDataRow})`,
      t: 'n',
      z: '0.00'
    };

    // TOTAL OT
    totalsRow[4] = {
      f: `SUM(E${firstDataRow}:E${lastDataRow})`,
      t: 'n',
      z: '0.00'
    };

    rows.push(totalsRow);

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Base styles
    const baseStyle = {
      font: { name: 'Leelawadee', sz: 10 },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    const headerStyle = {
      font: { name: 'Leelawadee', sz: 10, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    const totalsStyle = {
      font: { name: 'Leelawadee', sz: 10, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    // Apply styles
    const range = XLSX.utils.decode_range(ws['!ref']);
    const totalsRowIndex = mergedData.length + 2; // +1 for header, +1 for blank row

    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddress]) continue;

        // Header row (row 0)
        if (R === 0) {
          ws[cellAddress].s = headerStyle;
        }
        // Totals row
        else if (R === totalsRowIndex) {
          const style = { ...totalsStyle };
          // Format numeric columns
          if (C === 1) {
            style.numFmt = '0.##'; // Hours - preserve decimals
          } else if (C >= 2) {
            style.numFmt = '0.00'; // Currency columns
          }
          ws[cellAddress].s = style;
        }
        // Data rows
        else {
          const style = { ...baseStyle };
          // Employee name - left aligned
          if (C === 0) {
            style.alignment = { horizontal: 'left', vertical: 'center' };
          }
          // Hours column
          else if (C === 1) {
            // Handle 'same' and 'Salary' text values
            if (typeof ws[cellAddress].v === 'string') {
              style.alignment = { horizontal: 'center', vertical: 'center' };
            } else {
              style.numFmt = '0.##';
            }
          }
          // Numeric columns (Appt OT, Field Bonus, TOTAL OT)
          else if (C >= 2) {
            style.numFmt = '0.00';
          }
          ws[cellAddress].s = style;
        }
      }
    }

    // Set column widths
    ws['!cols'] = [
      { wch: 25 },  // Employee Name
      { wch: 10 },  // Hours
      { wch: 12 },  // Appt OT
      { wch: 12 },  // Field Bonus
      { wch: 12 }   // TOTAL OT
    ];

    // Create workbook and export
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Payroll');

    const fileName = `payroll_${payrollPeriod.endDate}_ADP.xlsx`;
    XLSX.writeFile(wb, fileName);
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
      
      const batchSize = 500;
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
      
      const mergedData = mergePayrollWithBonuses();
      const totalHours = mergedData.reduce((sum, emp) => sum + (typeof emp.hours === 'number' ? emp.hours : 0), 0);
      const totalApptOT = mergedData.reduce((sum, emp) => sum + (emp.apptOT || 0), 0);
      const totalFieldBonus = mergedData.reduce((sum, emp) => sum + emp.calculatedFieldOT, 0);
      const totalOT = mergedData.reduce((sum, emp) => sum + emp.calculatedTotal, 0);
      
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad';
      
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
          status: 'processed',
          total_amount: totalOT,
          processing_settings: {
            bonus_rate: bonusRate,
            employee_count: mergedData.length,
            worksheet_issues: worksheetIssues
          },
          created_by: userId
        })
        .select()
        .single();
      
      if (periodError) throw periodError;
      
      const processInfo = {
        startDate: payrollPeriod.startDate,
        endDate: payrollPeriod.endDate,
        processedDate: payrollPeriod.processedDate,
        inspectionCount: allInspectionIds.length
      };
      localStorage.setItem('lastPayrollProcessed', JSON.stringify(processInfo));
      
      setSuccessMessage(`Successfully marked ${allInspectionIds.length} inspections as processed for period ending ${payrollPeriod.endDate}`);

      const nextPeriod = getNextPayrollPeriod(payrollPeriod.endDate);
      setPayrollPeriod({
        startDate: payrollPeriod.processedDate,  // This moves processing date to start
        endDate: nextPeriod.endDate,
        processedDate: new Date().toISOString().split('T')[0],  // This resets to today
        expectedHours: nextPeriod.expectedHours
      });
      
      setPayrollData([]);
      setInspectionBonuses({});
      setWorksheetIssues([]);
      setUploadedFile(null);
      
      // Refresh data in App.js
      if (onRefresh) onRefresh();
      
      // Still need to check for last processed info
      loadInitialData();
    } catch (error) {
      console.error('Error marking inspections as processed:', error);
      setError('Failed to mark inspections as processed: ' + error.message);
    }
  };

  const generateEmailFeedback = () => {
    if (worksheetIssues.length === 0 && !payrollData.some(emp => emp.issues.length > 0)) {
      return '';
    }
    
    let email = `Hi,\n\nI've reviewed the payroll worksheet and found a few items:\n\n`;
    
    if (worksheetIssues.length > 0) {
      worksheetIssues.forEach((issue, index) => {
        email += `${index + 1}. ${issue.emailText}\n\n`;
      });
    }
    
    const employeesWithIssues = payrollData.filter(emp => emp.issues.length > 0);
    if (employeesWithIssues.length > 0) {
      email += `Employee-specific issues:\n\n`;
      employeesWithIssues.forEach(emp => {
        email += `${emp.worksheetName}:\n`;
        emp.issues.forEach(issue => {
          email += `  - ${issue}\n`;
        });
        email += '\n';
      });
    }
    
    email += `Let me know if you have any questions!\n\nThanks`;
    
    return email;
  };

  const copyEmailToClipboard = async () => {
    const email = generateEmailFeedback();
    
    if (!email) {
      setError('No issues to copy');
      return;
    }
    
    try {
      await navigator.clipboard.writeText(email);
      setSuccessMessage('Email text copied to clipboard!');
      setTimeout(() => setSuccessMessage(null), 2000);  // Reset after 2 seconds
    } catch (err) {
      // Fallback method if clipboard API fails
      const textArea = document.createElement("textarea");
      textArea.value = email;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      try {
        document.execCommand('copy');
        setSuccessMessage('Email text copied to clipboard!');
        setTimeout(() => setSuccessMessage(null), 2000);  // Reset after 2 seconds
      } catch (err) {
        setError('Failed to copy to clipboard');
      }
      
      textArea.remove();
    }
  };
  const getRowColor = (employee) => {
    if (employee.issues?.length > 0) return 'bg-amber-50';
    return '';
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'current':
        return 'bg-green-100 text-green-800';
      case 'aging':
        return 'bg-yellow-100 text-yellow-800';
      case 'stale':
        return 'bg-red-100 text-red-800';
      case 'no-data':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'current':
        return '✓';
      case 'aging':
        return '⚠';
      case 'stale':
        return '✗';
      case 'no-data':
        return '—';
      default:
        return '?';
    }
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
                {formatDateForDisplay(lastProcessedInfo.startDate)} - {formatDateForDisplay(lastProcessedInfo.endDate)}
              </span>
            </div>
            <div>
              <span className="text-blue-700">Processed on:</span>
              <span className="ml-2 font-medium text-blue-900">
                {formatDateForDisplay(lastProcessedInfo.processedDate)}
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
            onClick={() => setActiveTab('recency')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'recency'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Data Recency
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
              {(worksheetIssues.length > 0 || payrollData.some(emp => emp.issues.length > 0)) && (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-gray-900">Worksheet Review</h3>
                    <button
                      onClick={copyEmailToClipboard}
                      className="text-sm text-blue-600 hover:text-blue-500"
                    >
                      {successMessage === 'Email text copied to clipboard!' ? '✓ Copied!' : 'Copy as Email'}
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
                      </div>
                    ))}
                    
                    {payrollData.filter(emp => emp.issues.length > 0).length > 0 && (
                      <div className="mt-4">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Employee Issues Found:</h4>
                        <div className="space-y-2">
                          {payrollData.filter(emp => emp.issues.length > 0).map((emp, index) => (
                            <div key={index} className="p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-md">
                              <p className="font-medium">{emp.worksheetName}:</p>
                              <ul className="list-disc list-inside text-sm mt-1">
                                {emp.issues.map((issue, issueIndex) => (
                                  <li key={issueIndex}>{issue}</li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Step 2: Calculate Bonuses */}
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

          {/* Step 3: Review and Export */}
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
                          <>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Initials</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hours</th>
                          </>
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
                              {employee.initials || '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {employee.hours === 'same' || employee.hours === 'Salary' ? (
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
                              {employee.inspectionCount > 0 && (
                                <span className="text-xs text-gray-500 ml-1">({employee.inspectionCount})</span>
                              )}
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
                          .sort((a, b) => b[1].inspections - a[1].inspections)
                          .map(([initials, data], index) => (
                            <tr key={index} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                Inspector {initials}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {initials}
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

      {/* Data Recency Tab */}
      {activeTab === 'recency' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Job Data Upload Recency</h2>
            <button
              onClick={fetchDataRecency}
              disabled={isLoadingRecency}
              className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              <svg className="mr-2 -ml-0.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {isLoadingRecency ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {isLoadingRecency ? (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : dataRecency.length === 0 ? (
            <div className="text-center py-12">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <p className="mt-2 text-gray-500">No active jobs found</p>
            </div>
          ) : (
            <>
              {/* Status Legend */}
              <div className="mb-4 flex items-center space-x-6 text-sm">
                <div className="flex items-center">
                  <span className="inline-block w-3 h-3 mr-2 bg-green-500 rounded-full"></span>
                  <span className="text-gray-600">Current (≤7 days)</span>
                </div>
                <div className="flex items-center">
                  <span className="inline-block w-3 h-3 mr-2 bg-yellow-500 rounded-full"></span>
                  <span className="text-gray-600">Aging (8-30 days)</span>
                </div>
                <div className="flex items-center">
                  <span className="inline-block w-3 h-3 mr-2 bg-red-500 rounded-full"></span>
                  <span className="text-gray-600">Stale (>30 days)</span>
                </div>
                <div className="flex items-center">
                  <span className="inline-block w-3 h-3 mr-2 bg-gray-400 rounded-full"></span>
                  <span className="text-gray-600">No Data</span>
                </div>
              </div>

              {/* Data Table */}
              <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
                <table className="min-w-full divide-y divide-gray-300">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Job Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Last Upload Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Days Ago
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {dataRecency.map((job) => (
                      <tr key={job.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {job.jobName}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {job.lastUploadDate ? formatDateForDisplay(job.lastUploadDate) : 'Never'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {job.daysAgo !== null ? `${job.daysAgo} days` : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(job.status)}`}>
                            <span className="mr-1">{getStatusIcon(job.status)}</span>
                            {job.status === 'current' ? 'Current' :
                             job.status === 'aging' ? 'Aging' :
                             job.status === 'stale' ? 'Stale' : 'No Data'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary Cards */}
              <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <p className="text-xs font-medium text-green-600 uppercase tracking-wider">Current</p>
                  <p className="mt-1 text-2xl font-bold text-green-900">
                    {dataRecency.filter(j => j.status === 'current').length}
                  </p>
                </div>
                <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                  <p className="text-xs font-medium text-yellow-600 uppercase tracking-wider">Aging</p>
                  <p className="mt-1 text-2xl font-bold text-yellow-900">
                    {dataRecency.filter(j => j.status === 'aging').length}
                  </p>
                </div>
                <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                  <p className="text-xs font-medium text-red-600 uppercase tracking-wider">Stale</p>
                  <p className="mt-1 text-2xl font-bold text-red-900">
                    {dataRecency.filter(j => j.status === 'stale').length}
                  </p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">No Data</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">
                    {dataRecency.filter(j => j.status === 'no-data').length}
                  </p>
                </div>
              </div>
            </>
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
                        {period.period_name || `${formatDateForDisplay(period.start_date)} - ${formatDateForDisplay(period.end_date)}`}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDateForDisplay(period.processed_date)}
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
