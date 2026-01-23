import React, { useState, useEffect, useRef } from 'react';
import {
  AlertCircle,
  RefreshCw,
  Download,
  Check,
  X,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import './sharedTabNav.css';
import { supabase, interpretCodes, propertyService, checklistService } from '../../../lib/supabaseClient';

const DataQualityTab = ({ 
  // Props from parent
  properties,
  jobData,
  vendorType,
  codeDefinitions,
  availableFields,
  marketLandData,    
  onUpdateJobCache 
}) => {
  // ==================== INTERNAL STATE MANAGEMENT ====================
  const [checkResults, setCheckResults] = useState({});
  const [rawResults, setRawResults] = useState({});
  const [qualityScore, setQualityScore] = useState(null);
  const [issueStats, setIssueStats] = useState({
    critical: 0,
    warning: 0,
    info: 0,
    total: 0
  });
  const [customChecks, setCustomChecks] = useState([]);
  const [currentCustomCheck, setCurrentCustomCheck] = useState({
    conditions: [{ logic: 'IF', field: '', operator: '=', value: '' }]
  });
  const [runHistory, setRunHistory] = useState([]);
  const [isDataQualityComplete, setIsDataQualityComplete] = useState(false);
  const [dataQualityActiveSubTab, setDataQualityActiveSubTab] = useState('overview');
  const [expandedCategories, setExpandedCategories] = useState(['mod_iv']);
  const [isRunningChecks, setIsRunningChecks] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0, phase: '' });
  const [allRawDataFields, setAllRawDataFields] = useState([]);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [ignoredIssues, setIgnoredIssues] = useState(new Set());
  const [modalData, setModalData] = useState({ title: '', properties: [] });

  // Helper: filter out ignored issues from results for display
  const filterIgnoredResults = (results, ignoredSet = ignoredIssues) => {
    const out = {};
    Object.entries(results).forEach(([cat, arr]) => {
      out[cat] = (arr || []).filter(issue => !ignoredSet.has(`${issue.property_key}-${issue.check}`));
    });
    return out;
  };

  // Helper: get only ignored issues from raw results
  const getIgnoredResults = (ignoredSet = ignoredIssues) => {
    const out = {};
    Object.entries(rawResults || {}).forEach(([cat, arr]) => {
      out[cat] = (arr || []).filter(issue => ignoredSet.has(`${issue.property_key}-${issue.check}`));
    });
    return out;
  };

  const computeStatsFromResults = (results) => {
    let critical = 0, warning = 0, info = 0;
    Object.values(results).forEach(category => {
      (category || []).forEach(issue => {
        if (issue.severity === 'critical') critical++;
        else if (issue.severity === 'warning') warning++;
        else if (issue.severity === 'info') info++;
      });
    });
    const total = critical + warning + info;
    return { critical, warning, info, total };
  };

  // Apply ignored filter and update UI state (scores + stats + results)
  const applyAndSetResults = (results, ignoredSet = ignoredIssues) => {
    const filtered = filterIgnoredResults(results, ignoredSet);
    setCheckResults(filtered);
    const score = calculateQualityScore(filtered);
    setQualityScore(score);
    const stats = computeStatsFromResults(filtered);
    setIssueStats(stats);
  };

  // Refs for uncontrolled inputs
  const customCheckNameInputRef = useRef(null);
  const customCheckSeveritySelectRef = useRef(null);

// Load saved data from props instead of database
  useEffect(() => {
    if (marketLandData) {
      // Load run history
      if (marketLandData.quality_check_results?.history) {
        setRunHistory(marketLandData.quality_check_results.history);
      }
      
      // Load custom checks
      if (marketLandData.custom_checks) {
        setCustomChecks(marketLandData.custom_checks);
      }
      
      // Load quality score
      if (marketLandData.quality_score) {
        setQualityScore(marketLandData.quality_score);
      }
      // Load ignored issues
      if (marketLandData.ignored_issues) {
        setIgnoredIssues(new Set(marketLandData.ignored_issues));
      }
    }
  }, [marketLandData]);

  // Re-apply filter when ignored issues change (e.g., loaded from database)
  useEffect(() => {
    if (rawResults && Object.keys(rawResults).length > 0 && ignoredIssues.size > 0) {
      const filtered = filterIgnoredResults(rawResults, ignoredIssues);
      setCheckResults(filtered);
      const score = calculateQualityScore(filtered);
      setQualityScore(score);
      const stats = computeStatsFromResults(filtered);
      setIssueStats(stats);
      console.log(`🔄 Re-filtered results with ${ignoredIssues.size} ignored issues`);
    }
  }, [ignoredIssues, rawResults]);

  // Initialize overview stats from last run if available
  useEffect(() => {
    if (marketLandData && marketLandData.quality_check_results?.history?.length > 0) {
      const lastRun = marketLandData.quality_check_results.history[0];

      // Restore stats from last run
      setIssueStats({
        critical: lastRun.criticalCount || 0,
        warning: lastRun.warningCount || 0,
        info: lastRun.infoCount || 0,
        total: lastRun.totalIssues || 0
      });

      // Set the quality score from last run
      if (lastRun.qualityScore) {
        setQualityScore(lastRun.qualityScore);
      }

      console.log(`📊 Restored stats from last run: ${new Date(lastRun.date).toLocaleDateString()}`);
    }

    // Load checklist status for Data Quality Analysis
    const loadChecklistStatus = async () => {
      try {
        if (!jobData?.id) return;
        const { data } = await supabase
          .from('checklist_item_status')
          .select('status')
          .eq('job_id', jobData.id)
          .eq('item_id', 'data-quality-analysis')
          .maybeSingle();
        setIsDataQualityComplete(data?.status === 'completed');
      } catch (e) {
        // ignore
      }
    };

    loadChecklistStatus();
  }, [marketLandData, jobData?.id]);

  // ESC key handler for modal
  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        setShowDetailsModal(false);
      }
    };
    
    if (showDetailsModal) {
      window.addEventListener('keydown', handleEsc);
      return () => {
        window.removeEventListener('keydown', handleEsc);
      };
    }
  }, [showDetailsModal]);

  // Populate raw data fields from a sample property
  useEffect(() => {
    const populateRawDataFields = async () => {
      if (properties.length > 0 && jobData?.id) {
        try {
          // Get raw data from the first property to discover available fields
          const sampleProperty = properties[0];
          const rawData = await propertyService.getRawDataForProperty(
            sampleProperty.job_id,
            sampleProperty.property_composite_key
          );

          if (rawData && typeof rawData === 'object') {
            const fieldNames = Object.keys(rawData).sort();
            setAllRawDataFields(fieldNames);
          }
        } catch (error) {
          console.error('Error loading raw data fields:', error);
        }
      }
    };

    populateRawDataFields();
  }, [properties, jobData?.id]);

  // ==================== DATA QUALITY FUNCTIONS ====================
  const exportToExcel = () => {
    if (Object.keys(checkResults).length === 0) return;
    
    const wb = XLSX.utils.book_new();
    const timestamp = new Date().toISOString().split('T')[0];
    const jobInfo = `${jobData?.job_number || 'Job'}_${jobData?.municipality || 'Municipality'}`;
    
    // SUMMARY SHEET
    const summaryData = [
      ['Data Quality Summary Report'],
      [],
      ['Job Information'],
      ['Job Number', jobData?.job_number || 'N/A'],
      ['Municipality', jobData?.municipality || 'N/A'],
      ['County', jobData?.county || 'N/A'],
      ['State', jobData?.state || 'N/A'],
      ['Analysis Date', new Date().toLocaleDateString()],
      [],
      ['Overall Metrics'],
      ['Total Properties', properties.length],
      ['Properties with Issues', issueStats.total],
      ['Critical Issues', issueStats.critical],
      ['Warnings', issueStats.warning],
      ['Info Messages', issueStats.info],
      ['Quality Score', `${qualityScore}%`],
      [],
      ['Issues by Category'],
      ['Category', 'Critical', 'Warning', 'Info', 'Total']
    ];
    
    Object.entries(checkResults).forEach(([category, issues]) => {
      if (issues && issues.length > 0) {
        const critical = issues.filter(i => i.severity === 'critical').length;
        const warning = issues.filter(i => i.severity === 'warning').length;
        const info = issues.filter(i => i.severity === 'info').length;
        summaryData.push([
          category.replace(/_/g, ' ').toUpperCase(),
          critical,
          warning,
          info,
          issues.length
        ]);
      }
    });
    
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    summarySheet['!cols'] = [
      { wch: 35 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 }
    ];

    // Apply styling to summary sheet
    const summaryRange = XLSX.utils.decode_range(summarySheet['!ref']);
    const headerRows = [0, 2, 9, 18]; // Title, Job Info, Overall Metrics, Issues by Category
    const tableHeaderRow = summaryData.findIndex(row => row[0] === 'Category');

    for (let R = summaryRange.s.r; R <= summaryRange.e.r; ++R) {
      for (let C = summaryRange.s.c; C <= summaryRange.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!summarySheet[cellAddress]) continue;

        const isHeader = headerRows.includes(R) || R === tableHeaderRow;

        summarySheet[cellAddress].s = {
          font: { name: 'Leelawadee', sz: 10, bold: isHeader },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
      }
    }

    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
    
    // DETAILS SHEET
    const detailsData = [
      ['Block', 'Lot', 'Qualifier', 'Card', 'Location', 'Class', 'Check Type', 'Severity', 'Message']
    ];
    
    Object.entries(checkResults).forEach(([category, issues]) => {
      if (issues && issues.length > 0) {
        issues.forEach(issue => {
          const property = properties.find(p => p.property_composite_key === issue.property_key);
          
          if (property) {
            detailsData.push([
              property.property_block || '',
              property.property_lot || '',
              property.property_qualifier || '',
              property.property_addl_card || '1',
              property.property_location || '',
              property.property_m4_class || '',
              getCheckTitle(issue.check),
              issue.severity,
              issue.message
            ]);
          } else {
            // Fallback if property not found - parse the composite key
            // Format: YEAR+CCDD-BLOCK-LOT_QUALIFIER-CARD-LOCATION
            const mainParts = issue.property_key.split('-');
            const block = mainParts[1] || '';
            const lotQual = mainParts[2] || '';
            const [lot, qualifier] = lotQual.split('_');
            const card = mainParts[3] || '';
            const location = mainParts[4] || '';
            
            detailsData.push([
              block,
              lot || '',
              qualifier || '',
              card || '1',
              location,
              '',
              getCheckTitle(issue.check),
              issue.severity,
              issue.message
            ]);
          }
        });
      }
    });
    
    const detailsSheet = XLSX.utils.aoa_to_sheet(detailsData);
    detailsSheet['!cols'] = [
      { wch: 15 },
      { wch: 15 },
      { wch: 12 },
      { wch: 10 },
      { wch: 20 },
      { wch: 10 },
      { wch: 45 },
      { wch: 12 },
      { wch: 60 }
    ];

    // Apply styling to details sheet
    const range = XLSX.utils.decode_range(detailsSheet['!ref']);
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!detailsSheet[cellAddress]) continue;

        const isHeader = R === 0;

        detailsSheet[cellAddress].s = {
          font: { name: 'Leelawadee', sz: 10, bold: isHeader },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
      }
    }
    
    XLSX.utils.book_append_sheet(wb, detailsSheet, 'Details');
    XLSX.writeFile(wb, `DQ_Report_${jobInfo}_${timestamp}.xlsx`);
    
    console.log('✅ Excel report exported successfully');
  };

  // Export ONLY ignored issues to Excel
  const exportIgnoredToExcel = () => {
    if (ignoredIssues.size === 0) return;
    const ignoredByCategory = getIgnoredResults();
    const hasAny = Object.values(ignoredByCategory).some(arr => arr && arr.length > 0);
    if (!hasAny) return;

    const wb = XLSX.utils.book_new();
    const timestamp = new Date().toISOString().split('T')[0];
    const jobInfo = `${jobData?.job_number || 'Job'}_${jobData?.municipality || 'Municipality'}`;

    // SUMMARY SHEET
    const summaryData = [
      ['Ignored Issues Summary'],
      [],
      ['Job Number', jobData?.job_number || 'N/A'],
      ['Municipality', jobData?.municipality || 'N/A'],
      ['Analysis Date', new Date().toLocaleDateString()],
      [],
      ['Category', 'Critical', 'Warning', 'Info', 'Total']
    ];

    Object.entries(ignoredByCategory).forEach(([category, issues]) => {
      if (issues && issues.length > 0) {
        const critical = issues.filter(i => i.severity === 'critical').length;
        const warning = issues.filter(i => i.severity === 'warning').length;
        const info = issues.filter(i => i.severity === 'info').length;
        summaryData.push([
          category.replace(/_/g, ' ').toUpperCase(),
          critical,
          warning,
          info,
          issues.length
        ]);
      }
    });

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);

    // Apply styling to summary sheet
    const summaryRange = XLSX.utils.decode_range(summarySheet['!ref']);
    const tableHeaderRow = summaryData.findIndex(row => row[0] === 'Category');

    for (let R = summaryRange.s.r; R <= summaryRange.e.r; ++R) {
      for (let C = summaryRange.s.c; C <= summaryRange.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!summarySheet[cellAddress]) continue;

        const isHeader = R === 0 || R === tableHeaderRow;

        summarySheet[cellAddress].s = {
          font: { name: 'Leelawadee', sz: 10, bold: isHeader },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
      }
    }

    summarySheet['!cols'] = [
      { wch: 35 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 }
    ];

    XLSX.utils.book_append_sheet(wb, summarySheet, 'Ignored Summary');

    // DETAILS SHEET
    const detailsData = [
      ['Block', 'Lot', 'Qualifier', 'Card', 'Location', 'Class', 'Check Type', 'Severity', 'Message']
    ];

    Object.entries(ignoredByCategory).forEach(([category, issues]) => {
      (issues || []).forEach(issue => {
        const property = properties.find(p => p.property_composite_key === issue.property_key);
        if (property) {
          detailsData.push([
            property.property_block || '',
            property.property_lot || '',
            property.property_qualifier || '',
            property.property_addl_card || '1',
            property.property_location || '',
            property.property_m4_class || '',
            getCheckTitle(issue.check),
            issue.severity,
            issue.message
          ]);
        }
      });
    });

    const detailsSheet = XLSX.utils.aoa_to_sheet(detailsData);

    // Apply styling to details sheet
    const detailsRange = XLSX.utils.decode_range(detailsSheet['!ref']);
    for (let R = detailsRange.s.r; R <= detailsRange.e.r; ++R) {
      for (let C = detailsRange.s.c; C <= detailsRange.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!detailsSheet[cellAddress]) continue;

        const isHeader = R === 0;

        detailsSheet[cellAddress].s = {
          font: { name: 'Leelawadee', sz: 10, bold: isHeader },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
      }
    }

    detailsSheet['!cols'] = [
      { wch: 15 },
      { wch: 15 },
      { wch: 12 },
      { wch: 10 },
      { wch: 20 },
      { wch: 10 },
      { wch: 45 },
      { wch: 12 },
      { wch: 60 }
    ];

    XLSX.utils.book_append_sheet(wb, detailsSheet, 'Ignored Details');

    XLSX.writeFile(wb, `DQ_Ignored_${jobInfo}_${timestamp}.xlsx`);
  };

const generateQCFormPDF = () => {
  // Create the form HTML with full-page layout
  const formHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>QC Form Template</title>
      <style>
        @page {
          size: letter;
          margin: 0.5in;
        }
        
        @media print {
          body {
            margin: 0;
            padding: 0;
          }
          .form-container {
            page-break-inside: avoid;
          }
        }
        
        body {
          font-family: Arial, sans-serif;
          font-size: 12pt;
          line-height: 1.2;
          margin: 0;
          padding: 0;
        }
        
        .form-container {
          width: 100%;
          height: 100vh;
          display: flex;
          flex-direction: column;
          padding: 0.5in;
          box-sizing: border-box;
        }
        
        h1 {
          text-align: center;
          font-size: 18pt;
          font-weight: bold;
          margin: 0 0 10px 0;
          letter-spacing: 1px;
        }
        
        h2 {
          text-align: center;
          font-size: 16pt;
          font-weight: normal;
          margin: 0 0 30px 0;
          letter-spacing: 0.5px;
        }
        
        .field-row {
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          width: 100%;
        }
        
        .field-group {
          display: flex;
          align-items: center;
          gap: 20px;
          width: 100%;
        }
        
        .field-inline {
          display: flex;
          align-items: center;
          flex: 1;
        }
        
        .label {
          font-weight: normal;
          font-size: 12pt;
          margin-right: 8px;
          white-space: nowrap;
        }
        
        .line {
          flex: 1;
          border: none;
          border-bottom: 1px solid black;
          height: 25px;
          min-width: 100px;
          background: transparent;
        }
        
        .line-short {
          flex: 0 0 100px;
          max-width: 100px;
        }
        
        .line-medium {
          flex: 0 0 150px;
          max-width: 150px;
        }
        
        .box-container {
          margin-bottom: 20px;
        }
        
        .box-label {
          font-weight: normal;
          font-size: 12pt;
          margin-bottom: 5px;
        }
        
        .box {
          width: 100%;
          border: 1px solid black;
          box-sizing: border-box;
          background: white;
        }
        
        .box-small {
          height: 80px;
        }
        
        .box-medium {
          height: 100px;
        }
        
        .box-large {
          height: 120px;
        }
        
        /* Ensure the form takes full page height */
        .content {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        
        .top-fields {
          flex: 0 0 auto;
        }
        
        .main-boxes {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: space-evenly;
          margin: 20px 0;
        }
        
        .bottom-fields {
          flex: 0 0 auto;
        }
      </style>
    </head>
    <body>
      <div class="form-container">
        <h1>PROFESSIONAL PROPERTY APPRAISERS</h1>
        <h2>QUALITY CONTROL FORM</h2>
        
        <div class="content">
          <div class="top-fields">
            <div class="field-row">
              <div class="field-inline">
                <span class="label">MUNICIPALITY:</span>
                <span class="line"></span>
              </div>
            </div>
            
            <div class="field-row">
              <div class="field-group">
                <div class="field-inline">
                  <span class="label">BLOCK:</span>
                  <span class="line line-short"></span>
                </div>
                <div class="field-inline">
                  <span class="label">LOT:</span>
                  <span class="line line-short"></span>
                </div>
                <div class="field-inline">
                  <span class="label">QUAL:</span>
                  <span class="line line-short"></span>
                </div>
              </div>
            </div>
            
            <div class="field-row">
              <div class="field-inline">
                <span class="label">INSPECTOR:</span>
                <span class="line"></span>
              </div>
            </div>
          </div>
          
          <div class="main-boxes">
            <div class="box-container">
              <div class="box-label">SKETCH:</div>
              <div class="box box-large"></div>
            </div>
            
            <div class="box-container">
              <div class="box-label">EXTERIOR:</div>
              <div class="box box-medium"></div>
            </div>
            
            <div class="box-container">
              <div class="box-label">INTERIOR:</div>
              <div class="box box-medium"></div>
            </div>
            
            <div class="box-container">
              <div class="box-label">DETACHED & NOTES:</div>
              <div class="box box-medium"></div>
            </div>
          </div>
          
          <div class="bottom-fields">
            <div class="field-row">
              <div class="field-group">
                <div class="field-inline">
                  <span class="label">PHOTO:</span>
                  <span class="line line-medium"></span>
                </div>
                <div class="field-inline">
                  <span class="label">DATE:</span>
                  <span class="line line-medium"></span>
                </div>
              </div>
            </div>
            
            <div class="field-row">
              <div class="field-inline">
                <span class="label">SUPERVISOR:</span>
                <span class="line"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
  
  // Open in new window and trigger print dialog (save as PDF option)
  const printWindow = window.open('', '_blank', 'width=850,height=1100');
  printWindow.document.write(formHTML);
  printWindow.document.close();
  
  // Auto-trigger print dialog after load
  printWindow.onload = function() {
    printWindow.print();
  };
};
  const runQualityChecks = async () => {
    setIsRunningChecks(true);
    setAnalysisProgress({ current: 0, total: properties.length, phase: 'Initializing...' });

    // VERIFY: Check when raw file was last updated to ensure we're using the latest data
    try {
      const { data: jobMeta } = await supabase
        .from('jobs')
        .select('raw_file_parsed_at, source_file_uploaded_at, updated_at')
        .eq('id', jobData.id)
        .single();

      if (jobMeta) {
        console.log('📅 Raw file last parsed:', jobMeta.raw_file_parsed_at);
        console.log('📅 Source file uploaded:', jobMeta.source_file_uploaded_at);
        console.log('📅 Job last updated:', jobMeta.updated_at);
      }
    } catch (err) {
      console.warn('Could not verify file timestamps:', err);
    }

    const results = {
      mod_iv: [],
      cama: [],
      characteristics: [],
      special: [],
      rooms: [],
      custom: []
    };

    try {
      const vendor = vendorType || jobData.vendor_source || 'BRT';

      // Create cache for raw data to avoid repeated RPC calls
      const rawDataCache = new Map();

      const pageSize = 100; // Process data in batches of 100
      const totalPages = Math.ceil(properties.length / pageSize);
      let processedCount = 0;

      for (let page = 0; page < totalPages; page++) {
        const batch = properties.slice(page * pageSize, (page + 1) * pageSize);
        setAnalysisProgress({
          current: processedCount,
          total: properties.length,
          phase: `Processing batch ${page + 1} of ${totalPages}...`
        });
        console.log(`Processing batch ${page + 1} of ${totalPages}...`);

        for (const property of batch) {
          await runPropertyChecks(property, results, rawDataCache);
          processedCount++;

          // Update progress every 200 properties since it's much faster now
          if (processedCount % 200 === 0) {
            setAnalysisProgress({
              current: processedCount,
              total: properties.length,
              phase: `Analyzing properties...`
            });
          }
        }
      }

      console.log('=== QUALITY CHECK COMPLETE ===');
      console.log(`Total properties analyzed: ${properties.length}`);
      console.log('Issues found by category:');
      Object.entries(results).forEach(([category, issues]) => {
        console.log(`  ${category}: ${issues.length} issues`);
        if (category === 'special' && issues.length > 0) {
          const specialTypes = [...new Set(issues.map(i => i.check))];
          specialTypes.forEach(type => {
            const count = issues.filter(i => i.check === type).length;
            console.log(`    - ${type}: ${count} properties`);
          });
        }
      });
      
      // Initialize raw results with standard checks
      setRawResults(results);

      // Run all custom checks automatically
      if (customChecks.length > 0) {
        setAnalysisProgress({
          current: 0,
          total: customChecks.length,
          phase: `Running ${customChecks.length} custom checks...`
        });
        console.log(`Running ${customChecks.length} custom checks...`);

        // Reset custom results first
        setCheckResults(prev => ({ ...prev, custom: [] }));

        // Run each custom check
        for (let i = 0; i < customChecks.length; i++) {
          setAnalysisProgress({
            current: i + 1,
            total: customChecks.length,
            phase: `Running custom check: ${customChecks[i].name}`
          });
          await runCustomCheck(customChecks[i]);
        }
      }

      await saveQualityResults(results);

      // Apply ignored filter for display
      const filteredResults = filterIgnoredResults(results);
      const score = calculateQualityScore(filteredResults);
      setQualityScore(score);
      setCheckResults(filteredResults);

      const { critical, warning, info, total } = computeStatsFromResults(filteredResults);
      setIssueStats({ critical, warning, info, total });

      console.log('Quality check complete!');
    } catch (error) {
      console.error('Error running quality checks:', error);
    } finally {
      setIsRunningChecks(false);
      setAnalysisProgress({ current: 0, total: 0, phase: '' });
    }
  };

  const runPropertyChecks = async (property, results, rawDataCache) => {
    const vendor = property.vendor_source || jobData.vendor_source || 'BRT';

    // Get raw data from cache or use FAST client-side parsing (skip slow RPC calls)
    let rawData = rawDataCache.get(property.property_composite_key);
    if (rawData === undefined) {
      try {
        // Use client-side fallback directly - much faster than RPC calls!
        rawData = (await propertyService.getRawDataForPropertyClientSide(property.job_id, property.property_composite_key)) || {};
      } catch (error) {
        // Reduced console noise - only log errors, not warnings for every property
        rawData = {};
      }
      rawDataCache.set(property.property_composite_key, rawData);
    }
    
    // MOD IV CHECKS
    const m4Class = property.property_m4_class;
    const modImprovement = property.values_mod_improvement || 0;
    const modLand = property.values_mod_land || 0;
    const modTotal = property.values_mod_total || 0;
    
    if ((m4Class === '1' || m4Class === '3B') && modImprovement > 0) {
      results.mod_iv.push({
        check: 'vacant_land_improvements',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: `Class ${m4Class} property has improvements: $${modImprovement.toLocaleString()}`,
        details: property
      });
    }
    
    if (['2', '3A', '4A', '4B', '4C'].includes(m4Class) && modImprovement === 0) {
      results.mod_iv.push({
        check: 'missing_improvements',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: `Class ${m4Class} property missing improvements`,
        details: property
      });
    }
    
    if (['15A', '15B', '15C', '15D', '15E', '15F'].includes(m4Class) && !property.property_facility) {
      results.mod_iv.push({
        check: 'missing_facility',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: `Class ${m4Class} missing facility information`,
        details: property
      });
    }
    
    if (m4Class === '3B' && !property.property_composite_key.includes('Q')) {
      results.mod_iv.push({
        check: 'farm_building_no_qualifier',
        severity: 'warning',
        property_key: property.property_composite_key,
        message: 'Class 3B with no qualifier (should be farm building)',
        details: property
      });
    }
    
    // CAMA CHECKS
    const camaClass = property.property_cama_class;
    const camaImprovement = property.values_cama_improvement || 0;
    
    if ((camaClass === '1' || camaClass === '3B') && camaImprovement > 0) {
      results.cama.push({
        check: 'cama_vacant_improvements',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: `CAMA Class ${camaClass} has improvements: $${camaImprovement.toLocaleString()}`,
        details: property
      });
    }
    
    if (['2', '3A', '4A', '4B', '4C'].includes(camaClass) && camaImprovement === 0) {
      results.cama.push({
        check: 'cama_missing_improvements',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: `CAMA Class ${camaClass} missing improvements`,
        details: property
      });
    }
    
    // BUILDING CLASS CHECKS
    const buildingClass = property.asset_building_class;
    const typeUse = property.asset_type_use;
    const designStyle = property.asset_design_style;
    
    // TYPE USE / BUILDING CLASS VALIDATION
    const typeUseStr = typeUse?.toString().trim();
    const buildingClassStr = buildingClass?.toString().trim();

    // Only validate if both fields have real values (not null, empty, whitespace, or "00")
    if (typeUseStr && typeUseStr !== '00' && buildingClassStr && parseInt(buildingClassStr) > 10) {
      let validBuildingClasses = [];
      const firstChar = typeUseStr.charAt(0);
      
      // Define valid building classes based on type/use first character
      switch(firstChar) {
        case '1':  // Single Family (10, 11, 12, etc.)
          validBuildingClasses = ['11','12','13','14','15','16','17','18','19','20','21','22','23'];
          break;
        case '2':  // Semi-Detached (20, 21, etc.)
          validBuildingClasses = ['25','27','29','31'];
          break;
        case '3':  // Row/Townhouse (30, 31, 3E, 3I, etc.)
          validBuildingClasses = ['33','35','37','39'];
          break;
        case '4':  // Multi-Family (42, 43, 44, etc.)
          validBuildingClasses = ['43','45','47','49'];
          break;
        case '5':  // Conversions (51, 52, 53, etc.)
          validBuildingClasses = ['11','12','13','14','15','16','17','18','19','20','21','22','23'];
          break;
        case '6':  // Condominiums (60, etc.)
          validBuildingClasses = ['25','27','29','31','33','35','37','39'];
          break;
      }
      
      // Check if current building class is valid for this type/use
      if (validBuildingClasses.length > 0 && !validBuildingClasses.includes(buildingClassStr)) {
        results.characteristics.push({
          check: 'type_use_building_class_invalid',
          severity: 'critical',
          property_key: property.property_composite_key,
          message: `Type/Use ${typeUseStr} has invalid Building Class ${buildingClassStr}. Valid classes for Type ${firstChar}x: ${validBuildingClasses.join(', ')}`,
          details: property
        });
      }
    }
    
    // Only flag building class issues for specific property classes when they have BOTH design style AND type/use
    // Classes to check: 2, 3A, 15A, 15B, 15C, 15D, 15E, 15F
    const classesToCheck = ['2', '3A', '15A', '15B', '15C', '15D', '15E', '15F'];
    // Treat null, empty, whitespace, and "00" as empty values (BRT uses "00" for empty fields)
    const hasValidDesign = designStyle && designStyle.trim() !== '' && designStyle.trim() !== '00';
    const hasValidTypeUse = typeUse && typeUse.trim() !== '' && typeUse.trim() !== '00';

    // Removed incorrect facility building class check - all checks now handled below
    
    // For residential classes, only flag building class 10 if they have BOTH design style AND type/use
    // If either is missing, the property might be exempt (disabled veteran) or detached structure (pool, garage)
    const residentialClassesCheck = ['2', '3A', '15A', '15B', '15C', '15D', '15E', '15F'];
    if (residentialClassesCheck.includes(m4Class) && parseInt(buildingClass) === 10) {
      if (hasValidDesign && hasValidTypeUse) {
        results.characteristics.push({
          check: 'residential_building_class_10',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Class ${m4Class} shouldn't have building class 10 (needs >10)`,
          details: property
        });
      }
    }
    
    if (buildingClass > 10) {
      if (!designStyle || designStyle.trim() === '' || designStyle.trim() === '00') {
        results.characteristics.push({
          check: 'missing_design_style',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: 'Building class > 10 missing design style',
          details: property
        });
      }
      if (!typeUse || typeUse.trim() === '' || typeUse.trim() === '00') {
        results.characteristics.push({
          check: 'missing_type_use',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: 'Building class > 10 missing type use',
          details: property
        });
      }
    }
    
    if ((m4Class === '2' || m4Class === '3A') && designStyle && designStyle.trim() !== '' && designStyle.trim() !== '00') {
      if (!buildingClass || buildingClass <= 10) {
        results.characteristics.push({
          check: 'design_without_proper_building_class',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Has design style "${designStyle}" but building class is ${buildingClass || 'missing'} (should be > 10)`,
          details: property
        });
      }
      if (!typeUse || typeUse.trim() === '' || typeUse.trim() === '00') {
        results.characteristics.push({
          check: 'design_without_type_use',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Has design style "${designStyle}" but missing type use`,
          details: property
        });
      }
    }
    
    if (modImprovement === 0) {
      if (designStyle && designStyle.trim() !== '' && designStyle.trim() !== '00') {
        results.characteristics.push({
          check: 'zero_improvement_with_design',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Zero improvement value but has design style: ${designStyle}`,
          details: property
        });
      }
      
      if (typeUse && typeUse.trim() !== '' && typeUse.trim() !== '00') {
        results.characteristics.push({
          check: 'zero_improvement_with_type',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Zero improvement value but has type use: ${typeUse}`,
          details: property
        });
      }
    }
    
    if (m4Class === '4A' || m4Class === '4B' || m4Class === '4C') {
      if (designStyle && designStyle.trim() !== '' && designStyle.trim() !== '00') {
        results.characteristics.push({
          check: 'commercial_with_design',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Commercial property (Class ${m4Class}) has residential design style: ${designStyle}`,
          details: property
        });
      }
      
      if (typeUse && typeUse.trim() !== '' && typeUse.trim() !== '00') {
        results.characteristics.push({
          check: 'commercial_with_type',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Commercial property (Class ${m4Class}) has residential type use: ${typeUse}`,
          details: property
        });
      }
    }

  // LOT SIZE CHECKS - Use the enhanced getTotalLotSize function
  // Skip lot size checks for additional cards (only check primary cards: 1 for BRT, M for Microsystems)
  const cardValue = property.property_addl_card || '1';
  const isPrimaryCard = (vendor === 'BRT' && cardValue === '1') ||
                        (vendor === 'Microsystems' && (cardValue === 'M' || cardValue === 'm'));

  if (isPrimaryCard) {
    // Determine lot acreage based on vendor type:
    // BRT: Use ONLY the calculated lot sizes from unit rate configuration (market_manual_lot_acre/sf)
    // Microsystems: Use direct read from asset fields
    let computedLotAcres = null;

    if (vendor === 'BRT') {
      // For BRT, prefer the calculated lot sizes from PreValuation unit rate configuration
      // These are stored in property_market_analysis by generateLotSizesForJob function
      const manualAcre = property.market_manual_lot_acre;
      const manualSf = property.market_manual_lot_sf;
      const lotFrontage = property.asset_lot_frontage || 0;
      const lotDepth = property.asset_lot_depth || 0;

      if (manualAcre && parseFloat(manualAcre) !== 0) {
        computedLotAcres = parseFloat(manualAcre);
      } else if (manualSf && parseFloat(manualSf) !== 0) {
        computedLotAcres = parseFloat(manualSf) / 43560;
      } else if (lotFrontage && lotDepth && parseFloat(lotFrontage) !== 0 && parseFloat(lotDepth) !== 0) {
        // Fallback to frontage �� depth if calculated values not available yet
        const sf = parseFloat(lotFrontage) * parseFloat(lotDepth);
        if (!isNaN(sf) && sf !== 0) {
          computedLotAcres = sf / 43560;
        }
      }
    } else {
      // For Microsystems, use direct asset fields
      const assetAcre = property.asset_lot_acre;
      const assetSf = property.asset_lot_sf;
      const lotFrontage = property.asset_lot_frontage || 0;
      const lotDepth = property.asset_lot_depth || 0;

      if (assetAcre && parseFloat(assetAcre) !== 0) {
        computedLotAcres = parseFloat(assetAcre);
      } else if (assetSf && parseFloat(assetSf) !== 0) {
        computedLotAcres = parseFloat(assetSf) / 43560;
      } else if (lotFrontage && lotDepth && parseFloat(lotFrontage) !== 0 && parseFloat(lotDepth) !== 0) {
        const sf = parseFloat(lotFrontage) * parseFloat(lotDepth);
        if (!isNaN(sf) && sf !== 0) {
          computedLotAcres = sf / 43560;
        }
      }
    }

    // Check if we truly have zero lot size
    if (!computedLotAcres || parseFloat(computedLotAcres) === 0) {
      // Skip condos with only site value
      let skipError = false;

      if (typeUseStr && (typeUseStr.startsWith('6') || typeUseStr.startsWith('60'))) {
        // It's a condo - check if it only has site value in BRT
        if (vendor === 'BRT' && rawData) {
          let hasSiteOnly = false;
          for (let i = 1; i <= 6; i++) {
            const code = rawData[`LANDUR_${i}`];
            if (code === '01' || code === '1') hasSiteOnly = true;
            if (code === '02' || code === '2') {
              hasSiteOnly = false;  // Has acreage, not just site value
              break;
            }
          }
          skipError = hasSiteOnly;
        }
      }

      if (!skipError) {
        results.characteristics.push({
          check: 'zero_lot_size',
          severity: 'critical',
          property_key: property.property_composite_key,
          message: 'Property has zero lot size (no acre, sf, frontage, or LANDUR data)',
          details: property
        });
      }
    }
  }
    // LIVING AREA & YEAR BUILT
    const sfla = property.asset_sfla || 0;
    const yearBuilt = property.asset_year_built;

    // Only flag missing living area for residential classes when they have valid type, use, design, and building class
    // This excludes exempt properties (disabled veterans, etc.) and detached structures (pools, garages)
    const residentialClasses = ['2', '3A', '15A', '15B', '15C', '15D', '15E', '15F'];
    if (residentialClasses.includes(m4Class) && sfla === 0) {
      // Only flag if property has all required fields indicating it's a real building
      if (hasValidTypeUse && hasValidDesign && buildingClass && parseInt(buildingClass) > 10) {
        results.characteristics.push({
          check: 'missing_sfla',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Class ${m4Class} property missing living area`,
          details: property
        });
      }
    }

    if ((m4Class === '2' || m4Class === '3A') && buildingClass > 10 && !yearBuilt) {
      // Only flag missing year built if property has valid type, use, and design
      if (hasValidTypeUse && hasValidDesign) {
        results.characteristics.push({
          check: 'missing_year_built',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: 'Improved property missing year built',
          details: property
        });
      }
    }
    
    // VCS CHECK
    if (!property.property_vcs) {
      results.special.push({
        check: 'missing_vcs',
        severity: 'warning',
        property_key: property.property_composite_key,
        message: 'Property missing VCS code',
        details: property
      });
    }
    
    // CONDITION CHECKS
    // Only check conditions for residential classes when they have valid type, use, and design
    if ((m4Class === '2' || m4Class === '3A') && buildingClass > 10) {
      if (hasValidTypeUse && hasValidDesign) {
        if (!property.asset_ext_cond) {
          results.characteristics.push({
            check: 'missing_ext_condition',
            severity: 'warning',
            property_key: property.property_composite_key,
            message: 'Improved property missing exterior condition',
            details: property
          });
        }
        if (!property.asset_int_cond) {
          results.characteristics.push({
            check: 'missing_int_condition',
            severity: 'warning',
            property_key: property.property_composite_key,
            message: 'Improved property missing interior condition',
            details: property
          });
        }
      }
    }
    
    // PARTIAL HEATING/COOLING SYSTEMS
    if (vendor === 'BRT') {
      if (!interpretCodes.isFieldEmpty(rawData.ACPARTIAL)) {
        results.special.push({
          check: 'partial_cooling',
          severity: 'info',
          property_key: property.property_composite_key,
          message: 'Property has partial AC system',
          details: property
        });
      }
      if (!interpretCodes.isFieldEmpty(rawData.HEATSYSPARTIAL)) {
        results.special.push({
          check: 'partial_heating',
          severity: 'info',
          property_key: property.property_composite_key,
          message: 'Property has partial heating system',
          details: property
        });
      }
    } else if (vendor === 'Microsystems') {
      const heatType1 = rawData['Heat System Type1'] || rawData['Heat Source'];
      const heatType2 = rawData['Heat System Type2'];
      if (heatType1 && heatType1.toString().trim() !== '' && 
          heatType2 && heatType2.toString().trim() !== '') {
        results.special.push({
          check: 'partial_heating',
          severity: 'info',
          property_key: property.property_composite_key,
          message: 'Property has partial heating system (multiple heat types)',
          details: property
        });
      }
    }
    
    // BEDROOM COUNT VALIDATION
    if ((m4Class === '2' || m4Class === '3A') && buildingClass > 10) {
      // Use direct column access instead of async lookup
      const bedrooms = property.asset_bedrooms;
      if (!bedrooms || bedrooms === 0) {
        results.rooms.push({
          check: 'zero_bedrooms',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: 'Residential property has zero bedrooms',
          details: property
        });
      }
    }
    
    // BATHROOM COUNT CROSS-CHECK
    if ((m4Class === '2' || m4Class === '3A') && buildingClass > 10) {
      if (vendor === 'BRT') {
        const bathTotal = parseInt(rawData.BATHTOT) || 0;
        const plumbingSum = await interpretCodes.getBathroomPlumbingSum(property, vendor);
        
        if (bathTotal !== plumbingSum && plumbingSum > 0) {
          results.rooms.push({
            check: 'bathroom_count_mismatch',
            severity: 'warning',
            property_key: property.property_composite_key,
            message: `Bathroom total (${bathTotal}) doesn't match plumbing sum (${plumbingSum})`,
            details: property
          });
        }
      } else if (vendor === 'Microsystems') {
        const fixtureSum = await interpretCodes.getBathroomFixtureSum(property, vendor);
        const roomSum = await interpretCodes.getBathroomRoomSum(property, vendor);
        
        if (fixtureSum !== roomSum && roomSum > 0) {
          results.rooms.push({
            check: 'bathroom_count_mismatch',
            severity: 'warning',
            property_key: property.property_composite_key,
            message: `Bathroom summary (${fixtureSum}) doesn't match floor totals (${roomSum})`,
            details: property
          });
        }
      }
    }
 
    // DETACHED ITEMS MISSING DEPRECIATION
    if (vendor === 'BRT') {
      for (let i = 1; i <= 11; i++) {
        const detachedCode = rawData[`DETACHEDCODE_${i}`];
        const detachedNC = rawData[`DETACHEDNC_${i}`];
        
        if (!interpretCodes.isFieldEmpty(detachedCode)) {
          if (!detachedNC || parseFloat(detachedNC) === 0) {
            results.special.push({
              check: 'detached_missing_depreciation',
              severity: 'warning',
              property_key: property.property_composite_key,
              message: `Detached item ${i} (${detachedCode}) missing depreciation`,
              details: property
            });
          }
        }
      }
    } else if (vendor === 'Microsystems') {
      for (let i = 1; i <= 4; i++) {
        const detachedCode = rawData[`Detached Item Code${i}`];
        const physicalDepr = rawData[`Physical Depr${i}`];
        const functionalDepr = rawData[`Functional Depr${i}`];
        const locationalDepr = rawData[`Locational Depr${i}`];
        
        if (!interpretCodes.isFieldEmpty(detachedCode)) {
          const hasPhys = physicalDepr && parseFloat(physicalDepr) !== 0;
          const hasFunc = functionalDepr && parseFloat(functionalDepr) !== 0;
          const hasLoc = locationalDepr && parseFloat(locationalDepr) !== 0;
          
          if (!hasPhys && !hasFunc && !hasLoc) {
            results.special.push({
              check: 'detached_missing_depreciation',
              severity: 'warning',
              property_key: property.property_composite_key,
              message: `Detached item ${i} (${detachedCode}) has no depreciation values`,
              details: property
            });
          }
        }
      }
    }
    
    // LAND ADJUSTMENTS
    if (vendor === 'BRT') {
      let hasLandAdjustments = false;
      
      for (let i = 1; i <= 6; i++) {
        if (!interpretCodes.isFieldEmpty(rawData[`LANDURCOND_${i}`])) {
          hasLandAdjustments = true;
          break;
        }
        if (rawData[`LANDURCONDPC_${i}`] && parseFloat(rawData[`LANDURCONDPC_${i}`]) !== 0 && parseFloat(rawData[`LANDURCONDPC_${i}`]) !== 100) {
          hasLandAdjustments = true;
          break;
        }
        if (!interpretCodes.isFieldEmpty(rawData[`LANDURINFL_${i}`])) {
          hasLandAdjustments = true;
          break;
        }
        if (rawData[`LANDURINFLPC_${i}`] && parseFloat(rawData[`LANDURINFLPC_${i}`]) !== 0 && parseFloat(rawData[`LANDURINFLPC_${i}`]) !== 100) {
          hasLandAdjustments = true;
          break;
        }
        if (!interpretCodes.isFieldEmpty(rawData[`LANDFFCOND_${i}`])) {
          hasLandAdjustments = true;
          break;
        }
        if (rawData[`LANDFFCONDPC_${i}`] && parseFloat(rawData[`LANDFFCONDPC_${i}`]) !== 0 && parseFloat(rawData[`LANDFFCONDPC_${i}`]) !== 100) {
          hasLandAdjustments = true;
          break;
        }
        if (!interpretCodes.isFieldEmpty(rawData[`LANDFFINFL_${i}`])) {
          hasLandAdjustments = true;
          break;
        }
        if (rawData[`LANDFFINFLPC_${i}`] && parseFloat(rawData[`LANDFFINFLPC_${i}`]) !== 0 && parseFloat(rawData[`LANDFFINFLPC_${i}`]) !== 100) {
          hasLandAdjustments = true;
          break;
        }
      }

      // Only flag land adjustments if location_analysis is NOT populated
      // If location_analysis exists, the adjustments are intentional from page-by-page analysis
      // Use the flattened field that was already processed by JobContainer
      const hasLocationAnalysisBRT = property.location_analysis && property.location_analysis.trim() !== '';

      if (hasLandAdjustments && !hasLocationAnalysisBRT) {
        results.special.push({
          check: 'land_adjustments_exist',
          severity: 'info',
          property_key: property.property_composite_key,
          message: 'Property has land adjustments applied without location analysis',
          details: property
        });
      }

    } else if (vendor === 'Microsystems') {
      let hasLandAdjustments = false;

      for (let i = 1; i <= 3; i++) {
        const netAdj = rawData[`Net Adjustment${i}`];
        const adjCode = rawData[`Adj Reason Code${i}`];
        const netAdjValue = parseFloat(netAdj) || 0;

        if (netAdjValue !== 0 || !interpretCodes.isFieldEmpty(adjCode)) {
          hasLandAdjustments = true;
          break;
        }
      }

      if (!hasLandAdjustments) {
        for (let i = 1; i <= 4; i++) {
          const overallPercent = rawData[`Overall Adj Percent${i}`];
          const overallReason = rawData[`Overall Adj Reason${i}`];
          const percentValue = parseFloat(overallPercent) || 0;

          if ((percentValue !== 0 && percentValue !== 100) || !interpretCodes.isFieldEmpty(overallReason)) {
            hasLandAdjustments = true;
            break;
          }
        }
      }

      if (!hasLandAdjustments) {
        const unitAdj1 = rawData['Unit Adjustment1'];
        const unitAdj2 = rawData['Unit Adjustment2'];
        const unitAdj = rawData['Unit Adjustment'];
        const unitCode1 = rawData['Unit Adj Code1'];
        const unitCode2 = rawData['Unit Adj Code2'];
        const unitCode = rawData['Unit Adj Code'];

        const unitAdj1Value = parseFloat(unitAdj1) || 0;
        const unitAdj2Value = parseFloat(unitAdj2) || 0;
        const unitAdjValue = parseFloat(unitAdj) || 0;

        if (unitAdj1Value !== 0 ||
            unitAdj2Value !== 0 ||
            unitAdjValue !== 0 ||
            !interpretCodes.isFieldEmpty(unitCode1) ||
            !interpretCodes.isFieldEmpty(unitCode2) ||
            !interpretCodes.isFieldEmpty(unitCode)) {
          hasLandAdjustments = true;
        }
      }

      // Only flag land adjustments if location_analysis is NOT populated
      // If location_analysis exists, the adjustments are intentional from page-by-page analysis
      // Use the flattened field that was already processed by JobContainer
      const hasLocationAnalysisMS = property.location_analysis && property.location_analysis.trim() !== '';

      if (hasLandAdjustments && !hasLocationAnalysisMS) {
        results.special.push({
          check: 'land_adjustments_exist',
          severity: 'info',
          property_key: property.property_composite_key,
          message: 'Property has land adjustments applied without location analysis',
          details: property
        });
      }
    }

    // MARKET ADJUSTMENTS
    if (vendor === 'BRT') {
      const issues = [];

      if (rawData.MKTADJ && parseFloat(rawData.MKTADJ) !== 1) {
        console.log(`❌ MKTADJ issue: ${property.property_composite_key} = ${rawData.MKTADJ}`);
        issues.push(`MKTADJ = ${rawData.MKTADJ} (should be 1)`);
        console.log(`❌ MKTADJ issue found: ${property.property_composite_key}`, {
          MKTADJ: rawData.MKTADJ,
          NCOVR: rawData.NCOVR
        });
      }

      if (rawData.NCOVR && parseFloat(rawData.NCOVR) !== 0) {
        console.log(`❌ NCOVR issue: ${property.property_composite_key} = ${rawData.NCOVR}`);
        issues.push(`NCOVR = ${rawData.NCOVR} (should be 0)`);
      }
      
      if (!interpretCodes.isFieldEmpty(rawData.NCREDIRECT)) {
        issues.push('NC Redirect value present');
      }
      
      if (rawData.NCMKTINFLNC && parseFloat(rawData.NCMKTINFLNC) !== 0) {
        issues.push(`NC Market Influence = ${rawData.NCMKTINFLNC}`);
      }
      if (rawData.NCMKTINFPC && parseFloat(rawData.NCMKTINFPC) !== 0) {
        issues.push(`NC Market Influence % = ${rawData.NCMKTINFPC}`);
      }
      
      if (!interpretCodes.isFieldEmpty(rawData.MKTECONDESC)) {
        issues.push('Economic description present');
      }
      if (!interpretCodes.isFieldEmpty(rawData.MKTFUNCDESC)) {
        issues.push('Functional description present');
      }
      if (!interpretCodes.isFieldEmpty(rawData.MKTMKTDESC)) {
        issues.push('Market description present');
      }
      if (!interpretCodes.isFieldEmpty(rawData.MKTPHYSDESC)) {
        issues.push('Physical description present');
      }
      
      if (rawData.MKTECONPC && parseFloat(rawData.MKTECONPC) !== 100 && parseFloat(rawData.MKTECONPC) !== 0) {
        issues.push(`Economic % = ${rawData.MKTECONPC} (should be 100)`);
      }
      if (rawData.MKTFUNCPC && parseFloat(rawData.MKTFUNCPC) !== 100 && parseFloat(rawData.MKTFUNCPC) !== 0) {
        issues.push(`Functional % = ${rawData.MKTFUNCPC} (should be 100)`);
      }
      if (rawData.MKTMKTPC && parseFloat(rawData.MKTMKTPC) !== 100 && parseFloat(rawData.MKTMKTPC) !== 0) {
        issues.push(`Market % = ${rawData.MKTMKTPC} (should be 100)`);
      }
      if (rawData.MKTPHYSPC && parseFloat(rawData.MKTPHYSPC) !== 100 && parseFloat(rawData.MKTPHYSPC) !== 0) {
        issues.push(`Physical % = ${rawData.MKTPHYSPC} (should be 100)`);
      }
      
      if (issues.length > 0) {
        results.special.push({
          check: 'market_adjustments_exist',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Market adjustments present: ${issues.join(', ')}`,
          details: property
        });
      }
    } else if (vendor === 'Microsystems') {
      const issues = [];
      
      if (!interpretCodes.isFieldEmpty(rawData['Over Improved Depr1'])) {
        issues.push(`Over Improved Depr1: ${rawData['Over Improved Depr1']}`);
      }
      
      if (!interpretCodes.isFieldEmpty(rawData['Over Improved Depr2'])) {
        issues.push(`Over Improved Depr2: ${rawData['Over Improved Depr2']}`);
      }
      
      if (!interpretCodes.isFieldEmpty(rawData['Economic Depr'])) {
        issues.push(`Economic Depr: ${rawData['Economic Depr']}`);
      }
      
      if (!interpretCodes.isFieldEmpty(rawData['Function Depr'])) {
        issues.push(`Function Depr: ${rawData['Function Depr']}`);
      }
      
      if (!interpretCodes.isFieldEmpty(rawData['Location Code'])) {
        issues.push(`Location Code: ${rawData['Location Code']}`);
      }
      
      if (!interpretCodes.isFieldEmpty(rawData['Phys Depr Code'])) {
        issues.push(`Phys Depr Code: ${rawData['Phys Depr Code']}`);
      }
      
      const netFunctional = parseFloat(rawData['Net Functional Depr']) || 0;
      if (netFunctional !== 100 && netFunctional !== 0) {
        issues.push(`Net Functional Depr = ${netFunctional}`);
      }
      
      const netLocational = parseFloat(rawData['Net Locational Depr']) || 0;
      if (netLocational !== 100 && netLocational !== 0) {
        issues.push(`Net Locational Depr = ${netLocational}`);
      }
      
      const underImpr = parseFloat(rawData['Under Improved Depr']) || 0;
      if (underImpr !== 100 && underImpr !== 0) {
        issues.push(`Under Improved Depr = ${underImpr}`);
      }
      
      if (issues.length > 0) {
        results.special.push({
          check: 'market_adjustments_exist',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Market adjustments present: ${issues.join(', ')}`,
          details: property
        });
      }
    }
    
    // FLAT ADD VALUES/OVERRIDES
    if (vendor === 'BRT') {
      const overrides = [];
      
      if (!interpretCodes.isFieldEmpty(rawData.IMPROVVALUEOVR)) {
        overrides.push('Improvement value override');
      }
      if (!interpretCodes.isFieldEmpty(rawData.LANDVALUEOVR)) {
        overrides.push('Land value override');
      }
      
      if (!interpretCodes.isFieldEmpty(rawData.WRITEIN_1)) {
        overrides.push(`Write-in 1: ${rawData.WRITEIN_1}`);
      }
      if (!interpretCodes.isFieldEmpty(rawData.WRITEIN_2)) {
        overrides.push(`Write-in 2: ${rawData.WRITEIN_2}`);
      }
      if (rawData.WRITEINVALUE_1 && parseFloat(rawData.WRITEINVALUE_1) !== 0) {
        overrides.push(`Write-in value 1: $${rawData.WRITEINVALUE_1}`);
      }
      if (rawData.WRITEINVALUE_2 && parseFloat(rawData.WRITEINVALUE_2) !== 0) {
        overrides.push(`Write-in value 2: $${rawData.WRITEINVALUE_2}`);
      }
      
      if (overrides.length > 0) {
        results.special.push({
          check: 'value_overrides',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Manual overrides: ${overrides.join(', ')}`,
          details: property
        });
      }
    } else if (vendor === 'Microsystems') {
      const overrides = [];
      
      if (!interpretCodes.isFieldEmpty(rawData['Flat Add Desc1'])) {
        overrides.push(`Flat Add 1: ${rawData['Flat Add Desc1']}`);
      }
      if (!interpretCodes.isFieldEmpty(rawData['Flat Add Desc2'])) {
        overrides.push(`Flat Add 2: ${rawData['Flat Add Desc2']}`);
      }
      if (!interpretCodes.isFieldEmpty(rawData['Base Cost Flat Add Desc1'])) {
        overrides.push(`Base Cost Add 1: ${rawData['Base Cost Flat Add Desc1']}`);
      }
      if (!interpretCodes.isFieldEmpty(rawData['Base Cost Flat Add Desc2'])) {
        overrides.push(`Base Cost Add 2: ${rawData['Base Cost Flat Add Desc2']}`);
      }
      
      if (rawData['Flat Add Value1'] && parseFloat(rawData['Flat Add Value1']) !== 0) {
        overrides.push(`Flat value 1: $${rawData['Flat Add Value1']}`);
      }
      if (rawData['Flat Add Value2'] && parseFloat(rawData['Flat Add Value2']) !== 0) {
        overrides.push(`Flat value 2: $${rawData['Flat Add Value2']}`);
      }
      if (rawData['Base Cost Flat Add Value1'] && parseFloat(rawData['Base Cost Flat Add Value1']) !== 0) {
        overrides.push(`Base cost value 1: $${rawData['Base Cost Flat Add Value1']}`);
      }
      if (rawData['Base Cost Flat Add Value2'] && parseFloat(rawData['Base Cost Flat Add Value2']) !== 0) {
        overrides.push(`Base cost value 2: $${rawData['Base Cost Flat Add Value2']}`);
      }
      
      if (overrides.length > 0) {
        results.special.push({
          check: 'value_overrides',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Manual overrides: ${overrides.join(', ')}`,
          details: property
        });
      }
    }
  };

  const runSingleCustomCheck = async (check) => {
    const checkResults = [];
    
    for (const property of properties) {
      let conditionMet = true;
      
      // [SAME LOGIC AS IN runCustomCheck but returns array instead of setting state]
      // ... all the condition checking logic ...
      
      if (conditionMet) {
        checkResults.push({
          check: `custom_${check.id}`,
          severity: check.severity,
          property_key: property.property_composite_key,
          message: check.name,
          details: property
        });
      }
    }
    
    return checkResults;
  };

  

  const saveQualityResults = async (results) => {
    try {
      // Use filtered results (exclude ignored) for saved summary/stats
      const displayResults = filterIgnoredResults(results);

      let criticalCount = 0;
      let warningCount = 0;
      let infoCount = 0;

      Object.values(displayResults).forEach(category => {
        (category || []).forEach(issue => {
          if (issue.severity === 'critical') criticalCount++;
          else if (issue.severity === 'warning') warningCount++;
          else if (issue.severity === 'info') infoCount++;
        });
      });

      const totalIssues = criticalCount + warningCount + infoCount;
      const score = calculateQualityScore(displayResults);

      const { data: existing } = await supabase
        .from('market_land_valuation')
        .select('id, quality_check_results')
        .eq('job_id', jobData.id)
        .single();

      const newRun = {
        date: new Date().toISOString(),
        propertyCount: properties.length,
        criticalCount,
        warningCount,
        infoCount,
        totalIssues,
        qualityScore: score
      };

      const existingResults = existing?.quality_check_results || {};
      const existingHistory = existingResults.history || [];
      const updatedHistory = [newRun, ...existingHistory].slice(0, 50);

      const qualityCheckResults = {
        summary: {
          mod_iv: (results.mod_iv || []).length,
          cama: (results.cama || []).length,
          characteristics: (results.characteristics || []).length,
          special: (results.special || []).length,
          rooms: (results.rooms || []).length,
          custom: (results.custom || []).length,
          timestamp: new Date().toISOString()
        },
        history: updatedHistory
      };

      const saveData = {
        job_id: jobData.id,
        quality_check_last_run: new Date().toISOString(),
        quality_issues_count: totalIssues,
        quality_score: score,
        critical_count: criticalCount,
        warning_count: warningCount,
        info_count: infoCount,
        custom_checks: customChecks.length > 0 ? customChecks : null,
        quality_check_results: qualityCheckResults,
        ignored_issues: Array.from(ignoredIssues)
      };

      if (existing) {
        const { error } = await supabase
          .from('market_land_valuation')
          .update(saveData)
          .eq('job_id', jobData.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('market_land_valuation')
          .insert(saveData);
        if (error) throw error;
      }

      // Cache refresh removed to avoid disrupting active analysis

      setRunHistory(updatedHistory);

      console.log(`✅ Saved: ${totalIssues} issues found (displayed, ignoring ${ignoredIssues.size} ignored)`);

      // After successful save
      if (onUpdateJobCache) {
        setTimeout(() => {
          console.log('🔄 DataQualityTab requesting parent refresh...');
          onUpdateJobCache();
        }, 500);
      }

    } catch (error) {
      console.error('Error saving:', error);
    }
  };

  const calculateQualityScore = (results) => {
    const totalProps = properties.length || 1;
    const issueWeights = { critical: 10, warning: 5, info: 1 };
    let totalDeductions = 0;
    
    Object.values(results).forEach(category => {
      category.forEach(issue => {
        totalDeductions += issueWeights[issue.severity] || 0;
      });
    });
    
    const score = Math.max(0, 100 - (totalDeductions / totalProps));
    return score.toFixed(1);
  };

  const toggleQualityCategory = (categoryId) => {
    setExpandedCategories(prev => 
      prev.includes(categoryId) 
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    );
  };
  const getCheckTitle = (checkType) => {
    // Handle custom checks
    if (checkType.startsWith('custom_')) {
      const checkId = checkType.replace('custom_', '');
      const customCheck = customChecks.find(c => c.id.toString() === checkId);
      return customCheck ? customCheck.name : checkType;
    }
    
    const titles = {
      'vacant_land_improvements': 'Vacant Land with Improvements',
      'missing_improvements': 'Properties Missing Improvements',
      'missing_facility': 'Missing Facility Information',
      'farm_building_no_qualifier': 'Farm Building Without Qualifier',
      'cama_vacant_improvements': 'CAMA Vacant Land with Improvements',
      'cama_missing_improvements': 'CAMA Properties Missing Improvements',
      'non_residential_wrong_building_class': 'Non-Residential with Wrong Building Class',
      'residential_building_class_10': 'Residential Properties with Building Class 10',
      'missing_design_style': 'Missing Design Style',
      'missing_type_use': 'Missing Type Use',
      'type_use_building_class_invalid': 'Invalid Building Class for Type/Use',
      'design_without_proper_building_class': 'Has Design but Wrong Building Class',
      'design_without_type_use': 'Has Design but Missing Type Use',
      'type_use_building_class_mismatch': 'Type Use/Building Class Mismatch',
      'zero_lot_size': 'Properties with Zero Lot Size',
      'missing_sfla': 'Missing Living Area',
      'missing_year_built': 'Missing Year Built',
      'missing_ext_condition': 'Missing Exterior Condition',
      'missing_int_condition': 'Missing Interior Condition',
      'zero_bedrooms': 'Properties with Zero Bedrooms',
      'bathroom_count_mismatch': 'Bathroom Count Mismatch',
      'missing_vcs': 'Missing VCS Code',
      'partial_cooling': 'Partial AC System',
      'partial_heating': 'Partial Heating System',
      'detached_missing_depreciation': 'Detached Items Missing Depreciation',
      'land_adjustments_exist': 'Properties with Land Adjustments',
      'market_adjustments_exist': 'Properties with Market Adjustments',
      'value_overrides': 'Manual Value Overrides Present',
      'zero_improvement_with_design': 'Zero Improvements with Design Style',
      'zero_improvement_with_type': 'Zero Improvements with Type Use',
      'commercial_with_design': 'Commercial Property with Residential Design',
      'commercial_with_type': 'Commercial Property with Residential Type'
    };
    return titles[checkType] || checkType;
  };

  const showPropertyDetails = (checkType, category) => {
    const issues = checkResults[category]?.filter(r => r.check === checkType) || [];
    setModalData({
      title: getCheckTitle(checkType),
      properties: issues
    });
    setShowDetailsModal(true);
  };

  const saveCustomChecksToDb = async (checks) => {
    try {
      await supabase
        .from('market_land_valuation')
        .update({ custom_checks: checks })
        .eq('job_id', jobData.id);
    } catch (error) {
      console.error('Error saving custom checks:', error);
    }
  };

  // Custom check functions
  const addConditionToCustomCheck = () => {
    setCurrentCustomCheck(prev => ({
      ...prev,
      conditions: [...prev.conditions, { logic: 'AND', field: '', operator: '=', value: '' }]
    }));
  };
  
  const updateCustomCheckCondition = (index, field, value) => {
    setCurrentCustomCheck(prev => ({
      ...prev,
      conditions: prev.conditions.map((cond, i) => 
        i === index ? { ...cond, [field]: value } : cond
      )
    }));
  };
  
  const removeCustomCheckCondition = (index) => {
    setCurrentCustomCheck(prev => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== index)
    }));
  };
  
  const saveCustomCheck = () => {
    const checkName = customCheckNameInputRef.current?.value;
    const checkSeverity = customCheckSeveritySelectRef.current?.value;
    
    if (!checkName || currentCustomCheck.conditions.some(c => !c.field)) {
      alert('Please complete all fields before saving');
      return;
    }
    
    const newCheck = {
      ...currentCustomCheck,
      name: checkName,
      severity: checkSeverity,
      id: Date.now()
    };
    
    setCustomChecks(prev => [...prev, newCheck]);
    
    customCheckNameInputRef.current.value = '';
    customCheckSeveritySelectRef.current.value = 'warning';
    setCurrentCustomCheck({
      name: '',
      severity: 'warning',
      conditions: [{ logic: 'IF', field: '', operator: '=', value: '' }]
    });
    
    saveCustomChecksToDb([...customChecks, newCheck]);
  };
  
  const deleteCustomCheck = (checkId) => {
    setCustomChecks(prev => prev.filter(check => check.id !== checkId));
    saveCustomChecksToDb(customChecks.filter(check => check.id !== checkId));
  };
  
const editCustomCheck = (check) => {
    customCheckNameInputRef.current.value = check.name;
    customCheckSeveritySelectRef.current.value = check.severity;
    setCurrentCustomCheck({
      ...check,
      conditions: check.conditions
    });
    // Remove from list so it can be re-saved with same or new name
    setCustomChecks(prev => prev.filter(c => c.id !== check.id));
  };
  
  const runCustomCheck = async (check) => {
    const results = { custom: [] };
    const rawDataCache = new Map(); // Cache for this custom check run

    for (const property of properties) {
      let conditionMet = true;

      for (let i = 0; i < check.conditions.length; i++) {
        const condition = check.conditions[i];

        let fieldValue;
        if (condition.field.startsWith('raw_data.')) {
          const rawFieldName = condition.field.replace('raw_data.', '');

          // Get raw data from cache or fetch from job-level storage
          let rawData = rawDataCache.get(property.property_composite_key);
          if (rawData === undefined) {
            rawData = (await propertyService.getRawDataForProperty(property.job_id, property.property_composite_key)) || {};
            rawDataCache.set(property.property_composite_key, rawData);
          }

          fieldValue = rawData[rawFieldName] || null;
        } else {
          fieldValue = property[condition.field];
        }
        const compareValue = condition.value;
        let thisConditionMet = false;
        
        switch (condition.operator) {
          case '=':
            thisConditionMet = fieldValue == compareValue;
            break;
          case '!=':
            thisConditionMet = fieldValue != compareValue;
            break;
          case '>':
            thisConditionMet = parseFloat(fieldValue) > parseFloat(compareValue);
            break;
          case '<':
            thisConditionMet = parseFloat(fieldValue) < parseFloat(compareValue);
            break;
          case '>=':
            thisConditionMet = parseFloat(fieldValue) >= parseFloat(compareValue);
            break;
          case '<=':
            thisConditionMet = parseFloat(fieldValue) <= parseFloat(compareValue);
            break;
          case 'is null':
            thisConditionMet = !fieldValue || fieldValue === '';
            break;
          case 'is not null':
            thisConditionMet = fieldValue && fieldValue !== '';
            break;
          case 'contains':
            thisConditionMet = fieldValue && fieldValue.toString().toLowerCase().includes(compareValue.toLowerCase());
            break;
          case 'is one of':
            const validValues = compareValue.split(',').map(v => v.trim());
            thisConditionMet = validValues.includes(fieldValue);
            break;
          case 'is not one of':
            const invalidValues = compareValue.split(',').map(v => v.trim());
            thisConditionMet = !invalidValues.includes(fieldValue);
            break;
        }
        
        if (i === 0) {
          conditionMet = thisConditionMet;
        } else {
          if (condition.logic === 'AND') {
            conditionMet = conditionMet && thisConditionMet;
          } else if (condition.logic === 'OR') {
            conditionMet = conditionMet || thisConditionMet;
          }
        }
      }
      
      if (conditionMet) {
        results.custom.push({
          check: `custom_${check.id}`,
          severity: check.severity,
          property_key: property.property_composite_key,
          message: check.name,
          details: property
        });
      }
    }
    
    // Merge into existing checkResults and update display while respecting ignored issues
    const updatedResults = {
      ...checkResults,
      custom: [...(checkResults.custom || []), ...results.custom]
    };

    // Update raw results with unfiltered custom issues
    setRawResults(prev => ({
      ...prev,
      custom: [...(prev?.custom || []), ...results.custom]
    }));

    setCheckResults(updatedResults);
    applyAndSetResults(updatedResults);

    console.log(`✅ Custom check "${check.name}" found ${results.custom.length} issues`);
  };
  
  const runAllCustomChecks = async () => {
    // Start with existing results but clear custom
    const updatedResults = {
      ...checkResults,
      custom: []
    };

    // Run all custom checks and collect results
    const rawDataCache = new Map(); // Cache for all custom checks

    for (const check of customChecks) {
      const customResults = [];

      for (const property of properties) {
        let conditionMet = true;

        // Check conditions (same logic as runCustomCheck)
        for (let i = 0; i < check.conditions.length; i++) {
          const condition = check.conditions[i];

          let fieldValue;
          if (condition.field.startsWith('raw_data.')) {
            const rawFieldName = condition.field.replace('raw_data.', '');

            // Get raw data from cache or fetch from job-level storage
            let rawData = rawDataCache.get(property.property_composite_key);
            if (rawData === undefined) {
              rawData = (await propertyService.getRawDataForProperty(property.job_id, property.property_composite_key)) || {};
              rawDataCache.set(property.property_composite_key, rawData);
            }

            fieldValue = rawData[rawFieldName] || null;
          } else {
            fieldValue = property[condition.field];
          }
          
          const compareValue = condition.value;
          let thisConditionMet = false;
          
          switch (condition.operator) {
            case '=':
              thisConditionMet = fieldValue == compareValue;
              break;
            case '!=':
              thisConditionMet = fieldValue != compareValue;
              break;
            case '>':
              thisConditionMet = parseFloat(fieldValue) > parseFloat(compareValue);
              break;
            case '<':
              thisConditionMet = parseFloat(fieldValue) < parseFloat(compareValue);
              break;
            case '>=':
              thisConditionMet = parseFloat(fieldValue) >= parseFloat(compareValue);
              break;
            case '<=':
              thisConditionMet = parseFloat(fieldValue) <= parseFloat(compareValue);
              break;
            case 'is null':
              thisConditionMet = !fieldValue || fieldValue === '';
              break;
            case 'is not null':
              thisConditionMet = fieldValue && fieldValue !== '';
              break;
            case 'contains':
              thisConditionMet = fieldValue && fieldValue.toString().toLowerCase().includes(compareValue.toLowerCase());
              break;
            case 'is one of':
              const validValues = compareValue.split(',').map(v => v.trim());
              thisConditionMet = validValues.includes(fieldValue);
              break;
            case 'is not one of':
              const invalidValues = compareValue.split(',').map(v => v.trim());
              thisConditionMet = !invalidValues.includes(fieldValue);
              break;
          }
          
          if (i === 0) {
            conditionMet = thisConditionMet;
          } else {
            if (condition.logic === 'AND') {
              conditionMet = conditionMet && thisConditionMet;
            } else if (condition.logic === 'OR') {
              conditionMet = conditionMet || thisConditionMet;
            }
          }
        }
        
        if (conditionMet) {
          customResults.push({
            check: `custom_${check.id}`,
            severity: check.severity,
            property_key: property.property_composite_key,
            message: check.name,
            details: property
          });
        }
      }
      
      // Add to updated results
      updatedResults.custom.push(...customResults);
    }
    
    // Update raw results with all custom issues
    setRawResults(prev => ({
      ...prev,
      custom: updatedResults.custom
    }));

    // Update state with complete results and update display (apply ignored filter)
    setCheckResults(updatedResults);
    applyAndSetResults(updatedResults);

    // Save to database with complete results (saves displayed counts and ignored list)
    await saveQualityResults(updatedResults);

    console.log(`✅ Custom checks complete: ${updatedResults.custom.length} issues found`);

    // Jump back to overview
    setDataQualityActiveSubTab('overview');
  };
  // RENDER
  return (
    <div className="tab-content">
      {/* Sub-tab Navigation */}
      <div className="mls-subtab-nav">
        <button
          onClick={() => setDataQualityActiveSubTab('overview')}
          className={`mls-subtab-btn ${dataQualityActiveSubTab === 'overview' ? 'mls-subtab-btn--active' : ''}`}
        >
          Overview
        </button>
        <button
          onClick={() => setDataQualityActiveSubTab('standard')}
          className={`mls-subtab-btn ${dataQualityActiveSubTab === 'standard' ? 'mls-subtab-btn--active' : ''}`}
        >
          Standard & Custom Check Results
        </button>
        <button
          onClick={() => setDataQualityActiveSubTab('custom')}
          className={`mls-subtab-btn ${dataQualityActiveSubTab === 'custom' ? 'mls-subtab-btn--active' : ''}`}
        >
          Custom Checks/Definitions
        </button>
        <button
          onClick={() => setDataQualityActiveSubTab('ignored')}
          className={`mls-subtab-btn ${dataQualityActiveSubTab === 'ignored' ? 'mls-subtab-btn--active' : ''}`}
        >
          Ignored {ignoredIssues.size > 0 ? `(${ignoredIssues.size})` : ''}
        </button>
        <button
          onClick={() => setDataQualityActiveSubTab('history')}
          className={`mls-subtab-btn ${dataQualityActiveSubTab === 'history' ? 'mls-subtab-btn--active' : ''}`}
        >
          Run History
        </button>
      </div>
      
      {/* OVERVIEW TAB CONTENT */}
      {dataQualityActiveSubTab === 'overview' && (
        <div>
          <div className="mb-6">
            <h3 className="text-2xl font-bold text-gray-800 mb-2">
              Data Quality Analysis
            </h3>
            <p className="text-gray-600">
              Analyzing {properties.length.toLocaleString()} properties for data integrity issues
            </p>
            {runHistory.length > 0 && (
              <p className="text-sm text-gray-500 mt-1">
                Last analysis run: {new Date(runHistory[0].date).toLocaleString()}
              </p>
            )}
          </div>

          <div className="flex gap-3 mb-6">
            <button
              onClick={runQualityChecks}
              disabled={isRunningChecks || properties.length === 0}
              className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-all ${
                isRunningChecks || properties.length === 0
                  ? 'bg-gray-400 text-white cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              <RefreshCw size={16} className={isRunningChecks ? 'animate-spin' : ''} />
              {isRunningChecks ? 'Running Analysis...' : 'Run Analysis'}
            </button>

            {/* Progress Bar */}
            {isRunningChecks && analysisProgress.total > 0 && (
              <div className="flex-1 min-w-0">
                <div className="bg-white border border-gray-300 rounded-lg p-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-gray-700">
                      {analysisProgress.phase}
                    </span>
                    <span className="text-sm text-gray-500">
                      {analysisProgress.current.toLocaleString()} / {analysisProgress.total.toLocaleString()}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
                    ></div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {Math.round((analysisProgress.current / analysisProgress.total) * 100)}% complete
                  </div>
                </div>
              </div>
            )}
            
            <button
              onClick={exportToExcel}
              disabled={Object.keys(checkResults).length === 0}
              className={`px-4 py-2 bg-white border-2 border-blue-600 text-blue-600 rounded-lg font-medium hover:bg-blue-50 transition-all flex items-center gap-2 ${
                Object.keys(checkResults).length === 0 ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <Download size={16} />
              Export to Excel
            </button>


            <button 
              onClick={generateQCFormPDF}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-all flex items-center gap-2"
            >
              📋 QC Form Template
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Properties</div>
              <div className="text-2xl font-bold text-gray-800">{properties.length.toLocaleString()}</div>

            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Properties with Issues</div>
              <div className="text-2xl font-bold text-red-600">{issueStats.total}</div>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Critical Issues</div>
              <div className="text-2xl font-bold text-red-600">{issueStats.critical}</div>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Warnings</div>
              <div className="text-2xl font-bold text-yellow-600">{issueStats.warning}</div>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Info Messages</div>
              <div className="text-2xl font-bold text-blue-600">{issueStats.info}</div>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4 bg-gradient-to-br from-green-50 to-green-100">
              <div className="text-xs text-gray-600 uppercase tracking-wide mb-1">Data Quality Score</div>
              <div className="text-2xl font-bold text-green-700">{qualityScore ? `${qualityScore}%` : '—'}</div>
            </div>
          </div>
        </div>
      )}

      {/* STANDARD CHECKS TAB CONTENT */}
      {dataQualityActiveSubTab === 'standard' && (
        <div>
          {Object.keys(checkResults).length > 0 ? (
            <div>
              <h4 className="text-lg font-semibold text-gray-800 mb-4">
                Check Results by Category
              </h4>
              
              {Object.entries(checkResults).map(([category, issues]) => {
                if (!issues || issues.length === 0) return null;
                
                const isExpanded = expandedCategories.includes(category);
                const criticalCount = issues.filter(i => i.severity === 'critical').length;
                const warningCount = issues.filter(i => i.severity === 'warning').length;
                const infoCount = issues.filter(i => i.severity === 'info').length;
                const uniquePropertiesWithIssues = new Set(issues.map(i => i.property_key)).size;
                const passCount = properties.length - uniquePropertiesWithIssues;
                
                return (
                  <div key={category} className="bg-white border border-gray-200 rounded-lg mb-3 overflow-hidden">
                    <div
                      onClick={() => toggleQualityCategory(category)}
                      className="p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors flex justify-between items-center"
                    >
                      <div className="flex items-center gap-2">
                        <ChevronRight
                          size={20}
                          className={`text-gray-500 transform transition-transform ${
                            isExpanded ? 'rotate-90' : ''
                          }`}
                        />
                        <span className="font-semibold text-gray-800 capitalize">
                          {category.replace(/_/g, ' ')} Checks ({issues.length} issues)
                        </span>
                      </div>
                      
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        {criticalCount > 0 && (
                          <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                            {criticalCount} Critical
                          </span>
                        )}
                        {warningCount > 0 && (
                          <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-semibold">
                            {warningCount} Warning
                          </span>
                        )}
                        {infoCount > 0 && (
                          <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                            {infoCount} Info
                          </span>
                        )}
                        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                          {passCount.toLocaleString()} Pass
                        </span>
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="p-4 border-t border-gray-200">
                        {Object.entries(
                          issues.reduce((acc, issue) => {
                            if (!acc[issue.check]) acc[issue.check] = [];
                            acc[issue.check].push(issue);
                            return acc;
                          }, {})
                        ).map(([checkType, checkIssues]) => (
                          <div
                            key={checkType}
                            className="p-3 bg-gray-50 rounded-lg mb-2 flex justify-between items-center"
                          >
                            <span className="text-sm text-gray-700">
                              {getCheckTitle(checkType)}
                            </span>
                            <div className="flex items-center gap-3">
                              <span className={`text-sm font-semibold ${
                                checkIssues[0].severity === 'critical' ? 'text-red-600' :
                                checkIssues[0].severity === 'warning' ? 'text-yellow-600' : 
                                'text-blue-600'
                              }`}>
                                {checkIssues.length} properties
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  showPropertyDetails(checkType, category);
                                }}
                                className="px-3 py-1 text-xs bg-white border border-blue-600 text-blue-600 rounded hover:bg-blue-50 transition-colors"
                              >
                                View Details
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
              <AlertCircle size={48} className="text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-800 mb-2">
                No Analysis Run Yet
              </h3>
              <p className="text-gray-600">
                Click "Run Analysis" in the Overview tab to check for data quality issues.
              </p>
            </div>
          )}
        </div>
      )}
      
      {/* IGNORED TAB CONTENT */}
      {dataQualityActiveSubTab === 'ignored' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-gray-800">Ignored Issues</h4>
            <div className="flex gap-2">
              <button
                onClick={exportIgnoredToExcel}
                disabled={ignoredIssues.size === 0}
                className={`px-4 py-2 bg-white border-2 border-blue-600 text-blue-600 rounded-lg font-medium hover:bg-blue-50 transition-all flex items-center gap-2 ${ignoredIssues.size === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Download size={16} />
                Export Ignored
              </button>
              {ignoredIssues.size > 0 && (
                <button
                  onClick={async () => {
                    if (!window.confirm(`Clear ${ignoredIssues.size} ignored issues? This will restore them to the issue lists.`)) return;
                    const emptySet = new Set();
                    setIgnoredIssues(emptySet);
                    try {
                      const { error } = await supabase
                        .from('market_land_valuation')
                        .update({
                          ignored_issues: [],
                          updated_at: new Date().toISOString()
                        })
                        .eq('job_id', jobData.id);

                      if (error) throw error;

                      // Recompute displayed results after clearing ignored
                      applyAndSetResults(rawResults || {} , emptySet);

                      // Notify parent to refresh data
                      if (onUpdateJobCache) {
                        await onUpdateJobCache();
                      }

                      console.log('✅ Cleared all ignored issues and saved to database');

                      // Show success message
                      const toast = document.createElement('div');
                      toast.textContent = '✅ All ignored issues cleared';
                      toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#10B981;color:white;padding:12px 20px;border-radius:6px;z-index:9999;font-size:14px;';
                      document.body.appendChild(toast);
                      setTimeout(() => toast.remove(), 2000);
                    } catch (error) {
                      console.error('Error clearing ignored issues:', error);
                      alert(`Failed to clear ignored issues: ${error.message}`);
                    }
                  }}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-lg font-medium hover:bg-yellow-700 transition-all flex items-center gap-2"
                >
                  <X size={16} />
                  Clear {ignoredIssues.size} Ignored
                </button>
              )}
            </div>
          </div>

          {ignoredIssues.size === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
              <AlertCircle size={48} className="text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-800 mb-2">No Ignored Issues</h3>
              <p className="text-gray-600">You haven't ignored any issues. Use the "Ignore" action in issue details to move items here.</p>
            </div>
          ) : Object.keys(rawResults || {}).length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
              <AlertCircle size={48} className="text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-800 mb-2">Run Analysis to View Details</h3>
              <p className="text-gray-600">Ignored items will appear here after you run the analysis.</p>
            </div>
          ) : (
            <div>
              {Object.entries(getIgnoredResults()).map(([category, issues]) => {
                if (!issues || issues.length === 0) return null;
                const criticalCount = issues.filter(i => i.severity === 'critical').length;
                const warningCount = issues.filter(i => i.severity === 'warning').length;
                const infoCount = issues.filter(i => i.severity === 'info').length;
                return (
                  <div key={`ignored-${category}`} className="bg-white border border-gray-200 rounded-lg mb-3 overflow-hidden">
                    <div className="p-4 bg-gray-50 flex justify-between items-center">
                      <span className="font-semibold text-gray-800 capitalize">{category.replace(/_/g, ' ')} Ignored ({issues.length})</span>
                      <div className="flex gap-2">
                        {criticalCount > 0 && (
                          <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">{criticalCount} Critical</span>
                        )}
                        {warningCount > 0 && (
                          <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-semibold">{warningCount} Warning</span>
                        )}
                        {infoCount > 0 && (
                          <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">{infoCount} Info</span>
                        )}
                      </div>
                    </div>
                    <div className="p-4 border-t border-gray-200">
                      {Object.entries(
                        (issues || []).reduce((acc, issue) => {
                          if (!acc[issue.check]) acc[issue.check] = [];
                          acc[issue.check].push(issue);
                          return acc;
                        }, {})
                      ).map(([checkType, checkIssues]) => (
                        <div key={`ignored-${category}-${checkType}`} className="p-3 bg-gray-50 rounded-lg mb-2 flex justify-between items-center">
                          <span className="text-sm text-gray-700">{getCheckTitle(checkType)}</span>
                          <div className="flex items-center gap-3">
                            <span className={`text-sm font-semibold ${
                              checkIssues[0].severity === 'critical' ? 'text-red-600' :
                              checkIssues[0].severity === 'warning' ? 'text-yellow-600' : 'text-blue-600'
                            }`}>
                              {checkIssues.length} properties
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const ignoredList = (rawResults[category] || []).filter(r => r.check === checkType).filter(r => ignoredIssues.has(`${r.property_key}-${r.check}`));
                                setModalData({ title: `${getCheckTitle(checkType)} (Ignored)`, properties: ignoredList });
                                setShowDetailsModal(true);
                              }}
                              className="px-3 py-1 text-xs bg-white border border-blue-600 text-blue-600 rounded hover:bg-blue-50 transition-colors"
                            >
                              View Details
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* CUSTOM CHECKS TAB CONTENT */}
      {dataQualityActiveSubTab === 'custom' && (
        <div>
          <div>
            {/* Main Content Area */}
            <div className="w-full">
              {/* Custom Check Builder */}
              <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">
                  Custom Check/Definition Builder
                </h3>
                
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Check Name</label>
                      <input 
                        ref={customCheckNameInputRef}
                        type="text"
                        placeholder="e.g., Missing Tax ID for Commercial"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Severity</label>
                      <select 
                        ref={customCheckSeveritySelectRef}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        defaultValue="warning"
                        onClick={(e) => e.stopPropagation()}
                      >  
                        <option value="critical">Critical</option>
                        <option value="warning">Warning</option>
                        <option value="info">Info</option>
                      </select>
                    </div>
                  </div>
                  
                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-sm font-medium text-gray-700">Conditions</label>
                      {allRawDataFields.length > 0 && (
                        <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
                          ✓ {allRawDataFields.length} raw data fields available
                        </span>
                      )}
                    </div>
                    {currentCustomCheck.conditions.map((condition, index) => (
                      <div key={index} className="flex gap-2 items-center mb-2">
                        <select 
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          value={condition.logic}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateCustomCheckCondition(index, 'logic', e.target.value)}
                          disabled={index === 0}
                        >
                          <option>IF</option>
                          <option>AND</option>
                          <option>OR</option>
                        </select>
                        
                        <select 
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1"
                          value={condition.field}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateCustomCheckCondition(index, 'field', e.target.value)}
                        >
                          <option value="">-- Select Field --</option>
                          
                          <optgroup label="Property Identification">
                            <option value="property_block">Block</option>
                            <option value="property_lot">Lot</option>
                            <option value="property_qualifier">Qualifier</option>
                            <option value="property_card">Card</option>
                            <option value="property_location">Location</option>
                            <option value="property_m4_class">M4 Class</option>
                            <option value="property_cama_class">CAMA Class</option>
                            <option value="property_vcs">VCS Code</option>
                            <option value="property_facility">Facility</option>
                          </optgroup>
                          
                          <optgroup label="Values">
                            <option value="values_mod_improvement">Mod Improvement</option>
                            <option value="values_mod_land">Mod Land</option>
                            <option value="values_mod_total">Mod Total</option>
                            <option value="values_cama_improvement">CAMA Improvement</option>
                            <option value="values_cama_land">CAMA Land</option>
                            <option value="values_cama_total">CAMA Total</option>
                            <option value="values_norm_time">Normalized Time Value</option>
                            <option value="values_norm_size">Normalized Size Value</option>
                          </optgroup>
                          
                          <optgroup label="Asset Information">
                            <option value="asset_building_class">Building Class</option>
                            <option value="asset_design_style">Design Style</option>
                            <option value="asset_type_use">Type Use</option>
                            <option value="asset_sfla">Living Area (SFLA)</option>
                            <option value="asset_year_built">Year Built</option>
                            <option value="asset_lot_acre">Lot Acres</option>
                            <option value="asset_lot_sf">Lot Square Feet</option>
                            <option value="asset_lot_frontage">Lot Frontage</option>
                            <option value="asset_ext_cond">Exterior Condition</option>
                            <option value="asset_int_cond">Interior Condition</option>
                            <option value="asset_zoning">Zoning</option>
                            <option value="asset_map_page">Map Page</option>
                            <option value="asset_key_page">Key Page</option>
                          </optgroup>
                          
                          <optgroup label="Sale Information">
                            <option value="sale_date">Sale Date</option>
                            <option value="sale_price">Sale Price</option>
                            <option value="sale_nu">Sale NU</option>
                            <option value="sale_book">Sale Book</option>
                            <option value="sale_page">Sale Page</option>
                          </optgroup>
                          
                          <optgroup label="Market Analysis">
                            <option value="location_analysis">Location Analysis</option>
                            <option value="newVCS">New VCS</option>
                          </optgroup>
                          
                          {(allRawDataFields.length > 0 || availableFields.length > 0) && (
                            <optgroup label={`Raw Data Fields (${allRawDataFields.length || availableFields.length} available)`}>
                              {(allRawDataFields.length > 0 ? allRawDataFields : availableFields).map(field => (
                                <option key={field} value={`raw_data.${field}`}>
                                  {field}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>

                        <select 
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          value={condition.operator}
                          onChange={(e) => updateCustomCheckCondition(index, 'operator', e.target.value)}
                        >
                          <option value="=">=</option>
                          <option value="!=">!=</option>
                          <option value=">">&gt;</option>
                          <option value="<">&lt;</option>
                          <option value=">=">&gt;=</option>
                          <option value="<=">&lt;=</option>
                          <option value="is null">is null</option>
                          <option value="is not null">is not null</option>
                          <option value="contains">contains</option>
                          <option value="is one of">is one of</option>
                          <option value="is not one of">is not one of</option>
                        </select>
                        
                        <input 
                          type="text" 
                          placeholder="Value"
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1"
                          value={condition.value}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            updateCustomCheckCondition(index, 'value', e.target.value);
                          }}
                          disabled={condition.operator === 'is null' || condition.operator === 'is not null'}
                        />      
                        
                        <button 
                          type="button"
                          className="p-2 text-red-500 hover:bg-red-50 rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeCustomCheckCondition(index);
                          }}
                          disabled={currentCustomCheck.conditions.length === 1}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                    
                    <button
                      type="button"
                      className="text-blue-600 text-sm hover:text-blue-700 mt-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        addConditionToCustomCheck();
                      }}
                    >
                      + Add Condition
                    </button>
                  </div>
                  
                  <div className="flex justify-end gap-2 pt-4 border-t">
                    <button
                      type="button" 
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        saveCustomCheck();
                      }}
                    >
                      Save Custom Check
                    </button>
                  </div>
                </div>
              </div>

              {/* Saved Custom Checks */}
              <div className="bg-white border-2 border-gray-200 rounded-lg p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-800">
                    ✅ Saved Custom Checks/Definitions
                  </h3>
                  <div className="flex items-center gap-4">
                    {customChecks.length > 0 && (
                      <>
                        <span className="text-sm text-gray-600">
                          {customChecks.length} custom check{customChecks.length !== 1 ? 's' : ''} will run with analysis
                        </span>
                        <button
                          type="button"
                          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            runAllCustomChecks();
                          }}
                        >
                          Run All Custom Checks
                        </button>
                      </>
                    )}
                  </div>
                </div>
                
                {customChecks.length > 0 ? (
                  <div className="space-y-2">
                    {customChecks.map((check) => (
                      <div key={check.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <div className="font-medium text-gray-800">{check.name}</div>
                          <div className="text-sm text-gray-600">
                            {check.conditions.length} condition{check.conditions.length !== 1 ? 's' : ''} • 
                            <span className={`ml-1 font-medium ${
                              check.severity === 'critical' ? 'text-red-600' :
                              check.severity === 'warning' ? 'text-yellow-600' :
                              'text-blue-600'
                            }`}>
                              {check.severity}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                            onClick={(e) => {
                              e.stopPropagation();
                              runCustomCheck(check);
                            }}
                          >
                            Run
                          </button>
                          <button
                            type="button"
                            className="px-3 py-1 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-700"
                            onClick={(e) => {
                              e.stopPropagation();
                              editCustomCheck(check);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button" 
                            className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteCustomCheck(check.id);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">
                    No custom checks saved yet
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* HISTORY TAB CONTENT */}
      {dataQualityActiveSubTab === 'history' && (
        <div>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Run Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Properties Analyzed
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Issues Found
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quality Score
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {runHistory.length > 0 ? (
                  runHistory.map((run, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {new Date(run.date).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {run.propertyCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="text-red-600 font-medium">{run.criticalCount}</span> Critical,{' '}
                        <span className="text-yellow-600 font-medium">{run.warningCount}</span> Warning,{' '}
                        <span className="text-blue-600 font-medium">{run.infoCount}</span> Info
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="font-medium text-green-600">{run.qualityScore}%</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" className="px-4 py-8 text-center text-gray-500">
                      No analysis runs yet. Run an analysis to see history.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* PROPERTY DETAILS MODAL */}
      {showDetailsModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 pt-10 overflow-y-auto"
          onClick={() => setShowDetailsModal(false)}
        >
          <div 
            className="bg-white rounded-lg w-[95%] max-w-6xl my-8 shadow-2xl flex flex-col"
            style={{ maxHeight: 'calc(100vh - 100px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
              <div className="flex items-center gap-4">
                <h3 className="text-lg font-semibold text-gray-800">
                  {modalData.title}
                </h3>
                <span className="text-sm text-gray-500">
                  ({modalData.properties.length} properties)
                </span>
              </div>
              <button
                onClick={() => setShowDetailsModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none p-2"
              >
                ×
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <table className="w-full">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Block
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Lot
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Qualifier
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Card
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Location
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Class
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Issue Details
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {modalData.properties.map((prop, index) => {
                    const property = prop.details;
                    const issueKey = `${prop.property_key}-${prop.check}`;
                    const isIgnored = ignoredIssues.has(issueKey);
                    
                    return (
                      <tr key={index} className={`border-b border-gray-100 hover:bg-gray-50 ${isIgnored ? 'opacity-50' : ''}`}>
                        <td className={`py-3 px-4 text-sm text-gray-900 ${isIgnored ? 'line-through' : ''}`}>
                          {property?.property_block || ''}
                        </td>
                        <td className={`py-3 px-4 text-sm text-gray-900 ${isIgnored ? 'line-through' : ''}`}>
                          {property?.property_lot || ''}
                        </td>
                        <td className={`py-3 px-4 text-sm text-gray-900 ${isIgnored ? 'line-through' : ''}`}>
                          {property?.property_qualifier || ''}
                        </td>
                        <td className={`py-3 px-4 text-sm text-gray-900 ${isIgnored ? 'line-through' : ''}`}>
                          {property?.property_card || ''}
                        </td>
                        <td className={`py-3 px-4 text-sm text-gray-900 ${isIgnored ? 'line-through' : ''}`}>
                          {property?.property_location || ''}
                        </td>
                        <td className={`py-3 px-4 text-sm text-gray-900 ${isIgnored ? 'line-through' : ''}`}>
                          {property?.property_m4_class || ''}
                        </td>
                        <td className={`py-3 px-4 text-sm text-gray-600 ${isIgnored ? 'line-through' : ''}`}>
                          {prop.message}
                        </td>
                        <td className="py-3 px-4">
                          <button
                            onClick={async () => {
                              // Confirm before ignoring to prevent accidental clicks
                              if (!isIgnored) {
                                const ok = window.confirm('Are you sure you want to IGNORE this issue? It will be removed from the displayed counts but can be restored later.');
                                if (!ok) return;
                              }

                              const newIgnored = new Set(ignoredIssues);
                              if (isIgnored) {
                                newIgnored.delete(issueKey);
                              } else {
                                newIgnored.add(issueKey);
                              }
                              setIgnoredIssues(newIgnored);

                              // Save to database immediately
                              try {
                                const { error } = await supabase
                                  .from('market_land_valuation')
                                  .update({
                                    ignored_issues: Array.from(newIgnored),
                                    updated_at: new Date().toISOString()
                                  })
                                  .eq('job_id', jobData.id);

                                if (error) throw error;

                                // Update displayed results/stats after toggling ignored
                                applyAndSetResults(checkResults, newIgnored);

                                // Notify parent to refresh data
                                if (onUpdateJobCache) {
                                  await onUpdateJobCache();
                                }

                                console.log(`✅ ${isIgnored ? 'Restored' : 'Ignored'} issue and saved to database`);

                                // Optional: Show brief success message
                                const msg = isIgnored ? '✅ Issue restored' : '✅ Issue ignored';
                                const toast = document.createElement('div');
                                toast.textContent = msg;
                                toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#10B981;color:white;padding:12px 20px;border-radius:6px;z-index:9999;font-size:14px;';
                                document.body.appendChild(toast);
                                setTimeout(() => toast.remove(), 2000);
                              } catch (error) {
                                console.error('Error saving ignored issues:', error);
                                alert(`Failed to ${isIgnored ? 'restore' : 'ignore'} issue: ${error.message}`);
                              }
                            }}
                            className={`px-2 py-1 text-xs rounded transition-colors ${
                              isIgnored
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                            }`}
                          >
                            {isIgnored ? 'Restore' : 'Ignore'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {modalData.properties.length > 10 && (
              <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center flex-shrink-0">
                <div className="text-sm text-gray-600">
                  Showing {modalData.properties.length} properties
                </div>
                <button
                  onClick={() => {
                    const scrollableDiv = document.querySelector('.overflow-y-auto.flex-1');
                    if (scrollableDiv) scrollableDiv.scrollTop = 0;
                  }}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Back to Top ↑
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {dataQualityActiveSubTab === 'overview' && (
        <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 60 }}>
          <button
            onClick={async () => {
              if (!jobData?.id) return;
              const newStatus = isDataQualityComplete ? 'pending' : 'completed';
              try {
                const { data: { user } } = await supabase.auth.getUser();
                const completedBy = newStatus === 'completed' ? (user?.id || null) : null;
                const updated = await checklistService.updateItemStatus(jobData.id, 'data-quality-analysis', newStatus, completedBy);
                const persistedStatus = updated?.status || newStatus;
                setIsDataQualityComplete(persistedStatus === 'completed');
                try { window.dispatchEvent(new CustomEvent('checklist_status_changed', { detail: { jobId: jobData.id, itemId: 'data-quality-analysis', status: persistedStatus } })); } catch(e){}
              } catch (error) {
                console.error('Data Quality checklist update failed:', error);
                alert('Failed to update checklist. Please try again.');
              }
            }}
            className="px-4 py-2 rounded-lg font-medium"
            style={{ backgroundColor: isDataQualityComplete ? '#10B981' : '#E5E7EB', color: isDataQualityComplete ? 'white' : '#374151' }}
            title={isDataQualityComplete ? 'Click to reopen' : 'Mark Data Quality Analysis complete'}
          >
            {isDataQualityComplete ? '✓ Mark Complete' : 'Mark Complete'}
          </button>
        </div>
      )}
    </div>
  );
};

export default DataQualityTab;
