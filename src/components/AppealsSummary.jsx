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

  const computeClassBreakdown = (snapshot) => {
    if (!snapshot || !Array.isArray(snapshot)) {
      return { residential: 0, commercial: 0, other: 0 };
    }

    // Match AppealLogTab logic: Residential = '2' or '3A', Commercial = '4A', '4B', '4C'
    const residential = snapshot.filter(a => {
      const cls = String(a.property_m4_class || '').trim();
      return cls === '2' || cls === '3A';
    }).length;

    const commercial = snapshot.filter(a => {
      const cls = String(a.property_m4_class || '').trim();
      return cls === '4A' || cls === '4B' || cls === '4C';
    }).length;

    const other = snapshot.length - residential - commercial;

    return { residential, commercial, other };
  };

  const getHearingDates = (snapshot) => {
    if (!snapshot || !Array.isArray(snapshot)) {
      return { earliest: null, hasMultiple: false };
    }

    const hearingDates = [...new Set(
      snapshot
        .map(a => a.hearing_date)
        .filter(Boolean)
        .sort()
    )];

    if (hearingDates.length === 0) {
      return { earliest: null, hasMultiple: false };
    }

    const earliest = new Date(hearingDates[0]).toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit'
    });

    return { earliest, hasMultiple: hearingDates.length > 1 };
  };

  const loadAppealsByJob = async () => {
    try {
      setLoading(true);
      const summaryData = [];

      // For each active job, use appeal_summary_snapshot if available, otherwise load from DB
      for (const job of jobs) {
        try {
          let appeals = job.appeal_summary_snapshot;

          // Fall back to database query if snapshot is not available
          if (!appeals) {
            const { data: fetchedAppeals, error } = await supabase
              .from('appeal_log')
              .select('*')
              .eq('job_id', job.id);

            if (error) {
              console.error(`Error loading appeals for job ${job.id}:`, error);
              continue;
            }
            appeals = fetchedAppeals || [];
          }

          if (appeals && appeals.length > 0) {
            // Calculate status breakdowns
            const statusBreakdown = {
              defend: 0,         // D
              stipulated: 0,     // S
              heard: 0,          // H
              withdrawn: 0,      // W
              assessor: 0,       // A or appeal_type = 'assessor'
              affirmed: 0,       // AP, AWP
              hasCME: 0          // cme_projected_value or cme_new_assessment
            };

            let proSeCount = 0;
            let attorneyCount = 0;

            appeals.forEach(appeal => {
              // Count by status
              const status = appeal.status?.toUpperCase();
              if (status === 'D') statusBreakdown.defend++;
              else if (status === 'S') statusBreakdown.stipulated++;
              else if (status === 'H') statusBreakdown.heard++;
              else if (status === 'W') statusBreakdown.withdrawn++;
              else if (status === 'A') statusBreakdown.assessor++;
              else if (status === 'AP' || status === 'AWP') statusBreakdown.affirmed++;

              // Count CME valuations
              if (appeal.cme_projected_value || appeal.cme_new_assessment) {
                statusBreakdown.hasCME++;
              }

              // Count pro se vs attorney
              if (appeal.attorney && appeal.attorney.trim() && appeal.attorney.toLowerCase() !== 'pro se') {
                attorneyCount++;
              } else {
                proSeCount++;
              }
            });

            // Compute class breakdown and hearing dates from snapshot
            const classBreakdown = computeClassBreakdown(appeals);
            const hearingInfo = getHearingDates(appeals);

            summaryData.push({
              jobId: job.id,
              jobName: job.job_name || 'Unnamed Job',
              totalAppeals: appeals.length,
              statusBreakdown,
              proSeCount,
              attorneyCount,
              residential: classBreakdown.residential,
              commercial: classBreakdown.commercial,
              other: classBreakdown.other,
              hearingDate: hearingInfo.earliest,
              hasMultipleHearings: hearingInfo.hasMultiple,
              snapshotAvailable: !!job.appeal_summary_snapshot
            });
          } else {
            // Job exists but has no appeals - add row with all zeros/blanks
            summaryData.push({
              jobId: job.id,
              jobName: job.job_name || 'Unnamed Job',
              totalAppeals: 0,
              statusBreakdown: {
                defend: 0, stipulated: 0, heard: 0, withdrawn: 0, assessor: 0, affirmed: 0, hasCME: 0
              },
              proSeCount: 0,
              attorneyCount: 0,
              residential: job.appeal_summary_snapshot ? 0 : null,
              commercial: job.appeal_summary_snapshot ? 0 : null,
              other: job.appeal_summary_snapshot ? 0 : null,
              hearingDate: job.appeal_summary_snapshot ? null : null,
              hasMultipleHearings: false,
              snapshotAvailable: !!job.appeal_summary_snapshot
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
      defend: acc.defend + row.statusBreakdown.defend,
      stipulated: acc.stipulated + row.statusBreakdown.stipulated,
      heard: acc.heard + row.statusBreakdown.heard,
      withdrawn: acc.withdrawn + row.statusBreakdown.withdrawn,
      assessor: acc.assessor + row.statusBreakdown.assessor,
      affirmed: acc.affirmed + row.statusBreakdown.affirmed,
      hasCME: acc.hasCME + row.statusBreakdown.hasCME,
      proSe: acc.proSe + row.proSeCount,
      attorney: acc.attorney + row.attorneyCount,
      residential: acc.residential + (row.residential !== null ? row.residential : 0),
      commercial: acc.commercial + (row.commercial !== null ? row.commercial : 0),
      other: acc.other + (row.other !== null ? row.other : 0)
    }),
    { totalAppeals: 0, defend: 0, stipulated: 0, heard: 0, withdrawn: 0, assessor: 0, affirmed: 0, hasCME: 0, proSe: 0, attorney: 0, residential: 0, commercial: 0, other: 0 }
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
          <>
            <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700">Job Name</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Total</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Defend</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Stipulated</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Heard</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Withdrawn</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Assessor</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Affirmed</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Has CME</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Pro Se</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Attorney</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Residential</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Commercial</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Other</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700">Hearing</th>
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
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.statusBreakdown.defend}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.statusBreakdown.stipulated}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.statusBreakdown.heard}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.statusBreakdown.withdrawn}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.statusBreakdown.assessor}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.statusBreakdown.affirmed}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.statusBreakdown.hasCME}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.proSeCount}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.attorneyCount}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.residential !== null ? row.residential : '—'}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.commercial !== null ? row.commercial : '—'}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.other !== null ? row.other : '—'}</td>
                  <td className="px-6 py-3 text-sm text-center text-gray-700">{row.hearingDate ? `${row.hearingDate}${row.hasMultipleHearings ? '*' : ''}` : '—'}</td>
                </tr>
              ))}
              {/* Totals Row */}
              <tr className="bg-blue-50 border-t-2 border-blue-200 font-bold">
                <td className="px-6 py-3 text-sm text-gray-900">TOTALS</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.totalAppeals}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.defend}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.stipulated}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.heard}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.withdrawn}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.assessor}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.affirmed}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.hasCME}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.proSe}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.attorney}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.residential}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.commercial}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">{totals.other}</td>
                <td className="px-6 py-3 text-sm text-center text-gray-900">—</td>
              </tr>
            </tbody>
          </table>

            {/* Legend */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-600">
              <p>* Multiple hearing dates on file</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AppealsSummary;
