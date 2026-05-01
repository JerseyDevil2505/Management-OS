import React, { useMemo, useState } from 'react';
import { Database, CheckCircle, AlertCircle, TrendingUp, Users, FileText, Home, Calendar, FileDown } from 'lucide-react';

const InspectionInfo = ({ jobData, properties = [], inspectionData = [] }) => {
  // Year filter — gates everything on inspection_measure_date year so a measure
  // done in a prior year doesn't count toward this year's entry rate (matches
  // how the state audits annual reassessment compliance).
  const [selectedYear, setSelectedYear] = useState('all');

  // Build the list of years that actually appear in the data (by measure_date)
  const availableYears = useMemo(() => {
    const years = new Set();
    (properties || []).forEach(p => {
      if (p.inspection_measure_date) {
        const y = new Date(p.inspection_measure_date).getFullYear();
        if (!Number.isNaN(y)) years.add(y);
      }
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [properties]);

  // Apply the year gate before any metric is computed.
  const yearFilteredProperties = useMemo(() => {
    if (selectedYear === 'all' || !selectedYear) return properties;
    const target = parseInt(selectedYear, 10);
    return (properties || []).filter(p => {
      if (!p.inspection_measure_date) return false;
      return new Date(p.inspection_measure_date).getFullYear() === target;
    });
  }, [properties, selectedYear]);
  // Extract refusal codes from parsed code definitions
  const getRefusalCodesFromCodeFile = () => {
    const vendor = jobData?.vendor_type || 'BRT';
    const refusalCodes = [];

    // First try to get from infoby_category_config (ProductionTracker)
    if (jobData?.infoby_category_config?.refusal) {
      return jobData.infoby_category_config.refusal;
    }

    // Otherwise extract from parsed_code_definitions (code file)
    const codeDefs = jobData?.parsed_code_definitions;
    if (!codeDefs) return refusalCodes;

    // Helper to scan a section's entries (and their nested MAP) for REFUSED descriptions
    const scanForRefusedCodes = (section) => {
      if (!section || typeof section !== 'object') return;
      Object.values(section).forEach(item => {
        // Check top-level entry
        if (item?.DATA?.VALUE && item.DATA.VALUE.toUpperCase().includes('REFUSED')) {
          const code = item.KEY || item.DATA.KEY;
          if (code) refusalCodes.push(code);
        }
        // Check nested MAP entries (e.g. INFO. BY subsection contains the actual codes)
        if (item?.MAP && typeof item.MAP === 'object') {
          Object.values(item.MAP).forEach(subItem => {
            if (subItem?.DATA?.VALUE && subItem.DATA.VALUE.toUpperCase().includes('REFUSED')) {
              const code = subItem.KEY || subItem.DATA.KEY;
              if (code) refusalCodes.push(code);
            }
          });
        }
      });
    };

    if (vendor === 'BRT') {
      // BRT: Look in Residential section for "REFUSED" descriptions
      const residentialSection = codeDefs.sections?.['Residential'] || {};
      scanForRefusedCodes(residentialSection);
    } else if (vendor === 'Microsystems') {
      // Microsystems: Look for "REFUSED" in any section
      const sections = codeDefs.sections || {};
      Object.values(sections).forEach(section => {
        scanForRefusedCodes(section);
      });
    }

    return refusalCodes;
  };

  const refusalCodes = getRefusalCodesFromCodeFile();
  const vendor = jobData?.vendor_type || 'BRT';

  const metrics = useMemo(() => {
    if (!yearFilteredProperties || yearFilteredProperties.length === 0) {
      return {
        totalProperties: 0,
        inspected: 0,
        notInspected: 0,
        entryRate: 0,
        improvedTotal: 0,
        improvedInspected: 0,
        improvedNotInspected: 0,
        improvedEntryRate: 0,
        interiorEntries: 0,
        improvedInteriorEntries: 0,
        improvedInteriorRate: 0,
        byClass: {},
        byVCS: {},
        missingInspections: [],
        inspectorBreakdown: {}
      };
    }

    let inspected = 0;
    let notInspected = 0;
    let improvedTotal = 0;
    let improvedInspected = 0;
    let improvedNotInspected = 0;
    let interiorEntries = 0;          // entries whose info_by_code is in the configured "entry" category
    let improvedInteriorEntries = 0;  // same, restricted to improved properties
    const residentialEntryDates = [];
    let mostRecentInteriorEntry = null;
    const entryCodes = jobData?.infoby_category_config?.entry || [];
    const byClass = {};
    const byVCS = {};
    const missingInspections = [];
    const inspectorBreakdown = {};

    yearFilteredProperties.forEach(prop => {
      const propertyClass = prop.property_m4_class || 'Unknown';
      if (!byClass[propertyClass]) {
        byClass[propertyClass] = { total: 0, inspected: 0, improvedTotal: 0, improvedInspected: 0 };
      }
      byClass[propertyClass].total++;

      // Determine VCS category
      const vcsCode = prop.new_vcs || prop.vcs_code || '';
      let vcsCategory = 'residential';
      if (vcsCode === '00' || vcsCode.toUpperCase() === 'VACANT') {
        vcsCategory = 'vacant';
      } else if (vcsCode.toUpperCase() === 'COMM' || propertyClass?.toUpperCase().includes('COMM')) {
        vcsCategory = 'commercial';
      }

      // Only include residential for VCS breakdown
      const isResidential = vcsCategory === 'residential';
      if (isResidential) {
        const vcsLabel = vcsCode || 'Unknown';
        if (!byVCS[vcsLabel]) {
          byVCS[vcsLabel] = { total: 0, inspected: 0, refusals: 0 };
        }
        byVCS[vcsLabel].total++;
      }

      // Entry = has list_by + list_date (BRT: LISTBY/LISTDT, Microsystems: Insp By/Insp Date)
      const hasListBy = prop.inspection_list_by && prop.inspection_list_by.trim();
      const hasListDate = prop.inspection_list_date;
      const hasEntry = hasListBy && hasListDate;

      // Refusal check - use vendor-specific code field
      let hasRefusal = false;
      if (vendor === 'Microsystems') {
        // Microsystems: check info_by_code
        const infoByCode = prop.info_by_code;
        hasRefusal = infoByCode && refusalCodes.includes(infoByCode);
      } else {
        // BRT (default): check inspection_info_by field
        const infoByCode = prop.inspection_info_by;
        hasRefusal = infoByCode && refusalCodes.includes(infoByCode);
      }

      // Improved property = has improvement value > 0
      const improvementValue = parseFloat(prop.values_cama_improvement || prop.values_mod_improvement || 0);
      const isImproved = improvementValue > 0;

      if (isImproved) {
        improvedTotal++;
        byClass[propertyClass].improvedTotal++;
      }

      // Refusals have list_by/list_date but should NOT count as entries
      if (hasRefusal) {
        notInspected++;
        if (isImproved) {
          improvedNotInspected++;
        }

        // Track refusals in VCS breakdown
        if (isResidential) {
          const vcsLabel = vcsCode || 'Unknown';
          byVCS[vcsLabel].refusals++;
        }

        // Track inspector who recorded the refusal
        if (hasListBy) {
          const inspector = prop.inspection_list_by.trim();
          if (!inspectorBreakdown[inspector]) {
            inspectorBreakdown[inspector] = 0;
          }
          inspectorBreakdown[inspector]++;
        }

        // Track in missing list
        if (missingInspections.length < 500) {
          missingInspections.push({
            block: prop.property_block || '',
            lot: prop.property_lot || '',
            qualifier: prop.property_qualifier || '',
            location: prop.property_location || '',
            class: propertyClass,
            owner: prop.owner_name || '',
            isImproved,
            isRefusal: true
          });
        }
      } else if (hasEntry) {
        inspected++;
        byClass[propertyClass].inspected++;

        // Interior-entry tally: only when info_by_code is in the configured entry category.
        // If no entry codes are configured, treat any non-refusal listing as interior.
        const infoByForInterior = vendor === 'Microsystems' ? prop.info_by_code : prop.inspection_info_by;
        const isInteriorEntry = entryCodes.length > 0
          ? (infoByForInterior && entryCodes.includes(infoByForInterior))
          : true;
        if (isInteriorEntry) {
          interiorEntries++;
        }

        if (isResidential) {
          const vcsLabel = vcsCode || 'Unknown';
          byVCS[vcsLabel].inspected++;
        }

        if (isImproved) {
          improvedInspected++;
          byClass[propertyClass].improvedInspected++;
          if (isInteriorEntry) {
            improvedInteriorEntries++;
          }
        }

        // Track residential (2/3A) dates for average measured + most recent interior entry
        const isResClass = propertyClass === '2' || propertyClass === '3A';
        if (isResClass) {
          // Average inspected date uses measure_date
          if (prop.inspection_measure_date) {
            residentialEntryDates.push(new Date(prop.inspection_measure_date));
          }

          // Most recent interior entry uses list_date
          if (hasListDate) {
            const infoByCode = vendor === 'Microsystems' ? prop.info_by_code : prop.inspection_info_by;
            // If entry codes are configured, use them; otherwise any entry counts
            const isInterior = entryCodes.length > 0
              ? (infoByCode && entryCodes.includes(infoByCode))
              : hasEntry;
            if (isInterior) {
              const entryDate = new Date(prop.inspection_list_date);
              if (!mostRecentInteriorEntry || entryDate > mostRecentInteriorEntry) {
                mostRecentInteriorEntry = entryDate;
              }
            }
          }
        }

        // Track inspector by list_by
        const inspector = prop.inspection_list_by.trim();
        if (!inspectorBreakdown[inspector]) {
          inspectorBreakdown[inspector] = 0;
        }
        inspectorBreakdown[inspector]++;
      } else {
        notInspected++;
        if (isImproved) {
          improvedNotInspected++;
        }

        // Track missing - limit to first 500 for display
        if (missingInspections.length < 500) {
          missingInspections.push({
            block: prop.property_block || '',
            lot: prop.property_lot || '',
            qualifier: prop.property_qualifier || '',
            location: prop.property_location || '',
            class: propertyClass,
            owner: prop.owner_name || '',
            isImproved,
            isRefusal: false
          });
        }
      }
    });

    const entryRate = properties.length > 0
      ? ((inspected / properties.length) * 100).toFixed(1)
      : 0;

    const improvedEntryRate = improvedTotal > 0
      ? ((improvedInspected / improvedTotal) * 100).toFixed(1)
      : 0;

    // Calculate average inspection date for residential (Class 2/3A)
    let avgInspectionDate = null;
    if (residentialEntryDates.length > 0) {
      const totalMs = residentialEntryDates.reduce((sum, d) => sum + d.getTime(), 0);
      avgInspectionDate = new Date(totalMs / residentialEntryDates.length);
    }

    const improvedInteriorRate = improvedTotal > 0
      ? ((improvedInteriorEntries / improvedTotal) * 100).toFixed(1)
      : 0;

    return {
      totalProperties: yearFilteredProperties.length,
      inspected,
      notInspected,
      entryRate: parseFloat(entryRate),
      improvedTotal,
      improvedInspected,
      improvedNotInspected,
      improvedEntryRate: parseFloat(improvedEntryRate),
      interiorEntries,
      improvedInteriorEntries,
      improvedInteriorRate: parseFloat(improvedInteriorRate),
      byClass,
      byVCS,
      missingInspections,
      inspectorBreakdown,
      avgInspectionDate,
      mostRecentInteriorEntry
    };
  }, [yearFilteredProperties, refusalCodes, vendor, jobData]);

  const sortedClasses = Object.entries(metrics.byClass)
    .sort(([a], [b]) => a.localeCompare(b));

  const sortedVCS = Object.entries(metrics.byVCS)
    .sort(([a], [b]) => {
      // Sort with 'Unknown' last
      if (a === 'Unknown') return 1;
      if (b === 'Unknown') return -1;
      return a.localeCompare(b);
    });

  const sortedInspectors = Object.entries(metrics.inspectorBreakdown)
    .sort(([, a], [, b]) => b - a);

  // PDF export — annual reassessment audit snapshot for LOJIK clients to
  // submit to the state. Mirrors the styling used in AppealsSummary.
  const exportPDF = async () => {
    if (!yearFilteredProperties || yearFilteredProperties.length === 0) return;

    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 36;
    const lojikBlue = [0, 102, 204];

    const yearLbl = selectedYear === 'all' ? 'All Years' : String(selectedYear);
    const jobName = jobData?.job_name || jobData?.name || 'Job';
    const ccdd = jobData?.ccdd_code ? ` (${jobData.ccdd_code})` : '';

    // Try to load logo
    let logoDataUrl = null;
    try {
      const response = await fetch('/lojik-logo.PNG');
      const blob = await response.blob();
      logoDataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn('Could not load logo:', err);
    }

    // Draw all header TEXT first (so PNG state corruption can't affect it).
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(17, 24, 39); // gray-900
    doc.text('Inspection Info Report', pageWidth - margin, margin + 18, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(55, 65, 81);
    doc.text(`${jobName}${ccdd}`, pageWidth - margin, margin + 34, { align: 'right' });
    doc.text(`Year: ${yearLbl}`, pageWidth - margin, margin + 48, { align: 'right' });
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth - margin, margin + 62, { align: 'right' });

    // Divider
    doc.setDrawColor(0, 102, 204);
    doc.setLineWidth(1.5);
    doc.line(margin, margin + 74, pageWidth - margin, margin + 74);

    // Subtitle
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(75, 85, 99);
    doc.text(
      'Annual reassessment inspection summary — gated on measure date',
      margin,
      margin + 88
    );

    // Logo LAST (PNG → JPEG via canvas to strip alpha and avoid GState leak)
    let logoRendered = false;
    if (logoDataUrl) {
      try {
        const img = await new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = logoDataUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 360;
        canvas.height = img.naturalHeight || 160;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95);
        doc.addImage(jpegDataUrl, 'JPEG', margin, margin, 90, 40);
        logoRendered = true;
      } catch (err) {
        console.warn('Logo render failed, falling back to text:', err);
      }
    }
    if (!logoRendered) {
      doc.setTextColor(0, 102, 204);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('LOJIK', margin, margin + 26);
    }

    // Summary metrics table
    const fmtDate = (d) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const summaryRows = [
      ['Total Properties (filtered)', metrics.totalProperties.toLocaleString()],
      ['Improved Properties', metrics.improvedTotal.toLocaleString()],
      ['Improved Entries', metrics.improvedInspected.toLocaleString()],
      ['Improved No Entry', metrics.improvedNotInspected.toLocaleString()],
      ['Improved Entry Rate', `${metrics.improvedEntryRate}%`],
      ['Improved Interior Entries', `${metrics.improvedInteriorEntries.toLocaleString()} / ${metrics.improvedTotal.toLocaleString()} (${metrics.improvedInteriorRate}%)`],
      ['Avg Measured Date (2/3A)', fmtDate(metrics.avgInspectionDate)],
      ['Latest Interior Entry (2/3A)', fmtDate(metrics.mostRecentInteriorEntry)]
    ];

    autoTable(doc, {
      head: [['Metric', 'Value']],
      body: summaryRows,
      startY: margin + 100,
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 5, lineColor: [220, 220, 220], lineWidth: 0.5 },
      headStyles: { fillColor: lojikBlue, textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 220 },
        1: { halign: 'right' }
      },
      didParseCell: (data) => { if (data.section !== 'body') return; }
    });

    // Property class breakdown
    const classBody = sortedClasses.map(([cls, data]) => {
      const rate = data.total > 0 ? ((data.inspected / data.total) * 100).toFixed(1) : '0.0';
      const imprRate = data.improvedTotal > 0
        ? ((data.improvedInspected / data.improvedTotal) * 100).toFixed(1)
        : '—';
      return [
        cls,
        data.total.toLocaleString(),
        data.inspected.toLocaleString(),
        `${rate}%`,
        data.improvedTotal.toLocaleString(),
        data.improvedTotal > 0 ? `${imprRate}%` : '—'
      ];
    });

    autoTable(doc, {
      head: [['Class', 'Total', 'Entries', 'Rate', 'Improved', 'Impr Rate']],
      body: classBody,
      startY: doc.lastAutoTable.finalY + 18,
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 5, lineColor: [220, 220, 220], lineWidth: 0.5 },
      headStyles: { fillColor: lojikBlue, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
      columnStyles: {
        0: { fontStyle: 'bold' },
        1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' },
        4: { halign: 'right' }, 5: { halign: 'right' }
      }
    });

    // VCS breakdown (residential)
    if (sortedVCS.length > 0) {
      const vcsBody = sortedVCS.map(([vcs, data]) => {
        const rate = data.total > 0 ? ((data.inspected / data.total) * 100).toFixed(1) : '0.0';
        return [
          vcs,
          data.total.toLocaleString(),
          data.inspected.toLocaleString(),
          `${rate}%`,
          data.refusals.toLocaleString()
        ];
      });

      autoTable(doc, {
        head: [['VCS Code', 'Total', 'Entries', 'Rate', 'Refusals']],
        body: vcsBody,
        startY: doc.lastAutoTable.finalY + 18,
        margin: { left: margin, right: margin },
        styles: { fontSize: 9, cellPadding: 5, lineColor: [220, 220, 220], lineWidth: 0.5 },
        headStyles: { fillColor: lojikBlue, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
        columnStyles: {
          0: { fontStyle: 'bold' },
          1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' },
          4: { halign: 'right' }
        }
      });
    }

    // Inspector breakdown
    if (sortedInspectors.length > 0) {
      const inspectorBody = sortedInspectors.map(([name, count]) => [
        name,
        count.toLocaleString(),
        metrics.inspected > 0 ? `${((count / metrics.inspected) * 100).toFixed(1)}%` : '0.0%'
      ]);

      autoTable(doc, {
        head: [['Inspector', 'Entries', '% of Total']],
        body: inspectorBody,
        startY: doc.lastAutoTable.finalY + 18,
        margin: { left: margin, right: margin },
        styles: { fontSize: 9, cellPadding: 5, lineColor: [220, 220, 220], lineWidth: 0.5 },
        headStyles: { fillColor: lojikBlue, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
        columnStyles: {
          0: { fontStyle: 'bold' },
          1: { halign: 'right' }, 2: { halign: 'right' }
        }
      });
    }

    // Page numbers
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Page ${i} of ${pageCount}`,
        pageWidth - margin,
        doc.internal.pageSize.getHeight() - 18,
        { align: 'right' }
      );
    }

    const safeJob = jobName.replace(/[^a-z0-9]+/gi, '_');
    const filename = `Inspection_Info_${safeJob}_${yearLbl}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.pdf`;
    doc.save(filename);
  };

  if (!properties || properties.length === 0) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="text-center text-gray-500 py-12">
          <Database className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-semibold mb-2">No Property Data</h3>
          <p>Upload property data files to see inspection metrics.</p>
        </div>
      </div>
    );
  }

  const yearLabel = selectedYear === 'all' ? 'All Years' : selectedYear;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-600" />
            Inspection Info
            <span className="text-sm font-normal text-gray-500">— {yearLabel}</span>
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Year filter gates on <span className="font-medium">measure date</span> — a property measured in a prior year doesn't count toward this year's entry rate, even if a later listing exists.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Year:</label>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Years</option>
            {availableYears.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={exportPDF}
            disabled={yearFilteredProperties.length === 0}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            title="Export this Inspection Info snapshot as PDF (state audit ready)"
          >
            <FileDown className="w-4 h-4" />
            Export PDF
          </button>
        </div>
      </div>

      {yearFilteredProperties.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-sm text-amber-800">
          No properties have a measure date in <span className="font-semibold">{yearLabel}</span>. Pick a different year to see metrics.
        </div>
      )}

      {/* Summary Cards - Improved Properties (entry rate only matters for improved) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white p-5 rounded-lg border-2 border-indigo-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Improved Properties</p>
              <p className="text-3xl font-bold text-indigo-600">{metrics.improvedTotal.toLocaleString()}</p>
            </div>
            <Home className="w-8 h-8 text-indigo-400" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border-2 border-green-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Improved Entries</p>
              <p className="text-3xl font-bold text-green-600">{metrics.improvedInspected.toLocaleString()}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-400" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border-2 border-amber-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Improved No Entry</p>
              <p className="text-3xl font-bold text-amber-600">{metrics.improvedNotInspected.toLocaleString()}</p>
            </div>
            <AlertCircle className="w-8 h-8 text-amber-400" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border-2 border-teal-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Improved Entry Rate</p>
              <p className="text-3xl font-bold text-teal-600">{metrics.improvedEntryRate}%</p>
            </div>
            <TrendingUp className="w-8 h-8 text-teal-400" />
          </div>
          <div className="mt-2 bg-gray-200 rounded-full h-2">
            <div
              className="bg-teal-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.min(metrics.improvedEntryRate, 100)}%` }}
            />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border-2 border-blue-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Avg Measured Date (2/3A)</p>
              <p className="text-2xl font-bold text-blue-600">
                {metrics.avgInspectionDate
                  ? metrics.avgInspectionDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : '\u2014'}
              </p>
            </div>
            <Calendar className="w-8 h-8 text-blue-400" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border-2 border-purple-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Latest Interior Entry (2/3A)</p>
              <p className="text-2xl font-bold text-purple-600">
                {metrics.mostRecentInteriorEntry
                  ? metrics.mostRecentInteriorEntry.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : '\u2014'}
              </p>
            </div>
            <Home className="w-8 h-8 text-purple-400" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border-2 border-rose-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Improved Interior Entries</p>
              <p className="text-3xl font-bold text-rose-600">
                {metrics.improvedInteriorEntries.toLocaleString()}
                <span className="text-base font-medium text-gray-400 ml-2">/ {metrics.improvedTotal.toLocaleString()}</span>
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {metrics.improvedInteriorRate}% interior entry rate
              </p>
            </div>
            <CheckCircle className="w-8 h-8 text-rose-400" />
          </div>
          <div className="mt-2 bg-gray-200 rounded-full h-2">
            <div
              className="bg-rose-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.min(metrics.improvedInteriorRate, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* By VCS - Residential Only */}
        <div className="bg-white rounded-lg border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">
            Residential Inspections by VCS
          </h3>
          {sortedVCS.length === 0 ? (
            <p className="text-gray-400 text-sm">No residential properties found.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 text-gray-500">VCS Code</th>
                  <th className="text-right py-2 text-gray-500">Total</th>
                  <th className="text-right py-2 text-gray-500">Entry</th>
                  <th className="text-right py-2 text-gray-500">Rate</th>
                  <th className="text-right py-2 text-gray-500">Refusal</th>
                </tr>
              </thead>
              <tbody>
                {sortedVCS.map(([vcsCode, data]) => {
                  const entryRate = data.total > 0 ? (data.inspected / data.total) * 100 : 0;
                  return (
                    <tr key={vcsCode} className="border-b border-gray-100">
                      <td className="py-2 font-medium">{vcsCode}</td>
                      <td className="text-right py-2">{data.total.toLocaleString()}</td>
                      <td className="text-right py-2">{data.inspected.toLocaleString()}</td>
                      <td className="text-right py-2">
                        <span className={`font-medium ${
                          entryRate >= 90 ? 'text-green-600'
                          : entryRate >= 50 ? 'text-amber-600'
                          : 'text-red-600'
                        }`}>
                          {entryRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="text-right py-2 text-red-600">{data.refusals.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* By Class */}
        <div className="bg-white rounded-lg border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">
            Breakdown by Property Class
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 text-gray-500">Class</th>
                <th className="text-right py-2 text-gray-500">Total</th>
                <th className="text-right py-2 text-gray-500">Entries</th>
                <th className="text-right py-2 text-gray-500">Rate</th>
                <th className="text-right py-2 text-gray-500">Impr</th>
                <th className="text-right py-2 text-gray-500">Impr Rate</th>
              </tr>
            </thead>
            <tbody>
              {sortedClasses.map(([cls, data]) => {
                const classRate = data.total > 0 ? (data.inspected / data.total) * 100 : 0;
                const imprRate = data.improvedTotal > 0 ? (data.improvedInspected / data.improvedTotal) * 100 : 0;
                return (
                  <tr key={cls} className="border-b border-gray-100">
                    <td className="py-2 font-medium">{cls}</td>
                    <td className="text-right py-2">{data.total.toLocaleString()}</td>
                    <td className="text-right py-2">{data.inspected.toLocaleString()}</td>
                    <td className="text-right py-2">
                      <span className={`font-medium ${
                        classRate >= 90 ? 'text-green-600'
                        : classRate >= 50 ? 'text-amber-600'
                        : 'text-red-600'
                      }`}>
                        {classRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="text-right py-2 text-indigo-600">{data.improvedTotal.toLocaleString()}</td>
                    <td className="text-right py-2">
                      {data.improvedTotal > 0 ? (
                        <span className={`font-medium ${
                          imprRate >= 90 ? 'text-green-600'
                          : imprRate >= 50 ? 'text-amber-600'
                          : 'text-red-600'
                        }`}>
                          {imprRate.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Inspector Breakdown */}
        <div className="bg-white rounded-lg border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide flex items-center gap-2">
            <Users className="w-4 h-4" />
            Inspector Breakdown
          </h3>
          {sortedInspectors.length === 0 ? (
            <p className="text-gray-400 text-sm">No inspections recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 text-gray-500">Inspector</th>
                  <th className="text-right py-2 text-gray-500">Entries</th>
                  <th className="text-right py-2 text-gray-500">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {sortedInspectors.map(([inspector, count]) => (
                  <tr key={inspector} className="border-b border-gray-100">
                    <td className="py-2 font-medium">{inspector}</td>
                    <td className="text-right py-2">{count.toLocaleString()}</td>
                    <td className="text-right py-2 text-gray-500">
                      {((count / metrics.inspected) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Missing Inspections */}
      <div className="bg-white rounded-lg border p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-500" />
          Missing Entries
          <span className="text-xs font-normal text-gray-400 ml-2">
            ({metrics.notInspected.toLocaleString()} total
            {metrics.missingInspections.length < metrics.notInspected ? `, showing first ${metrics.missingInspections.length}` : ''})
          </span>
        </h3>
        {metrics.missingInspections.length === 0 ? (
          <div className="text-center py-8 text-green-600">
            <CheckCircle className="w-10 h-10 mx-auto mb-2" />
            <p className="font-medium">All properties have entries!</p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b">
                  <th className="text-left py-2 text-gray-500">Block</th>
                  <th className="text-left py-2 text-gray-500">Lot</th>
                  <th className="text-left py-2 text-gray-500">Qual</th>
                  <th className="text-left py-2 text-gray-500">Class</th>
                  <th className="text-left py-2 text-gray-500">Location</th>
                  <th className="text-left py-2 text-gray-500">Owner</th>
                  <th className="text-center py-2 text-gray-500">Impr</th>
                  <th className="text-center py-2 text-gray-500">Ref</th>
                </tr>
              </thead>
              <tbody>
                {metrics.missingInspections.map((prop, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-1.5">{prop.block}</td>
                    <td className="py-1.5">{prop.lot}</td>
                    <td className="py-1.5">{prop.qualifier || '-'}</td>
                    <td className="py-1.5">{prop.class}</td>
                    <td className="py-1.5 text-gray-600">{prop.location}</td>
                    <td className="py-1.5 text-gray-600">{prop.owner}</td>
                    <td className="py-1.5 text-center">
                      {prop.isImproved ? (
                        <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" title="Improved"></span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="py-1.5 text-center">
                      {prop.isRefusal ? (
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700" title="Refusal">R</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default InspectionInfo;
