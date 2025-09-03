import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import * as XLSX from 'xlsx';

const BillingManagement = ({ 
  activeJobs = [], 
  legacyJobs = [], 
  planningJobs = [], 
  expenses = [], 
  receivables = [], 
  distributions = [], 
  billingMetrics = null,
  onDataUpdate,
  onRefresh 
}) => {
  const [activeTab, setActiveTab] = useState('active');
  const [jobs, setJobs] = useState([]);
  const [legacyJobsState, setLegacyJobs] = useState([]);
  const [planningJobsState, setPlanningJobs] = useState([]);
  // Add state to track counts for all job types
  const [jobCounts, setJobCounts] = useState({
    active: 0,
    planned: 0,
    legacy: 0
  });
  const [expensesState, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showContractSetup, setShowContractSetup] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [showBillingForm, setShowBillingForm] = useState(false);
  const [billingHistoryText, setBillingHistoryText] = useState('');
  const [showExpenseImport, setShowExpenseImport] = useState(false);
  const [expenseFile, setExpenseFile] = useState(null);
  const [revenueData, setRevenueData] = useState({ totalRevenue: 0 });
  const [showOpenInvoices, setShowOpenInvoices] = useState(false);
  const [allOpenInvoices, setAllOpenInvoices] = useState([]);
  const [officeReceivables, setOfficeReceivables] = useState([]);
  const [showReceivableForm, setShowReceivableForm] = useState(false);
  const [receivableForm, setReceivableForm] = useState({
    jobName: '',
    eventDescription: '',
    status: 'O',
    invoiceNumber: '',
    amount: ''
  });
  const [editingReceivable, setEditingReceivable] = useState(null);
  const [distributionsState, setDistributions] = useState([]);
  const [showDistributionForm, setShowDistributionForm] = useState(false);
  const [distributionForm, setDistributionForm] = useState({
    shareholder: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    notes: ''
  });
  const [distributionMetrics, setDistributionMetrics] = useState({
    conservative: 0,
    projected: 0,
    ytdDistributions: 0,
    monthlyCollectionRate: 0,
    projectedYearEnd: 0
  });
  
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [selectedReminderInvoice, setSelectedReminderInvoice] = useState(null);
  const [reminderMessage, setReminderMessage] = useState('');
  
  const [reserveSettings, setReserveSettings] = useState({
    operatingReserveMonths: 1, // 0, 1, or 2
    cashReserve: 125000
  });

  //Invoice aging helpers
  const calculateInvoiceAge = (billingDate) => {
    const today = new Date();
    const invoiceDate = new Date(billingDate);
    const diffTime = today - invoiceDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getAgingBucket = (days) => {
    if (days < 30) return 'current';
    if (days < 60) return '30-59';
    if (days < 90) return '60-89';
    if (days < 120) return '90-119';
    return '120+';
  };

  const getAgingColor = (days) => {
    if (days < 30) return '';
    if (days < 60) return 'bg-yellow-50';
    if (days < 90) return 'bg-orange-50';
    if (days < 120) return 'bg-orange-100';
    return 'bg-red-50';
  };

  const generateReminderMessage = (invoice, daysOld) => {
    const municipality = invoice.job_name?.replace(' Township', '')?.replace(' Borough', '')?.replace(' City', '');
    const amount = formatCurrency(invoice.open_balance || invoice.amount_billed);
    const invoiceDate = new Date(invoice.billing_date).toLocaleDateString();
    
    if (daysOld >= 60 && daysOld < 90) {
      return `Hi ${municipality},

We wanted to check in on invoice #${invoice.invoice_number} dated ${invoiceDate} for ${amount}. We noticed it's been about ${daysOld} days since submission.

Just wanted to make sure you have everything you need from us to process this payment. Please let us know if you need any additional documentation.

Thanks so much!`;
    } else if (daysOld >= 90 && daysOld < 120) {
      return `Hi ${municipality},

Following up on invoice #${invoice.invoice_number} from ${invoiceDate} (${amount}) which is now ${daysOld} days outstanding.

We understand the typical municipal payment timeline is within 60 days per New Jersey statutes. We'd appreciate if you could look into this when you get a chance.

If there are any issues or questions about this invoice, please let us know so we can resolve them promptly.

Thank you for your attention to this matter.`;
    } else if (daysOld >= 120) {
      return `Dear ${municipality},

RE: Outstanding Invoice #${invoice.invoice_number} - ${daysOld} Days Past Due

This invoice totaling ${amount} dated ${invoiceDate} remains unpaid after ${daysOld} days. Per N.J.S.A. 40A:5-16, municipal payments are required within 60 days of invoice receipt.

Please remit payment immediately. If there are any disputes regarding this invoice, please notify us in writing within 5 business days.

Thank you for your immediate attention to this matter.`;
    }
    
    return '';
  };

  // Dynamic working days calculation
  const getWorkingDaysForMonth = (year, month) => {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    let workingDays = 0;
    
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(year, month - 1, day);
      const dayOfWeek = date.getDay();
      // Count weekdays (Mon-Fri)
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        workingDays++;
      }
    }
    
    // Rough federal holiday adjustment
    const federalHolidayAdjustment = {
      1: 2,  // New Year's, MLK
      2: 1,  // Presidents
      5: 1,  // Memorial
      7: 1,  // July 4th
      9: 1,  // Labor
      11: 2, // Veterans, Thanksgiving
      12: 1  // Christmas
    };
    
    return workingDays - (federalHolidayAdjustment[month] || 0);
  };
  
  // Generate working days for current year
  const currentYear = new Date().getFullYear();
  const workingDays = {};
  for (let month = 1; month <= 12; month++) {
    workingDays[month] = getWorkingDaysForMonth(currentYear, month);
  }

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
    profitLossPercent: 0,
    projectedCash: 0,              
    projectedProfitLoss: 0,        
    projectedProfitLossPercent: 0  
  });

  // Master function to load all data fresh from database
  const loadAllData = async () => {
    try {
      await loadJobCounts();
      await calculateGlobalMetrics();
      await loadJobs();

      if (activeTab === 'expenses') {
        await loadExpenses();
      }
      if (activeTab === 'receivables') {
        await loadOfficeReceivables();
      }
      if (activeTab === 'distributions') {
        await loadDistributions();
        await calculateDistributionMetrics();
      }
    } catch (error) {
      console.error('Error loading all data:', error);
    }
  };

  useEffect(() => {
    // Always fetch fresh data on mount and tab changes
    loadAllData();
  }, [activeTab]);

  // Refresh data every time the component becomes visible
  useEffect(() => {
    loadAllData();
  }, []);

  useEffect(() => {
    if (activeTab === 'distributions' && globalMetrics.totalPaid > 0) {
      calculateDistributionMetrics();
    }
  }, [globalMetrics, activeTab, reserveSettings]);

  const calculateGlobalMetrics = async () => {
    // Use the pre-calculated metrics from App.js
    if (billingMetrics) {
      setGlobalMetrics(billingMetrics);
    }
  };

  const loadExpenses = async () => {
    try {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('year', new Date().getFullYear())
        .order('month');

      if (error) throw error;
      setExpenses(data || []);
    } catch (error) {
      console.error('Error loading expenses:', error);
      setExpenses([]);
    }
  };

  const loadOfficeReceivables = async () => {
    try {
      const { data, error } = await supabase
        .from('office_receivables')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOfficeReceivables(data || []);
    } catch (error) {
      console.error('Error loading office receivables:', error);
      setOfficeReceivables([]);
    }
  }; 

  const loadDistributions = async () => {
    try {
      const { data, error } = await supabase
        .from('shareholder_distributions')
        .select('*')
        .eq('year', new Date().getFullYear())
        .order('distribution_date', { ascending: false });

      if (error) throw error;
      setDistributions(data || []);
    } catch (error) {
      console.error('Error loading distributions:', error);
      setDistributions([]);
    }
  };
  
const calculateDistributionMetrics = async () => {
    try {
      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1;
      const monthsElapsed = currentMonth;
      const monthsRemaining = 12 - currentMonth;
      
      // Use distributions from props instead of fetching
      const ytdDistributions = distributions
        ?.filter(d => d.status === 'paid')
        ?.reduce((sum, dist) => sum + parseFloat(dist.amount), 0) || 0;
      
      // Use planning jobs from props for the projection formula
      const plannedContractsTotal = planningJobs
        ?.filter(job => job.contract_amount && !job.is_archived)
        ?.reduce((sum, job) => sum + (job.contract_amount || 0), 0) || 0;
      
      // Calculate monthly collection rate (keep for display purposes)
      const monthlyCollectionRate = monthsElapsed > 0 ? globalMetrics.totalPaid / monthsElapsed : 0;
      
      // NEW Project year-end cash formula
      const projectedYearEnd = (globalMetrics.totalPaid + globalMetrics.totalOpen + globalMetrics.totalRemaining) - (plannedContractsTotal * 0.9);
      
      // Calculate operating reserve based on user setting
      const operatingReserve = reserveSettings.operatingReserveMonths > 0 
        ? globalMetrics.dailyFringe * (reserveSettings.operatingReserveMonths * 21) 
        : 0;
      const cashReserve = reserveSettings.cashReserve;
      
      // Calculate remaining year expenses
      const remainingDaysInYear = (12 - currentMonth + 1) * 21; // Rough estimate
      const remainingYearExpenses = globalMetrics.dailyFringe * remainingDaysInYear;
      
      // Projected approach (available by year-end)
      const projected = projectedYearEnd - 
                       operatingReserve - 
                       cashReserve - 
                       ytdDistributions - 
                       globalMetrics.projectedExpenses;
      
      setDistributionMetrics({
        projected: Math.max(0, projected),
        ytdDistributions,
        monthlyCollectionRate,
        projectedYearEnd,
        operatingReserve,
        cashReserve
      });
    } catch (error) {
      console.error('Error calculating distribution metrics:', error);
    }
  };  

  const generateBondLetter = async () => {
    try {
      // Load jsPDF from CDN if not already loaded
      if (!window.jspdf) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        document.head.appendChild(script);
        await new Promise(resolve => script.onload = resolve);
      }
      
      // Always fetch fresh data directly from database
      const { data: activeJobsData, error: activeError } = await supabase
        .from('jobs')
        .select(`
          *,
          job_contracts(*),
          workflow_stats,
          billing_events(*)
        `)
        .eq('job_type', 'standard');

      if (activeError) {
        console.error('Error fetching active jobs:', activeError);
        throw activeError;
      }

      const { data: planningJobsData, error: planningError } = await supabase
        .from('planning_jobs')
        .select('*')
        .gt('contract_amount', 0);

      if (planningError) {
        console.error('Error fetching planning jobs:', planningError);
        throw planningError;
      }

      console.log('Active jobs fetched:', activeJobsData?.length || 0);
      console.log('Planning jobs fetched:', planningJobsData?.length || 0);

      const allJobs = [];
      
      // Process active jobs
      if (activeJobsData && activeJobsData.length > 0) {
        activeJobsData.forEach(job => {
          const contract = job.job_contracts?.[0];
          
          // Get parcels from workflow_stats or job properties
          let parcels = 0;
          if (job.workflow_stats?.totalRecords) {
            parcels = job.workflow_stats.totalRecords;
          } else if (job.workflow_stats?.billingAnalytics?.totalBillable) {
            parcels = job.workflow_stats.billingAnalytics.totalBillable;
          } else {
            parcels = job.total_properties || (job.totalresidential + job.totalcommercial) || 0;
          }
          
          // Calculate % complete from workflow_stats
          let percentComplete = '0.0';
          if (job.workflow_stats) {
            const billable = job.workflow_stats.billingAnalytics?.totalBillable || 0;
            const total = job.workflow_stats.totalRecords || 0;
            if (total > 0 && billable > 0) {
              percentComplete = ((billable / total) * 100).toFixed(1);
            }
          }
          
          // Calculate % billed from billing events
          let percentBilled = '0.0';
          if (job.billing_events && job.billing_events.length > 0) {
            const totalBilled = job.billing_events.reduce((sum, event) => 
              sum + parseFloat(event.percentage_billed || 0), 0);
            percentBilled = (totalBilled * 100).toFixed(1);
          }
          
          if (contract && parcels > 0) {
            // Fix timezone issue - parse date string directly
            const dueYear = job.end_date ? parseInt(job.end_date.substring(0, 4)) : new Date().getFullYear();
            
            allJobs.push({
              municipality: job.job_name,
              dueYear: dueYear,
              contractStatus: 'YES',
              parcels: parcels,
              amount: contract.contract_amount,
              pricePerParcel: (contract.contract_amount / parcels).toFixed(2),
              percentComplete: percentComplete,
              percentBilled: percentBilled,
              isPending: false
            });
          }
        });
      }
      
      // Process planning jobs
      if (planningJobsData && planningJobsData.length > 0) {
        planningJobsData.forEach(job => {
          if (job.contract_amount > 0) {
            const parcels = job.total_properties || 
                           ((job.residential_properties || 0) + (job.commercial_properties || 0)) || 
                           0;
            
            // Fix timezone issue for planning jobs too
            const dueYear = job.end_date ? parseInt(job.end_date.substring(0, 4)) : new Date().getFullYear() + 1;
            
            allJobs.push({
              municipality: (job.municipality || job.job_name || 'Unknown') + '*', // Add asterisk for pending
              dueYear: dueYear,
              contractStatus: 'PENDING',
              parcels: parcels,
              amount: job.contract_amount,
              pricePerParcel: parcels > 0 ? (job.contract_amount / parcels).toFixed(2) : '0.00',
              percentComplete: '0.0',
              percentBilled: '0.0',
              isPending: true
            });
          }
        });
      }
      
      // Sort by percent billed (highest to lowest)
      allJobs.sort((a, b) => parseFloat(b.percentBilled) - parseFloat(a.percentBilled));
      
      // Calculate totals - exclude jobs with 0 parcels from average calculation
      const totalParcels = allJobs.reduce((sum, job) => sum + job.parcels, 0);
      const totalAmount = allJobs.reduce((sum, job) => sum + parseFloat(job.amount), 0);
      
      // Calculate average only for jobs WITH parcels
      const jobsWithParcels = allJobs.filter(job => job.parcels > 0);
      const parcelsForAvg = jobsWithParcels.reduce((sum, job) => sum + job.parcels, 0);
      const amountForAvg = jobsWithParcels.reduce((sum, job) => sum + parseFloat(job.amount), 0);
      const avgPricePerParcel = parcelsForAvg > 0 ? (amountForAvg / parcelsForAvg).toFixed(2) : '0.00';
      
      console.log('Total jobs in report:', allJobs.length);
      console.log('Total amount:', totalAmount);
      console.log('Total parcels:', totalParcels);
      
      // Generate PDF using jsPDF - LANDSCAPE orientation
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'letter'
      });
      
      // Add content with adjusted positions for landscape
      doc.setFontSize(14);
      doc.text('PROFESSIONAL PROPERTY APPRAISERS', 140, 15, { align: 'center' });
      doc.setFontSize(11);
      doc.text('Bonding Status Report', 140, 22, { align: 'center' });
      doc.text(new Date().toLocaleDateString(), 140, 28, { align: 'center' });
      
      // Add table headers with better spacing for landscape
      let y = 40;
      doc.setFontSize(9);
      doc.text('Municipality', 10, y);
      doc.text('Due Year', 65, y);
      doc.text('Contract Status', 85, y);
      doc.text('Parcels', 115, y);
      doc.text('Amount', 135, y);
      doc.text('$/Parcel', 165, y);
      doc.text('Complete %', 185, y);
      doc.text('Billed %', 215, y);
      
      // Add jobs with adjusted spacing
      y += 8;
      doc.setFontSize(8);
      
      let currentPage = 1;
      allJobs.forEach(job => {
        if (y > 185) { // New page if needed
          doc.addPage();
          currentPage++;
          y = 20;
          // Repeat headers on new page
          doc.setFontSize(9);
          doc.text('Municipality', 10, y);
          doc.text('Due Year', 65, y);
          doc.text('Contract Status', 85, y);
          doc.text('Parcels', 115, y);
          doc.text('Amount', 135, y);
          doc.text('$/Parcel', 165, y);
          doc.text('Complete %', 185, y);
          doc.text('Billed %', 215, y);
          y += 8;
          doc.setFontSize(8);
        }
        
        // Municipality name
        doc.text(job.municipality.substring(0, 35), 10, y);
        
        // Due Year
        doc.text(job.dueYear.toString(), 65, y);
        
        // Contract Status with color
        if (job.contractStatus === 'YES') {
          doc.setTextColor(6, 95, 70); // Green for Fully Executed
          doc.text('Fully Executed', 85, y);
        } else {
          doc.setTextColor(146, 64, 14); // Amber for Awarded
          doc.text('Awarded', 85, y);
        }
        doc.setTextColor(0, 0, 0); // Back to black
        
        // Parcels (right-aligned)
        doc.text(job.parcels.toLocaleString(), 125, y, { align: 'right' });
        
        // Amount (right-aligned)
        doc.text(`$${parseFloat(job.amount).toLocaleString()}`, 155, y, { align: 'right' });
        
        // $/Parcel (right-aligned)
        doc.text(`$${job.pricePerParcel}`, 175, y, { align: 'right' });
        
        // Complete % (right-aligned)
        doc.text(`${job.percentComplete}%`, 205, y, { align: 'right' });
        
        // Billed % (right-aligned)
        doc.text(`${job.percentBilled}%`, 235, y, { align: 'right' });
        
        y += 6;
      });
      
      // Add totals - left aligned, all bold, no spacing
      y += 10;
      doc.setFontSize(10);
      doc.setFont(undefined, 'bold');
      doc.text(`Total Contracts: ${allJobs.length}`, 10, y);
      y += 5;
      doc.text(`Total Parcels: ${totalParcels.toLocaleString()}`, 10, y);
      y += 5;
      doc.text(`Total Amount: $${totalAmount.toLocaleString()}`, 10, y);
      y += 5;
      doc.setFontSize(11);
      doc.text(`Overall Avg $/Parcel: $${avgPricePerParcel}`, 10, y);
      doc.setFont(undefined, 'normal');
      
      // Add footnote centered at bottom
      doc.setFontSize(8);
      doc.text('*Awarded jobs have been awarded but not yet moved to active jobs', 140, 195, { align: 'center' });
      
      // Save PDF
      doc.save(`PPA_Bonding_Report_${new Date().toISOString().split('T')[0]}.pdf`);
      
      alert('Bonding report PDF generated successfully!');
    } catch (error) {
      console.error('Error generating report:', error);
      alert('Error generating report: ' + error.message);
    }
  };

  const calculateBillingTotals = (job) => {
    if (!job.job_contracts?.[0] || !job.billing_events) return null;
    
    const contract = job.job_contracts[0];
    const events = job.billing_events || [];
    
    const totalPercentageBilled = events.reduce((sum, event) => sum + parseFloat(event.percentage_billed || 0), 0);
    const totalAmountBilled = events.reduce((sum, event) => sum + parseFloat(event.amount_billed || 0), 0);
    const remainingDue = contract.contract_amount - totalAmountBilled;

      // DEBUG: Add this for yellow jobs at 100%
  if (totalPercentageBilled >= 0.99 && totalPercentageBilled <= 1.01) {
  }
    
    return {
      contractAmount: contract.contract_amount,
      totalPercentageBilled: totalPercentageBilled * 100,
      totalAmountBilled,
      remainingDue,
      isComplete: Math.round(totalPercentageBilled * 10000) / 10000 >= 1.0
    };
  };
  
  const loadJobCounts = async () => {
    // Use counts from props
    setJobCounts({
      active: activeJobs.length,
      planned: planningJobs.length,
      legacy: legacyJobs.length
    });
  };

const loadJobs = async () => {
    try {
      setLoading(true);

      if (activeTab === 'active') {
        const { data, error } = await supabase
          .from('jobs')
          .select(`
            *,
            job_contracts(*),
            billing_events(*)
          `)
          .eq('job_type', 'standard')
          .order('job_name');

        if (error) throw error;
        setJobs(data || []);
      } else if (activeTab === 'planned') {
        const { data, error } = await supabase
          .from('planning_jobs')
          .select('*')
          .eq('is_archived', false)
          .order('municipality');

        if (error) throw error;
        setPlanningJobs(data || []);
      } else if (activeTab === 'legacy') {
        const { data, error } = await supabase
          .from('jobs')
          .select(`
            *,
            job_contracts(*),
            billing_events(*)
          `)
          .eq('job_type', 'legacy_billing')
          .order('job_name');

        if (error) throw error;
        setLegacyJobs(data || []);
      }
    } catch (error) {
      console.error('Error loading jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const parseBillingHistory = (text) => {
    // Parse pasted billing history
    // Format: 12/4/2024 10.00% D 12240225 $49,935.00 $4,994.00 $0.00 $44,941.00
    const lines = text.trim().split('\n');
    const parsedEvents = [];
    
    lines.forEach((line, index) => {
      const parts = line.trim().split('\t');
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
      if (onRefresh) onRefresh();
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

        // FIXED: Recalculate total percent_billed from all billing events
        const { data: allBillingEvents, error: eventsError } = await supabase
          .from('billing_events')
          .select('percentage_billed')
          .eq('job_id', selectedJob.id);

        if (eventsError) {
          console.error('Error fetching billing events:', eventsError);
        } else {
          // Calculate the actual total from all billing events
          const actualTotalPercent = allBillingEvents.reduce((sum, event) =>
            sum + parseFloat(event.percentage_billed || 0), 0);

          const { error: jobUpdateError } = await supabase
            .from('jobs')
            .update({ percent_billed: actualTotalPercent })
            .eq('id', selectedJob.id);

          if (jobUpdateError) {
            console.error('Error updating job percent_billed:', jobUpdateError);
          } else {
            console.log(`✅ Updated job ${selectedJob.id} percent_billed to ${(actualTotalPercent * 100).toFixed(4)}% (recalculated from ${allBillingEvents.length} events)`);

            // Notify parent components that data has changed
            if (onDataUpdate) {
              onDataUpdate();
            }
            if (onRefresh) {
              onRefresh();
            }
          }
        }
       
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
                
                const updatedEvents = [...(job.billing_events || []), newEvent];
                const recalculatedPercent = updatedEvents.reduce((sum, event) =>
                  sum + parseFloat(event.percentage_billed || 0), 0);

                return {
                  ...job,
                  billing_events: updatedEvents,
                  percent_billed: recalculatedPercent
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
              
              const updatedEvents = [...(job.billing_events || []), newEvent];
              const recalculatedPercent = updatedEvents.reduce((sum, event) =>
                sum + parseFloat(event.percentage_billed || 0), 0);

              return {
                ...job,
                billing_events: updatedEvents,
                percent_billed: recalculatedPercent
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
      if (onRefresh) onRefresh();
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
        billing_type: editingEvent.billing_type || null,
        invoice_number: editingEvent.invoice_number || ''
      };

      // First update the billing event
      const { error: updateError } = await supabase
        .from('billing_events')
        .update(updateData)
        .eq('id', editingEvent.id);

      if (updateError) throw updateError;

      // Call the cache update for status changes
      if (onDataUpdate) {
        onDataUpdate('billing_event_status', editingEvent.id, { status: editingEvent.status });
      }

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
      if (onRefresh) onRefresh();
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
      
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error('Error updating planned contract:', error);
    }
  };

  const loadAllOpenInvoices = async () => {
    try {
      // Get all jobs with open invoices (both standard and legacy)
      const { data: allJobs, error } = await supabase
        .from('jobs')
        .select(`
          id,
          job_name,
          job_type,
          billing_events(
            id,
            billing_date,
            invoice_number,
            amount_billed,
            percentage_billed,
            billing_type,
            status
          )
        `)
        .in('job_type', ['standard', 'legacy_billing']);

      if (error) throw error;

      // Filter and flatten to just open invoices
      const openInvoices = [];
      allJobs.forEach(job => {
        if (job.billing_events) {
          job.billing_events.forEach(event => {
            if (event.status === 'O') {
              openInvoices.push({
                ...event,
                job_name: job.job_name,
                job_type: job.job_type,
                job_id: job.id
              });
            }
          });
        }
      });
      
      // Get office receivables
      const { data: receivables, receivablesError } = await supabase
        .from('office_receivables')
        .select('*')
        .eq('status', 'O');

      if (!receivablesError && receivables) {
        receivables.forEach(receivable => {
          openInvoices.push({
            id: receivable.id,
            billing_date: receivable.created_at,
            invoice_number: receivable.invoice_number,
            amount_billed: receivable.amount,
            percentage_billed: 0,
            billing_type: 'office_receivable',
            status: 'O',
            job_name: receivable.job_name,
            job_type: 'office_receivable',
            job_id: receivable.id,
            event_description: receivable.event_description
          });
        });
      }

      // Sort by billing date (most recent first)
      openInvoices.sort((a, b) => new Date(b.billing_date) - new Date(a.billing_date));
      setAllOpenInvoices(openInvoices);
      setShowOpenInvoices(true);

      // Sort by billing date (most recent first)
      openInvoices.sort((a, b) => new Date(b.billing_date) - new Date(a.billing_date));
      setAllOpenInvoices(openInvoices);
      setShowOpenInvoices(true);
    } catch (error) {
      console.error('Error loading open invoices:', error);
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
      if (onRefresh) onRefresh();
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

      // Update the job in state without reloading
      setShowEditBilling(false);
      setEditingEvent(null);
      if (onRefresh) onRefresh();
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
      if (onRefresh) onRefresh();
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
        if (onRefresh) onRefresh();
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
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Business Overview</h2>
          <button
            onClick={loadAllOpenInvoices}
            className="px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-900 text-sm font-bold shadow-md ring-2 ring-gray-600 ring-offset-2"
          >
            View All Open Invoices ({formatCurrency(globalMetrics.totalOpen)})
          </button>
        </div>
        
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
          <div className={`bg-white rounded-lg p-4 shadow-sm border-2 ${globalMetrics.projectedProfitLoss >= 0 ? 'border-green-400' : 'border-red-400'}`}>
            <p className="text-sm text-gray-600 mb-1">Projected P/L</p>
            <p className={`text-2xl font-bold ${globalMetrics.projectedProfitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(globalMetrics.projectedProfitLoss)}
            </p>
            <p className="text-xs text-gray-500">
              Margin: {globalMetrics.projectedCash > 0 ? ((globalMetrics.projectedProfitLoss / globalMetrics.projectedCash) * 100).toFixed(1) : '0.0'}%
            </p>
          </div>
        </div>
      </div>
      {/* Bond Letter Generation Section */}
      <div className="flex justify-end mb-6">
        <button
          onClick={generateBondLetter}
          className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-md shadow hover:bg-purple-700 transition-colors duration-200 flex items-center space-x-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span>Generate Bonding Status Report</span>
        </button>
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
            Active Jobs ({jobCounts.active})
          </button>
          <button
            onClick={() => setActiveTab('planned')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'planned'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Planned Jobs ({jobCounts.planned})
          </button>
          <button
            onClick={() => setActiveTab('legacy')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'legacy'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Legacy Jobs ({jobCounts.legacy})
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
          {planningJobsState.filter(job => !job.is_archived).length === 0 ? (
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
                  {planningJobsState
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

              {legacyJobsState.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                  <p className="text-gray-600">No legacy billing jobs found. Click "Add Legacy Job" to create one.</p>
                </div>
              ) : (
                legacyJobsState.map(job => {
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
                                  if (onRefresh) onRefresh();   
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

              {expensesState.length === 0 ? (
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
                          {Object.values(workingDays).map((days, idx) => (
                            <td key={idx} className="px-6 py-2 text-center text-xs font-semibold text-blue-700">
                              {days}
                            </td>
                          ))}
                          <td className="px-6 py-2 text-center text-xs font-bold text-blue-700 bg-blue-100">
                            {Object.values(workingDays).reduce((sum, days) => sum + days, 0)}
                          </td>
                          ))}
                          <td className="px-6 py-2 text-center text-xs font-bold text-blue-700 bg-blue-100">
                            {Object.values(workingDays).reduce((sum, days) => sum + days, 0)}
                          </td>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {/* Group expenses by category */}
                        {(() => {
                          const expensesByCategory = {};
                          const categoryTotals = {};
                          
                          expensesState.forEach(expense => {
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
                            expensesState.forEach(expense => {
                              monthlyTotals[expense.month - 1] += parseFloat(expense.amount);
                            });
                            
                            return monthlyTotals.map((total, idx) => (
                              <td key={idx} className="px-6 py-4 text-sm text-right text-gray-900">
                                {total > 0 ? formatCurrency(total) : '-'}
                              </td>
                            ));
                          })()}
                          <td className="px-6 py-4 text-sm text-right text-gray-900 bg-gray-200">
                            {formatCurrency(expensesState.reduce((sum, exp) => sum + parseFloat(exp.amount), 0))}
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
                              const dailyAvg = total / workingDays[idx + 1];
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
                              Object.values(workingDays).reduce((sum, days) => sum + days, 0)
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
              <div className="flex justify-end mb-4">
                <button
                  onClick={() => {
                    setEditingReceivable(null);
                    setReceivableForm({
                      jobName: '',
                      eventDescription: '',
                      status: 'O',
                      invoiceNumber: '',
                      amount: ''
                    });
                    setShowReceivableForm(true);
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  + Add Receivable
                </button>
              </div>

              {officeReceivables.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                  <p className="text-gray-600">No office receivables found. Click "Add Receivable" to create one.</p>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Job Name
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Event
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Invoice #
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Amount
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {officeReceivables.map((receivable) => (
                        <tr key={receivable.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {receivable.job_name}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900">
                            {receivable.event_description || '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              receivable.status === 'P' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              {receivable.status === 'P' ? 'Paid' : 'Open'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {receivable.invoice_number || '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                            {formatCurrency(receivable.amount)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              onClick={() => {
                                setEditingReceivable(receivable);
                                setReceivableForm({
                                  jobName: receivable.job_name,
                                  eventDescription: receivable.event_description || '',
                                  status: receivable.status,
                                  invoiceNumber: receivable.invoice_number || '',
                                  amount: receivable.amount.toString()
                                });
                                setShowReceivableForm(true);
                              }}
                              className="text-blue-600 hover:text-blue-900 mr-3"
                            >
                              Edit
                            </button>
                            <button
                              onClick={async () => {
                                if (window.confirm('Are you sure you want to delete this receivable?')) {
                                  try {
                                    const { error } = await supabase
                                      .from('office_receivables')
                                      .delete()
                                      .eq('id', receivable.id);
                                    
                                    if (error) throw error;
                                    
                                    if (onRefresh) onRefresh();
                                  } catch (error) {
                                    console.error('Error deleting receivable:', error);
                                    alert('Error deleting receivable');
                                  }
                                }
                              }}
                              className="text-red-600 hover:text-red-900"
                            >
                              Delete
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

          {/* Shareholder Distributions Tab */}
          {activeTab === 'distributions' && (
            <div className="space-y-6">
{/* Distribution Metrics Dashboard */}
          <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-800">Distribution Analysis</h2>
              
              {/* Reserve Settings */}
              <div className="flex items-center space-x-4 text-sm">
                <div className="flex items-center space-x-2">
                  <label className="text-gray-700 font-medium">Operating Reserve:</label>
                  <select
                    value={reserveSettings.operatingReserveMonths}
                    onChange={(e) => setReserveSettings(prev => ({ ...prev, operatingReserveMonths: parseInt(e.target.value) }))}
                    className="px-3 py-1 border border-gray-300 rounded-md bg-white"
                  >
                    <option value="0">None</option>
                    <option value="1">1 Month</option>
                    <option value="2">2 Months</option>
                  </select>
                </div>
                <div className="flex items-center space-x-2">
                  <label className="text-gray-700 font-medium">Cash Reserve: $</label>
                  <input
                    type="number"
                    value={reserveSettings.cashReserve}
                    onChange={(e) => setReserveSettings(prev => ({ ...prev, cashReserve: parseInt(e.target.value) || 0 }))}
                    className="w-28 px-3 py-1 border border-gray-300 rounded-md"
                    step="10000"
                    placeholder="200000"
                  />
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
{/* Actual (Year-to-Date) */}
              <div className="bg-white rounded-lg p-6 shadow-md border-2 border-green-400">
                <h3 className="text-md font-semibold text-gray-700 mb-3">Actual (Year-to-Date)</h3>
                <p className={`text-3xl font-bold ${
                  ((globalMetrics.totalPaid + globalMetrics.totalOpen) - globalMetrics.currentExpenses - distributionMetrics.ytdDistributions) >= 0 
                    ? 'text-green-600' 
                    : 'text-red-600'
                }`}>
                  {formatCurrency((globalMetrics.totalPaid + globalMetrics.totalOpen) - globalMetrics.currentExpenses - distributionMetrics.ytdDistributions)}
                </p>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">YTD Income (Paid):</span>
                    <span className="font-medium text-green-600">{formatCurrency(globalMetrics.totalPaid)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Open Invoices:</span>
                    <span className="font-medium text-blue-600">+{formatCurrency(globalMetrics.totalOpen)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">YTD Expenses:</span>
                    <span className="font-medium text-red-600">-{formatCurrency(globalMetrics.currentExpenses)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-gray-600 font-semibold">Net Profit:</span>
                    <span className={`font-bold ${
                      ((globalMetrics.totalPaid + globalMetrics.totalOpen) - globalMetrics.currentExpenses) >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {formatCurrency((globalMetrics.totalPaid + globalMetrics.totalOpen) - globalMetrics.currentExpenses)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">YTD Distributions:</span>
                    <span className="font-medium text-blue-600">-{formatCurrency(distributionMetrics.ytdDistributions)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-gray-600 font-semibold">Balance:</span>
                    <span className={`font-bold ${
                      ((globalMetrics.totalPaid + globalMetrics.totalOpen) - globalMetrics.currentExpenses - distributionMetrics.ytdDistributions) >= 0 
                        ? 'text-green-600' 
                        : 'text-red-600'
                    }`}>
                      {formatCurrency((globalMetrics.totalPaid + globalMetrics.totalOpen) - globalMetrics.currentExpenses - distributionMetrics.ytdDistributions)}
                    </span>
                  </div>
                  {/* Show shareholder loan if distributions exceed profit */}
                  {(distributionMetrics.ytdDistributions > ((globalMetrics.totalPaid + globalMetrics.totalOpen) - globalMetrics.currentExpenses)) && (
                    <div className="mt-2 p-2 bg-red-50 rounded border border-red-200">
                      <span className="text-xs text-red-700 font-semibold">
                        ⚠️ Shareholder Loan Required: {formatCurrency(distributionMetrics.ytdDistributions - ((globalMetrics.totalPaid + globalMetrics.totalOpen) - globalMetrics.currentExpenses))}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Projected (Year-End) */}
              <div className="bg-white rounded-lg p-6 shadow-md border-2 border-blue-400">
                <h3 className="text-md font-semibold text-gray-700 mb-3">Projected (Year-End)</h3>
                <p className={`text-3xl font-bold ${distributionMetrics.projected > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                  {formatCurrency(distributionMetrics.projected)}
                </p>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Projected Cash:</span>
                    <span className="font-medium">{formatCurrency(distributionMetrics.projectedYearEnd)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Monthly Collection Rate:</span>
                    <span className="font-medium text-green-600">{formatCurrency(distributionMetrics.monthlyCollectionRate)}/mo</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Open Invoices:</span>
                    <span className="font-medium">{formatCurrency(globalMetrics.totalOpen)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Projected Expenses:</span>
                    <span className="font-medium text-red-600">-{formatCurrency(globalMetrics.projectedExpenses)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Operating Reserve:</span>
                    <span className="font-medium text-orange-600">-{formatCurrency(distributionMetrics.operatingReserve)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Cash Reserve:</span>
                    <span className="font-medium text-orange-600">-{formatCurrency(distributionMetrics.cashReserve)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-gray-600 font-semibold">Available for Distribution:</span>
                    <span className="font-bold text-blue-600">
                      {formatCurrency(distributionMetrics.projected)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Per-Person Breakdown */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-lg p-4 shadow-sm">
                <p className="text-sm text-gray-600">Thomas Davis (10%)</p>
                <p className="text-xs text-gray-500 mb-1">Actual Balance / Projected</p>
                <p className="text-lg font-semibold text-gray-900">
                  ${Math.floor(((globalMetrics.totalPaid + globalMetrics.totalOpen) - globalMetrics.currentExpenses - distributionMetrics.ytdDistributions) * 0.10).toLocaleString()} / 
                  ${Math.floor(distributionMetrics.projected * 0.10).toLocaleString()}
                </p>
              </div>
              <div className="bg-white rounded-lg p-4 shadow-sm">
                <p className="text-sm text-gray-600">Brian Schneider (45%)</p>
                <p className="text-xs text-gray-500 mb-1">Actual Balance / Projected</p>
                <p className="text-lg font-semibold text-gray-900">
                  ${Math.floor(((globalMetrics.totalPaid + globalMetrics.totalOpen) - globalMetrics.currentExpenses - distributionMetrics.ytdDistributions) * 0.45).toLocaleString()} / 
                  ${Math.floor(distributionMetrics.projected * 0.45).toLocaleString()}
                </p>
              </div>
              <div className="bg-white rounded-lg p-4 shadow-sm">
                <p className="text-sm text-gray-600">Kristine Duda (45%)</p>
                <p className="text-xs text-gray-500 mb-1">Actual Balance / Projected</p>
                <p className="text-lg font-semibold text-gray-900">
                  ${Math.floor(((globalMetrics.totalPaid + globalMetrics.totalOpen) - globalMetrics.currentExpenses - distributionMetrics.ytdDistributions) * 0.45).toLocaleString()} / 
                  ${Math.floor(distributionMetrics.projected * 0.45).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
              
              {/* Distributions by Partner */}
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <h3 className="text-lg font-semibold text-gray-900 p-6 pb-4">{new Date().getFullYear()} Distribution Summary</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6">
                  {['Thomas Davis', 'Brian Schneider', 'Kristine Duda'].map(partner => {
                    const ownership = partner === 'Thomas Davis' ? 0.10 : 0.45;
                    const partnerDistributions = distributionsState.filter(d => 
                      d.shareholder_name === partner && d.status === 'paid'
                    );
                    const totalTaken = partnerDistributions.reduce((sum, d) => sum + d.amount, 0);
                    
                    // Calculate the highest distribution level to ensure tax matching
                    const allPartners = ['Thomas Davis', 'Brian Schneider', 'Kristine Duda'];
                    let maxImpliedTotal = 0;
                    
                    allPartners.forEach(p => {
                      const pOwnership = p === 'Thomas Davis' ? 0.10 : 0.45;
                      const pDistributions = distributionsState.filter(d => d.shareholder_name === p && d.status === 'paid');
                      const pTotal = pDistributions.reduce((sum, d) => sum + d.amount, 0);
                      const impliedTotal = pTotal / pOwnership;
                      if (impliedTotal > maxImpliedTotal) {
                        maxImpliedTotal = impliedTotal;
                      }
                    });
                    
                    // Calculate what this partner should have based on the max level
                    const shouldHave = maxImpliedTotal * ownership;
                    const balance = totalTaken - shouldHave;
                    
                    return (
                      <div key={partner} className="border rounded-lg p-4">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h4 className="font-semibold text-gray-900">{partner}</h4>
                            <p className="text-sm text-gray-500">{(ownership * 100).toFixed(0)}% Owner</p>
                          </div>
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            Math.abs(balance) < 1 ? 'bg-green-100 text-green-800' : 
                            balance > 0 ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {Math.abs(balance) < 1 ? 'Balanced' : 
                             balance > 0 ? 'Distributed' : 'Owed'}
                          </span>
                        </div>
                        
                        <div className="space-y-3">
                          <div>
                            <p className="text-sm text-gray-600">Distributions Taken:</p>
                            <p className="text-xl font-bold text-gray-900">{formatCurrency(totalTaken)}</p>
                          </div>
                          
                          <div>
                            <p className="text-sm text-gray-600">Should Have (based on {(ownership * 100).toFixed(0)}%):</p>
                            <p className="text-lg font-semibold text-gray-700">{formatCurrency(shouldHave)}</p>
                          </div>
                          
                          <div className="pt-3 border-t">
                            <p className="text-sm text-gray-600">Balance:</p>
                            <p className={`text-xl font-bold ${
                              Math.abs(balance) < 1 ? 'text-green-600' : 
                              balance > 0 ? 'text-blue-600' : 'text-orange-600'
                            }`}>
                              {balance > 0 ? '+' : ''}{formatCurrency(balance)}
                            </p>
                          </div>
                          
                          {/* All distributions for the year */}
                          <div className="mt-4 max-h-40 overflow-y-auto">
                            <p className="text-xs text-gray-500 mb-2">All {new Date().getFullYear()} Distributions:</p>
                            {partnerDistributions.length === 0 ? (
                              <p className="text-xs text-gray-400 italic">No distributions yet</p>
                            ) : (
                              partnerDistributions.map((dist, idx) => (
                                <div key={idx} className="text-xs text-gray-600 flex justify-between py-1 hover:bg-gray-50">
                                  <span>{new Date(dist.distribution_date).toLocaleDateString()}</span>
                                  <span className="font-medium">{formatCurrency(dist.amount)}</span>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {/* Overall Summary */}
                <div className="bg-gray-50 p-4 m-6 rounded-lg">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm text-gray-600">Total Distributed in {new Date().getFullYear()}:</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {formatCurrency((() => {
                          // Calculate the highest distribution level
                          const allPartners = ['Thomas Davis', 'Brian Schneider', 'Kristine Duda'];
                          let maxImpliedTotal = 0;
                          
                          allPartners.forEach(p => {
                            const pOwnership = p === 'Thomas Davis' ? 0.10 : 0.45;
                            const pDistributions = distributionsState.filter(d => d.shareholder_name === p && d.status === 'paid');
                            const pTotal = pDistributions.reduce((sum, d) => sum + d.amount, 0);
                            const impliedTotal = pTotal / pOwnership;
                            if (impliedTotal > maxImpliedTotal) {
                              maxImpliedTotal = impliedTotal;
                            }
                          });
                          
                          return maxImpliedTotal;
                        })())}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowDistributionForm(true)}
                      className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                    >
                      + Record Distribution
                    </button>
                  </div>
                </div>
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
                <p className="text-sm text-gray-600 mb-1">Percentage: {(editingEvent.percentage_billed * 100).toFixed(2)}%</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Invoice Number
                </label>
                <input
                  type="text"
                  value={editingEvent.invoice_number || ''}
                  onChange={(e) => setEditingEvent(prev => ({ ...prev, invoice_number: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="INV-2025-001"
                />
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

      {/* Open Invoices Modal */}
      {showOpenInvoices && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-8">
          <div className="bg-white rounded-lg p-6 w-full max-w-4xl" style={{ height: '550px' }}>
            <div className="flex justify-between items-center mb-4 flex-shrink-0">
              <h3 className="text-xl font-semibold">All Open Invoices</h3>
              <div className="flex items-center space-x-4">
                <span className="text-lg font-medium text-orange-600">
                  Total: {formatCurrency(allOpenInvoices.reduce((sum, inv) => sum + parseFloat(inv.amount_billed), 0))}
                </span>
                <button
                  onClick={() => setShowOpenInvoices(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div style={{ height: 'calc(100% - 80px)', overflowY: 'auto', overflowX: 'hidden' }}>
              {allOpenInvoices.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-600">No open invoices found.</p>
                </div>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Municipality</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Invoice #</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Open Balance</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Age</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {allOpenInvoices.map((invoice) => {
                      const daysOld = calculateInvoiceAge(invoice.billing_date);
                      const rowColor = getAgingColor(daysOld);
                      
                      return (
                        <tr key={invoice.id} className={rowColor}>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {invoice.job_name}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {invoice.invoice_number}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {new Date(invoice.billing_date).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-orange-600">
                            {formatCurrency(invoice.amount_billed)}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium">
                            <span className={`${
                              daysOld >= 120 ? 'text-red-600 font-bold' :
                              daysOld >= 90 ? 'text-orange-600 font-bold' :
                              daysOld >= 60 ? 'text-yellow-600 font-bold' :
                              'text-gray-600'
                            }`}>
                              {daysOld} days
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {daysOld >= 60 && (
                              <button
                                onClick={() => {
                                  setSelectedReminderInvoice(invoice);
                                  setReminderMessage(generateReminderMessage(invoice, daysOld));
                                  setShowReminderModal(true);
                                }}
                                className="px-2 py-1 text-xs border border-blue-500 text-blue-600 rounded hover:bg-blue-50 bg-transparent"
                              >
                                Send Reminder
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Office Receivable Form Modal */}
      {showReceivableForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">
              {editingReceivable ? 'Edit' : 'Add'} Office Receivable
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Job Name
                </label>
                <input
                  type="text"
                  value={receivableForm.jobName}
                  onChange={(e) => setReceivableForm(prev => ({ ...prev, jobName: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="e.g., Springfield Office Renovation"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Event Description
                </label>
                <textarea
                  value={receivableForm.eventDescription}
                  onChange={(e) => setReceivableForm(prev => ({ ...prev, eventDescription: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  rows="3"
                  placeholder="Reason for invoice..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  value={receivableForm.status}
                  onChange={(e) => setReceivableForm(prev => ({ ...prev, status: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="O">Open</option>
                  <option value="P">Paid</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Invoice Number
                </label>
                <input
                  type="text"
                  value={receivableForm.invoiceNumber}
                  onChange={(e) => setReceivableForm(prev => ({ ...prev, invoiceNumber: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="INV-2025-001"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Amount
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={receivableForm.amount}
                  onChange={(e) => setReceivableForm(prev => ({ ...prev, amount: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="1500.00"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowReceivableForm(false);
                  setEditingReceivable(null);
                  setReceivableForm({
                    jobName: '',
                    eventDescription: '',
                    status: 'O',
                    invoiceNumber: '',
                    amount: ''
                  });
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    const data = {
                      job_name: receivableForm.jobName,
                      event_description: receivableForm.eventDescription,
                      status: receivableForm.status,
                      invoice_number: receivableForm.invoiceNumber,
                      amount: parseFloat(receivableForm.amount)
                    };

                    if (editingReceivable) {
                      const { error } = await supabase
                        .from('office_receivables')
                        .update(data)
                        .eq('id', editingReceivable.id);
                      
                      if (error) throw error;
                    } else {
                      const { error } = await supabase
                        .from('office_receivables')
                        .insert(data);
                      
                      if (error) throw error;
                    }
                    
                    setShowReceivableForm(false);
                    setEditingReceivable(null);
                    setReceivableForm({
                      jobName: '',
                      eventDescription: '',
                      status: 'O',
                      invoiceNumber: '',
                      amount: ''
                    });
                    if (onRefresh) onRefresh();
                  } catch (error) {
                    console.error('Error saving receivable:', error);
                    alert('Error saving receivable');
                  }
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                {editingReceivable ? 'Update' : 'Add'} Receivable
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Distribution Form Modal */}
      {showDistributionForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Record Distribution</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Who is taking the distribution?
                </label>
                <select
                  value={distributionForm.shareholder}
                  onChange={(e) => setDistributionForm(prev => ({ ...prev, shareholder: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="">Select shareholder...</option>
                  <option value="Thomas Davis">Thomas Davis (10%)</option>
                  <option value="Brian Schneider">Brian Schneider (45%)</option>
                  <option value="Kristine Duda">Kristine Duda (45%)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Amount Taken
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={distributionForm.amount}
                  onChange={(e) => setDistributionForm(prev => ({ ...prev, amount: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="10000.00"
                />
                {distributionForm.amount && distributionForm.shareholder && (
                  <div className="mt-2 p-3 bg-blue-50 rounded-md text-sm">
                    <p className="text-blue-900">
                      Recording distribution of {formatCurrency(parseFloat(distributionForm.amount))} for {distributionForm.shareholder}
                    </p>
                  </div>
                )}      
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={distributionForm.date}
                  onChange={(e) => setDistributionForm(prev => ({ ...prev, date: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  value={distributionForm.notes}
                  onChange={(e) => setDistributionForm(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  rows="2"
                  placeholder="Purpose of distribution..."
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowDistributionForm(false);
                  setDistributionForm({
                    shareholder: '',
                    amount: '',
                    date: new Date().toISOString().split('T')[0],
                    notes: ''
                  });
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    if (!distributionForm.shareholder || !distributionForm.amount) {
                      alert('Please select a shareholder and enter an amount');
                      return;
                    }

                    const amount = parseFloat(distributionForm.amount);
                    const date = new Date(distributionForm.date);
                    
                    // Only create one record for the actual distribution
                    const { error } = await supabase
                      .from('shareholder_distributions')
                      .insert({
                        shareholder_name: distributionForm.shareholder,
                        ownership_percentage: distributionForm.shareholder === 'Thomas Davis' ? 10 : 45,
                        distribution_date: distributionForm.date,
                        amount: amount,
                        status: 'paid',
                        year: date.getFullYear(),
                        month: date.getMonth() + 1,
                        notes: distributionForm.notes
                      });
                    
                    if (error) throw error;
                    
                    setShowDistributionForm(false);
                    setDistributionForm({
                      shareholder: '',
                      amount: '',
                      date: new Date().toISOString().split('T')[0],
                      notes: ''
                    });
                    if (onRefresh) onRefresh();
                  } catch (error) {
                    console.error('Error recording distribution:', error);
                    alert('Error recording distribution');
                  }
                }}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                Record Distribution
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Reminder Modal */}
      {showReminderModal && selectedReminderInvoice && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Payment Reminder</h2>
            
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">
                Invoice: {selectedReminderInvoice.invoice_number} - {selectedReminderInvoice.job_name}
              </p>
              <p className="text-sm text-gray-600">
                Days Outstanding: {calculateInvoiceAge(selectedReminderInvoice.billing_date)}
              </p>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Message Preview (you can edit before copying):
              </label>
              <textarea
                value={reminderMessage}
                onChange={(e) => setReminderMessage(e.target.value)}
                className="w-full h-64 p-3 border border-gray-300 rounded-md"
              />
            </div>
            
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => {
                  setShowReminderModal(false);
                  setSelectedReminderInvoice(null);
                  setReminderMessage('');
                }}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(reminderMessage);
                  alert('Reminder message copied to clipboard!');
                  setShowReminderModal(false);
                  setSelectedReminderInvoice(null);
                  setReminderMessage('');
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Copy to Clipboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingManagement;
