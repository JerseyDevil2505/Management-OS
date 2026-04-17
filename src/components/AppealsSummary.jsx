import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { AlertCircle, Calendar, FileText, TrendingUp } from 'lucide-react';

const AppealsSummary = ({ jobs = [], onJobSelect }) => {
  const [jobAppealsSummary, setJobAppealsSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState([]);

  useEffect(() => {
    if (jobs && jobs.length > 0) {
      loadAppealsByJob();
    } else {
      setJobAppealsSummary([]);
      setLoading(false);
    }
  }, [jobs, selectedYear]);

  const computeClassBreakdown = (snapshot) => {
    if (!snapshot || !Array.isArray(snapshot)) {
      return { residential: 0, commercial: 0, vacant: 0 };
    }

    // Match AppealLogTab logic: Residential = '2' or '3A', Commercial = '4A', '4B', '4C', Vacant Land = everything else
    const residential = snapshot.filter(a => {
      const cls = String(a.property_m4_class || '').trim();
      return cls === '2' || cls === '3A';
    }).length;

    const commercial = snapshot.filter(a => {
      const cls = String(a.property_m4_class || '').trim();
      return cls === '4A' || cls === '4B' || cls === '4C';
    }).length;

    const vacant = snapshot.length - residential - commercial;

    return { residential, commercial, vacant };
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

    // Parse date locally to avoid timezone drift (same as AppealLogTab)
    const [year, month, day] = hearingDates[0].split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const earliest = date.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit'
    });

    return { earliest, hasMultiple: hearingDates.length > 1 };
  };

  const loadAppealsByJob = async () => {
    try {
      setLoading(true);

      // Separate jobs with snapshots from those needing DB fetch
      const jobsWithSnapshots = [];
      const jobsNeedingFetch = [];
      jobs.forEach(job => {
        if (job.appeal_summary_snapshot) {
          jobsWithSnapshots.push(job);
        } else {
          jobsNeedingFetch.push(job);
        }
      });

      // Single batch query for all jobs without snapshots
      let fetchedAppealsByJob = {};
      if (jobsNeedingFetch.length > 0) {
        const jobIds = jobsNeedingFetch.map(j => j.id);
        const { data: allFetchedAppeals, error } = await supabase
          .from('appeal_log')
          .select('*')
          .in('job_id', jobIds);

        if (error) {
          console.error('Error batch-loading appeals:', error);
        } else {
          // Group fetched appeals by job_id
          (allFetchedAppeals || []).forEach(appeal => {
            if (!fetchedAppealsByJob[appeal.job_id]) {
              fetchedAppealsByJob[appeal.job_id] = [];
            }
            fetchedAppealsByJob[appeal.job_id].push(appeal);
          });
        }
      }

      // Build summary and collect all years in a single pass
      const summaryData = [];
      const allYearsSet = new Set();

      for (const job of jobs) {
        const appeals = job.appeal_summary_snapshot || fetchedAppealsByJob[job.id] || [];

        // Collect all years from this job's appeals
        appeals.forEach(a => {
          if (a.appeal_year) allYearsSet.add(a.appeal_year);
        });

        if (appeals.length > 0) {
          // Filter appeals by selected year
          const yearFilteredAppeals = appeals.filter(a => a.appeal_year === selectedYear);

          if (yearFilteredAppeals.length === 0) {
            continue;
          }

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

          yearFilteredAppeals.forEach(appeal => {
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

          // Compute class breakdown and hearing dates from year-filtered appeals
          const classBreakdown = computeClassBreakdown(yearFilteredAppeals);
          const hearingInfo = getHearingDates(yearFilteredAppeals);

          summaryData.push({
            jobId: job.id,
            jobName: job.job_name || 'Unnamed Job',
            totalAppeals: yearFilteredAppeals.length,
            statusBreakdown,
            proSeCount,
            attorneyCount,
            residential: classBreakdown.residential,
            commercial: classBreakdown.commercial,
            vacant: classBreakdown.vacant,
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
            vacant: job.appeal_summary_snapshot ? 0 : null,
            hearingDate: job.appeal_summary_snapshot ? null : null,
            hasMultipleHearings: false,
            snapshotAvailable: !!job.appeal_summary_snapshot
          });
        }
      }

      // Show jobs that have appeals, plus Maplewood and Jackson as special cases, sorted by CCDD code
      const jobsWithAppeals = summaryData
        .filter(row => row.totalAppeals > 0 || row.jobName === 'Maplewood' || row.jobName === 'Jackson')
        .sort((a, b) => {
          // Sort by CCDD code (from job object if available)
          const ccddA = jobs.find(j => j.id === a.jobId)?.ccdd_code || '';
          const ccddB = jobs.find(j => j.id === b.jobId)?.ccdd_code || '';
          return ccddA.localeCompare(ccddB);
        });
      setJobAppealsSummary(jobsWithAppeals);

      // Years already collected in single pass above
      const yearsArray = [...allYearsSet].sort((a, b) => b - a);
      setAvailableYears(yearsArray.length > 0 ? yearsArray : [new Date().getFullYear()]);
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
      vacant: acc.vacant + (row.vacant !== null ? row.vacant : 0)
    }),
    { totalAppeals: 0, defend: 0, stipulated: 0, heard: 0, withdrawn: 0, assessor: 0, affirmed: 0, hasCME: 0, proSe: 0, attorney: 0, residential: 0, commercial: 0, vacant: 0 }
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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <AlertCircle className="w-8 h-8 text-amber-600" />
              Appeals Summary by Job
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Overview of all PPA appeals (active, archived, draft) with class and representation breakdown
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Year:</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {availableYears.map(year => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="overflow-x-auto flex-1">
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
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Total</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Residential</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Commercial</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Vacant Land</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Defend</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Stipulated</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Heard</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Withdrawn</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Assessor</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Affirmed</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Has CME</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Pro Se</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Attorney</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Hearing</th>
              </tr>
            </thead>
            <tbody>
              {jobAppealsSummary.map((row, idx) => {
                const cmeMatchesTotal = row.totalAppeals > 0 && row.statusBreakdown.hasCME === row.totalAppeals;
                return (
                <tr
                  key={row.jobId}
                  className={`border-b border-gray-200 ${cmeMatchesTotal ? 'bg-green-50 hover:bg-green-100' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{row.jobName}</td>
                  <td className="px-4 py-3 text-sm text-center text-gray-700 font-semibold">{row.totalAppeals}</td>
                  <td className="px-4 py-3 text-sm text-center text-gray-700">{row.residential !== null ? row.residential : '—'}</td>
                  <td className="px-4 py-3 text-sm text-center text-gray-700">{row.commercial !== null ? row.commercial : '—'}</td>
                  <td className="px-4 py-3 text-sm text-center text-gray-700">{row.vacant !== null ? row.vacant : '—'}</td>
                  <td className="px-4 py-3 text-sm text-center text-gray-700">{row.statusBreakdown.defend}</td>
                  <td className="px-4 py-3 text-sm text-center text-gray-700">{row.statusBreakdown.stipulated}</td>
                  <td className="px-4 py-3 text-sm text-center text-gray-700">{row.statusBreakdown.heard}</td>
                  <td className="px-4 py-3 text-sm text-center text-gray-700">{row.statusBreakdown.withdrawn}</td>
                  <td className="px-4 py-3 text-sm text-center text-gray-700">{row.statusBreakdown.assessor}</td>
                  <td className="px-4 py-3 text-sm text-center text-gray-700">{row.statusBreakdown.affirmed}</td>
                  <td className={`px-4 py-3 text-sm text-center ${cmeMatchesTotal ? 'text-green-800 font-semibold' : 'text-gray-700'}`}>{row.statusBreakdown.hasCME}</td>
                  <td className="px-4 py-3 text-sm text-center text-gray-700">{row.proSeCount}</td>
                  <td className="px-4 py-3 text-sm text-center text-gray-700">{row.attorneyCount}</td>
                  <td className="px-4 py-3 text-sm text-center text-gray-700">{row.hearingDate ? `${row.hearingDate}${row.hasMultipleHearings ? '*' : ''}` : '—'}</td>
                </tr>
                );
              })}
              {/* Totals Row */}
              <tr className="bg-blue-50 border-t-2 border-blue-200 font-bold">
                <td className="px-4 py-3 text-sm text-gray-900">TOTALS</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totals.totalAppeals}</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totals.residential}</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totals.commercial}</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totals.vacant}</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totals.defend}</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totals.stipulated}</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totals.heard}</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totals.withdrawn}</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totals.assessor}</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totals.affirmed}</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totals.hasCME}</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totals.proSe}</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">{totals.attorney}</td>
                <td className="px-4 py-3 text-sm text-center text-gray-900">—</td>
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
