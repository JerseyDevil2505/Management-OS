import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Users, Calendar, MapPin, Building, TrendingUp, DollarSign, AlertTriangle, CheckCircle, Clock, Download, Upload, Settings, Eye, Filter, Search } from 'lucide-react';
import { supabase, jobService } from '../lib/supabaseClient';

const AdminJobManagement = ({ onJobSelect, jobMetrics = {}, isLoadingMetrics = false }) => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  // Load jobs from database
  const loadJobs = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: jobsData, error: jobsError } = await supabase
        .from('jobs')
        .select(`
          *,
          employees!jobs_assigned_manager_fkey(first_name, last_name),
          job_assignments(
            id,
            employee_id,
            role,
            assigned_date,
            employees(first_name, last_name, initials)
          )
        `)
        .order('created_at', { ascending: false });

      if (jobsError) throw jobsError;

      console.log('📊 AdminJobManagement: Loaded jobs from database', jobsData?.length);
      setJobs(jobsData || []);

    } catch (error) {
      console.error('❌ Error loading jobs:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  // ENHANCED: Display metrics with fallback to "-" for unprocessed jobs
  const displayMetric = (jobId, metricName, isPercentage = false, defaultValue = null) => {
    const metrics = jobMetrics[jobId];
    
    if (!metrics) {
      return defaultValue !== null ? defaultValue : '-';
    }

    // Total properties is always available (from property_records count)
    if (metricName === 'totalProperties') {
      return metrics.totalProperties?.toLocaleString() || '0';
    }

    // Properties inspected shows actual count when processed
    if (metricName === 'propertiesInspected') {
      return metrics.isProcessed ? 
        (metrics.propertiesInspected?.toLocaleString() || '0') : 
        '-';
    }

    // Analytics metrics show "-" until processed
    if (!metrics.isProcessed) {
      return '-';
    }

    const value = metrics[metricName];
    if (value === null || value === undefined) {
      return '-';
    }

    return isPercentage ? `${value}%` : value.toLocaleString();
  };

  // ENHANCED: Get completion display for properties inspected
  const getCompletionDisplay = (jobId) => {
    const metrics = jobMetrics[jobId];
    
    if (!metrics || !metrics.isProcessed) {
      const totalProperties = metrics?.totalProperties || 0;
      return {
        current: '-',
        total: totalProperties.toLocaleString(),
        percentage: '-',
        isComplete: false
      };
    }

    const current = metrics.propertiesInspected || 0;
    const total = metrics.totalProperties || 0;
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

    return {
      current: current.toLocaleString(),
      total: total.toLocaleString(),
      percentage: `${percentage}%`,
      isComplete: percentage === 100
    };
  };

  // Filter and search jobs
  const filteredJobs = jobs.filter(job => {
    const matchesSearch = job.job_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         job.ccdd_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         job.municipality?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesFilter = filterStatus === 'all' || 
                         (filterStatus === 'active' && job.job_status === 'active') ||
                         (filterStatus === 'completed' && job.job_status === 'completed') ||
                         (filterStatus === 'archived' && job.job_status === 'archived');

    const matchesTab = activeTab === 'active' ? job.job_status === 'active' :
                      activeTab === 'planning' ? job.job_status === 'planning' :
                      activeTab === 'archived' ? job.job_status === 'archived' :
                      true;

    return matchesSearch && matchesFilter && matchesTab;
  });

  const handleCreateJob = () => {
    console.log('Create new job clicked');
    // TODO: Implement job creation modal
  };

  const handleEditJob = (job) => {
    console.log('Edit job clicked:', job.job_name);
    // TODO: Implement job editing modal
  };

  const handleDeleteJob = (job) => {
    console.log('Delete job clicked:', job.job_name);
    // TODO: Implement job deletion with confirmation
  };

  const handleAssignProperties = (job) => {
    console.log('Assign properties clicked:', job.job_name);
    // TODO: Implement property assignment modal
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-3"></div>
          <span className="text-gray-600">Loading jobs...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertTriangle className="w-5 h-5 text-red-600 mr-2" />
            <span className="text-red-800 font-medium">Error loading jobs: {error}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border-2 border-blue-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Settings className="w-8 h-8 mr-3 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Active Job Management</h1>
              <p className="text-gray-600">
                Connected to database with {filteredJobs.length} active jobs tracked
                {isLoadingMetrics && (
                  <span className="ml-2 text-blue-600">
                    <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-1"></div>
                    Loading analytics...
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={handleCreateJob}
            className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <Edit className="w-4 h-4" />
            <span className="font-medium">Create New Job</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'active', name: 'Active Jobs', count: jobs.filter(j => j.job_status === 'active').length },
            { id: 'planning', name: 'Planning Jobs', count: jobs.filter(j => j.job_status === 'planning').length },
            { id: 'archived', name: 'Archived Jobs', count: jobs.filter(j => j.job_status === 'archived').length }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <span>{tab.name}</span>
              <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded-full text-xs">
                {tab.count}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* Search and Filter */}
      <div className="flex items-center space-x-4 bg-white p-4 rounded-lg border shadow-sm">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search jobs by name, CCDD, or municipality..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="flex items-center space-x-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {/* Jobs List */}
      <div className="space-y-4">
        {filteredJobs.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border">
            <Building className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Jobs Found</h3>
            <p className="text-gray-600">
              {searchTerm || filterStatus !== 'all' ? 
                'No jobs match your current filters.' : 
                'No jobs available in this category.'
              }
            </p>
          </div>
        ) : (
          filteredJobs.map((job) => {
            const completion = getCompletionDisplay(job.id);
            const metrics = jobMetrics[job.id];
            
            return (
              <div key={job.id} className="bg-white rounded-lg border shadow-sm p-6">
                {/* Job Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h2 className="text-xl font-bold text-gray-900">{job.job_name}</h2>
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">
                        {job.vendor_type || 'BRT'}
                      </span>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        job.job_status === 'active' ? 'bg-green-100 text-green-800' :
                        job.job_status === 'planning' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {job.job_status === 'active' ? 'Active' : 
                         job.job_status === 'planning' ? 'Planning' : 'Archived'}
                      </span>
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                        {displayMetric(job.id, 'totalProperties') !== '-' ? 
                          `${((parseFloat(job.percent_completed) || 0) * 100).toFixed(1)}% Billed` :
                          '0.00% Billed'
                        }
                      </span>
                    </div>
                    <div className="flex items-center space-x-4 text-sm text-gray-600">
                      <div className="flex items-center">
                        <span className="font-medium">{job.ccdd_code || job.ccddCode}</span>
                      </div>
                      <div className="flex items-center">
                        <MapPin className="w-4 h-4 mr-1" />
                        <span>{job.municipality || 'Municipality'}</span>
                      </div>
                      <div className="flex items-center">
                        <Calendar className="w-4 h-4 mr-1" />
                        <span>Due: {job.end_date ? new Date(job.end_date).getFullYear() : 'TBD'}</span>
                      </div>
                      <div className="flex items-center">
                        <Users className="w-4 h-4 mr-1" />
                        <span>{job.employees?.first_name} {job.employees?.last_name} (Lead Manager)</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ENHANCED: Metrics Display with Live Data */}
                <div className="grid grid-cols-5 gap-4 mb-4">
                  {/* Properties Inspected */}
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {completion.current} of {completion.total}
                    </div>
                    <div className="text-sm text-gray-600">Properties Inspected</div>
                    <div className={`text-sm font-medium ${completion.isComplete ? 'text-green-600' : 'text-blue-600'}`}>
                      {completion.percentage} Complete
                    </div>
                  </div>

                  {/* Entry Rate */}
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {displayMetric(job.id, 'entryRate', true)}
                    </div>
                    <div className="text-sm text-gray-600">Entry Rate</div>
                  </div>

                  {/* Refusal Rate */}
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-600">
                      {displayMetric(job.id, 'refusalRate', true)}
                    </div>
                    <div className="text-sm text-gray-600">Refusal Rate</div>
                  </div>

                  {/* Commercial Complete */}
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {displayMetric(job.id, 'commercialComplete', true)}
                    </div>
                    <div className="text-sm text-gray-600">Commercial Complete</div>
                  </div>

                  {/* Pricing Complete */}
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {displayMetric(job.id, 'pricingComplete', true)}
                    </div>
                    <div className="text-sm text-gray-600">Pricing Complete</div>
                  </div>
                </div>

                {/* Analytics Status Indicator */}
                {metrics && (
                  <div className="mb-4 flex items-center justify-between text-sm">
                    <div className="flex items-center space-x-2">
                      {metrics.isProcessed ? (
                        <>
                          <CheckCircle className="w-4 h-4 text-green-500" />
                          <span className="text-green-600">
                            Analytics processed {metrics.lastProcessed ? 
                              `on ${new Date(metrics.lastProcessed).toLocaleDateString()}` : ''
                            }
                          </span>
                        </>
                      ) : (
                        <>
                          <Clock className="w-4 h-4 text-gray-400" />
                          <span className="text-gray-500">Analytics not yet processed</span>
                        </>
                      )}
                    </div>
                    {isLoadingMetrics && (
                      <div className="flex items-center text-blue-600">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                        <span>Updating...</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Job Actions */}
                <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                  <div className="flex items-center space-x-2 text-sm text-gray-600">
                    <MapPin className="w-4 h-4" />
                    <span>{job.county || 'Camden County'}</span>
                    
                    <div className="flex items-center ml-4">
                      <Users className="w-4 h-4 mr-1" />
                      <AlertTriangle className="w-4 h-4 text-red-500" />
                      <span className="cursor-pointer hover:text-blue-600" onClick={() => handleAssignProperties(job)}>
                        Assign Properties
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => onJobSelect(job)}
                      className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <Eye className="w-4 h-4" />
                      <span>Go to Job</span>
                    </button>
                    
                    <button
                      onClick={() => handleEditJob(job)}
                      className="flex items-center space-x-2 bg-orange-600 text-white px-3 py-2 rounded-lg hover:bg-orange-700 transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                      <span>Edit</span>
                    </button>
                    
                    <button
                      onClick={() => handleDeleteJob(job)}
                      className="flex items-center space-x-2 bg-red-600 text-white px-3 py-2 rounded-lg hover:bg-red-700 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default AdminJobManagement;
