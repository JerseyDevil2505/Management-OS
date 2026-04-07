import React, { useState, useEffect, useMemo } from 'react';
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';

const AppealLogTab = ({ jobData, properties = [], inspectionData = [], onNavigateToCME = () => {} }) => {
  // State
  const [appeals, setAppeals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState([]);
  
  // Column group visibility toggles
  const [expandedGroups, setExpandedGroups] = useState({
    propertyInfo: true,
    legal: true,
    workflow: true,
    valuation: true,
    notes: true
  });

  // Load appeals from database
  useEffect(() => {
    if (!jobData?.id) return;
    
    const loadAppeals = async () => {
      try {
        setIsLoading(true);
        const { data, error } = await supabase
          .from('appeal_log')
          .select('*')
          .eq('job_id', jobData.id)
          .order('appeal_number', { ascending: true });

        if (error) throw error;

        // Enrich with property data
        const enrichedAppeals = (data || []).map(appeal => {
          const property = properties.find(p => p.property_composite_key === appeal.property_composite_key);
          return {
            ...appeal,
            // Derived fields from property match
            property_m4_class: property?.property_m4_class || appeal.property_m4_class || null,
            new_vcs: property?.new_vcs || null,
            owner_name: property?.owner_name || null,
            property_block: appeal.property_block || property?.property_block || null,
            property_lot: appeal.property_lot || property?.property_lot || null,
            property_qualifier: appeal.property_qualifier || property?.property_qualifier || null,
            property_location: appeal.property_location || property?.property_location || null
          };
        });

        setAppeals(enrichedAppeals);

        // Build unique years from data + current year
        const yearsFromData = [...new Set(enrichedAppeals.map(a => a.appeal_year).filter(Boolean))];
        const currentYear = new Date().getFullYear();
        const allYears = [...new Set([...yearsFromData, currentYear])].sort((a, b) => b - a);
        setAvailableYears(allYears.length > 0 ? allYears : [currentYear]);
      } catch (error) {
        console.error('Error loading appeals:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadAppeals();
  }, [jobData?.id, properties]);

  // Filter appeals by selected year
  const filteredAppeals = useMemo(() => {
    return appeals.filter(a => !a.appeal_year || a.appeal_year === selectedYear);
  }, [appeals, selectedYear]);

  // Calculate statistics
  const stats = useMemo(() => {
    const filtered = filteredAppeals;
    
    const totalAppeals = filtered.length;
    const totalAssessmentExposure = filtered.reduce((sum, a) => sum + (a.current_assessment || 0), 0);
    const totalPossibleLoss = filtered.reduce((sum, a) => sum + (a.possible_loss || 0), 0);
    const totalActualLoss = filtered.reduce((sum, a) => sum + (a.loss || 0), 0);

    // Status counts
    const statusCounts = {
      S: 0, D: 0, H: 0, W: 0, A: 0, AP: 0, AWP: 0, NA: 0
    };
    filtered.forEach(a => {
      const status = a.status?.toUpperCase() || 'NA';
      if (statusCounts.hasOwnProperty(status)) {
        statusCounts[status]++;
      }
    });

    // Class counts
    const residentialCount = filtered.filter(a => ['2', '3A'].includes(a.property_m4_class)).length;
    const commercialCount = filtered.filter(a => ['4A', '4B', '4C'].includes(a.property_m4_class)).length;
    const vacantCount = filtered.filter(a => ['1', '3B'].includes(a.property_m4_class)).length;
    const otherCount = totalAppeals - residentialCount - commercialCount - vacantCount;

    return {
      totalAppeals,
      totalAssessmentExposure,
      totalPossibleLoss,
      totalActualLoss,
      statusCounts,
      residentialCount,
      commercialCount,
      vacantCount,
      otherCount
    };
  }, [filteredAppeals]);

  // Helper: Format currency
  const formatCurrency = (value) => {
    if (value === null || value === undefined || isNaN(value)) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  // Helper: Get status badge styling
  const getStatusStyle = (status) => {
    const s = status?.toUpperCase() || 'NA';
    switch (s) {
      case 'S': return { bg: 'bg-green-50', text: 'text-green-700', badge: 'bg-green-100' };
      case 'D':
      case 'H': return { bg: 'bg-red-50', text: 'text-red-700', badge: 'bg-red-100' };
      case 'W': return { bg: 'bg-gray-50', text: 'text-gray-700', badge: 'bg-gray-100' };
      case 'A':
      case 'AP':
      case 'AWP': return { bg: 'bg-amber-50', text: 'text-amber-700', badge: 'bg-amber-100' };
      default: return { bg: 'bg-gray-50', text: 'text-gray-700', badge: 'bg-gray-100' };
    }
  };

  // Helper: Check owner mismatch
  const hasOwnerMismatch = (appeal) => {
    if (!appeal.petitioner_name || !appeal.owner_name) return false;
    const pet = appeal.petitioner_name.toLowerCase().trim();
    const own = appeal.owner_name.toLowerCase().trim();
    return pet !== own;
  };

  // Helper: Calculate AC%
  const calculateACPercent = (appeal) => {
    if (!appeal.current_assessment || !appeal.judgment_value) return null;
    const pct = ((appeal.current_assessment - appeal.judgment_value) / appeal.current_assessment) * 100;
    return Math.round(pct * 10) / 10;
  };

  // Helper: Calculate evidence due (hearing_date - 7 days)
  const getEvidenceDueDate = (appeal) => {
    if (!appeal.hearing_date) return null;
    const date = new Date(appeal.hearing_date);
    date.setDate(date.getDate() - 7);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-500">Loading appeals...</p>
      </div>
    );
  }

  if (filteredAppeals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="w-12 h-12 text-gray-300 mb-3" />
        <p className="text-gray-500 font-medium">No Appeals Logged</p>
        <p className="text-sm text-gray-400 mt-1">Appeals will appear here once logged</p>
      </div>
    );
  }

  // ==================== RENDER ====================

  return (
    <div className="space-y-6">
      {/* YEAR FILTER */}
      <div className="flex justify-end">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Appeal Year:</label>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {availableYears.map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
      </div>

      {/* STATS ROW 1 - TOTALS */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total Appeals</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{stats.totalAppeals}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Assessment Exposure</p>
          <p className="text-xl font-bold text-blue-600 mt-2">{formatCurrency(stats.totalAssessmentExposure)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Possible Loss</p>
          <p className="text-xl font-bold text-orange-600 mt-2">{formatCurrency(stats.totalPossibleLoss)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Judgment Loss</p>
          <p className="text-xl font-bold text-red-600 mt-2">{formatCurrency(stats.totalActualLoss)}</p>
        </div>
      </div>

      {/* STATS ROW 2 - STATUS BADGES */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-3">By Status</p>
        <div className="flex gap-2 flex-wrap">
          {['S', 'D', 'H', 'W', 'A', 'AP', 'AWP', 'NA'].map(status => {
            const count = stats.statusCounts[status] || 0;
            const style = getStatusStyle(status);
            return (
              <div key={status} className={`${style.badge} ${style.text} px-3 py-1 rounded-full text-sm font-medium`}>
                {status}: <span className="font-bold">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* STATS ROW 3 - BY CLASS */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Residential</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{stats.residentialCount}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Commercial</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{stats.commercialCount}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Vacant Land</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{stats.vacantCount}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Other</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{stats.otherCount}</p>
        </div>
      </div>

      {/* COLUMN GROUP TOGGLES */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3 flex gap-2 flex-wrap">
        {[
          { key: 'propertyInfo', label: 'Property Info' },
          { key: 'legal', label: 'Legal' },
          { key: 'workflow', label: 'Workflow' },
          { key: 'notes', label: 'Notes' }
        ].map(group => (
          <button
            key={group.key}
            onClick={() => setExpandedGroups(prev => ({ ...prev, [group.key]: !prev[group.key] }))}
            className="text-xs font-medium px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 flex items-center gap-1"
          >
            {group.label}
            {expandedGroups[group.key] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        ))}
      </div>

      {/* TABLE - HORIZONTALLY SCROLLABLE WITH STICKY LEFT COLUMNS */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gradient-to-r from-blue-50 to-green-50 border-b border-gray-200">
              {/* FROZEN LEFT COLUMNS */}
              <th className="sticky left-0 z-10 bg-gradient-to-r from-blue-50 to-green-50 px-3 py-2 text-left font-medium text-gray-700 border-r border-gray-200">Status</th>
              <th className="sticky left-16 z-10 bg-gradient-to-r from-blue-50 to-green-50 px-3 py-2 text-left font-medium text-gray-700 border-r border-gray-200">Year</th>
              <th className="sticky left-28 z-10 bg-gradient-to-r from-blue-50 to-green-50 px-3 py-2 text-left font-medium text-gray-700 border-r border-gray-200">Appeal #</th>
              <th className="sticky left-48 z-10 bg-gradient-to-r from-blue-50 to-green-50 px-3 py-2 text-left font-medium text-gray-700 border-r border-gray-200">Block</th>
              <th className="sticky left-64 z-10 bg-gradient-to-r from-blue-50 to-green-50 px-3 py-2 text-left font-medium text-gray-700 border-r border-gray-200">Lot</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700">Qual</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700">Location</th>

              {/* PROPERTY INFO GROUP */}
              {expandedGroups.propertyInfo && (
                <>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Class</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">VCS</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Bracket</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Inspected</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Owner</th>
                </>
              )}

              {/* LEGAL GROUP */}
              {expandedGroups.legal && (
                <>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Petitioner</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Attorney</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Attny Address</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Attny City/State</th>
                </>
              )}

              {/* WORKFLOW GROUP */}
              {expandedGroups.workflow && (
                <>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Submission</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Evidence</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Evidence Due</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Hearing</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Stip</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Tax Court</th>
                </>
              )}

              {/* VALUATION GROUP (always visible) */}
              <th className="px-3 py-2 text-left font-medium text-gray-700">Current Assessment</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700">Requested</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700">Possible Loss</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 text-blue-600">CME Value</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700">AC%</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700">Judgment</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700">Loss</th>

              {/* NOTES GROUP */}
              {expandedGroups.notes && (
                <th className="px-3 py-2 text-left font-medium text-gray-700">Comments</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredAppeals.map((appeal, idx) => {
              const statusStyle = getStatusStyle(appeal.status);
              const ownerMismatch = hasOwnerMismatch(appeal);
              const acPercent = calculateACPercent(appeal);
              const evidenceDue = getEvidenceDueDate(appeal);

              return (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  {/* FROZEN LEFT COLUMNS */}
                  <td className="sticky left-0 z-10 bg-white hover:bg-gray-50 px-3 py-2 whitespace-nowrap border-r border-gray-200">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${statusStyle.badge} ${statusStyle.text}`}>
                      {appeal.status || 'NA'}
                    </span>
                  </td>
                  <td className="sticky left-16 z-10 bg-white hover:bg-gray-50 px-3 py-2 whitespace-nowrap border-r border-gray-200 text-gray-900">{appeal.appeal_year || '-'}</td>
                  <td className="sticky left-28 z-10 bg-white hover:bg-gray-50 px-3 py-2 whitespace-nowrap border-r border-gray-200 text-gray-900 font-medium">{appeal.appeal_number || '-'}</td>
                  <td className="sticky left-48 z-10 bg-white hover:bg-gray-50 px-3 py-2 whitespace-nowrap border-r border-gray-200 text-gray-900">{appeal.property_block || '-'}</td>
                  <td className="sticky left-64 z-10 bg-white hover:bg-gray-50 px-3 py-2 whitespace-nowrap border-r border-gray-200 text-gray-900">{appeal.property_lot || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.property_qualifier || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.property_location || '-'}</td>

                  {/* PROPERTY INFO GROUP */}
                  {expandedGroups.propertyInfo && (
                    <>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.property_m4_class || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.new_vcs || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.cme_bracket || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.inspected ? 'Yes' : 'No'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600 flex items-center gap-1">
                        {appeal.owner_name || '-'}
                        {ownerMismatch && <span className="text-yellow-600">⚠️</span>}
                      </td>
                    </>
                  )}

                  {/* LEGAL GROUP */}
                  {expandedGroups.legal && (
                    <>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.petitioner_name || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.attorney || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.attorney_address || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.attorney_city_state || '-'}</td>
                    </>
                  )}

                  {/* WORKFLOW GROUP */}
                  {expandedGroups.workflow && (
                    <>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.submission_type || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.evidence_status || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{evidenceDue || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.hearing_date ? new Date(appeal.hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.stip_status || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.tax_court_pending ? 'Yes' : 'No'}</td>
                    </>
                  )}

                  {/* VALUATION GROUP */}
                  <td className="px-3 py-2 whitespace-nowrap text-gray-900 font-medium">{formatCurrency(appeal.current_assessment)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-900 font-medium">{formatCurrency(appeal.requested_value)}</td>
                  <td className={`px-3 py-2 whitespace-nowrap font-medium ${appeal.possible_loss > 0 ? 'text-red-600' : 'text-gray-600'}`}>{formatCurrency(appeal.possible_loss)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-blue-600 font-semibold">{formatCurrency(appeal.cme_projected_value)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{acPercent !== null ? `${acPercent}%` : '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-900 font-medium">{formatCurrency(appeal.judgment_value)}</td>
                  <td className={`px-3 py-2 whitespace-nowrap font-medium ${appeal.loss > 0 ? 'text-red-600' : 'text-gray-600'}`}>{formatCurrency(appeal.loss)}</td>

                  {/* NOTES GROUP */}
                  {expandedGroups.notes && (
                    <td className="px-3 py-2 text-gray-600 max-w-xs truncate">{appeal.comments || '-'}</td>
                  )}
                </tr>
              );
            })}

            {/* TOTALS ROW */}
            <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold text-gray-900">
              <td colSpan="7" className="px-3 py-3 text-right">TOTALS:</td>
              {expandedGroups.propertyInfo && <td colSpan="5"></td>}
              {expandedGroups.legal && <td colSpan="4"></td>}
              {expandedGroups.workflow && <td colSpan="6"></td>}
              <td className="px-3 py-3 whitespace-nowrap">{formatCurrency(filteredAppeals.reduce((sum, a) => sum + (a.current_assessment || 0), 0))}</td>
              <td className="px-3 py-3 whitespace-nowrap">{formatCurrency(filteredAppeals.reduce((sum, a) => sum + (a.requested_value || 0), 0))}</td>
              <td className="px-3 py-3 whitespace-nowrap text-red-600">{formatCurrency(filteredAppeals.reduce((sum, a) => sum + (a.possible_loss || 0), 0))}</td>
              <td className="px-3 py-3 whitespace-nowrap text-blue-600">{formatCurrency(filteredAppeals.reduce((sum, a) => sum + (a.cme_projected_value || 0), 0))}</td>
              <td className="px-3 py-3 whitespace-nowrap">-</td>
              <td className="px-3 py-3 whitespace-nowrap">{formatCurrency(filteredAppeals.reduce((sum, a) => sum + (a.judgment_value || 0), 0))}</td>
              <td className="px-3 py-3 whitespace-nowrap text-red-600">{formatCurrency(filteredAppeals.reduce((sum, a) => sum + (a.loss || 0), 0))}</td>
              {expandedGroups.notes && <td></td>}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AppealLogTab;
