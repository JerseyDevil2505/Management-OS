import React, { useState, useEffect } from 'react';
import { jobService, planningJobService, employeeService, utilityService } from '../lib/supabaseClient';

function AdminJobManagement({ onJobSelect, jobMetrics = {}, isLoadingMetrics = false }) {
  const [activeTab, setActiveTab] = useState('active');
  const [jobs, setJobs] = useState([]);
  const [planningJobs, setPlanningJobs] = useState([]);
  const [archivedJobs, setArchivedJobs] = useState([]);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    employees: 0,
    jobs: 0,
    properties: 0,
    propertiesBreakdown: { total: 0, residential: 0, commercial: 0, other: 0 }
  });

  const [editingJob, setEditingJob] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newJob, setNewJob] = useState({
    name: '',
    municipality: '',
    ccdd: '',
    county: '',
    state: 'NJ',
    vendor: '',
    dueDate: '',
    assignedManagers: []
  });

  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [selectedJobForAssignment, setSelectedJobForAssignment] = useState(null);
  const [assignmentFile, setAssignmentFile] = useState(null);
  const [assignmentProgress, setAssignmentProgress] = useState(null);
  const [forceQuit, setForceQuit] = useState(false);

  const [hpiData, setHpiData] = useState({});
  const [showHpiModal, setShowHpiModal] = useState(false);
  const [selectedCounty, setSelectedCounty] = useState('');
  const [hpiEntries, setHpiEntries] = useState([]);

  const [newPlanningJob, setNewPlanningJob] = useState({
    ccddCode: '',
    municipality: '',
    end_date: '',
    comments: ''
  });

  const [editingPlanningJob, setEditingPlanningJob] = useState(null);

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [jobsData, planningData, managersData, statsData] = await Promise.all([
          jobService.getAll(),
          planningJobService.getAll(),
          employeeService.getManagers(),
          utilityService.getStats()
        ]);

        // Separate jobs by status
        const activeJobs = jobsData.filter(job => job.status === 'active');
        const archived = jobsData.filter(job => job.status === 'archived');

        setJobs(activeJobs);
        setPlanningJobs(planningData);
        setArchivedJobs(archived);
        setManagers(managersData);
        setStats(statsData);

        console.log(`📊 Loaded ${activeJobs.length} active jobs, ${archived.length} archived jobs`);
      } catch (error) {
        console.error('Error loading admin data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // ENHANCED: Get job metrics with fallback to live data or defaults
  const getJobMetricsForTile = (job) => {
    // First, try to get metrics from App.js data hub (fast path)
    if (jobMetrics[job.id] && jobMetrics[job.id].isProcessed) {
      return jobMetrics[job.id];
    }

    // Fallback: Check if job has workflow_stats directly
    if (job.workflowStats && job.workflowStats.totalRecords) {
      return {
        totalProperties: job.workflowStats.totalRecords || 0,
        propertiesInspected: job.workflowStats.validInspections || 0,
        entryRate: job.workflowStats.jobEntryRate || 0,
        refusalRate: job.workflowStats.jobRefusalRate || 0,
        commercialComplete: job.workflowStats.commercialCompletePercent || 0,
        pricingComplete: job.workflowStats.pricingCompletePercent || 0,
        lastProcessed: job.workflowStats.lastProcessed,
        isProcessed: true
      };
    }

    // Final fallback: Use job properties and basic calculations
    const totalProps = job.totalProperties || 0;
    const inspectedProps = job.inspectedProperties || 0;
    const entryRate = totalProps > 0 ? Math.round((inspectedProps / totalProps) * 100) : 0;

    return {
      totalProperties: totalProps,
      propertiesInspected: inspectedProps,
      entryRate: entryRate,
      refusalRate: 0,
      commercialComplete: 0,
      pricingComplete: 0,
      lastProcessed: null,
      isProcessed: false
    };
  };

  // Handle job creation
  const handleCreateJob = async (e) => {
    e.preventDefault();
    try {
      const jobData = {
        ...newJob,
        status: 'active'
      };

      const createdJob = await jobService.create(jobData);
      
      setJobs(prev => [createdJob, ...prev]);
      setShowCreateForm(false);
      setNewJob({
        name: '',
        municipality: '',
        ccdd: '',
        county: '',
        state: 'NJ',
        vendor: '',
        dueDate: '',
        assignedManagers: []
      });

      console.log('✅ Job created successfully:', createdJob);
    } catch (error) {
      console.error('❌ Error creating job:', error);
      alert('Failed to create job. Please try again.');
    }
  };

  // Handle job updates
  const handleSaveJob = async () => {
    if (!editingJob) return;

    try {
      const updatedJob = await jobService.update(editingJob.id, editingJob);
      
      setJobs(prev => prev.map(job => 
        job.id === editingJob.id ? { ...job, ...editingJob } : job
      ));
      
      setEditingJob(null);
      console.log('✅ Job updated successfully');
    } catch (error) {
      console.error('❌ Error updating job:', error);
      alert('Failed to update job. Please try again.');
    }
  };

  // Handle job deletion
  const handleDeleteJob = async (jobId) => {
    if (!window.confirm('Are you sure you want to delete this job? This action cannot be undone.')) {
      return;
    }

    try {
      await jobService.delete(jobId);
      setJobs(prev => prev.filter(job => job.id !== jobId));
      setArchivedJobs(prev => prev.filter(job => job.id !== jobId));
      console.log('✅ Job deleted successfully');
    } catch (error) {
      console.error('❌ Error deleting job:', error);
      alert('Failed to delete job. Please try again.');
    }
  };

  // Handle property assignment
  const handleAssignProperties = async () => {
    if (!assignmentFile || !selectedJobForAssignment) return;

    setAssignmentProgress({
      step: 'Reading file...',
      progress: 0,
      logs: []
    });

    try {
      const text = await assignmentFile.text();
      const rows = text.split('\n').filter(row => row.trim());
      
      if (rows.length < 2) {
        throw new Error('CSV file must have at least a header row and one data row');
      }

      const headers = rows[0].split(',').map(h => h.trim().toLowerCase());
      
      const requiredFields = ['property_block', 'property_lot', 'property_qualifier'];
      const missingFields = requiredFields.filter(field => !headers.includes(field));
      
      if (missingFields.length > 0) {
        throw new Error(`Missing required columns: ${missingFields.join(', ')}`);
      }

      setAssignmentProgress({
        step: 'Processing assignments...',
        progress: 25,
        logs: [`📁 Found ${rows.length - 1} properties to assign`]
      });

      // Process assignments (simplified for display)
      const assignments = [];
      for (let i = 1; i < rows.length; i++) {
        if (forceQuit) {
          console.log('🛑 Force quit requested, stopping assignment process');
          break;
        }

        const values = rows[i].split(',');
        const assignment = {};
        
        headers.forEach((header, index) => {
          assignment[header] = values[index]?.trim() || '';
        });

        assignments.push(assignment);

        if (i % 100 === 0) {
          setAssignmentProgress(prev => ({
            ...prev,
            progress: 25 + Math.round((i / (rows.length - 1)) * 50),
            logs: [...prev.logs, `✅ Processed ${i} of ${rows.length - 1} assignments`]
          }));
        }
      }

      if (!forceQuit) {
        setAssignmentProgress({
          step: 'Finalizing...',
          progress: 100,
          logs: [`🎉 Successfully assigned ${assignments.length} properties`]
        });

        // Update job with assignment info
        const updatedJob = await jobService.update(selectedJobForAssignment.id, {
          has_property_assignments: true,
          assigned_property_count: assignments.length,
          assigned_has_commercial: assignments.some(a => ['4A', '4B', '4C'].includes(a.property_m4_class))
        });

        setJobs(prev => prev.map(job => 
          job.id === selectedJobForAssignment.id ? { ...job, ...updatedJob } : job
        ));
      }

    } catch (error) {
      console.error('❌ Assignment error:', error);
      setAssignmentProgress({
        step: 'Error occurred',
        progress: 0,
        logs: [`❌ Error: ${error.message}`]
      });
    }
  };

  // Handle planning job operations
  const handleCreatePlanningJob = async (e) => {
    e.preventDefault();
    try {
      const created = await planningJobService.create(newPlanningJob);
      setPlanningJobs(prev => [created, ...prev]);
      setNewPlanningJob({ ccddCode: '', municipality: '', end_date: '', comments: '' });
    } catch (error) {
      console.error('❌ Error creating planning job:', error);
    }
  };

  const handleUpdatePlanningJob = async (id, updates) => {
    try {
      await planningJobService.update(id, updates);
      setPlanningJobs(prev => prev.map(pj => pj.id === id ? { ...pj, ...updates } : pj));
      setEditingPlanningJob(null);
    } catch (error) {
      console.error('❌ Error updating planning job:', error);
    }
  };

  const handleDeletePlanningJob = async (id) => {
    if (!window.confirm('Delete this planning job?')) return;
    
    try {
      await planningJobService.delete(id);
      setPlanningJobs(prev => prev.filter(pj => pj.id !== id));
    } catch (error) {
      console.error('❌ Error deleting planning job:', error);
    }
  };

  // County HPI Management
  const handleHpiUpdate = (county, year, value) => {
    setHpiData(prev => ({
      ...prev,
      [county]: {
        ...prev[county],
        [year]: value
      }
    }));
  };

  const renderJobTile = (job) => {
    const metrics = getJobMetricsForTile(job);
    const isAnalyticsReady = metrics.isProcessed;

    return (
      <div
        key={job.id}
        className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow border border-gray-200"
      >
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              {job.name}
            </h3>
            <p className="text-sm text-gray-600">
              {job.municipality} • CCDD: {job.ccddCode}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {job.vendor} • Due: {job.dueDate ? new Date(job.dueDate).toLocaleDateString() : 'Not set'}
            </p>
          </div>
          
          {isAnalyticsReady && (
            <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-medium">
              Analytics Ready
            </span>
          )}
        </div>

        {/* Job Metrics Grid */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-blue-50 p-3 rounded-lg">
            <p className="text-xs text-blue-600 font-medium">Total Properties</p>
            <p className="text-lg font-bold text-blue-800">
              {metrics.totalProperties.toLocaleString()}
            </p>
          </div>
          
          <div className="bg-green-50 p-3 rounded-lg">
            <p className="text-xs text-green-600 font-medium">Inspected</p>
            <p className="text-lg font-bold text-green-800">
              {metrics.propertiesInspected.toLocaleString()}
            </p>
          </div>
          
          <div className="bg-purple-50 p-3 rounded-lg">
            <p className="text-xs text-purple-600 font-medium">Entry Rate</p>
            <p className="text-lg font-bold text-purple-800">
              {metrics.entryRate}%
            </p>
          </div>
          
          <div className="bg-orange-50 p-3 rounded-lg">
            <p className="text-xs text-orange-600 font-medium">Commercial</p>
            <p className="text-lg font-bold text-orange-800">
              {metrics.commercialComplete}%
            </p>
          </div>
        </div>

        {/* Assignment Status */}
        {job.has_property_assignments && (
          <div className="bg-gray-50 p-2 rounded mb-4">
            <p className="text-xs text-gray-600">
              📋 {job.assignedPropertyCount?.toLocaleString() || 'Unknown'} properties assigned
              {job.assigned_has_commercial && ' • Includes commercial properties'}
            </p>
          </div>
        )}

        {/* Manager Assignments */}
        {job.assignedManagers && job.assignedManagers.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-gray-600 mb-1">Assigned Managers:</p>
            <div className="flex flex-wrap gap-1">
              {job.assignedManagers.map(manager => (
                <span key={manager.id} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
                  {manager.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex space-x-2">
          <button
            onClick={() => onJobSelect(job)}
            className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            Open Job
          </button>
          
          <button
            onClick={() => setEditingJob({ ...job })}
            className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors text-sm"
          >
            ✏️
          </button>
          
          <button
            onClick={() => {
              setSelectedJobForAssignment(job);
              setShowAssignmentModal(true);
            }}
            className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors text-sm"
          >
            📋
          </button>
          
          <button
            onClick={() => handleDeleteJob(job.id)}
            className="px-3 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50 transition-colors text-sm"
          >
            🗑️
          </button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-gray-600">Loading jobs...</span>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header with Stats */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Job Management</h1>
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            + Create New Job
          </button>
        </div>

        {/* Enhanced Stats Banner */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <div className="bg-gradient-to-r from-blue-500 to-blue-600 p-6 rounded-lg text-white">
            <h3 className="text-sm font-medium opacity-90">Active Jobs</h3>
            <p className="text-3xl font-bold">{jobs.length}</p>
            {isLoadingMetrics && (
              <p className="text-xs opacity-75 mt-1">
                <div className="inline-block animate-spin rounded-full h-3 w-3 border-b border-white mr-1"></div>
                Loading analytics...
              </p>
            )}
          </div>
          
          <div className="bg-gradient-to-r from-green-500 to-green-600 p-6 rounded-lg text-white">
            <h3 className="text-sm font-medium opacity-90">Total Properties</h3>
            <p className="text-3xl font-bold">{stats.propertiesBreakdown.total.toLocaleString()}</p>
            <p className="text-xs opacity-75 mt-1">
              {Object.values(jobMetrics).filter(m => m.isProcessed).length} jobs with analytics
            </p>
          </div>
          
          <div className="bg-gradient-to-r from-purple-500 to-purple-600 p-6 rounded-lg text-white">
            <h3 className="text-sm font-medium opacity-90">Employees</h3>
            <p className="text-3xl font-bold">{stats.employees}</p>
            <p className="text-xs opacity-75 mt-1">{managers.length} managers</p>
          </div>
          
          <div className="bg-gradient-to-r from-orange-500 to-orange-600 p-6 rounded-lg text-white">
            <h3 className="text-sm font-medium opacity-90">Property Breakdown</h3>
            <p className="text-xl font-bold">{stats.propertiesBreakdown.residential.toLocaleString()} Res</p>
            <p className="text-sm opacity-75">{stats.propertiesBreakdown.commercial.toLocaleString()} Com • {stats.propertiesBreakdown.other.toLocaleString()} Other</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'active', label: 'Active Jobs', count: jobs.length },
            { id: 'planning', label: 'Planning Jobs', count: planningJobs.length },
            { id: 'archived', label: 'Archived Jobs', count: archivedJobs.length },
            { id: 'hpi', label: 'County HPI', count: Object.keys(hpiData).length },
            { id: 'managers', label: 'Manager Assignments', count: managers.length }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={`ml-2 py-0.5 px-2 rounded-full text-xs ${
                  activeTab === tab.id
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'active' && (
        <div className="space-y-6">
          {jobs.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 text-lg">No active jobs found.</p>
              <button
                onClick={() => setShowCreateForm(true)}
                className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create Your First Job
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {jobs.map(renderJobTile)}
            </div>
          )}
        </div>
      )}

      {/* Planning Jobs Tab */}
      {activeTab === 'planning' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4">Create Planning Job</h2>
            <form onSubmit={handleCreatePlanningJob} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <input
                type="text"
                placeholder="CCDD Code"
                value={newPlanningJob.ccddCode}
                onChange={(e) => setNewPlanningJob(prev => ({ ...prev, ccddCode: e.target.value }))}
                className="border border-gray-300 rounded-lg px-3 py-2"
                required
              />
              <input
                type="text"
                placeholder="Municipality"
                value={newPlanningJob.municipality}
                onChange={(e) => setNewPlanningJob(prev => ({ ...prev, municipality: e.target.value }))}
                className="border border-gray-300 rounded-lg px-3 py-2"
                required
              />
              <input
                type="date"
                value={newPlanningJob.end_date}
                onChange={(e) => setNewPlanningJob(prev => ({ ...prev, end_date: e.target.value }))}
                className="border border-gray-300 rounded-lg px-3 py-2"
                required
              />
              <button
                type="submit"
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
              >
                Add Planning Job
              </button>
            </form>
            <textarea
              placeholder="Comments (optional)"
              value={newPlanningJob.comments}
              onChange={(e) => setNewPlanningJob(prev => ({ ...prev, comments: e.target.value }))}
              className="mt-4 w-full border border-gray-300 rounded-lg px-3 py-2"
              rows="2"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {planningJobs.map(pj => (
              <div key={pj.id} className="bg-white p-4 rounded-lg shadow-md">
                {editingPlanningJob?.id === pj.id ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editingPlanningJob.ccddCode}
                      onChange={(e) => setEditingPlanningJob(prev => ({ ...prev, ccddCode: e.target.value }))}
                      className="w-full border rounded px-2 py-1"
                    />
                    <input
                      type="text"
                      value={editingPlanningJob.municipality}
                      onChange={(e) => setEditingPlanningJob(prev => ({ ...prev, municipality: e.target.value }))}
                      className="w-full border rounded px-2 py-1"
                    />
                    <input
                      type="date"
                      value={editingPlanningJob.end_date}
                      onChange={(e) => setEditingPlanningJob(prev => ({ ...prev, end_date: e.target.value }))}
                      className="w-full border rounded px-2 py-1"
                    />
                    <textarea
                      value={editingPlanningJob.comments || ''}
                      onChange={(e) => setEditingPlanningJob(prev => ({ ...prev, comments: e.target.value }))}
                      className="w-full border rounded px-2 py-1"
                      rows="2"
                    />
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleUpdatePlanningJob(pj.id, editingPlanningJob)}
                        className="bg-green-600 text-white px-3 py-1 rounded text-sm"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingPlanningJob(null)}
                        className="bg-gray-600 text-white px-3 py-1 rounded text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <h3 className="font-semibold">{pj.ccddCode}</h3>
                    <p className="text-sm text-gray-600">{pj.municipality}</p>
                    <p className="text-xs text-gray-500">Due: {new Date(pj.end_date).toLocaleDateString()}</p>
                    {pj.comments && <p className="text-xs text-gray-700 mt-2">{pj.comments}</p>}
                    <div className="flex space-x-2 mt-3">
                      <button
                        onClick={() => setEditingPlanningJob({ ...pj })}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeletePlanningJob(pj.id)}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Archived Jobs Tab */}
      {activeTab === 'archived' && (
        <div className="space-y-6">
          {archivedJobs.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 text-lg">No archived jobs found.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {archivedJobs.map(job => (
                <div
                  key={job.id}
                  className="bg-gray-50 rounded-lg shadow-md p-6 border border-gray-200 opacity-75"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-700 mb-1">
                        {job.name}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {job.municipality} • CCDD: {job.ccddCode}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Archived • {job.vendor}
                      </p>
                    </div>
                    
                    <span className="bg-gray-200 text-gray-600 px-2 py-1 rounded-full text-xs font-medium">
                      Archived
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-gray-100 p-3 rounded-lg">
                      <p className="text-xs text-gray-500 font-medium">Total Properties</p>
                      <p className="text-lg font-bold text-gray-600">
                        {(job.totalProperties || 0).toLocaleString()}
                      </p>
                    </div>
                    
                    <div className="bg-gray-100 p-3 rounded-lg">
                      <p className="text-xs text-gray-500 font-medium">Completed</p>
                      <p className="text-lg font-bold text-gray-600">
                        {(job.inspectedProperties || 0).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex space-x-2">
                    <button
                      onClick={() => onJobSelect(job)}
                      className="flex-1 bg-gray-400 text-white px-4 py-2 rounded hover:bg-gray-500 transition-colors text-sm font-medium"
                    >
                      View Archive
                    </button>
                    
                    <button
                      onClick={() => handleDeleteJob(job.id)}
                      className="px-3 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50 transition-colors text-sm"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* County HPI Tab */}
      {activeTab === 'hpi' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4">County HPI Management</h2>
            <p className="text-gray-600 mb-4">
              Manage Housing Price Index data for property valuation analysis.
            </p>
            <button
              onClick={() => setShowHpiModal(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Manage HPI Data
            </button>
          </div>
        </div>
      )}

      {/* Manager Assignments Tab */}
      {activeTab === 'managers' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4">Manager Workload Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {managers.map(manager => {
                const assignedJobs = jobs.filter(job => 
                  job.assignedManagers?.some(am => am.id === manager.id)
                );
                const totalProperties = assignedJobs.reduce((sum, job) => sum + (job.totalProperties || 0), 0);
                const completedProperties = assignedJobs.reduce((sum, job) => sum + (job.inspectedProperties || 0), 0);
                const completionRate = totalProperties > 0 ? Math.round((completedProperties / totalProperties) * 100) : 0;

                return (
                  <div key={manager.id} className="border border-gray-200 rounded-lg p-4">
                    <h3 className="font-semibold text-gray-900">{manager.first_name} {manager.last_name}</h3>
                    <p className="text-sm text-gray-600">{manager.role} • {manager.region}</p>
                    
                    <div className="mt-3 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Assigned Jobs:</span>
                        <span className="font-medium">{assignedJobs.length}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Total Properties:</span>
                        <span className="font-medium">{totalProperties.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Completion Rate:</span>
                        <span className={`font-medium ${completionRate >= 80 ? 'text-green-600' : completionRate >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {completionRate}%
                        </span>
                      </div>
                    </div>

                    {assignedJobs.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <p className="text-xs text-gray-500 mb-1">Assigned Jobs:</p>
                        <div className="space-y-1">
                          {assignedJobs.map(job => (
                            <p key={job.id} className="text-xs text-gray-700">
                              • {job.name} ({(job.totalProperties || 0).toLocaleString()} props)
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Create Job Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold mb-4">Create New Job</h2>
            <form onSubmit={handleCreateJob} className="space-y-4">
              <input
                type="text"
                placeholder="Job Name"
                value={newJob.name}
                onChange={(e) => setNewJob(prev => ({ ...prev, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                required
              />
              <input
                type="text"
                placeholder="Municipality"
                value={newJob.municipality}
                onChange={(e) => setNewJob(prev => ({ ...prev, municipality: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                required
              />
              <input
                type="text"
                placeholder="CCDD Code"
                value={newJob.ccdd}
                onChange={(e) => setNewJob(prev => ({ ...prev, ccdd: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                required
              />
              <input
                type="text"
                placeholder="County"
                value={newJob.county}
                onChange={(e) => setNewJob(prev => ({ ...prev, county: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                required
              />
              <select
                value={newJob.vendor}
                onChange={(e) => setNewJob(prev => ({ ...prev, vendor: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                required
              >
                <option value="">Select Vendor</option>
                <option value="BRT">BRT</option>
                <option value="Microsystems">Microsystems</option>
              </select>
              <input
                type="date"
                value={newJob.dueDate}
                onChange={(e) => setNewJob(prev => ({ ...prev, dueDate: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
              
              <div className="flex space-x-3">
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Create Job
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="flex-1 bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Job Modal */}
      {editingJob && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold mb-4">Edit Job</h2>
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Job Name"
                value={editingJob.name}
                onChange={(e) => setEditingJob(prev => ({ ...prev, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
              <input
                type="text"
                placeholder="Municipality"
                value={editingJob.municipality}
                onChange={(e) => setEditingJob(prev => ({ ...prev, municipality: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
              <input
                type="text"
                placeholder="CCDD Code"
                value={editingJob.ccddCode}
                onChange={(e) => setEditingJob(prev => ({ ...prev, ccddCode: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
              <input
                type="text"
                placeholder="County"
                value={editingJob.county}
                onChange={(e) => setEditingJob(prev => ({ ...prev, county: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
              <select
                value={editingJob.vendor}
                onChange={(e) => setEditingJob(prev => ({ ...prev, vendor: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                <option value="">Select Vendor</option>
                <option value="BRT">BRT</option>
                <option value="Microsystems">Microsystems</option>
              </select>
              <input
                type="date"
                value={editingJob.dueDate}
                onChange={(e) => setEditingJob(prev => ({ ...prev, dueDate: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
              
              <div className="flex space-x-3">
                <button
                  onClick={handleSaveJob}
                  className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => setEditingJob(null)}
                  className="flex-1 bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Property Assignment Modal */}
      {showAssignmentModal && selectedJobForAssignment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-2xl w-full mx-4">
            <h2 className="text-xl font-semibold mb-4">
              Assign Properties - {selectedJobForAssignment.name}
            </h2>
            
            {!assignmentProgress ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Upload CSV File
                  </label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => setAssignmentFile(e.target.files[0])}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Required columns: property_block, property_lot, property_qualifier
                  </p>
                </div>
                
                <div className="flex space-x-3">
                  <button
                    onClick={handleAssignProperties}
                    disabled={!assignmentFile}
                    className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400"
                  >
                    Process Assignments
                  </button>
                  <button
                    onClick={() => {
                      setShowAssignmentModal(false);
                      setSelectedJobForAssignment(null);
                      setAssignmentFile(null);
                    }}
                    className="flex-1 bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium text-gray-900">{assignmentProgress.step}</h3>
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${assignmentProgress.progress}%` }}
                    ></div>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{assignmentProgress.progress}% complete</p>
                </div>

                <div className="max-h-40 overflow-y-auto bg-gray-50 p-3 rounded border">
                  {assignmentProgress.logs.map((log, index) => (
                    <p key={index} className="text-sm text-gray-700 mb-1">{log}</p>
                  ))}
                </div>

                <div className="flex space-x-3">
                  {assignmentProgress.progress < 100 && (
                    <button
                      onClick={() => setForceQuit(true)}
                      className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
                    >
                      Force Quit
                    </button>
                  )}
                  
                  {assignmentProgress.progress === 100 && (
                    <button
                      onClick={() => {
                        setShowAssignmentModal(false);
                        setSelectedJobForAssignment(null);
                        setAssignmentFile(null);
                        setAssignmentProgress(null);
                        setForceQuit(false);
                      }}
                      className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Done
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminJobManagement;
