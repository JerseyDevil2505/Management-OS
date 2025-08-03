  import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as XLSX from 'xlsx';

const BillingManagement = () => {
  const [activeTab, setActiveTab] = useState('active');
  const [jobs, setJobs] = useState([]);
  const [legacyJobs, setLegacyJobs] = useState([]);
  const [planningJobs, setPlanningJobs] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showContractSetup, setShowContractSetup] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [showBillingForm, setShowBillingForm] = useState(false);
  const [billingHistoryText, setBillingHistoryText] = useState('');
  const [showExpenseImport, setShowExpenseImport] = useState(false);
  const [expenseFile, setExpenseFile] = useState(null);
  const [revenueData, setRevenueData] = useState({ totalRevenue: 0 });
  
  // Working days for 2025 (excluding weekends and federal holidays)
  const workingDays2025 = {
    1: 21,  // Jan
    2: 19,  // Feb
    3: 21,  // Mar
    4: 21,  // Apr
    5: 21,  // May
    6: 20,  // Jun
    7: 22,  // Jul
    8: 21,  // Aug
    9: 21,  // Sep
    10: 22, // Oct
    11: 18, // Nov
    12: 22  // Dec
  };

  const [contractSetup, setContractSetup] = useState({
    contractAmount: '',
    templateType: 'standard',
    retainerPercentage: 0.10,
    endOfJobPercentage: 0.05,
    firstYearAppealsPercentage: 0.03,
    secondYearAppealsPercentage: 0.02,
    thirdYearAppealsPercentage: 0.00
  });
  const [billingForm, setBillingForm] = useState({
    billingDate: new Date().toISOString().split('T')[0],
    percentageBilled: '',
    status: 'P', // Changed from 'D' to 'P' for Paid
    invoiceNumber: '',
    notes: '',
    manualOverride: false,
    overrideAmount: '',
    billingType: ''
  });
  const [showBulkPaste, setShowBulkPaste] = useState(false);
  const [bulkBillingText, setBulkBillingText] = useState('');
  const [showEditBilling, setShowEditBilling] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [showLegacyJobForm, setShowLegacyJobForm] = useState(false);
  const [legacyJobForm, setLegacyJobForm] = useState({
    jobName: '',
    contractAmount: '',
    billingHistory: '',
    templateType: 'standard',
    retainerPercentage: 0.10,
    endOfJobPercentage: 0.05,
    firstYearAppealsPercentage: 0.03,
    secondYearAppealsPercentage: 0.02,
    thirdYearAppealsPercentage: 0.00
  });
  const [globalMetrics, setGlobalMetrics] = useState({
    totalSigned: 0,
    totalPaid: 0,
    totalOpen: 0,
    totalRemaining: 0,
    totalRemainingExcludingRetainer: 0,
    dailyFringe: 0,
    currentExpenses: 0,
    projectedExpenses: 0,
    profitLoss: 0,
    profitLossPercent: 0
  });

  useEffect(() => {
    loadJobs();
    calculateGlobalMetrics();
    if (activeTab === 'expenses') {
      loadExpenses();
    }
  }, [activeTab]);

  const calculateGlobalMetrics = async () => {
    try {
      // Get all active jobs with contracts
      const { data: activeJobs } = await supabase
        .from('jobs')
        .select(`
          job_contracts(contract_amount, retainer_amount),
          billing_events(amount_billed, retainer_amount, status, percentage_billed)
        `)
        .eq('job_type', 'standard');

      // Get planning jobs with contract amounts
      const { data: planningJobsData } = await supabase
        .from('planning_jobs')
        .select('contract_amount')
        .not('contract_amount', 'is', null)
        .eq('is_archived', false);

      // Get current year expenses
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;
      const { data: expenseData } = await supabase
        .from('expenses')
        .select('*')
        .eq('year', currentYear);

      let totalSigned = 0;
      let totalPaid = 0;
      let totalOpen = 0;
      let totalRemaining = 0;
      let totalRemainingExcludingRetainer = 0;

      // Calculate from active jobs
      if (activeJobs) {
        activeJobs.forEach(job => {
          if (job.job_contracts?.[0]) {
            const contract = job.job_contracts[0];
            const contractAmount = contract.contract_amount;
            const totalRetainerAmount = contract.retainer_amount;
            
            totalSigned += contractAmount;

            let jobPaid = 0;
            let jobOpen = 0;  // ADD THIS LINE
            let totalPercentageBilled = 0;

            if (job.billing_events) {
              job.billing_events.forEach(event => {
                if (event.status === 'P') {
                  jobPaid += event.amount_billed;
                } else if (event.status === 'O') {   // Check for multiple possible open statuses
                  jobOpen += event.amount_billed;
                }
                totalPercentageBilled += event.percentage_billed;
              });
            }

            totalPaid += jobPaid;
            totalOpen += jobOpen;  // ADD THIS LINE
            const jobRemaining = contractAmount - jobPaid;
            totalRemaining += jobRemaining;
            
            // Calculate remaining retainer to be collected
            const remainingPercentage = 1 - totalPercentageBilled;
            const remainingRetainer = totalRetainerAmount * remainingPercentage;
            
            // Remaining excluding future retainer collections
            totalRemainingExcludingRetainer += (jobRemaining - remainingRetainer);
          }
        });
      }
       // Get legacy jobs with open invoices
      const { data: legacyJobs } = await supabase
        .from('jobs')
        .select(`
          job_contracts(contract_amount),
          billing_events(amount_billed, status)
        `)
        .eq('job_type', 'legacy_billing');
  
      if (legacyJobs) {
        legacyJobs.forEach(job => {
          // Add open invoices to totalOpen
          if (job.billing_events) {
            job.billing_events.forEach(event => {
              if (event.status === 'O') {
                totalOpen += event.amount_billed;
              }
            });
          }
          
          // Add remaining contract balance to totalRemaining
          if (job.job_contracts?.[0]) {
            const contract = job.job_contracts[0];
            const totalBilled = job.billing_events?.reduce((sum, event) => 
              sum + parseFloat(event.amount_billed || 0), 0) || 0;
            const jobRemaining = contract.contract_amount - totalBilled;
            
            if (jobRemaining > 0) {
              totalRemaining += jobRemaining;
              // For legacy jobs, assume standard 10% retainer on the remaining amount
              totalRemainingExcludingRetainer += jobRemaining * 0.9;
            }
          }
        });
      }
      // Add planning jobs to total signed
      if (planningJobsData) {
        planningJobsData.forEach(job => {
          if (job.contract_amount) {
            totalSigned += job.contract_amount;
            // Planning jobs have no payments yet, so full amount is remaining
            totalRemaining += job.contract_amount;
            // Assuming standard 10% retainer for planning jobs
            totalRemainingExcludingRetainer += (job.contract_amount * 0.9);
          }
        });
      }

      // Calculate expense metrics
      let currentExpenses = 0;
      let monthlyExpenses = new Array(12).fill(0);
      
      if (expenseData) {
        expenseData.forEach(expense => {
          monthlyExpenses[expense.month - 1] += parseFloat(expense.amount);
          if (expense.month <= currentMonth) {
            currentExpenses += parseFloat(expense.amount);
          }
        });
      }

      // Calculate working days so far this year
      let workingDaysSoFar = 0;
      for (let month = 1; month <= currentMonth; month++) {
        workingDaysSoFar += workingDays2025[month] || 21;
      }

      // Calculate total working days in year
      const totalWorkingDays = Object.values(workingDays2025).reduce((sum, days) => sum + days, 0);

      // Calculate daily fringe (expense rate) and projections
      const revenue = totalPaid; // Use total paid invoices as revenue
      const dailyFringe = workingDaysSoFar > 0 ? currentExpenses / workingDaysSoFar : 0;
      
      // Calculate average of monthly daily rates for better projection
      let monthlyDailyRates = [];
      let totalDailyRates = 0;
      let monthsWithData = 0;
      
      for (let month = 1; month <= currentMonth; month++) {
        const monthExpense = monthlyExpenses[month - 1];
        if (monthExpense > 0) {
          const dailyRate = monthExpense / workingDays2025[month];
          monthlyDailyRates.push(dailyRate);
          totalDailyRates += dailyRate;
          monthsWithData++;
        }
      }
      
      // Use average of monthly daily rates for projection
      const avgMonthlyDailyRate = monthsWithData > 0 ? totalDailyRates / monthsWithData : 0;
      const projectedExpenses = avgMonthlyDailyRate * totalWorkingDays;  // This line stays the same
      
      // Keep YTD rate for display
      const dailyExpenseRate = workingDaysSoFar > 0 ? currentExpenses / workingDaysSoFar : 0;
      
      // Calculate profit/loss
      const projectedRevenue = dailyFringe * totalWorkingDays;
      const profitLoss = projectedRevenue - projectedExpenses;
      const profitLossPercent = projectedRevenue > 0 ? (profitLoss / projectedRevenue) * 100 : 0;

      setGlobalMetrics({
        totalSigned,
        totalPaid,
        totalOpen,
        totalRemaining,
        totalRemainingExcludingRetainer,
        dailyFringe: avgMonthlyDailyRate || dailyExpenseRate,
        currentExpenses,
        projectedExpenses,
        profitLoss,
        profitLossPercent
      });
    } catch (error) {
      console.error('Error calculating global metrics:', error);
    }
  };

  const loadExpenses = async () => {
    try {
      const currentYear = new Date().getFullYear();
      const { data: expenseData, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('year', currentYear)
        .order('category')
        .order('month');

      if (error) throw error;
      setExpenses(expenseData || []);
    } catch (error) {
      console.error('Error loading expenses:', error);
    }
  };

  const loadJobs = async () => {
    try {
      setLoading(true);
      
      if (activeTab === 'active') {
        // Load ALL active jobs (no filter on job names)
        const { data: jobsData, error: jobsError } = await supabase
          .from('jobs')
          .select(`
            *,
            job_contracts(*),
            billing_events(*)
          `)
          .eq('job_type', 'standard')
          .order('created_at', { ascending: false });

        if (jobsError) throw jobsError;
        setJobs(jobsData || []);
      } else if (activeTab === 'planned') {
        // Load planning jobs
        const { data: planningData, error: planningError } = await supabase
          .from('planning_jobs')
          .select('*')
          .or('is_archived.eq.false,is_archived.is.null');

        if (planningError) throw planningError;
        setPlanningJobs(planningData || []);
      } else if (activeTab === 'legacy') {
        // Load legacy billing-only jobs
        const { data: legacyData, error: legacyError } = await supabase
          .from('jobs')
          .select(`
            *,
            job_contracts(*),
            billing_events(*)
          `)
          .eq('job_type', 'legacy_billing');

        if (legacyError) throw legacyError;
        setLegacyJobs(legacyData || []);
      }
    } catch (error) {
      console.error('Error loading jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateBillingTotals = (job) => {
    if (!job.job_contracts?.[0] || !job.billing_events) return null;
    
    const contract = job.job_contracts[0];
    const events = job.billing_events || [];
    
    const totalPercentageBilled = events.reduce((sum, event) => sum + parseFloat(event.percentage_billed || 0), 0);
    const totalAmountBilled = events.reduce((sum, event) => sum + parseFloat(event.amount_billed || 0), 0);
    const remainingDue = contract.contract_amount - totalAmountBilled;
    
    return {
      contractAmount: contract.contract_amount,
      totalPercentageBilled: totalPercentageBilled * 100,
      totalAmountBilled,
      remainingDue,
      isComplete: totalPercentageBilled >= 1.0
    };
  };

  const parseBillingHistory = (text) => {
    console.log('Raw text to parse:', text);
    console.log('Text length:', text.length);
    // Parse pasted billing history
    // Format: 12/4/2024 10.00% D 12240225 $49,935.00 $4,994.00 $0.00 $44,941.00
    const lines = text.trim().split('\n');
    console.log('Lines after split:', lines);
    console.log('Number of lines:', lines.length);
    const parsedEvents = [];
    
    lines.forEach((line, index) => {
      console.log(`Line ${index}:`, line);
      console.log(`Line ${index} length:`, line.length);
      const parts = line.trim().split('\t');
      console.log(`Line ${index} parts:`, parts);
      console.log(`Line ${index} parts count:`, parts.length);
      if (parts.length >= 8) {
        const date = parts[0];
        const percentage = parseFloat(parts[1].replace('%', ''));
        
        // Check if third part is D or empty/missing
        let status, invoiceNumber, startIndex;
        if (parts[2] === 'D') {
          status = 'P'; // D becomes P (Paid)
          invoiceNumber = parts[3];
          startIndex = 4;
        } else {
          status = 'O'; // No D means Open (changed from '')
          invoiceNumber = parts[2];
          startIndex = 3;
        }
        
        // Remove $ and commas from amounts and round to nearest dollar
        const totalAmount = Math.round(parseFloat(parts[startIndex].replace(/[$,]/g, '')));
        const retainerAmount = Math.round(parseFloat(parts[startIndex + 1].replace(/[$,]/g, '')));
        // Skip parts[startIndex + 2] which seems to be $0.00
        const amountBilled = parseFloat(parts[startIndex + 2].replace(/[$,]/g, ''));
        
        parsedEvents.push({
          date,
          percentage,
          status,
          invoiceNumber,
          totalAmount,
          retainerAmount,
          amountBilled
        });
      }
    });
    
    return parsedEvents;
  };

  const handleContractSetup = async () => {
    if (!selectedJob) return;
    
    try {
      // Calculate all amounts based on percentages
      const contractData = {
        job_id: selectedJob.id,
        contract_amount: parseFloat(contractSetup.contractAmount),
        retainer_percentage: contractSetup.retainerPercentage,
        retainer_amount: parseFloat(contractSetup.contractAmount) * contractSetup.retainerPercentage,
        end_of_job_percentage: contractSetup.endOfJobPercentage,
        end_of_job_amount: parseFloat(contractSetup.contractAmount) * contractSetup.endOfJobPercentage,
        first_year_appeals_percentage: contractSetup.firstYearAppealsPercentage,
        first_year_appeals_amount: parseFloat(contractSetup.contractAmount) * contractSetup.firstYearAppealsPercentage,
        second_year_appeals_percentage: contractSetup.secondYearAppealsPercentage,
        second_year_appeals_amount: parseFloat(contractSetup.contractAmount) * contractSetup.secondYearAppealsPercentage,
        third_year_appeals_percentage: contractSetup.thirdYearAppealsPercentage,
        third_year_appeals_amount: parseFloat(contractSetup.contractAmount) * contractSetup.thirdYearAppealsPercentage
      };

      const { error: contractError } = await supabase
        .from('job_contracts')
        .upsert(contractData);

      if (contractError) throw contractError;

      // If contract amount changed, recalculate all billing events' amounts
      if (selectedJob.job_contracts?.[0] && 
          selectedJob.job_contracts[0].contract_amount !== parseFloat(contractSetup.contractAmount)) {
        
        // Recalculate all billing event amounts based on new contract
        const { data: billingEvents } = await supabase
          .from('billing_events')
          .select('*')
          .eq('job_id', selectedJob.id)
          .order('billing_date');

        if (billingEvents) {
          let runningTotal = 0;
          
          for (const event of billingEvents) {
            // Recalculate amounts based on new contract amount
            const totalAmount = Math.round(parseFloat(contractSetup.contractAmount) * event.percentage_billed);
            const retainerAmount = Math.round(totalAmount * contractSetup.retainerPercentage);
            const amountBilled = totalAmount - retainerAmount;
            runningTotal += amountBilled;
            const remainingDue = parseFloat(contractSetup.contractAmount) - runningTotal;

            await supabase
              .from('billing_events')
              .update({
                total_amount: totalAmount,
                retainer_amount: retainerAmount,
                amount_billed: amountBilled,
                remaining_due: remainingDue
              })
              .eq('id', event.id);
          }
        }
      }

      // If billing history was provided, bulk import the events
      if (billingHistoryText.trim()) {
        const parsedEvents = parseBillingHistory(billingHistoryText);
        let runningTotal = 0;
        let runningPercentage = 0;
        
        for (const event of parsedEvents) {
          console.log('Saving event:', event);
          runningTotal += event.amountBilled;
          runningPercentage += event.percentage / 100;
          const remainingDue = parseFloat(contractSetup.contractAmount) - runningTotal;
          
          const billingData = {
            job_id: selectedJob.id,
            billing_date: new Date(event.date).toISOString().split('T')[0],
            percentage_billed: event.percentage / 100,
            status: event.status,
            invoice_number: event.invoiceNumber,
            total_amount: event.totalAmount,
            retainer_amount: event.retainerAmount,
            amount_billed: event.amountBilled,
            remaining_due: remainingDue,
            notes: 'Imported from billing history',
            billing_type: billingForm.billingType
          };

          const { error: eventError } = await supabase
            .from('billing_events')
            .insert(billingData);

          if (eventError) {
            console.error('Error inserting billing event:', eventError);
          }
        }

        // Update job percent_billed
        await supabase
          .from('jobs')
          .update({ 
            billing_setup_complete: true,
            percent_billed: runningPercentage 
          })
          .eq('id', selectedJob.id);
      } else {
        // Just update billing_setup_complete if no history provided
        await supabase
          .from('jobs')
          .update({ billing_setup_complete: true })
          .eq('id', selectedJob.id);
      }

      setShowContractSetup(false);
      setSelectedJob(null);
      setBillingHistoryText('');
      // Reset contract setup to defaults
      setContractSetup({
        contractAmount: '',
        templateType: 'standard',
        retainerPercentage: 0.10,
        endOfJobPercentage: 0.05,
        firstYearAppealsPercentage: 0.03,
        secondYearAppealsPercentage: 0.02,
        thirdYearAppealsPercentage: 0.00
      });
      loadJobs();
      calculateGlobalMetrics();
    } catch (error) {
      console.error('Error setting up contract:', error);
    }
  };

  const handleAddBillingEvent = async () => {
    if (!selectedJob || !selectedJob.job_contracts?.[0]) return;
    
    console.log('showBulkPaste:', showBulkPaste);
    console.log('bulkBillingText:', bulkBillingText);
    console.log('bulkBillingText trimmed:', bulkBillingText.trim())
    
    try {
      const contract = selectedJob.job_contracts[0];
      
      if (showBulkPaste && bulkBillingText.trim()) {
        // Handle bulk paste
        const parsedEvents = parseBillingHistory(bulkBillingText);
        console.log('Parsed events:', parsedEvents);
        if (parsedEvents.length === 0) {
          alert('No valid events found in pasted text. Check format.');
          return;
        }        
        let runningTotal = 0;
        let runningPercentage = 0;
        
        // Get existing events to calculate starting totals
        const existingEvents = selectedJob.billing_events || [];
        const previousBilled = existingEvents.reduce((sum, event) => sum + parseFloat(event.amount_billed || 0), 0);
        const previousPercentage = existingEvents.reduce((sum, event) => sum + parseFloat(event.percentage_billed || 0), 0);
        
        runningTotal = previousBilled;
        runningPercentage = previousPercentage;
        
        for (const event of parsedEvents) {
          console.log('Processing event:', event);
          runningTotal += event.amountBilled;
          runningPercentage += event.percentage / 100;
          const remainingDue = contract.contract_amount - runningTotal;
          
          const billingData = {
            job_id: selectedJob.id,
            billing_date: new Date(event.date).toISOString().split('T')[0],
            percentage_billed: event.percentage / 100,
            status: event.status,
            invoice_number: event.invoiceNumber,
            total_amount: event.totalAmount,
            retainer_amount: event.retainerAmount,
            amount_billed: event.amountBilled,
            remaining_due: remainingDue,
            notes: 'Bulk imported'
          };

          const { error: eventError } = await supabase
            .from('billing_events')
            .insert(billingData);

          if (eventError) {
            console.error('Error inserting billing event:', eventError);
          }
        }

        // Update job percent_billed
        await supabase
          .from('jobs')
          .update({ percent_billed: runningPercentage })
          .eq('id', selectedJob.id);

        // Add success notification
        alert(`Successfully imported ${parsedEvents.length} billing events!`);    
          
        setShowBulkPaste(false);
        setBulkBillingText('');
      } else {
        // Handle single event
        const percentageDecimal = parseFloat(billingForm.percentageBilled) / 100;
        const totalAmount = Math.round(contract.contract_amount * percentageDecimal);
        const retainerAmount = Math.round(totalAmount * contract.retainer_percentage);
        
        let amountBilled;
        if (billingForm.manualOverride && billingForm.overrideAmount) {
          // Use manual override amount
          amountBilled = parseFloat(billingForm.overrideAmount);
        } else {
          // Use calculated amount
          amountBilled = totalAmount - retainerAmount;
        }
        
        // Calculate remaining due
        const existingEvents = selectedJob.billing_events || [];
        const previousBilled = existingEvents.reduce((sum, event) => sum + parseFloat(event.amount_billed || 0), 0);
        const remainingDue = contract.contract_amount - previousBilled - amountBilled;

        const billingData = {
          job_id: selectedJob.id,
          billing_date: billingForm.billingDate,
          percentage_billed: percentageDecimal,
          status: billingForm.status || 'O',
          invoice_number: billingForm.invoiceNumber,
          total_amount: totalAmount,
          retainer_amount: retainerAmount,
          amount_billed: amountBilled,
          remaining_due: remainingDue,
          notes: billingForm.notes
        };

        const { error } = await supabase
          .from('billing_events')
          .insert(billingData);

        if (error) throw error;
       
        // Update legacy jobs if this is a legacy job
        if (selectedJob.job_type === 'legacy_billing') {
          setLegacyJobs(prevJobs => 
            prevJobs.map(job => {
              if (job.id === selectedJob.id) {
                const newEvent = {
                  id: Date.now(),
                  job_id: selectedJob.id,
                  billing_date: billingForm.billingDate,
                  percentage_billed: percentageDecimal,
                  status: billingForm.status || 'O',
                  invoice_number: billingForm.invoiceNumber,
                  total_amount: totalAmount,
                  retainer_amount: retainerAmount,
                  amount_billed: amountBilled,
                  remaining_due: remainingDue,
                  notes: billingForm.notes,
                  billing_type: billingForm.billingType
                };
                
                return {
                  ...job,
                  billing_events: [...(job.billing_events || []), newEvent],
                  percent_billed: (job.percent_billed || 0) + percentageDecimal
                };
              }
              return job;
            })
          );
        }
        
        // Update active jobs
        setJobs(prevJobs => 
          prevJobs.map(job => {
            if (job.id === selectedJob.id) {
              // Add the new event to this job
              const newEvent = {
                id: Date.now(), // Temporary ID
                job_id: selectedJob.id,
                billing_date: billingForm.billingDate,
                percentage_billed: percentageDecimal,
                status: billingForm.status || 'O',
                invoice_number: billingForm.invoiceNumber,
                total_amount: totalAmount,
                retainer_amount: retainerAmount,
                amount_billed: amountBilled,
                remaining_due: remainingDue,
                notes: billingForm.notes,
                billing_type: billingForm.billingType
              };
              
              return {
                ...job,
                billing_events: [...(job.billing_events || []), newEvent],
                percent_billed: (job.percent_billed || 0) + percentageDecimal
              };
            }
            return job;
          })
        );
        calculateGlobalMetrics();
      }
      
      setShowBillingForm(false);
      setBillingForm({
        billingDate: new Date().toISOString().split('T')[0],
        percentageBilled: '',
        status: 'P',
        invoiceNumber: '',
        notes: '',
        manualOverride: false,
        overrideAmount: '',
        billingType: ''
      });
      await loadJobs()
      calculateGlobalMetrics();
    } catch (error) {
      console.error('Error adding billing event:', error);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount || 0);
  };

  const handleUpdateBillingEvent = async () => {
    if (!editingEvent) return;
    
    try {
      // Prepare update data
      const updateData = {
        status: editingEvent.status || '',
        amount_billed: parseFloat(editingEvent.amount_billed),
        billing_type: editingEvent.billing_type || null
      };

      // First update the billing event
      const { error: updateError } = await supabase
        .from('billing_events')
        .update(updateData)
        .eq('id', editingEvent.id);

      if (updateError) throw updateError;

      // Get all billing events for this job ordered by date
      const { data: jobData } = await supabase
        .from('jobs')
        .select(`
          id,
          job_contracts(contract_amount),
          billing_events(
            id, 
            amount_billed,
            billing_date
          )
        `)
        .eq('id', editingEvent.job_id)
        .single();

      if (jobData && jobData.job_contracts?.[0]) {
        const contractAmount = jobData.job_contracts[0].contract_amount;
        
        // Sort events by billing date
        const sortedEvents = jobData.billing_events.sort((a, b) => 
          new Date(a.billing_date) - new Date(b.billing_date)
        );
        
        let runningTotal = 0;

        // Update remaining_due for each event in chronological order
        for (const event of sortedEvents) {
          runningTotal += parseFloat(event.amount_billed || 0);
          const remainingDue = contractAmount - runningTotal;
          
          const { error } = await supabase
            .from('billing_events')
            .update({ remaining_due: remainingDue })
            .eq('id', event.id);
            
          if (error) {
            console.error('Error updating remaining_due for event:', event.id, error);
          }
        }
      }

      setShowEditBilling(false);
      setEditingEvent(null);
      loadJobs();
      calculateGlobalMetrics();
    } catch (error) {
      console.error('Error updating billing event:', error);
      alert('Error updating billing event: ' + error.message);
    }
  };

  const handleUpdatePlannedContract = async (planningJobId, contractAmount) => {
    try {
      const { error } = await supabase
        .from('planning_jobs')
        .update({ contract_amount: parseFloat(contractAmount) })
        .eq('id', planningJobId);

      if (error) throw error;
      loadJobs();
      calculateGlobalMetrics();  // ADD THIS LINE
    } catch (error) {
      console.error('Error updating planned contract:', error);
    }
  };

  const handleRolloverToActive = async (planningJob) => {
    if (!window.confirm(`Roll over "${planningJob.job_name}" to active jobs? This will create a new active job with billing setup.`)) {
      return;
    }

    try {
      // Create new active job
      const { data: newJob, error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_name: planningJob.job_name || planningJob.municipality,
          vendor: planningJob.vendor,
          job_type: 'standard',
          billing_setup_complete: true,
          percent_billed: 0,
          total_properties: planningJob.total_properties || 0,
          totalresidential: planningJob.residential_properties || 0,
          totalcommercial: planningJob.commercial_properties || 0
        })
        .select()
        .single();

      if (jobError) throw jobError;

      // Create contract with standard percentages
      if (planningJob.contract_amount) {
        const contractData = {
          job_id: newJob.id,
          contract_amount: planningJob.contract_amount,
          retainer_percentage: 0.10,
          retainer_amount: planningJob.contract_amount * 0.10,
          end_of_job_percentage: 0.05,
          end_of_job_amount: planningJob.contract_amount * 0.05,
          first_year_appeals_percentage: 0.03,
          first_year_appeals_amount: planningJob.contract_amount * 0.03,
          second_year_appeals_percentage: 0.02,
          second_year_appeals_amount: planningJob.contract_amount * 0.02,
          third_year_appeals_percentage: 0.00,
          third_year_appeals_amount: 0
        };

        await supabase.from('job_contracts').insert(contractData);
      }

      // Archive the planning job
      await supabase
        .from('planning_jobs')
        .update({ is_archived: true })
        .eq('id', planningJob.id);

      alert(`Successfully rolled over "${planningJob.job_name || planningJob.municipality}" to active jobs!`);
      setActiveTab('active');
      loadJobs();
    } catch (error) {
      console.error('Error rolling over planning job:', error);
      alert('Error rolling over job: ' + error.message);
    }
  };

  const handleDeleteBillingEvent = async () => {
    if (!editingEvent) return;
    
    if (!window.confirm('Are you sure you want to delete this billing event? This cannot be undone.')) {
      return;
    }
    
    try {
      // Get the job to recalculate percent_billed after deletion
      const { data: billingEvent } = await supabase
        .from('billing_events')
        .select('job_id, percentage_billed')
        .eq('id', editingEvent.id)
        .single();

      // Delete the billing event
      const { error: deleteError } = await supabase
        .from('billing_events')
        .delete()
        .eq('id', editingEvent.id);

      if (deleteError) throw deleteError;

      // Recalculate the job's percent_billed
      const { data: remainingEvents } = await supabase
        .from('billing_events')
        .select('percentage_billed')
        .eq('job_id', billingEvent.job_id);

      const newTotalPercentage = remainingEvents.reduce((sum, event) => sum + parseFloat(event.percentage_billed || 0), 0);
      
      await supabase
        .from('jobs')
        .update({ percent_billed: newTotalPercentage })
        .eq('id', billingEvent.job_id);

      // Give database time to commit
      await new Promise(resolve => setTimeout(resolve, 500));

      // Update the job in state without reloading
      setShowEditBilling(false);      
      setShowEditBilling(false);
      setEditingEvent(null);
      loadJobs();
      calculateGlobalMetrics();
    } catch (error) {
      console.error('Error deleting billing event:', error);
    }
  };

  const handleCreateLegacyJob = async () => {
    if (!legacyJobForm.jobName || !legacyJobForm.contractAmount) return;
    
    try {
      // Create the legacy job
      const { data: newJob, error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_name: legacyJobForm.jobName,
          client_name: legacyJobForm.jobName,  // Use job name as client name for legacy
          start_date: new Date().toISOString().split('T')[0],  // Today's date
          end_date: new Date().toISOString().split('T')[0],    // Today's date
          job_type: 'legacy_billing',
          billing_setup_complete: true,
          percent_billed: 0,
          created_by: '5df85ca3-7a54-4798-a665-c31da8d9caad'  // Your ID
        })
        .select()
        .single();

      if (jobError) throw jobError;

      // Create the contract with specified percentages
      const contractData = {
        job_id: newJob.id,
        contract_amount: parseFloat(legacyJobForm.contractAmount),
        retainer_percentage: legacyJobForm.retainerPercentage,
        retainer_amount: parseFloat(legacyJobForm.contractAmount) * legacyJobForm.retainerPercentage,
        end_of_job_percentage: legacyJobForm.endOfJobPercentage,
        end_of_job_amount: parseFloat(legacyJobForm.contractAmount) * legacyJobForm.endOfJobPercentage,
        first_year_appeals_percentage: legacyJobForm.firstYearAppealsPercentage,
        first_year_appeals_amount: parseFloat(legacyJobForm.contractAmount) * legacyJobForm.firstYearAppealsPercentage,
        second_year_appeals_percentage: legacyJobForm.secondYearAppealsPercentage,
        second_year_appeals_amount: parseFloat(legacyJobForm.contractAmount) * legacyJobForm.secondYearAppealsPercentage,
        third_year_appeals_percentage: legacyJobForm.thirdYearAppealsPercentage,
        third_year_appeals_amount: parseFloat(legacyJobForm.contractAmount) * legacyJobForm.thirdYearAppealsPercentage
      };

      const { error: contractError } = await supabase
        .from('job_contracts')
        .insert(contractData);

      if (contractError) throw contractError;

      // If billing history provided, bulk import
      if (legacyJobForm.billingHistory.trim()) {
        const parsedEvents = parseBillingHistory(legacyJobForm.billingHistory);
        let runningTotal = 0;
        let runningPercentage = 0;
        
        for (const event of parsedEvents) {
          runningTotal += event.amountBilled;
          runningPercentage += event.percentage / 100;
          const remainingDue = parseFloat(legacyJobForm.contractAmount) - runningTotal;
          
          const billingData = {
            job_id: newJob.id,
            billing_date: new Date(event.date).toISOString().split('T')[0],
            percentage_billed: event.percentage / 100,
            status: event.status,
            invoice_number: event.invoiceNumber,
            total_amount: event.totalAmount,
            retainer_amount: event.retainerAmount,
            amount_billed: event.amountBilled,
            remaining_due: remainingDue,
            notes: 'Imported legacy billing'
          };

          await supabase.from('billing_events').insert(billingData);
        }

        // Update job percent_billed
        await supabase
          .from('jobs')
          .update({ percent_billed: runningPercentage })
          .eq('id', newJob.id);
      }

      setShowLegacyJobForm(false);
      setLegacyJobForm({
        jobName: '',
        contractAmount: '',
        billingHistory: '',
        templateType: 'standard',
        retainerPercentage: 0.10,
        endOfJobPercentage: 0.05,
        firstYearAppealsPercentage: 0.03,
        secondYearAppealsPercentage: 0.02,
        thirdYearAppealsPercentage: 0.00
      });
      setActiveTab('legacy');
      loadJobs();
    } catch (error) {
      console.error('Error creating legacy job:', error);
    }
  };

  const handleExpenseImport = async () => {
    if (!expenseFile) return;
    
    try {
      // Read the file
      const arrayBuffer = await expenseFile.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      
      // Parse with SheetJS
      const workbook = XLSX.read(data, { type: 'array' });
      
      // Get first sheet only
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Convert to JSON
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      // Find the header row (contains month names)
      let headerRowIndex = -1;
      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (row.includes('January') || row.includes('JAN') || row.includes('Jan')) {
          headerRowIndex = i;
          break;
        }
      }
      
      if (headerRowIndex === -1) {
        alert('Could not find month headers in the file');
        return;
      }
      
      // Get month column indices (skip % columns)
      const monthColumns = {};
      const headerRow = jsonData[headerRowIndex];
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                     'July', 'August', 'September', 'October', 'November', 'December'];
      
      months.forEach((month, index) => {
        for (let col = 0; col < headerRow.length; col++) {
          if (headerRow[col] && headerRow[col].toString().toLowerCase().includes(month.toLowerCase().substring(0, 3))) {
            monthColumns[index + 1] = col; // Store month number (1-12) -> column index
            break;
          }
        }
      });
      
      // Process expense rows
      const currentYear = new Date().getFullYear();
      const expenseData = [];
      
      // Start from row after header, stop at SUB TOTAL or empty rows
      for (let rowIndex = headerRowIndex + 1; rowIndex < jsonData.length; rowIndex++) {
        const row = jsonData[rowIndex];
        const category = row[0]; // First column is category
        
        // Skip if no category or if it's a total row
        if (!category || 
            category.toString().toUpperCase().includes('TOTAL') ||
            category.toString().toUpperCase().includes('FRINGE')) {
          continue;
        }
        
        // Extract amounts for each month
        for (const [monthNum, colIndex] of Object.entries(monthColumns)) {
          const amount = row[colIndex];
          if (amount && !isNaN(parseFloat(amount))) {
            expenseData.push({
              category: category.toString().trim(),
              month: parseInt(monthNum),
              year: currentYear,
              amount: parseFloat(amount)
            });
          }
        }
      }
      
      // Clear existing expenses for the year
      await supabase
        .from('expenses')
        .delete()
        .eq('year', currentYear);
      
      // Insert new expenses
      if (expenseData.length > 0) {
        const { error } = await supabase
          .from('expenses')
          .insert(expenseData);
        
        if (error) throw error;
        
        alert(`Successfully imported ${expenseData.length} expense entries`);
        setShowExpenseImport(false);
        setExpenseFile(null);
        loadExpenses(); // Reload the expenses
        calculateGlobalMetrics(); // Update metrics
      } else {
        alert('No expense data found in the file');
      }
      
    } catch (error) {
      console.error('Error importing expenses:', error);
      alert('Error importing file: ' + error.message);
    }
  };  
  
  const getJobStatusColor = (job) => {
    const totals = calculateBillingTotals(job);
    if (!totals) return 'bg-gray-100';
    
    if (totals.isComplete) return 'bg-green-100 border-green-400';
    if (totals.totalPercentageBilled >= 75) return 'bg-yellow-100 border-yellow-400';
    if (totals.totalPercentageBilled >= 50) return 'bg-blue-100 border-blue-400';
    return 'bg-red-100 border-red-400';
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Billing Management</h1>
        <p className="text-gray-600">Track contracts, billing events, and payment status</p>
      </div>

      {/* Global Metrics Dashboard */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Business Overview</h2>
        
        {/* Row 1: Contract & Revenue Status */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Total Signed Contracts</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(globalMetrics.totalSigned)}</p>
            <p className="text-xs text-gray-500 mt-1">All contracts</p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Total Amount Paid</p>
            <p className="text-2xl font-bold text-green-600">{formatCurrency(globalMetrics.totalPaid)}</p>
            <p className="text-xs text-gray-500 mt-1">Collected revenue</p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm border-2 border-green-400">
            <p className="text-sm text-gray-600 mb-1">Collection Rate</p>
            <p className="text-2xl font-bold text-green-600">
              {globalMetrics.totalSigned > 0 ? ((globalMetrics.totalPaid / globalMetrics.totalSigned) * 100).toFixed(1) : '0.0'}%
            </p>
            <p className="text-xs text-green-600 mt-1">Payment efficiency</p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Total Amount Open</p>
            <p className="text-2xl font-bold text-orange-600">{formatCurrency(globalMetrics.totalOpen)}</p>
            <p className="text-xs text-gray-500 mt-1">Outstanding invoices</p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Total Remaining</p>
            <p className="text-2xl font-bold text-gray-700">{formatCurrency(globalMetrics.totalRemaining)}</p>
            <p className="text-xs text-gray-500 mt-1">To be billed</p>
          </div>
        </div>
        
        {/* Row 2: Cash Flow Analysis */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-white rounded-lg p-4 shadow-sm border-2 border-blue-400">
            <p className="text-sm text-gray-600 mb-1">Remaining (No Retainer)</p>
            <p className="text-2xl font-bold text-blue-600">{formatCurrency(globalMetrics.totalRemainingExcludingRetainer)}</p>
            <p className="text-xs text-blue-600 mt-1">Actual work remaining</p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Retainer Held</p>
            <p className="text-2xl font-bold text-purple-600">
              {formatCurrency(globalMetrics.totalRemaining - globalMetrics.totalRemainingExcludingRetainer)}
            </p>
            <p className="text-xs text-gray-500 mt-1">Future collections</p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Unbilled Work</p>
            <p className="text-2xl font-bold text-indigo-600">
              {formatCurrency(globalMetrics.totalRemaining - globalMetrics.totalOpen)}
            </p>
            <p className="text-xs text-gray-500 mt-1">Not yet invoiced</p>
          </div>
        </div>
        
        {/* Row 3: Expenses & Profitability */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Daily Expense Rate</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(globalMetrics.dailyFringe)}</p>
            <p className="text-xs text-gray-500 mt-1">Avg daily cost</p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Current Expenses</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(globalMetrics.currentExpenses)}</p>
            <p className="text-xs text-gray-500 mt-1">Year to date</p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Projected Expenses</p>
            <p className="text-2xl font-bold text-red-700">{formatCurrency(globalMetrics.projectedExpenses)}</p>
            <p className="text-xs text-gray-500 mt-1">Full year estimate</p>
          </div>
          <div className={`bg-white rounded-lg p-4 shadow-sm border-2 ${(globalMetrics.totalPaid - globalMetrics.currentExpenses) >= 0 ? 'border-green-400' : 'border-red-400'}`}>
            <p className="text-sm text-gray-600 mb-1">Actual P/L</p>
            <p className={`text-2xl font-bold ${(globalMetrics.totalPaid - globalMetrics.currentExpenses) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(globalMetrics.totalPaid - globalMetrics.currentExpenses)}
            </p>
            <p className="text-xs text-gray-500">
              Margin: {globalMetrics.totalPaid > 0 ? (((globalMetrics.totalPaid - globalMetrics.currentExpenses) / globalMetrics.totalPaid) * 100).toFixed(1) : '0.0'}%
            </p>
          </div>
          <div className={`bg-white rounded-lg p-4 shadow-sm border-2 ${(globalMetrics.totalSigned - globalMetrics.projectedExpenses) >= 0 ? 'border-green-400' : 'border-red-400'}`}>
            <p className="text-sm text-gray-600 mb-1">Projected P/L</p>
            <p className={`text-2xl font-bold ${(globalMetrics.totalSigned - globalMetrics.projectedExpenses) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(globalMetrics.totalSigned - globalMetrics.projectedExpenses)}
            </p>
            <p className="text-xs text-gray-500">
              Margin: {globalMetrics.totalSigned > 0 ? (((globalMetrics.totalSigned - globalMetrics.projectedExpenses) / globalMetrics.totalSigned) * 100).toFixed(1) : '0.0'}%
            </p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('active')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'active'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Active Jobs ({jobs.filter(j => j.job_type === 'standard').length})
          </button>
          <button
            onClick={() => setActiveTab('planned')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'planned'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Planned Jobs ({planningJobs.filter(job => !job.is_archived).length})
          </button>
          <button
            onClick={() => setActiveTab('legacy')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'legacy'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Legacy Jobs ({legacyJobs.length})
          </button>
          <button
            onClick={() => setActiveTab('expenses')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'expenses'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Expenses
          </button>
          <button
            onClick={() => setActiveTab('receivables')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'receivables'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Office Receivables
          </button>
          <button
            onClick={() => setActiveTab('distributions')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'distributions'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Shareholder Distributions
          </button>
        </nav>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading billing data...</p>
        </div>
      ) : (
        <>
          {/* Active Jobs Tab */}
          {activeTab === 'active' && (
            <div className="space-y-6">
              {jobs.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                  <p className="text-gray-600">No active jobs found.</p>
                </div>
              ) : (
                jobs
                  .sort((a, b) => {
                    // Calculate percent billed for sorting
                    const aPercent = a.percent_billed || 0;
                    const bPercent = b.percent_billed || 0;
                    return aPercent - bPercent; // Lowest percent first
                  })
                  .map(job => {
                  const totals = calculateBillingTotals(job);
                  const needsContractSetup = !job.job_contracts || job.job_contracts.length === 0;
                  
                  return (
                    <div key={job.id} className={`border-2 rounded-lg p-6 ${getJobStatusColor(job)}`}>
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center space-x-3">
                          <h3 className="text-xl font-semibold text-gray-900">{job.job_name}</h3>
                          <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                            {job.vendor || 'No Vendor'}
                          </span>
                          {needsContractSetup && (
                            <span className="flex items-center px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">
                              ⚠️ Contract Setup Required
                            </span>
                          )}
                          {totals?.isComplete && (
                            <span className="flex items-center px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                              ✅ 100% Billed
                            </span>
                          )}
                        </div>
                        <div className="flex space-x-2">
                          {needsContractSetup ? (
                            <button
                              onClick={() => {
                                setSelectedJob(job);
                                setShowContractSetup(true);
                              }}
                              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                            >
                              Setup Contract
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setSelectedJob(job);
                                  setShowBillingForm(true);
                                }}
                                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                              >
                                Add Billing Event
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedJob(job);
                                  // Pre-fill contract form with existing values
                                  const contract = job.job_contracts[0];
                                  setContractSetup({
                                    contractAmount: contract.contract_amount.toString(),
                                    templateType: 'custom',
                                    retainerPercentage: contract.retainer_percentage,
                                    endOfJobPercentage: contract.end_of_job_percentage,
                                    firstYearAppealsPercentage: contract.first_year_appeals_percentage,
                                    secondYearAppealsPercentage: contract.second_year_appeals_percentage,
                                    thirdYearAppealsPercentage: contract.third_year_appeals_percentage || 0
                                  });
                                  setShowContractSetup(true);
                                }}
                                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                              >
                                Edit Contract
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {totals && (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                          <div className="bg-white p-3 rounded-md">
                            <p className="text-sm text-gray-600">Contract Amount</p>
                            <p className="text-lg font-semibold">{formatCurrency(totals.contractAmount)}</p>
                          </div>
                          <div className="bg-white p-3 rounded-md">
                            <p className="text-sm text-gray-600">Percentage Billed</p>
                            <p className="text-lg font-semibold">{totals.totalPercentageBilled.toFixed(2)}%</p>
                          </div>
                          <div className="bg-white p-3 rounded-md">
                            <p className="text-sm text-gray-600">Amount Billed</p>
                            <p className="text-lg font-semibold">{formatCurrency(totals.totalAmountBilled)}</p>
                          </div>
                          <div className="bg-white p-3 rounded-md">
                            <p className="text-sm text-gray-600">Remaining Due</p>
                            <p className="text-lg font-semibold">{formatCurrency(totals.remainingDue)}</p>
                          </div>
                          <div className="bg-white p-3 rounded-md border-2 border-blue-400">
                            <p className="text-sm text-gray-600">Remaining (No Retainer)</p>
                            <p className="text-lg font-semibold text-blue-600">
                              {(() => {
                                const remainingNoRet = (totals.contractAmount - job.job_contracts[0].retainer_amount) - totals.totalAmountBilled;
                                return formatCurrency(remainingNoRet < 0 ? 0 : remainingNoRet);
                              })()}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Contract Breakdown */}
                      {job.job_contracts?.[0] && (
                        <div className="bg-white p-4 rounded-md border border-gray-200 mb-4">
                          <p className="text-sm font-medium text-gray-700 mb-3">CONTRACT BREAKDOWN</p>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                            <div>
                              <p className="text-gray-600">Total Contract</p>
                              <p className="font-semibold">{formatCurrency(job.job_contracts[0].contract_amount)}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">Retainer ({(job.job_contracts[0].retainer_percentage * 100).toFixed(0)}%)</p>
                              <p className="font-semibold">{formatCurrency(job.job_contracts[0].retainer_amount)}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">End of Job ({(job.job_contracts[0].end_of_job_percentage * 100).toFixed(0)}%)</p>
                              <p className="font-semibold">{formatCurrency(job.job_contracts[0].end_of_job_amount)}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">1st Yr Appeals ({(job.job_contracts[0].first_year_appeals_percentage * 100).toFixed(0)}%)</p>
                              <p className="font-semibold">{formatCurrency(job.job_contracts[0].first_year_appeals_amount)}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">2nd Yr Appeals ({(job.job_contracts[0].second_year_appeals_percentage * 100).toFixed(0)}%)</p>
                              <p className="font-semibold">{formatCurrency(job.job_contracts[0].second_year_appeals_amount)}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">3rd Yr Appeals ({(job.job_contracts[0].third_year_appeals_percentage * 100).toFixed(0)}%)</p>
                              <p className="font-semibold">{formatCurrency(job.job_contracts[0].third_year_appeals_amount || 0)}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Billing Events Table */}
                      {job.billing_events && job.billing_events.length > 0 && (
                        <div className="bg-white rounded-md overflow-hidden">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">%</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Billed</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Remaining</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Remaining (No Ret)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {job.billing_events
                                .sort((a, b) => new Date(a.billing_date) - new Date(b.billing_date))
                                .map((event, index) => {
                                  // Simple calculation: (Contract - Total Retainer) - Amount Billed So Far
                                  const contractMinusRetainer = job.job_contracts[0].contract_amount - job.job_contracts[0].retainer_amount;
                                  const amountBilledSoFar = job.job_contracts[0].contract_amount - event.remaining_due;
                                  const remainingNoRetainer = contractMinusRetainer - amountBilledSoFar;
                                  
                                  return (
                                    <tr 
                                      key={event.id}
                                      className="hover:bg-gray-50 cursor-pointer"
                                      onClick={() => {
                                        setEditingEvent(event);
                                        setShowEditBilling(true);
                                      }}
                                    >
                                      <td className="px-4 py-2 text-sm text-gray-900">
                                        {new Date(event.billing_date).toLocaleDateString()}
                                      </td>
                                      <td className="px-4 py-2 text-sm text-gray-900">
                                        {event.billing_type ? (
                                          <span className="font-medium text-purple-700">
                                            {event.billing_type === 'turnover' ? 'Turnover' :
                                             event.billing_type === '1st_appeals' ? '1st Yr Appeals' :
                                             event.billing_type === '2nd_appeals' ? '2nd Yr Appeals' :
                                             event.billing_type === '3rd_appeals' ? '3rd Yr Appeals' :
                                             event.billing_type === 'retainer' ? 'Retainer Payout' :
                                             event.billing_type}
                                          </span>
                                        ) : (
                                          (event.percentage_billed * 100).toFixed(2) + '%'
                                        )}
                                      </td>
                                      <td className="px-4 py-2 text-sm">
                                        <span className={`px-2 py-1 text-xs rounded-full ${
                                          event.status === 'P' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                                        }`}>
                                          {event.status === 'P' ? 'Paid' : 'Open'}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2 text-sm text-gray-900">{event.invoice_number}</td>
                                      <td className="px-4 py-2 text-sm text-gray-900">{formatCurrency(event.total_amount)}</td>
                                      <td className="px-4 py-2 text-sm text-gray-900">{formatCurrency(event.amount_billed)}</td>
                                      <td className="px-4 py-2 text-sm text-gray-900">{formatCurrency(event.remaining_due)}</td>
                                      <td className="px-4 py-2 text-sm font-semibold text-blue-600">
                                        {formatCurrency(Math.max(0, remainingNoRetainer))}
                                      </td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

      {/* Planned Jobs Tab */}
      {activeTab === 'planned' && (
        <div className="space-y-6">
          {planningJobs.filter(job => !job.is_archived).length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <p className="text-gray-600">No planned jobs found. Create them in the Admin Jobs section.</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Municipality
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      CCDD
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contract Amount
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Target Date
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {planningJobs
                    .filter(job => !job.is_archived)
                    .sort((a, b) => {
                      // First priority: Jobs without contract amounts go to top
                      if (!a.contract_amount && b.contract_amount) return -1;
                      if (a.contract_amount && !b.contract_amount) return 1;
                      
                      // Second priority: Sort by end_date (target date) - earliest first
                      if (!a.end_date && !b.end_date) return 0;
                      if (!a.end_date) return 1;
                      if (!b.end_date) return -1;
                      return new Date(a.end_date) - new Date(b.end_date);
                    })
                    .map(job => (
                      <tr key={job.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {job.municipality || job.job_name || 'Unnamed Job'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <span className="px-2 py-1 text-xs rounded-full bg-gray-200 text-gray-700">
                            {job.ccdd_code || '-'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div className="flex items-center space-x-2">
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 pointer-events-none">$</span>
                              <input
                                type="text"
                                value={job.contract_amount ? Number(job.contract_amount).toLocaleString() : ''}
                                onChange={(e) => {
                                  // Remove commas and non-numeric characters
                                  const numericValue = e.target.value.replace(/[^0-9]/g, '');
                                  setPlanningJobs(prev => 
                                    prev.map(j => j.id === job.id ? {...j, contract_amount: numericValue} : j)
                                  );
                                }}
                                onKeyPress={(e) => {
                                  if (e.key === 'Enter') {
                                    handleUpdatePlannedContract(job.id, job.contract_amount);
                                  }
                                }}
                                onBlur={() => handleUpdatePlannedContract(job.id, job.contract_amount)}
                                className="pl-8 pr-3 py-1 w-32 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500"
                                placeholder="0"
                              />
                            </div>
                            {!job.contract_amount && (
                              <span className="text-red-600 font-semibold text-xs">NEED AMT</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {job.end_date ? new Date(job.end_date).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => handleRolloverToActive(job)}
                            className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={!job.contract_amount}
                            title={!job.contract_amount ? "Set contract amount first" : "Roll over to active jobs"}
                          >
                            Roll to Active →
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

          {/* Legacy Jobs Tab */}
          {activeTab === 'legacy' && (
            <div className="space-y-6">
              <div className="flex justify-end mb-4">
                <button
                  onClick={() => setShowLegacyJobForm(true)}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  + Add Legacy Job
                </button>
              </div>

              {legacyJobs.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                  <p className="text-gray-600">No legacy billing jobs found. Click "Add Legacy Job" to create one.</p>
                </div>
              ) : (
                legacyJobs.map(job => {
                  const totals = calculateBillingTotals(job);
                  const needsContractSetup = !job.job_contracts || job.job_contracts.length === 0;
                  
                  return (
                    <div key={job.id} className={`border-2 rounded-lg p-6 ${getJobStatusColor(job)}`}>
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center space-x-3">
                          <h3 className="text-xl font-semibold text-gray-900">{job.job_name}</h3>
                          <span className="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-800">
                            Legacy Billing
                          </span>
                          {totals?.isComplete && (
                            <span className="flex items-center px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                              ✅ 100% Billed
                            </span>
                          )}
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => {
                              setSelectedJob(job);
                              setShowBillingForm(true);
                            }}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                          >
                            Add Billing Event
                          </button>
                          <button
                            onClick={() => {
                              setSelectedJob(job);
                              const contract = job.job_contracts[0];
                              setContractSetup({
                                contractAmount: contract.contract_amount.toString(),
                                templateType: 'custom',
                                retainerPercentage: contract.retainer_percentage,
                                endOfJobPercentage: contract.end_of_job_percentage,
                                firstYearAppealsPercentage: contract.first_year_appeals_percentage,
                                secondYearAppealsPercentage: contract.second_year_appeals_percentage,
                                thirdYearAppealsPercentage: contract.third_year_appeals_percentage || 0
                              });
                              setShowContractSetup(true);
                            }}
                            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                          >
                            Edit Contract
                          </button>
                          <button
                            onClick={async () => {
                              if (window.confirm(`Are you sure you want to delete "${job.job_name}"? This will delete all billing events and cannot be undone.`)) {
                                try {
                                  const { error } = await supabase
                                    .from('jobs')
                                    .delete()
                                    .eq('id', job.id);
                                  
                                  if (error) throw error;
                                  
                                  alert('Legacy job deleted successfully');
                                  loadJobs();
                                  calculateGlobalMetrics();
                                } catch (error) {
                                  console.error('Error deleting legacy job:', error);
                                  alert('Error deleting job: ' + error.message);
                                }
                              }
                            }}
                            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      {totals && (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                          <div className="bg-white p-3 rounded-md">
                            <p className="text-sm text-gray-600">Contract Amount</p>
                            <p className="text-lg font-semibold">{formatCurrency(totals.contractAmount)}</p>
                          </div>
                          <div className="bg-white p-3 rounded-md">
                            <p className="text-sm text-gray-600">Percentage Billed</p>
                            <p className="text-lg font-semibold">{totals.totalPercentageBilled.toFixed(2)}%</p>
                          </div>
                          <div className="bg-white p-3 rounded-md">
                            <p className="text-sm text-gray-600">Amount Billed</p>
                            <p className="text-lg font-semibold">{formatCurrency(totals.totalAmountBilled)}</p>
                          </div>
                          <div className="bg-white p-3 rounded-md">
                            <p className="text-sm text-gray-600">Remaining Due</p>
                            <p className="text-lg font-semibold">{formatCurrency(totals.remainingDue)}</p>
                          </div>
                          <div className="bg-white p-3 rounded-md border-2 border-blue-400">
                            <p className="text-sm text-gray-600">Remaining (No Retainer)</p>
                            <p className="text-lg font-semibold text-blue-600">
                              {(() => {
                                const remainingNoRet = (totals.contractAmount - job.job_contracts[0].retainer_amount) - totals.totalAmountBilled;
                                return formatCurrency(remainingNoRet < 0 ? 0 : remainingNoRet);
                              })()}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Contract Breakdown */}
                      {job.job_contracts?.[0] && (
                        <div className="bg-white p-4 rounded-md border border-gray-200 mb-4">
                          <p className="text-sm font-medium text-gray-700 mb-3">CONTRACT BREAKDOWN</p>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                            <div>
                              <p className="text-gray-600">Total Contract</p>
                              <p className="font-semibold">{formatCurrency(job.job_contracts[0].contract_amount)}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">Retainer ({(job.job_contracts[0].retainer_percentage * 100).toFixed(0)}%)</p>
                              <p className="font-semibold">{formatCurrency(job.job_contracts[0].retainer_amount)}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">End of Job ({(job.job_contracts[0].end_of_job_percentage * 100).toFixed(0)}%)</p>
                              <p className="font-semibold">{formatCurrency(job.job_contracts[0].end_of_job_amount)}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">1st Yr Appeals ({(job.job_contracts[0].first_year_appeals_percentage * 100).toFixed(0)}%)</p>
                              <p className="font-semibold">{formatCurrency(job.job_contracts[0].first_year_appeals_amount)}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">2nd Yr Appeals ({(job.job_contracts[0].second_year_appeals_percentage * 100).toFixed(0)}%)</p>
                              <p className="font-semibold">{formatCurrency(job.job_contracts[0].second_year_appeals_amount)}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">3rd Yr Appeals ({(job.job_contracts[0].third_year_appeals_percentage * 100).toFixed(0)}%)</p>
                              <p className="font-semibold">{formatCurrency(job.job_contracts[0].third_year_appeals_amount || 0)}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Billing Events Table */}
                      {job.billing_events && job.billing_events.length > 0 && (
                        <div className="bg-white rounded-md overflow-hidden">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">%</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Billed</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Remaining</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Remaining (No Ret)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {job.billing_events
                                .sort((a, b) => new Date(a.billing_date) - new Date(b.billing_date))
                                .map((event, index) => {
                                  // Simple calculation: (Contract - Total Retainer) - Amount Billed So Far
                                  const contractMinusRetainer = job.job_contracts[0].contract_amount - job.job_contracts[0].retainer_amount;
                                  const amountBilledSoFar = job.job_contracts[0].contract_amount - event.remaining_due;
                                  const remainingNoRetainer = contractMinusRetainer - amountBilledSoFar;
                                  
                                  return (
                                    <tr 
                                      key={event.id}
                                      className="hover:bg-gray-50 cursor-pointer"
                                      onClick={() => {
                                        setEditingEvent(event);
                                        setShowEditBilling(true);
                                      }}
                                    >
                                      <td className="px-4 py-2 text-sm text-gray-900">
                                        {new Date(event.billing_date).toLocaleDateString()}
                                      </td>
                                      <td className="px-4 py-2 text-sm text-gray-900">
                                        {event.billing_type ? (
                                          <span className="font-medium text-purple-700">
                                            {event.billing_type === 'turnover' ? 'Turnover' :
                                             event.billing_type === '1st_appeals' ? '1st Yr Appeals' :
                                             event.billing_type === '2nd_appeals' ? '2nd Yr Appeals' :
                                             event.billing_type === '3rd_appeals' ? '3rd Yr Appeals' :
                                             event.billing_type === 'retainer' ? 'Retainer Payout' :
                                             event.billing_type}
                                          </span>
                                        ) : (
                                          `${(event.percentage_billed * 100).toFixed(2)}%`
                                        )}
                                      </td>
                                      <td className="px-4 py-2 text-sm">
                                        <span className={`px-2 py-1 text-xs rounded-full ${
                                          event.status === 'P' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                                        }`}>
                                          {event.status === 'P' ? 'Paid' : 'Open'}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2 text-sm text-gray-900">{event.invoice_number}</td>
                                      <td className="px-4 py-2 text-sm text-gray-900">{formatCurrency(event.total_amount)}</td>
                                      <td className="px-4 py-2 text-sm text-gray-900">{formatCurrency(event.amount_billed)}</td>
                                      <td className="px-4 py-2 text-sm text-gray-900">{formatCurrency(event.remaining_due)}</td>
                                      <td className="px-4 py-2 text-sm font-semibold text-blue-600">
                                        {remainingNoRetainer < 0 ? formatCurrency(0) : formatCurrency(remainingNoRetainer)}
                                      </td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Expenses Tab */}
          {activeTab === 'expenses' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-semibold text-gray-900">Monthly Expenses - {new Date().getFullYear()}</h2>
                <button
                  onClick={() => setShowExpenseImport(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Import Excel
                </button>
              </div>

              {expenses.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                  <p className="text-gray-600 mb-4">No expense data found.</p>
                  <p className="text-sm text-gray-500">Click "Import Excel" to upload your expense file.</p>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50">
                            Category
                          </th>
                          {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, idx) => (
                            <th key={month} className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                              {month}
                            </th>
                          ))}
                          <th className="px-6 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-100">
                            Total
                          </th>
                        </tr>
                        <tr className="bg-blue-50">
                          <td className="px-6 py-2 text-xs font-medium text-blue-700 sticky left-0 bg-blue-50">
                            Working Days
                          </td>
                          {Object.values(workingDays2025).map((days, idx) => (
                            <td key={idx} className="px-6 py-2 text-center text-xs font-semibold text-blue-700">
                              {days}
                            </td>
                          ))}
                          <td className="px-6 py-2 text-center text-xs font-bold text-blue-700 bg-blue-100">
                            {Object.values(workingDays2025).reduce((sum, days) => sum + days, 0)}
                          </td>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {/* Group expenses by category */}
                        {(() => {
                          const expensesByCategory = {};
                          const categoryTotals = {};
                          
                          expenses.forEach(expense => {
                            if (!expensesByCategory[expense.category]) {
                              expensesByCategory[expense.category] = new Array(12).fill(0);
                              categoryTotals[expense.category] = 0;
                            }
                            expensesByCategory[expense.category][expense.month - 1] = expense.amount;
                            categoryTotals[expense.category] += parseFloat(expense.amount);
                          });
                          
                          return Object.entries(expensesByCategory).map(([category, monthlyAmounts]) => (
                            <tr key={category} className="hover:bg-gray-50">
                              <td className="px-6 py-4 text-sm font-medium text-gray-900 sticky left-0 bg-white">
                                {category}
                              </td>
                              {monthlyAmounts.map((amount, idx) => (
                                <td key={idx} className="px-6 py-4 text-sm text-right text-gray-900">
                                  {amount > 0 ? formatCurrency(amount) : '-'}
                                </td>
                              ))}
                              <td className="px-6 py-4 text-sm text-right font-semibold text-gray-900 bg-gray-50">
                                {formatCurrency(categoryTotals[category])}
                              </td>
                            </tr>
                          ));
                        })()}
                        
                        {/* Totals Row */}
                        <tr className="bg-gray-100 font-semibold">
                          <td className="px-6 py-4 text-sm text-gray-900 sticky left-0 bg-gray-100">
                            TOTAL
                          </td>
                          {(() => {
                            const monthlyTotals = new Array(12).fill(0);
                            expenses.forEach(expense => {
                              monthlyTotals[expense.month - 1] += parseFloat(expense.amount);
                            });
                            
                            return monthlyTotals.map((total, idx) => (
                              <td key={idx} className="px-6 py-4 text-sm text-right text-gray-900">
                                {total > 0 ? formatCurrency(total) : '-'}
                              </td>
                            ));
                          })()}
                          <td className="px-6 py-4 text-sm text-right text-gray-900 bg-gray-200">
                            {formatCurrency(expenses.reduce((sum, exp) => sum + parseFloat(exp.amount), 0))}
                          </td>
                        </tr>
                        
                        {/* Daily Average Row */}
                        <tr className="bg-yellow-50 font-medium">
                          <td className="px-6 py-4 text-sm text-yellow-800 sticky left-0 bg-yellow-50">
                            Daily Average
                          </td>
                          {(() => {
                            const monthlyTotals = new Array(12).fill(0);
                            expenses.forEach(expense => {
                              monthlyTotals[expense.month - 1] += parseFloat(expense.amount);
                            });
                            
                            return monthlyTotals.map((total, idx) => {
                              const dailyAvg = total / workingDays2025[idx + 1];
                              return (
                                <td key={idx} className="px-6 py-4 text-sm text-right text-yellow-800">
                                  {total > 0 ? formatCurrency(dailyAvg) : '-'}
                                </td>
                              );
                            });
                          })()}
                          <td className="px-6 py-4 text-sm text-right text-yellow-800 bg-yellow-100">
                            {formatCurrency(
                              expenses.reduce((sum, exp) => sum + parseFloat(exp.amount), 0) / 
                              Object.values(workingDays2025).reduce((sum, days) => sum + days, 0)
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

          {/* Office Receivables Tab */}
          {activeTab === 'receivables' && (
            <div className="space-y-6">
              <div className="text-center py-12 bg-gray-50 rounded-lg">
                <p className="text-gray-600 mb-4">Office Receivables tracking coming soon.</p>
                <p className="text-sm text-gray-500">This will track money owed to the office.</p>
              </div>
            </div>
          )}

          {/* Shareholder Distributions Tab */}
          {activeTab === 'distributions' && (
            <div className="space-y-6">
              <div className="text-center py-12 bg-gray-50 rounded-lg">
                <p className="text-gray-600 mb-4">Shareholder Distributions tracking coming soon.</p>
                <p className="text-sm text-gray-500">This will track distributions to shareholders.</p>
              </div>
            </div>
          )} 

      {/* Contract Setup Modal */}
      {showContractSetup && selectedJob && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">
              {selectedJob.job_contracts && selectedJob.job_contracts.length > 0 ? 'Edit' : 'Setup'} Contract: {selectedJob.job_name}
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contract Amount
                </label>
                <input
                  type="number"
                  value={contractSetup.contractAmount}
                  onChange={(e) => setContractSetup(prev => ({ ...prev, contractAmount: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="500000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Contract Template
                </label>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="standard"
                      checked={contractSetup.templateType === 'standard'}
                      onChange={(e) => {
                        setContractSetup(prev => ({
                          ...prev,
                          templateType: e.target.value,
                          retainerPercentage: 0.10,
                          endOfJobPercentage: 0.05,
                          firstYearAppealsPercentage: 0.03,
                          secondYearAppealsPercentage: 0.02,
                          thirdYearAppealsPercentage: 0.00
                        }));
                      }}
                      className="mr-2"
                    />
                    Standard (10% retainer, 5% end, 3%+2% appeals)
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="custom"
                      checked={contractSetup.templateType === 'custom'}
                      onChange={(e) => setContractSetup(prev => ({ ...prev, templateType: e.target.value }))}
                      className="mr-2"
                    />
                    Custom Configuration
                  </label>
                </div>
              </div>

              {contractSetup.templateType === 'custom' && (
                <div className="space-y-3 pl-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Retainer %
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={contractSetup.retainerPercentage}
                      onChange={(e) => setContractSetup(prev => ({ ...prev, retainerPercentage: parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      End of Job %
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={contractSetup.endOfJobPercentage}
                      onChange={(e) => setContractSetup(prev => ({ ...prev, endOfJobPercentage: parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      1st Year Appeals %
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={contractSetup.firstYearAppealsPercentage}
                      onChange={(e) => setContractSetup(prev => ({ ...prev, firstYearAppealsPercentage: parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      2nd Year Appeals %
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={contractSetup.secondYearAppealsPercentage}
                      onChange={(e) => setContractSetup(prev => ({ ...prev, secondYearAppealsPercentage: parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      3rd Year Appeals %
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={contractSetup.thirdYearAppealsPercentage}
                      onChange={(e) => setContractSetup(prev => ({ ...prev, thirdYearAppealsPercentage: parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Billing History (Optional - paste from Excel)
                </label>
                <textarea
                  value={billingHistoryText}
                  onChange={(e) => setBillingHistoryText(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
                  rows="8"
                  placeholder="Paste billing history in this format:
12/4/2024 10.00% D 12240225 $49,935.00 $4,994.00 $0.00 $44,941.00
2/28/2025 24.37% D 020225 $121,690.00 $12,169.00 $0.00 $109,521.00"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Format: Date Percentage% D/blank InvoiceNumber $Total $Retainer $0 $Billed
                </p>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowContractSetup(false);
                  setSelectedJob(null);
                  setBillingHistoryText('');
                  // Reset contract setup to defaults
                  setContractSetup({
                    contractAmount: '',
                    templateType: 'standard',
                    retainerPercentage: 0.10,
                    endOfJobPercentage: 0.05,
                    firstYearAppealsPercentage: 0.03,
                    secondYearAppealsPercentage: 0.02,
                    thirdYearAppealsPercentage: 0.00
                  });
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleContractSetup}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Save Contract {billingHistoryText.trim() && '& Import History'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Billing Event Modal */}
      {showBillingForm && selectedJob && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Add Billing Event: {selectedJob.job_name}</h3>
            
            <div className="flex justify-center mb-4">
              <button
                onClick={() => setShowBulkPaste(false)}
                className={`px-4 py-2 rounded-l-md ${!showBulkPaste ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
              >
                Single Event
              </button>
              <button
                onClick={() => setShowBulkPaste(true)}
                className={`px-4 py-2 rounded-r-md ${showBulkPaste ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
              >
                Bulk Paste
              </button>
            </div>
            
            {showBulkPaste ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Paste Billing Events
                  </label>
                  <textarea
                    value={bulkBillingText}
                    onChange={(e) => setBulkBillingText(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
                    rows="10"
                    placeholder="Paste billing events (one per line):
12/4/2024 10.00% D 12240225 $49,935.00 $4,994.00 $0.00 $44,941.00
2/28/2025 24.37% D 020225 $121,690.00 $12,169.00 $0.00 $109,521.00"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Format: Date Percentage% D/blank InvoiceNumber $Total $Retainer $0 $Billed
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Billing Date
                  </label>
                  <input
                    type="date"
                    value={billingForm.billingDate}
                    onChange={(e) => setBillingForm(prev => ({ ...prev, billingDate: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Percentage Billed (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={billingForm.percentageBilled}
                    onChange={(e) => setBillingForm(prev => ({ ...prev, percentageBilled: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="25.0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Invoice Number
                  </label>
                  <input
                    type="text"
                    value={billingForm.invoiceNumber}
                    onChange={(e) => setBillingForm(prev => ({ ...prev, invoiceNumber: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="INV-2025-001"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Status
                  </label>
                  <select
                    value={billingForm.status}
                    onChange={(e) => setBillingForm(prev => ({ ...prev, status: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="P">Paid</option>
                    <option value="O">Open</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Billing Type (Optional)
                  </label>
                  <select
                    value={billingForm.billingType}
                    onChange={(e) => setBillingForm(prev => ({ ...prev, billingType: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="">Regular Billing</option>
                    <option value="retainer">Retainer Payout</option>
                    <option value="turnover">Turnover</option>
                    <option value="1st_appeals">1st Year Appeals</option>
                    <option value="2nd_appeals">2nd Year Appeals</option>
                    <option value="3rd_appeals">3rd Year Appeals</option>
                  </select>
                </div>
                
                <div className="border-t pt-4">
                  <label className="flex items-center mb-2">
                    <input
                      type="checkbox"
                      checked={billingForm.manualOverride}
                      onChange={(e) => setBillingForm(prev => ({ ...prev, manualOverride: e.target.checked }))}
                      className="mr-2"
                    />
                    <span className="text-sm font-medium text-gray-700">Manual Amount Override</span>
                  </label>
                  
                  {billingForm.manualOverride && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Override Amount
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={billingForm.overrideAmount}
                        onChange={(e) => setBillingForm(prev => ({ ...prev, overrideAmount: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        placeholder="80147.00"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Enter the actual amount to bill (overrides percentage calculation)
                      </p>
                    </div>
                  )}
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={billingForm.notes}
                    onChange={(e) => setBillingForm(prev => ({ ...prev, notes: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    rows="3"
                    placeholder="Optional notes..."
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowBillingForm(false);
                  setShowBulkPaste(false);
                  setBulkBillingText('');
                  setBillingForm({
                    billingDate: new Date().toISOString().split('T')[0],
                    percentageBilled: '',
                    status: 'P',
                    invoiceNumber: '',
                    notes: '',
                    manualOverride: false,
                    overrideAmount: '',
                    billingType: ''
                  });
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleAddBillingEvent}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                {showBulkPaste ? 'Import Events' : 'Add Billing Event'}
              </button>
            </div>
          </div>
        </div>
      )}
                
      {/* Edit Billing Event Modal */}
      {showEditBilling && editingEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Edit Billing Event</h3>
            
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-md">
                <p className="text-sm text-gray-600 mb-1">Date: {new Date(editingEvent.billing_date).toLocaleDateString()}</p>
                <p className="text-sm text-gray-600 mb-1">Invoice: {editingEvent.invoice_number}</p>
                <p className="text-sm text-gray-600 mb-1">Percentage: {(editingEvent.percentage_billed * 100).toFixed(2)}%</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Payment Status
                </label>
                <select
                  value={editingEvent.status}
                  onChange={(e) => setEditingEvent(prev => ({ ...prev, status: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="P">Paid</option>
                  <option value="O">Open</option>  
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Billing Type
                </label>
                <select
                  value={editingEvent.billing_type || ''}
                  onChange={(e) => setEditingEvent(prev => ({ ...prev, billing_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="">Regular Billing</option>
                  <option value="retainer">Retainer Payout</option>
                  <option value="turnover">Turnover</option>
                  <option value="1st_appeals">1st Year Appeals</option>
                  <option value="2nd_appeals">2nd Year Appeals</option>
                  <option value="3rd_appeals">3rd Year Appeals</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Amount Billed
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={editingEvent.amount_billed}
                  onChange={(e) => setEditingEvent(prev => ({ ...prev, amount_billed: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="0.00"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Original amount: {formatCurrency(editingEvent.total_amount - editingEvent.retainer_amount)}
                </p>
              </div>
            </div>

            <div className="flex justify-between mt-6">
              <button
                onClick={handleDeleteBillingEvent}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                Delete Event
              </button>
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowEditBilling(false);
                    setEditingEvent(null);
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateBillingEvent}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Update Event
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legacy Job Form Modal */}
      {showLegacyJobForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Create Legacy Billing Job</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Job Name
                </label>
                <input
                  type="text"
                  value={legacyJobForm.jobName}
                  onChange={(e) => setLegacyJobForm(prev => ({ ...prev, jobName: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="e.g., Westville Borough 2023"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contract Amount
                </label>
                <input
                  type="number"
                  value={legacyJobForm.contractAmount}
                  onChange={(e) => setLegacyJobForm(prev => ({ ...prev, contractAmount: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="500000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Contract Template
                </label>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="standard"
                      checked={legacyJobForm.templateType === 'standard'}
                      onChange={(e) => {
                        setLegacyJobForm(prev => ({
                          ...prev,
                          templateType: e.target.value,
                          retainerPercentage: 0.10,
                          endOfJobPercentage: 0.05,
                          firstYearAppealsPercentage: 0.03,
                          secondYearAppealsPercentage: 0.02,
                          thirdYearAppealsPercentage: 0.00
                        }));
                      }}
                      className="mr-2"
                    />
                    Standard (10% retainer, 5% end, 3%+2% appeals)
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="custom"
                      checked={legacyJobForm.templateType === 'custom'}
                      onChange={(e) => setLegacyJobForm(prev => ({ ...prev, templateType: e.target.value }))}
                      className="mr-2"
                    />
                    Custom Configuration
                  </label>
                </div>
              </div>

              {legacyJobForm.templateType === 'custom' && (
                <div className="space-y-3 pl-6 border-l-2 border-gray-200">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Retainer %
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={legacyJobForm.retainerPercentage}
                      onChange={(e) => setLegacyJobForm(prev => ({ ...prev, retainerPercentage: parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      End of Job %
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={legacyJobForm.endOfJobPercentage}
                      onChange={(e) => setLegacyJobForm(prev => ({ ...prev, endOfJobPercentage: parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      1st Year Appeals %
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={legacyJobForm.firstYearAppealsPercentage}
                      onChange={(e) => setLegacyJobForm(prev => ({ ...prev, firstYearAppealsPercentage: parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      2nd Year Appeals %
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={legacyJobForm.secondYearAppealsPercentage}
                      onChange={(e) => setLegacyJobForm(prev => ({ ...prev, secondYearAppealsPercentage: parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      3rd Year Appeals %
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={legacyJobForm.thirdYearAppealsPercentage}
                      onChange={(e) => setLegacyJobForm(prev => ({ ...prev, thirdYearAppealsPercentage: parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Billing History (Optional - paste from Excel)
                </label>
                <textarea
                  value={legacyJobForm.billingHistory}
                  onChange={(e) => setLegacyJobForm(prev => ({ ...prev, billingHistory: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
                  rows="8"
                  placeholder="Paste billing history in this format:
12/4/2024 10.00% D 12240225 $49,935.00 $4,994.00 $0.00 $44,941.00
2/28/2025 24.37% D 020225 $121,690.00 $12,169.00 $0.00 $109,521.00"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Format: Date Percentage% D/blank InvoiceNumber $Total $Retainer $0 $Billed
                </p>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowLegacyJobForm(false);
                  setLegacyJobForm({
                    jobName: '',
                    contractAmount: '',
                    billingHistory: '',
                    templateType: 'standard',
                    retainerPercentage: 0.10,
                    endOfJobPercentage: 0.05,
                    firstYearAppealsPercentage: 0.03,
                    secondYearAppealsPercentage: 0.02,
                    thirdYearAppealsPercentage: 0.00
                  });
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateLegacyJob}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                Create Legacy Job
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expense Import Modal */}
      {showExpenseImport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Import Expense Data</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Excel File
                </label>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setExpenseFile(e.target.files[0])}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
                <p className="text-xs text-gray-500 mt-2">
                  Upload your expense Excel file. The first sheet will be imported.
                </p>
              </div>

              {expenseFile && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <p className="text-sm text-blue-800">
                    Selected: {expenseFile.name}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowExpenseImport(false);
                  setExpenseFile(null);
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleExpenseImport}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                disabled={!expenseFile}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingManagement;
