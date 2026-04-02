import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { AlertCircle, Calendar, FileText, TrendingUp } from 'lucide-react';

const AppealsSummary = ({ jobs = [], onJobSelect }) => {
  const [appeals, setAppeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('deadline');

  useEffect(() => {
    loadAppeals();
  }, [jobs]);

  const loadAppeals = async () => {
    try {
      setLoading(true);
      // For now, placeholder - will load from appeal_log table
      // This will aggregate appeal data from all PPA jobs
      
      if (jobs && jobs.length > 0) {
        // Temporary: create dummy appeal data from jobs for now
        // Later: Load from database appeal_log table
        const appealList = [];
        
        // This is a placeholder - we'll enhance once appeal data is in the database
        setAppeals(appealList);
      } else {
        setAppeals([]);
      }
    } catch (error) {
      console.error('Error loading appeals:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDeadlineStatus = (deadline) => {
    if (!deadline) return 'unknown';
    const today = new Date();
    const deadlineDate = new Date(deadline);
    const daysRemaining = Math.floor((deadlineDate - today) / (1000 * 60 * 60 * 24));
    
    if (daysRemaining < 0) return 'overdue';
    if (daysRemaining <= 7) return 'urgent';
    if (daysRemaining <= 30) return 'soon';
    return 'scheduled';
  };

  const getStatusColor = (status) => {
    const colors = {
      overdue: 'bg-red-50 border-red-200 text-red-800',
      urgent: 'bg-orange-50 border-orange-200 text-orange-800',
      soon: 'bg-yellow-50 border-yellow-200 text-yellow-800',
      scheduled: 'bg-green-50 border-green-200 text-green-800',
      unknown: 'bg-gray-50 border-gray-200 text-gray-800'
    };
    return colors[status] || colors.unknown;
  };

  const getStatusLabel = (status) => {
    const labels = {
      overdue: 'OVERDUE',
      urgent: 'DUE SOON',
      soon: 'UPCOMING',
      scheduled: 'SCHEDULED',
      unknown: 'UNKNOWN'
    };
    return labels[status] || labels.unknown;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading appeals...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <AlertCircle className="w-8 h-8 text-amber-600" />
              Appeals Summary
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Track appeal deadlines and defense status across all jobs
            </p>
          </div>
        </div>
      </div>

      {/* Filters and Controls */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Filter by Status
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Appeals</option>
              <option value="overdue">Overdue</option>
              <option value="urgent">Due Soon</option>
              <option value="pending">Pending</option>
              <option value="filed">Filed</option>
              <option value="decided">Decided</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="deadline">Deadline (Nearest)</option>
              <option value="job">Job Name</option>
              <option value="status">Status</option>
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-8">
        {appeals && appeals.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              No Appeals Yet
            </h3>
            <p className="text-gray-500 max-w-md mx-auto">
              Appeal data will appear here as jobs are completed and appeal deadlines are tracked. 
              Select a job's Appeal Log tab to manage appeal details.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Appeals Grid - placeholder structure */}
            <div className="grid gap-4">
              <p className="text-center text-gray-500 py-8">
                Appeal tracking coming soon. Access individual job appeals via the Appeal Log tab in each job.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="px-6 py-4 bg-blue-50 border-t border-blue-200 rounded-b-lg">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">Quick Tips:</p>
            <ul className="list-disc list-inside space-y-1 text-blue-700">
              <li>Appeals due April 1st and May 1st for most municipalities</li>
              <li>Use the CME (Comparable Market Evaluation) tool in Final Valuation for appeal defense</li>
              <li>Access appeal details from the Appeal Log tab within each job workspace</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppealsSummary;
