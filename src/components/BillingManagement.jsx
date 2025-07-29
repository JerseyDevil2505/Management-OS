import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const BillingManagement = () => {
  const [activeTab, setActiveTab] = useState('active');
  const [jobs, setJobs] = useState([]);
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
    notes: ''
  });

  useEffect(() => {
    loadJobs();
  }, [activeTab]);

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
        const status = parts[2] === 'D' ? 'P' : ''; // D becomes P (Paid), blank stays blank
        const invoiceNumber = parts[3];
        // Remove $ and commas from amounts
        const totalAmount = parseFloat(parts[4].replace(/[$,]/g, ''));
        const retainerAmount = parseFloat(parts[5].replace(/[$,]/g, ''));
        // Skip parts[6] which seems to be $0.00
        const amountBilled = parseFloat(parts[7].replace(/[$,]/g, ''));
        
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
      // First, create the contract
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
        second_year_appeals_amount: parseFloat(contractSetup.contractAmount) * contractSetup.secondYearAppealsPercentage
      };

      const { error: contractError } = await supabase
        .from('job_contracts')
        .upsert(contractData);

      if (contractError) throw contractError;

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
      loadJobs();
    } catch (error) {
      console.error('Error setting up contract:', error);
    }
  };

  const handleAddBillingEvent = async () => {
    if (!selectedJob || !selectedJob.job_contracts?.[0]) return;
    
    try {
      const contract = selectedJob.job_contracts[0];
      const percentageDecimal = parseFloat(billingForm.percentageBilled) / 100;
      const totalAmount = contract.contract_amount * percentageDecimal;
      const retainerAmount = totalAmount * contract.retainer_percentage;
      const amountBilled = totalAmount - retainerAmount;
      
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

      setShowBillingForm(false);
      setBillingForm({
        billingDate: new Date().toISOString().split('T')[0],
        percentageBilled: '',
        status: 'P',
        invoiceNumber: '',
        notes: ''
      });
      loadJobs();
    } catch (error) {
      console.error('Error adding billing event:', error);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount || 0);
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
                jobs.map(job => {
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
                            <button
                              onClick={() => {
                                setSelectedJob(job);
                                setShowBillingForm(true);
                              }}
                              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                            >
                              Add Billing Event
                            </button>
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
                            <p className="text-lg font-semibold">{totals.totalPercentageBilled.toFixed(1)}%</p>
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
                              {job.billing_events.map(event => (
                                <tr key={event.id}>
                                  <td className="px-4 py-2 text-sm text-gray-900">
                                    {new Date(event.billing_date).toLocaleDateString()}
                                  </td>
                                  <td className="px-4 py-2 text-sm text-gray-900">
                                    {(event.percentage_billed * 100).toFixed(1)}%
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

          {/* Legacy Jobs Tab */}
          {activeTab === 'legacy' && (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <p className="text-gray-600">Legacy billing jobs will appear here</p>
            </div>
          )}
        </>
      )}

      {/* Contract Setup Modal */}
      {showContractSetup && selectedJob && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Setup Contract: {selectedJob.job_name}</h3>
            
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
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Add Billing Event: {selectedJob.job_name}</h3>
            
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

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowBillingForm(false);
                  setBillingForm({
                    billingDate: new Date().toISOString().split('T')[0],
                    percentageBilled: '',
                    status: 'P',
                    invoiceNumber: '',
                    notes: ''
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
                Add Billing Event
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingManagement;
