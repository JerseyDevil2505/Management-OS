import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { AlertCircle, Calendar, FileText, TrendingUp } from 'lucide-react';

const AppealsSummary = ({ jobs = [], onJobSelect }) => {
  const [jobAppealsSummary, setJobAppealsSummary] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (jobs && jobs.length > 0) {
      loadAppealsByJob();
    } else {
      setJobAppealsSummary([]);
      setLoading(false);
    }
  }, [jobs]);

  const loadAppealsByJob = async () => {
    try {
      setLoading(true);
      const summaryData = [];

      // For each active job, load appeal_log data
      for (const job of jobs) {
        try {
          const { data: appeals, error } = await supabase
            .from('appeal_log')
            .select('*')
            .eq('job_id', job.id);

          if (error) {
            console.error(`Error loading appeals for job ${job.id}:`, error);
            continue;
          }

          if (appeals && appeals.length > 0) {
            // Calculate breakdowns
            const classBreakdown = {
              residential: 0,    // 2, 3A
              commercial: 0,     // 4A, 4B, 4C
              vacant: 0,         // 1, 3B
              other: 0           // other
            };

            let proSeCount = 0;
            let attorneyCount = 0;

            appeals.forEach(appeal => {
              // Classify by class
              const classCode = appeal.property_m4_class;
              if (['2', '3A'].includes(classCode)) {
                classBreakdown.residential++;
              } else if (['4A', '4B', '4C'].includes(classCode)) {
                classBreakdown.commercial++;
              } else if (['1', '3B'].includes(classCode)) {
                classBreakdown.vacant++;
              } else {
                classBreakdown.other++;
              }

              // Count pro se vs attorney
              if (appeal.attorney && appeal.attorney.trim() && appeal.attorney.toLowerCase() !== 'pro se') {
                attorneyCount++;
              } else {
                proSeCount++;
              }
            });

            summaryData.push({
              jobId: job.id,
              jobName: job.job_name || 'Unnamed Job',
              totalAppeals: appeals.length,
              classBreakdown,
              proSeCount,
              attorneyCount
            });
          }
        } catch (err) {
          console.error(`Error processing job ${job.id}:`, err);
        }
      }

      setJobAppealsSummary(summaryData);
    } catch (error) {
      console.error('Error loading appeals:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate totals
  const totals = jobAppealsSummary.reduce(
    (acc, row) => ({
      totalAppeals: acc.totalAppeals + row.totalAppeals,
      residential: acc.residential + row.classBreakdown.residential,
      commercial: acc.commercial + row.classBreakdown.commercial,
      vacant: acc.vacant + row.classBreakdown.vacant,
      other: acc.other + row.classBreakdown.other,
      proSe: acc.proSe + row.proSeCount,
      attorney: acc.attorney + row.attorneyCount
    }),
    { totalAppeals: 0, residential: 0, commercial: 0, vacant: 0, other: 0, proSe: 0, attorney: 0 }
  );


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
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
          <AlertCircle className="w-8 h-8 text-amber-600" />
          Appeals Summary by Job
        </h2>
        <p className="text-sm text-gray-600 mt-1">
          Overview of all PPA appeals (active, archived, draft) with class and representation breakdown
        </p>
      </div>

      {/* Content */}
      <div className="overflow-x-auto">
        {jobAppealsSummary.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              No Appeals Logged Yet
            </h3>
            <p className="text-gray-500">
              Appeals data will appear here once you add appeals to job Appeal Log tabs.
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700">Job Name</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Total Appeals</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Residential</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Commercial</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Vacant Land</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Other</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Pro Se</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Attorney</th>
              </tr>
            </thead>
            <tbody>
              {jobAppealsSummary.map((row, idx) => (
                <tr
                  key={row.jobId}
                  className="border-b border-gray-200 hover:bg-gray-50 cursor-pointer"
                  onClick={() => onJobSelect && onJobSelect(row.jobId)}
                >
                  <td className="px-6 py-3 text-sm font-medium text-gray-900">{row.jobName}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700 font-semibold">{row.totalAppeals}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.classBreakdown.residential}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.classBreakdown.commercial}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.classBreakdown.vacant}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.classBreakdown.other}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.proSeCount}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.attorneyCount}</td>
                </tr>
              ))}
              {/* Totals Row */}
              <tr className="bg-blue-50 border-t-2 border-blue-200 font-bold">
                <td className="px-6 py-3 text-sm text-gray-900">TOTALS</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.totalAppeals}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.residential}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.commercial}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.vacant}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.other}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.proSe}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.attorney}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default AppealsSummary;
