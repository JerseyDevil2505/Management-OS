import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const BillingManagement = () => {
  const [activeTab, setActiveTab] = useState('active');
  const [jobs, setJobs] = useState([]);
  const [planningJobs, setPlanningJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showContractSetup, setShowContractSetup] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [showBillingForm, setShowBillingForm] = useState(false);
  const [billingHistoryText, setBillingHistoryText] = useState('');
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
    overrideAmount: ''
  });
  const [showBulkPaste, setShowBulkPaste] = useState(false);
  const [bulkBillingText, setBulkBillingText] = useState('');
  const [showEditBilling, setShowEditBilling] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [showLegacyJobForm, setShowLegacyJobForm] = useState(false);
  const [legacyJobForm, setLegacyJobForm] = useState({
    jobName: '',
    contractAmount: '',
    billingHistory: ''
  });
  const [globalMetrics, setGlobalMetrics] = useState({
    totalSigned: 0,
    totalPaid: 0,
    totalRemaining: 0,
    totalRemainingExcludingRetainer: 0
  });

  useEffect(() => {
    loadJobs();
    calculateGlobalMetrics();
  }, [activeTab]);

  const calculateGlobalMetrics = async () => {
    try {
      // Get all active jobs with contracts
      const { data: activeJobs } = await supabase
        .from('jobs')
        .select(`
          job_contracts(contract_amount),
          billing_events(amount_billed, retainer_amount, status)
        `)
        .eq('job_type', 'standard');

      // Get planning jobs with contract amounts
      const { data: planningJobsData } = await supabase
        .from('planning_jobs')
        .select('contract_amount')
        .not('contract_amount', 'is', null)
        .eq('is_archived', false);

      let totalSigned = 0;
      let totalPaid = 0;
      let totalRemaining = 0;
      let totalRemainingExcludingRetainer = 0;

      // Calculate from active jobs
      if (activeJobs) {
        activeJobs.forEach(job => {
          if (job.job_contracts?.[0]) {
            const contractAmount = job.job_contracts[0].contract_amount;
            totalSigned += contractAmount;

            let jobPaid = 0;
            let jobRetainerPaid = 0;

            if (job.billing_events) {
              job.billing_events.forEach(event => {
                if (event.status === 'P') {
                  jobPaid += event.amount_billed;
                  jobRetainerPaid += event.retainer_amount;
                }
              });
            }

            totalPaid += jobPaid;
            const jobRemaining = contractAmount - jobPaid;
            totalRemaining += jobRemaining;
            
            // For remaining excluding retainer, we add back the paid retainer amounts
            totalRemainingExcludingRetainer += (jobRemaining - jobRetainerPaid);
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

      setGlobalMetrics({
        totalSigned,
        totalPaid,
        totalRemaining,
        totalRemainingExcludingRetainer
      });
    } catch (error) {
      console.error('Error calculating global metrics:', error);
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
          .eq('is_archived', false);

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
        setJobs(legacyData || []);
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
    // Parse pasted billing history
    // Format: 12/4/2024 10.00% D 12240225 $49,935.00 $4,994.00 $0.00 $44,941.00
    const lines = text.trim().split('\n');
    const parsedEvents = [];
    
    lines.forEach(line => {
      const parts = line.trim().split(/\s+/);
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
          status = ''; // No D means Open
          invoiceNumber = parts[2];
          startIndex = 3;
        }
        
        // Remove $ and commas from amounts and round to nearest dollar
        const totalAmount = Math.round(parseFloat(parts[startIndex].replace(/[$,]/g, '')));
        const retainerAmount = Math.round(parseFloat(parts[startIndex + 1].replace(/[$,]/g, '')));
        // Skip parts[startIndex + 2] which seems to be $0.00
        const amountBilled = parseFloat(parts[startIndex + 3].replace(/[$,]/g, ''));
        
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
            notes: 'Imported from billing history'
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
    
    try {
      const contract = selectedJob.job_contracts[0];
      
      if (showBulkPaste && bulkBillingText.trim()) {
        // Handle bulk paste
        const parsedEvents = parseBillingHistory(bulkBillingText);
        let runningTotal = 0;
        let runningPercentage = 0;
        
        // Get existing events to calculate starting totals
        const existingEvents = selectedJob.billing_events || [];
        const previousBilled = existingEvents.reduce((sum, event) => sum + parseFloat(event.amount_billed || 0), 0);
        const previousPercentage = existingEvents.reduce((sum, event) => sum + parseFloat(event.percentage_billed || 0), 0);
        
        runningTotal = previousBilled;
        runningPercentage = previousPercentage;
        
        for (const event of parsedEvents) {
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
          status: billingForm.status,
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

        // Update jobs.percent_billed
        const newTotalPercentage = existingEvents.reduce((sum, event) => sum + parseFloat(event.percentage_billed || 0), 0) + percentageDecimal;
        await supabase
          .from('jobs')
          .update({ percent_billed: newTotalPercentage })
          .eq('id', selectedJob.id);
      }

      setShowBillingForm(false);
      setBillingForm({
        billingDate: new Date().toISOString().split('T')[0],
        percentageBilled: '',
        status: 'P',
        invoiceNumber: '',
        notes: '',
        manualOverride: false,
        overrideAmount: ''
      });
      loadJobs();
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
        amount_billed: parseFloat(editingEvent.amount_billed)
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
          job_name: planningJob.job_name,
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

      alert(`Successfully rolled over "${planningJob.job_name}" to active jobs!`);
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

      setShowEditBilling(false);
      setEditingEvent(null);
      loadJobs();
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
          job_type: 'legacy_billing',
          billing_setup_complete: true,
          percent_billed: 0
        })
        .select()
        .single();

      if (jobError) throw jobError;

      // Create the contract with standard percentages
      const contractData = {
        job_id: newJob.id,
        contract_amount: parseFloat(legacyJobForm.contractAmount),
        retainer_percentage: 0.10,
        retainer_amount: parseFloat(legacyJobForm.contractAmount) * 0.10,
        end_of_job_percentage: 0.05,
        end_of_job_amount: parseFloat(legacyJobForm.contractAmount) * 0.05,
        first_year_appeals_percentage: 0.03,
        first_year_appeals_amount: parseFloat(legacyJobForm.contractAmount) * 0.03,
        second_year_appeals_percentage: 0.02,
        second_year_appeals_amount: parseFloat(legacyJobForm.contractAmount) * 0.02,
        third_year_appeals_percentage: 0.00,
        third_year_appeals_amount: 0
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
        billingHistory: ''
      });
      setActiveTab('legacy');
      loadJobs();
    } catch (error) {
      console.error('Error creating legacy job:', error);
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Total Signed Contracts</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(globalMetrics.totalSigned)}</p>
            <p className="text-xs text-gray-500 mt-1">Active + Planned</p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Total Amount Paid</p>
            <p className="text-2xl font-bold text-green-600">{formatCurrency(globalMetrics.totalPaid)}</p>
            <p className="text-xs text-gray-500 mt-1">All paid invoices</p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Total Remaining</p>
            <p className="text-2xl font-bold text-orange-600">{formatCurrency(globalMetrics.totalRemaining)}</p>
            <p className="text-xs text-gray-500 mt-1">Including retainer</p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm border-2 border-blue-400">
            <p className="text-sm text-gray-600 mb-1">Remaining (No Retainer)</p>
            <p className="text-2xl font-bold text-blue-600">{formatCurrency(globalMetrics.totalRemainingExcludingRetainer)}</p>
            <p className="text-xs text-blue-600 mt-1">Actual work remaining</p>
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
            Planned Jobs
          </button>
          <button
            onClick={() => setActiveTab('legacy')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'legacy'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Legacy Jobs
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
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
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
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {job.billing_events
                                .sort((a, b) => new Date(a.billing_date) - new Date(b.billing_date))
                                .map(event => (
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
                                    {(event.percentage_billed * 100).toFixed(2)}%
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
                                </tr>
                              ))}
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
                planningJobs.filter(job => !job.is_archived).map(job => {
                  // Calculate breakdown amounts
                  const contractAmount = parseFloat(job.contract_amount) || 0;
                  const retainerAmount = contractAmount * 0.10;
                  const turnoverAmount = contractAmount * 0.05;
                  const appealsAmount = contractAmount * 0.03;
                  
                  return (
                    <div key={job.id} className="border-2 border-gray-300 rounded-lg p-6 bg-gray-50">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center space-x-3">
                          <h3 className="text-xl font-semibold text-gray-900">{job.municipality || job.job_name || 'Unnamed Job'}</h3>
                          {job.ccdd_code && (
                            <span className="px-2 py-1 text-xs rounded-full bg-gray-200 text-gray-700">
                              {job.ccdd_code}
                            </span>
                          )}
                          <span className="px-2 py-1 text-xs rounded-full bg-orange-100 text-orange-800">
                            Planned
                          </span>
                        </div>
                        <button
                          onClick={() => handleRolloverToActive(job)}
                          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                          disabled={!job.contract_amount}
                          title={!job.contract_amount ? "Set contract amount first" : "Roll over to active jobs"}
                        >
                          Roll to Active →
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-600 mb-1">Contract Amount</label>
                          <input
                            type="number"
                            value={job.contract_amount || ''}
                            onChange={(e) => handleUpdatePlannedContract(job.id, e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded text-lg font-semibold"
                            placeholder="Enter amount"
                          />
                        </div>
                        
                        {contractAmount > 0 && (
                          <div className="bg-white p-3 rounded-md border border-gray-200">
                            <p className="text-xs font-medium text-gray-600 mb-2">CONTRACT BREAKDOWN</p>
                            <div className="space-y-1 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-600">Retainer (10%)</span>
                                <span className="font-medium">{formatCurrency(retainerAmount)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">Turnover (5%)</span>
                                <span className="font-medium">{formatCurrency(turnoverAmount)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">Appeals (3%)</span>
                                <span className="font-medium">{formatCurrency(appealsAmount)}</span>
                              </div>
                              <div className="flex justify-between pt-2 border-t border-gray-200">
                                <span className="font-medium text-gray-700">Total</span>
                                <span className="font-bold text-gray-900">{formatCurrency(contractAmount)}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {job.start_date && (
                        <div className="text-sm text-gray-600">
                          Target: {new Date(job.start_date).toLocaleDateString()}
                          {job.end_date && ` - ${new Date(job.end_date).toLocaleDateString()}`}
                        </div>
                      )}
                    </div>
                  );
                })
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

              {jobs.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                  <p className="text-gray-600">No legacy billing jobs found. Click "Add Legacy Job" to create one.</p>
                </div>
              ) : (
                jobs.map(job => {
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
                        <button
                          onClick={() => {
                            setSelectedJob(job);
                            setShowBillingForm(true);
                          }}
                          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                        >
                          Add Billing Event
                        </button>
                      </div>

                      {totals && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
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
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {job.billing_events
                                .sort((a, b) => new Date(a.billing_date) - new Date(b.billing_date))
                                .map(event => (
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
                                    {(event.percentage_billed * 100).toFixed(2)}%
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
                                </tr>
                              ))}
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
        </>
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
                    <option value="">Open</option>
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
                    overrideAmount: ''
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
                  <option value="">Open</option>
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
                    billingHistory: ''
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
    </div>
  );
};

export default BillingManagement;
