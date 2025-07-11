import React, { useState, useRef } from 'react';
import { Upload, Download, AlertCircle, CheckCircle, Settings } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

const PayrollProductionUpdater = () => {
  const [csvFile, setCsvFile] = useState(null);
  const [excelFile, setExcelFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState('inspectors');
  const [jobs, setJobs] = useState({});
  const [currentJobName, setCurrentJobName] = useState('');
  const [jobMetrics, setJobMetrics] = useState(null);
  const [inspectorDefinitions, setInspectorDefinitions] = useState(() => {
    // Load from localStorage on initialization
    try {
      const saved = localStorage.getItem('payroll-inspector-definitions');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error('Error loading inspector definitions from localStorage:', error);
    }
    
    // Default inspector definitions if nothing saved
    return {
      'MX': { name: 'Inspector MX', type: 'residential' },
      'DE': { name: 'Inspector DE', type: 'commercial' },
      'RR': { name: 'Inspector RR', type: 'commercial' },
      'SD': { name: 'Inspector SD', type: 'residential' },
      'AS': { name: 'Inspector AS', type: 'residential' },
      'AM': { name: 'Arcadio Martinez', type: 'residential' }
    };
  });
  const [showInspectorManager, setShowInspectorManager] = useState(false);
  const [newInspector, setNewInspector] = useState({ initials: '', name: '', type: 'residential' });
  const [settings, setSettings] = useState({
    startDate: '2025-04-01',
    cleanPreStartDates: true,
    cleanOrphanedInitials: true,
    validatePropertyClass: true,
    validateInitialsFormat: true,
    requireDateForInitials: true,
    flagDuplicateEntries: true,
    validateBlockLotFormat: true,
    lastUpdateDate: '2025-06-01', // For payroll calculation
    payPerProperty: 2.00,
    targetPropertyClasses: ['2', '3A'], // Classes eligible for bonus
    applyColorCoding: true,
    autoMarkInspected: true,
    useSlipstreamColors: true // Use Excel slipstream color scheme
  });
  
  const csvInputRef = useRef();
  const excelInputRef = useRef();
  const inspectorImportRef = useRef();

  // Custom hook to update inspector definitions and save to localStorage
  const updateInspectorDefinitions = (newDefinitions) => {
    setInspectorDefinitions(newDefinitions);
    try {
      localStorage.setItem('payroll-inspector-definitions', JSON.stringify(newDefinitions));
    } catch (error) {
      console.error('Error saving inspector definitions to localStorage:', error);
    }
  };

  const handleFileUpload = (file, type) => {
    if (type === 'csv') {
      setCsvFile(file);
    } else {
      setExcelFile(file);
    }
  };

  const importInspectorsFromExcel = async (file) => {
    try {
      const excelArrayBuffer = await readFileAsArrayBuffer(file);
      const workbook = XLSX.read(excelArrayBuffer, { cellDates: true });
      
      // Use the first sheet
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      
      const importedInspectors = {};
      let importCount = 0;
      let skippedCount = 0;
      
      // Process each row (skip header row 0)
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const nameWithInitials = row[1]; // Column B
        const role = row[5]; // Column F
        
        // Only process Residential and Commercial roles
        if (role && (role === 'Residential' || role === 'Commercial')) {
          if (nameWithInitials && typeof nameWithInitials === 'string') {
            // Extract initials from parentheses like "Aguilar, Jared (JA)" -> "JA"
            const initialsMatch = nameWithInitials.match(/\(([A-Z]{2,3})\)/);
            if (initialsMatch) {
              const initials = initialsMatch[1];
              // Extract name (everything before the parentheses, trimmed)
              const name = nameWithInitials.replace(/\s*\([^)]*\)/, '').trim();
              
              // Convert role to lowercase for consistency
              const inspectorType = role.toLowerCase();
              
              // Only add if initials don't already exist
              if (!inspectorDefinitions[initials]) {
                importedInspectors[initials] = {
                  name: name,
                  type: inspectorType
                };
                importCount++;
              } else {
                skippedCount++;
              }
            }
          }
        }
      }
      
      // Merge with existing inspectors
      setInspectorDefinitions(prev => {
        const updated = { ...prev, ...importedInspectors };
        // Save to localStorage
        try {
          localStorage.setItem('payroll-inspector-definitions', JSON.stringify(updated));
        } catch (error) {
          console.error('Error saving to localStorage:', error);
        }
        return updated;
      });
      
      // Show success message
      alert(`Import complete!\n✅ Imported: ${importCount} inspectors\n⚠️ Skipped: ${skippedCount} (already exist or invalid format)\n\nOnly Residential and Commercial inspectors were imported.`);
      
    } catch (error) {
      console.error('Import error:', error);
      alert(`Error importing inspectors: ${error.message}`);
    }
  };

  const processFiles = async () => {
    if (!csvFile || !excelFile) {
      alert('Please upload both CSV and Excel files');
      return;
    }

    if (!currentJobName.trim()) {
      alert('Please enter a job name');
      return;
    }

    setProcessing(true);
    try {
      // Read CSV file
      const csvText = await readFileAsText(csvFile);
      const csvData = Papa.parse(csvText, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true
      });

      // Read Excel file
      const excelArrayBuffer = await readFileAsArrayBuffer(excelFile);
      const workbook = XLSX.read(excelArrayBuffer, { cellDates: true });
      
      // Find the production sheet
      const productionSheetName = workbook.SheetNames.find(name => 
        name.includes('REVAL PRODUCTION') || name.includes('Production')
      );
      
      if (!productionSheetName) {
        throw new Error('Could not find production sheet in Excel file');
      }

      const productionSheet = workbook.Sheets[productionSheetName];
      const excelData = XLSX.utils.sheet_to_json(productionSheet, { header: 1 });
      
      // Process the update
      const updateResults = await updateProductionData(csvData.data, excelData, workbook, productionSheetName);
      
      // Calculate comprehensive metrics
      const metrics = calculateJobMetrics(csvData.data, excelData);
      
      // Store job data
      const jobData = {
        name: currentJobName.trim(),
        date: new Date().toISOString(),
        csvData: csvData.data,
        excelData: excelData,
        results: updateResults,
        metrics: metrics,
        settings: {...settings},
        inspectorDefinitions: {...inspectorDefinitions}
      };
      
      setJobs(prev => ({...prev, [currentJobName.trim()]: jobData}));
      setResults(updateResults);
      setJobMetrics(metrics);
      setActiveTab('metrics');
    } catch (error) {
      console.error('Processing error:', error);
      alert(`Error processing files: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const updateProductionData = async (csvData, excelData, workbook, sheetName) => {
    const results = {
      totalMatches: 0,
      updatedRecords: 0,
      cleanedPreStart: 0,
      cleanedOrphaned: 0,
      validationErrors: 0,
      duplicatesFound: 0,
      invalidInitials: 0,
      missingDates: 0,
      markedInspected: 0,
      colorCodedRows: 0,
      errors: [],
      warnings: [],
      summary: [],
      payrollAnalytics: {
        inspectorStats: {},
        totalPayroll: 0,
        eligibleProperties: 0,
        inspectionTypes: {
          exterior: 0,
          interior: 0,
          commercial: 0
        }
      }
    };

    // Get headers from Excel sheet and find correct mapping
    const headers = excelData[0];
    const blockCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('BLOCK'));
    const lotCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('LOT'));
    const qualifierCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('QUALIFIER'));
    const cardCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('CARD'));
    const propertyLocationCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('PROPERTY_LOCATION'));
    
    // Find target columns including property class and inspected
    const targetColumns = {
      BLOCK: blockCol,
      LOT: lotCol,
      QUALIFIER: qualifierCol,
      CARD: cardCol,
      PROPERTY_LOCATION: propertyLocationCol,
      INFOBY: headers.findIndex(h => h && h.toString().toUpperCase().includes('INFOBY')), // Column Q
      PROPERTY_CLASS: headers.findIndex(h => h && (h.toString().toUpperCase().includes('PROPERTY_CLASS') || h.toString().toUpperCase().includes('MODIV'))), // Property class column
      INSPECTED: headers.findIndex(h => h && h.toString().toUpperCase().includes('INSPECTED')), // Column S
      MEASUREBY: headers.findIndex(h => h && h.toString().toUpperCase().includes('MEASUREBY')), // Column T
      MEASUREDT: headers.findIndex(h => h && h.toString().toUpperCase().includes('MEASUREDT')), // Column U
      LISTBY: headers.findIndex(h => h && h.toString().toUpperCase().includes('LISTBY')), // Column V
      LISTDT: headers.findIndex(h => h && h.toString().toUpperCase().includes('LISTDT')), // Column W
      PRICEBY: headers.findIndex(h => h && h.toString().toUpperCase().includes('PRICEBY')), // Column X
      PRICEDT: headers.findIndex(h => h && h.toString().toUpperCase().includes('PRICEDT')), // Column Y
      FIELDCALL_1: headers.findIndex(h => h && h.toString().toUpperCase().includes('FIELDCALL_1')), // Column Z
      FIELDCALL_2: headers.findIndex(h => h && h.toString().toUpperCase().includes('FIELDCALL_2')),
      FIELDCALL_3: headers.findIndex(h => h && h.toString().toUpperCase().includes('FIELDCALL_3')),
      FIELDCALL_4: headers.findIndex(h => h && h.toString().toUpperCase().includes('FIELDCALL_4')),
      FIELDCALL_5: headers.findIndex(h => h && h.toString().toUpperCase().includes('FIELDCALL_5')),
      FIELDCALL_6: headers.findIndex(h => h && h.toString().toUpperCase().includes('FIELDCALL_6')),
      FIELDCALL_7: headers.findIndex(h => h && h.toString().toUpperCase().includes('FIELDCALL_7')),
      FIELDCALLDT_1: headers.findIndex(h => h && h.toString().toUpperCase().includes('FIELDCALLDT_1')), // Column AG
      FIELDCALLDT_2: headers.findIndex(h => h && h.toString().toUpperCase().includes('FIELDCALLDT_2')),
      FIELDCALLDT_3: headers.findIndex(h => h && h.toString().toUpperCase().includes('FIELDCALLDT_3')),
      FIELDCALLDT_4: headers.findIndex(h => h && h.toString().toUpperCase().includes('FIELDCALLDT_4')),
      FIELDCALLDT_5: headers.findIndex(h => h && h.toString().toUpperCase().includes('FIELDCALLDT_5')),
      FIELDCALLDT_6: headers.findIndex(h => h && h.toString().toUpperCase().includes('FIELDCALLDT_6')),
      FIELDCALLDT_7: headers.findIndex(h => h && h.toString().toUpperCase().includes('FIELDCALLDT_7')) // Column AM
    };

    // Create lookup map for CSV data
    const csvLookup = new Map();
    csvData.forEach(row => {
      const key = `${row.BLOCK}-${row.LOT}`;
      csvLookup.set(key, row);
    });

    const startDate = new Date(settings.startDate);
    const lastUpdateDate = new Date(settings.lastUpdateDate);
    
    // Initialize payroll tracking
    const inspectorStats = {};
    
    const initInspector = (initials) => {
      if (!inspectorStats[initials]) {
        inspectorStats[initials] = {
          name: inspectorDefinitions[initials]?.name || `Inspector ${initials}`,
          type: inspectorDefinitions[initials]?.type || 'residential',
          totalProperties: 0,
          eligibleProperties: 0,
          payrollAmount: 0,
          inspectionTypes: {
            exterior: 0,
            interior: 0,
            commercial: 0
          },
          recentWork: []
        };
      }
    };
    
    // Validation functions
    const isValidInitials = (initials) => {
      if (!initials || typeof initials !== 'string') return false;
      return /^[A-Z]{2,3}$/.test(initials.trim().toUpperCase());
    };
    
    const isValidBlockLot = (block, lot) => {
      return block && lot && !isNaN(block) && !isNaN(lot);
    };
    
    const isEligibleForPay = (propertyClass) => {
      return settings.targetPropertyClasses.includes(propertyClass);
    };
    
    const isRecentWork = (dateValue) => {
      return dateValue && !isNaN(dateValue.getTime()) && dateValue >= lastUpdateDate;
    };
    
    const hasAnyInspectionData = (csvRow) => {
      return (csvRow.MEASUREBY || csvRow.LISTBY || csvRow.PRICEBY || 
              csvRow.MEASUREDT || csvRow.LISTDT || csvRow.PRICEDT ||
              csvRow.FIELDCALL_1 || csvRow.FIELDCALL_2 || csvRow.FIELDCALL_3 || csvRow.FIELDCALL_4);
    };
    
    const getInspectorType = (initials) => {
      return inspectorDefinitions[initials]?.type || 'residential';
    };
    
    // Track duplicates
    const seenBlockLots = new Set();
    const duplicates = new Set();
    
    // First pass: identify duplicates
    csvData.forEach(row => {
      const key = `${row.BLOCK}-${row.LOT}`;
      if (seenBlockLots.has(key)) {
        duplicates.add(key);
        results.duplicatesFound++;
      } else {
        seenBlockLots.add(key);
      }
    });

    // Process each Excel row
    for (let i = 1; i < excelData.length; i++) {
      const excelRow = excelData[i];
      const block = excelRow[blockCol];
      const lot = excelRow[lotCol];
      const key = `${block}-${lot}`;
      
      if (csvLookup.has(key)) {
        results.totalMatches++;
        const csvRow = csvLookup.get(key);
        let updated = false;
        
        // Get property class for payroll calculation
        const propertyClass = csvRow.PROPERTY_CLASS || excelRow[targetColumns.PROPERTY_CLASS];
        const isEligible = isEligibleForPay(propertyClass);
        
        // Process all field updates first (including data scrubbing)
        let fieldUpdatesCompleted = false;

        // Track inspector work for payroll
        const trackInspectorWork = (initials, dateValue, inspectionType) => {
          if (initials && isValidInitials(initials)) {
            initInspector(initials);
            inspectorStats[initials].totalProperties++;
            
            if (isRecentWork(dateValue)) {
              inspectorStats[initials].recentWork.push({
                block,
                lot,
                date: dateValue,
                propertyClass,
                inspectionType,
                eligible: isEligible
              });
              
              if (isEligible) {
                inspectorStats[initials].eligibleProperties++;
                inspectorStats[initials].payrollAmount += settings.payPerProperty;
                results.payrollAnalytics.eligibleProperties++;
              }
              
              inspectorStats[initials].inspectionTypes[inspectionType]++;
              results.payrollAnalytics.inspectionTypes[inspectionType]++;
            }
          }
        };

        // Update target columns with enhanced validation
        Object.entries(targetColumns).forEach(([field, colIndex]) => {
          if (colIndex !== -1 && csvRow[field] !== undefined && csvRow[field] !== null) {
            const oldValue = excelRow[colIndex];
            let newValue = csvRow[field];
            
            // Validation and cleaning rules
            
            // 1. Clean dates before start date
            if (settings.cleanPreStartDates && field.includes('DT')) {
              const dateValue = new Date(newValue);
              if (!isNaN(dateValue.getTime()) && dateValue < startDate) {
                excelRow[colIndex] = '';
                const initialsField = field.replace('DT', 'BY').replace('CALLDT_', 'CALL_');
                const initialsCol = targetColumns[initialsField];
                if (initialsCol !== -1) {
                  excelRow[initialsCol] = '';
                }
                results.cleanedPreStart++;
                return;
              }
            }
            
            // 2. Validate and clean initials format
            if (settings.validateInitialsFormat && (field.includes('BY') || field.includes('CALL_')) && !field.includes('DT')) {
              if (newValue && !isValidInitials(newValue)) {
                results.warnings.push(`Invalid initials format "${newValue}" for Block ${block}, Lot ${lot}, Field ${field}`);
                results.invalidInitials++;
                if (settings.cleanOrphanedInitials) {
                  excelRow[colIndex] = '';
                  return;
                }
              } else if (newValue) {
                newValue = newValue.toString().trim().toUpperCase();
              }
            }
            
            // 3. Require date when initials are present
            if (settings.requireDateForInitials && (field.includes('BY') || field.includes('CALL_')) && !field.includes('DT')) {
              if (newValue) {
                const dateField = field.replace('BY', 'DT').replace('CALL_', 'CALLDT_');
                const dateCol = targetColumns[dateField];
                if (dateCol !== -1 && (!csvRow[dateField] || csvRow[dateField] === '')) {
                  results.warnings.push(`Initials "${newValue}" without date for Block ${block}, Lot ${lot}, Field ${field}`);
                  results.missingDates++;
                  if (settings.cleanOrphanedInitials) {
                    excelRow[colIndex] = '';
                    return;
                  }
                }
              }
            }
            
            // 4. Clean orphaned initials (original rule)
            if (settings.cleanOrphanedInitials && (field.includes('BY') || field.includes('CALL_')) && !field.includes('DT')) {
              const dateField = field.replace('BY', 'DT').replace('CALL_', 'CALLDT_');
              const dateCol = targetColumns[dateField];
              if (dateCol !== -1 && (!excelRow[dateCol] || excelRow[dateCol] === '')) {
                excelRow[colIndex] = '';
                results.cleanedOrphaned++;
                return;
              }
            }
            
            // 5. Flag duplicates
            if (settings.flagDuplicateEntries && duplicates.has(key)) {
              results.warnings.push(`Duplicate Block/Lot combination: ${key}`);
            }
            
            // 6. Validate Block/Lot format
            if (settings.validateBlockLotFormat && !isValidBlockLot(block, lot)) {
              results.warnings.push(`Invalid Block/Lot format: Block "${block}", Lot "${lot}"`);
              results.validationErrors++;
            }

            // Apply the update
            excelRow[colIndex] = newValue;
            if (oldValue !== newValue) {
              updated = true;
            }
            
            // Track payroll for inspector work
            if ((field === 'MEASUREBY' || field === 'LISTBY' || field === 'PRICEBY') && newValue) {
              const dateField = field.replace('BY', 'DT');
              const dateValue = new Date(csvRow[dateField]);
              let inspectionType = 'exterior';
              
              if (field === 'LISTBY') inspectionType = 'interior';
              else if (field === 'PRICEBY') inspectionType = 'commercial';
              
              trackInspectorWork(newValue, dateValue, inspectionType);
            }
          }
        });

        if (updated) {
          results.updatedRecords++;
        }

        // AFTER all data scrubbing, check if row should be marked as inspected
        if (settings.autoMarkInspected && targetColumns.INSPECTED !== -1) {
          const hasValidInspectorData = (
            (excelRow[targetColumns.MEASUREBY] && excelRow[targetColumns.MEASUREDT]) ||
            (excelRow[targetColumns.LISTBY] && excelRow[targetColumns.LISTDT]) ||
            (excelRow[targetColumns.PRICEBY] && excelRow[targetColumns.PRICEDT])
          );
          
          if (hasValidInspectorData) {
            excelRow[targetColumns.INSPECTED] = 'YES';
            results.markedInspected++;
            updated = true;
          }
        }
      }
    }

    // Finalize payroll analytics
    results.payrollAnalytics.inspectorStats = inspectorStats;
    results.payrollAnalytics.totalPayroll = Object.values(inspectorStats)
      .reduce((total, inspector) => total + inspector.payrollAmount, 0);

    // Apply color coding and formatting to the workbook
    const newSheet = XLSX.utils.aoa_to_sheet(excelData);
    
    if (settings.applyColorCoding) {
      // Add conditional formatting for color coding
      const range = XLSX.utils.decode_range(newSheet['!ref']);
      
      // Process each row for color coding
      for (let row = 1; row <= range.e.r; row++) {
        const excelRow = excelData[row];
        const inspected = excelRow[targetColumns.INSPECTED];
        
        if (inspected === 'YES') {
          // Determine inspector type based on who did the work
          let inspectorType = 'residential'; // default
          
          // Check all inspector fields to determine type
          const inspectorFields = ['MEASUREBY', 'LISTBY', 'PRICEBY', 'FIELDCALL_1', 'FIELDCALL_2', 'FIELDCALL_3', 'FIELDCALL_4'];
          for (const field of inspectorFields) {
            const initials = excelRow[targetColumns[field]];
            if (initials) {
              inspectorType = getInspectorType(initials);
              break; // Use the first inspector found
            }
          }
          
          // Apply color coding to the entire row
          for (let col = 0; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({r: row, c: col});
            const cell = newSheet[cellAddress] || {};
            
            if (!cell.s) cell.s = {};
            
            if (settings.useSlipstreamColors) {
              // Excel Slipstream color scheme
              if (inspectorType === 'commercial') {
                // Slipstream Blue: Light blue background with dark blue text
                cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'D6EAF8' } }; // Light blue
                cell.s.font = { color: { rgb: '1B4F72' } }; // Dark blue
              } else {
                // Slipstream Green: Light green background with dark green text
                cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'D5F4E6' } }; // Light green
                cell.s.font = { color: { rgb: '0B5345' } }; // Dark green
              }
            } else {
              // Classic color scheme
              if (inspectorType === 'commercial') {
                // Light blue background, dark blue font
                cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'ADD8E6' } };
                cell.s.font = { color: { rgb: '000080' } };
              } else {
                // Light green background, dark green font  
                cell.s.fill = { patternType: 'solid', fgColor: { rgb: '90EE90' } };
                cell.s.font = { color: { rgb: '006400' } };
              }
            }
            
            newSheet[cellAddress] = cell;
          }
          
          results.colorCodedRows++;
        }
      }
    }
    
    workbook.Sheets[sheetName] = newSheet;

    // Generate download
    const updatedFile = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([updatedFile], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    
    results.downloadUrl = url;
    results.fileName = `Updated_${excelFile.name}`;

    return results;
  };

  const calculateJobMetrics = (csvData, excelData) => {
    const metrics = {
      overallCompletion: {
        total: 0,
        inspected: 0,
        percentage: 0
      },
      interiorInspections: {
        class2_3A: {
          total: 0,
          listed: 0,
          percentage: 0
        }
      },
      pricingInspections: {
        class4ABC: {
          total: 0,
          priced: 0,
          percentage: 0
        }
      },
      inspectorActivity: {},
      projectedCompletion: {
        remainingProperties: 0,
        businessDaysToComplete: 0,
        estimatedFinishDate: null
      }
    };

    // Find column indices
    const headers = excelData[0];
    const inspectedCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('INSPECTED'));
    const propertyClassCol = headers.findIndex(h => h && (h.toString().toUpperCase().includes('PROPERTY_CLASS') || h.toString().toUpperCase().includes('MODIV')));
    const listByCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('LISTBY'));
    const priceByCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('PRICEBY'));
    const listDtCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('LISTDT'));
    const priceDtCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('PRICEDT'));

    // Process each row for metrics
    for (let i = 1; i < excelData.length; i++) {
      const row = excelData[i];
      const inspected = row[inspectedCol];
      const propertyClass = row[propertyClassCol];
      const listBy = row[listByCol];
      const priceBy = row[priceByCol];
      const listDt = row[listDtCol];
      const priceDt = row[priceDtCol];

      metrics.overallCompletion.total++;
      
      // Overall completion tracking
      if (inspected && inspected.toString().toUpperCase() === 'YES') {
        metrics.overallCompletion.inspected++;
      }

      // Interior inspections for Class 2 and 3A
      if (propertyClass && ['2', '3A'].includes(propertyClass.toString())) {
        metrics.interiorInspections.class2_3A.total++;
        if (listBy) {
          metrics.interiorInspections.class2_3A.listed++;
          
          // Track inspector activity
          const initials = listBy.toString().toUpperCase();
          if (!metrics.inspectorActivity[initials]) {
            metrics.inspectorActivity[initials] = {
              name: inspectorDefinitions[initials]?.name || `Inspector ${initials}`,
              type: inspectorDefinitions[initials]?.type || 'residential',
              dailyAverage: 0,
              recentWork: 0,
              lastWorkDate: null
            };
          }
          
          if (listDt) {
            const workDate = new Date(listDt);
            if (!isNaN(workDate.getTime())) {
              metrics.inspectorActivity[initials].recentWork++;
              if (!metrics.inspectorActivity[initials].lastWorkDate || workDate > metrics.inspectorActivity[initials].lastWorkDate) {
                metrics.inspectorActivity[initials].lastWorkDate = workDate;
              }
            }
          }
        }
      }

      // Pricing inspections for Class 4A, 4B, 4C
      if (propertyClass && ['4A', '4B', '4C'].includes(propertyClass.toString())) {
        metrics.pricingInspections.class4ABC.total++;
        if (priceBy) {
          metrics.pricingInspections.class4ABC.priced++;
          
          // Track inspector activity
          const initials = priceBy.toString().toUpperCase();
          if (!metrics.inspectorActivity[initials]) {
            metrics.inspectorActivity[initials] = {
              name: inspectorDefinitions[initials]?.name || `Inspector ${initials}`,
              type: inspectorDefinitions[initials]?.type || 'commercial',
              dailyAverage: 0,
              recentWork: 0,
              lastWorkDate: null
            };
          }
          
          if (priceDt) {
            const workDate = new Date(priceDt);
            if (!isNaN(workDate.getTime())) {
              metrics.inspectorActivity[initials].recentWork++;
              if (!metrics.inspectorActivity[initials].lastWorkDate || workDate > metrics.inspectorActivity[initials].lastWorkDate) {
                metrics.inspectorActivity[initials].lastWorkDate = workDate;
              }
            }
          }
        }
      }
    }

    // Calculate percentages
    metrics.overallCompletion.percentage = metrics.overallCompletion.total > 0 
      ? (metrics.overallCompletion.inspected / metrics.overallCompletion.total * 100) 
      : 0;

    metrics.interiorInspections.class2_3A.percentage = metrics.interiorInspections.class2_3A.total > 0
      ? (metrics.interiorInspections.class2_3A.listed / metrics.interiorInspections.class2_3A.total * 100)
      : 0;

    metrics.pricingInspections.class4ABC.percentage = metrics.pricingInspections.class4ABC.total > 0
      ? (metrics.pricingInspections.class4ABC.priced / metrics.pricingInspections.class4ABC.total * 100)
      : 0;

    // Calculate daily averages and projected completion
    const today = new Date();
    const projectStartDate = new Date(settings.startDate);
    const businessDaysElapsed = calculateBusinessDays(projectStartDate, today);
    
    let totalDailyCapacity = 0;
    Object.keys(metrics.inspectorActivity).forEach(initials => {
      const inspector = metrics.inspectorActivity[initials];
      if (businessDaysElapsed > 0) {
        inspector.dailyAverage = inspector.recentWork / businessDaysElapsed;
        totalDailyCapacity += inspector.dailyAverage;
      }
    });

    // Calculate remaining work and projected finish
    metrics.projectedCompletion.remainingProperties = metrics.overallCompletion.total - metrics.overallCompletion.inspected;
    
    if (totalDailyCapacity > 0 && metrics.projectedCompletion.remainingProperties > 0) {
      metrics.projectedCompletion.businessDaysToComplete = Math.ceil(
        metrics.projectedCompletion.remainingProperties / totalDailyCapacity
      );
      
      metrics.projectedCompletion.estimatedFinishDate = addBusinessDays(
        today, 
        metrics.projectedCompletion.businessDaysToComplete
      );
    }

    return metrics;
  };

  const calculateBusinessDays = (startDate, endDate) => {
    let count = 0;
    const current = new Date(startDate);
    
    while (current <= endDate) {
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday (0) or Saturday (6)
        count++;
      }
      current.setDate(current.getDate() + 1);
    }
    
    return count;
  };

  const addBusinessDays = (startDate, businessDays) => {
    const result = new Date(startDate);
    let daysAdded = 0;
    
    while (daysAdded < businessDays) {
      result.setDate(result.getDate() + 1);
      const dayOfWeek = result.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not weekend
        daysAdded++;
      }
    }
    
    return result;
  };

  const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  };

  const readFileAsArrayBuffer = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsArrayBuffer(file);
    });
  };

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Payroll Production Data Updater
        </h1>
        <p className="text-gray-600">
          Automate bimonthly payroll processing and production tracking with built-in data cleaning and analytics
        </p>
        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
          <h3 className="text-sm font-semibold text-blue-800 mb-1">📅 Typical Usage Schedule:</h3>
          <div className="text-sm text-blue-700">
            • <strong>Bimonthly Reports:</strong> Run 2 business days before pay period ends<br/>
            • <strong>Month-End Reports:</strong> Run at the end of each month for final reconciliation<br/>
            • <strong>Ad-Hoc Reports:</strong> Can be run anytime for progress tracking
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('inspectors')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'inspectors'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              👥 Inspector Management
            </button>
            <button
              onClick={() => setActiveTab('upload')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'upload'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              📁 Upload & Process
            </button>
            <button
              onClick={() => setActiveTab('metrics')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'metrics'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              📊 Job Metrics
            </button>
            <button
              onClick={() => setActiveTab('jobs')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'jobs'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              📋 All Jobs ({Object.keys(jobs).length})
            </button>
          </nav>
        </div>
      </div>

      {/* Inspector Management Tab */}
      {activeTab === 'inspectors' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg border-2 border-blue-200 p-6">
            <div className="flex items-center mb-6">
              <Settings className="w-8 h-8 mr-3 text-blue-600" />
              <div>
                <h2 className="text-2xl font-bold text-gray-800">👥 Inspector Management</h2>
                <p className="text-gray-600 mt-1">Manage inspector profiles for payroll tracking and color coding</p>
              </div>
            </div>
            
            {/* Add New Inspector */}
            <div className="mb-6 p-6 bg-white rounded-lg border shadow-sm">
              <h3 className="text-lg font-semibold mb-4 text-gray-700 flex items-center">
                ➕ Add New Inspector
              </h3>
              
              {/* Import from Excel Option */}
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-semibold text-blue-800 mb-3 flex items-center">
                  📊 Import from Excel File
                </h4>
                <p className="text-sm text-blue-700 mb-3">
                  Import inspectors directly from your staff Excel file. The system will read Column B (names with initials) and Column F (roles), importing only Residential and Commercial inspectors.
                </p>
                <div className="flex items-center gap-4">
                  <input
                    ref={inspectorImportRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => {
                      if (e.target.files[0]) {
                        importInspectorsFromExcel(e.target.files[0]);
                      }
                    }}
                    className="hidden"
                  />
                  <button
                    onClick={() => inspectorImportRef.current.click()}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Import from Excel
                  </button>
                  <div className="text-xs text-blue-600">
                    Expected format: "Last, First (XX)" in Column B, "Residential" or "Commercial" in Column F
                  </div>
                </div>
              </div>
              
              {/* Manual Add Form */}
              <div className="border-t border-gray-200 pt-4">
                <h4 className="font-semibold text-gray-700 mb-3">Manual Entry</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Initials *</label>
                    <input
                      type="text"
                      placeholder="e.g., AM"
                      value={newInspector.initials}
                      onChange={(e) => setNewInspector({...newInspector, initials: e.target.value.toUpperCase()})}
                      className="w-full p-3 border rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      maxLength="3"
                    />
                    <p className="text-xs text-gray-500 mt-1">2-3 uppercase letters</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Full Name *</label>
                    <input
                      type="text"
                      placeholder="e.g., Arcadio Martinez"
                      value={newInspector.name}
                      onChange={(e) => setNewInspector({...newInspector, name: e.target.value})}
                      className="w-full p-3 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Inspector's full name</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Inspector Type *</label>
                    <select
                      value={newInspector.type}
                      onChange={(e) => setNewInspector({...newInspector, type: e.target.value})}
                      className="w-full p-3 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="residential">🏠 Residential</option>
                      <option value="commercial">🏭 Commercial</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">Determines color coding</p>
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={() => {
                        if (newInspector.initials && newInspector.name) {
                          setInspectorDefinitions({
                            ...inspectorDefinitions,
                            [newInspector.initials]: {
                              name: newInspector.name,
                              type: newInspector.type
                            }
                          });
                          setNewInspector({ initials: '', name: '', type: 'residential' });
                        }
                      }}
                      disabled={!newInspector.initials || !newInspector.name}
                      className="w-full px-4 py-3 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                      Add Inspector
                    </button>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Current Inspectors */}
            <div className="p-6 bg-white rounded-lg border shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-700 flex items-center">
                  📋 Current Inspectors
                </h3>
                <div className="flex items-center gap-3">
                  <div className="text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                    {Object.keys(inspectorDefinitions).length} inspector{Object.keys(inspectorDefinitions).length !== 1 ? 's' : ''} configured
                  </div>
                  <div className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded-full flex items-center gap-1">
                    💾 Auto-saved locally
                  </div>
                </div>
              </div>
              
              {Object.keys(inspectorDefinitions).length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">👥</div>
                  <h4 className="text-lg font-medium mb-2">No Inspectors Configured</h4>
                  <p className="text-sm">Add your first inspector above to get started with payroll tracking and color coding!</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {Object.entries(inspectorDefinitions).map(([initials, info]) => (
                    <div key={initials} className={`flex justify-between items-center p-4 rounded-lg border-l-4 transition-all hover:shadow-md ${
                      info.type === 'commercial' ? 'bg-blue-50 border-blue-400 hover:bg-blue-100' : 'bg-green-50 border-green-400 hover:bg-green-100'
                    }`}>
                      <div className="flex items-center flex-1">
                        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white border-2 border-current mr-4">
                          <span className={`font-bold text-lg ${
                            info.type === 'commercial' ? 'text-blue-600' : 'text-green-600'
                          }`}>
                            {initials}
                          </span>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-lg text-gray-800">{info.name}</span>
                            <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                              info.type === 'commercial' ? 'bg-blue-200 text-blue-800' : 'bg-green-200 text-green-800'
                            }`}>
                              {info.type === 'commercial' ? '🏭 Commercial' : '🏠 Residential'}
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 mt-1">
                            Color coding: {info.type === 'commercial' ? 'Blue scheme for commercial/warehouse properties' : 'Green scheme for residential/home properties'}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const updated = {...inspectorDefinitions};
                          delete updated[initials];
                          updateInspectorDefinitions(updated);
                        }}
                        className="ml-4 text-red-500 hover:text-red-700 text-sm font-medium px-4 py-2 rounded hover:bg-red-50 transition-colors border border-red-200 hover:border-red-300"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Color Coding Information */}
            <div className="mt-6 p-4 bg-white rounded-lg border border-gray-200">
              <h4 className="font-semibold text-gray-800 mb-3 flex items-center">
                🎨 Color Coding System
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="flex items-center p-3 rounded-lg border border-blue-200 bg-blue-50">
                  <div className="w-6 h-6 bg-blue-200 border border-blue-300 rounded mr-3"></div>
                  <div>
                    <div className="font-medium text-blue-800">🏭 Commercial Inspectors</div>
                    <div className="text-blue-600">Excel "Slipstream" blue scheme for inspected rows</div>
                  </div>
                </div>
                <div className="flex items-center p-3 rounded-lg border border-green-200 bg-green-50">
                  <div className="w-6 h-6 bg-green-200 border border-green-300 rounded mr-3"></div>
                  <div>
                    <div className="font-medium text-green-800">🏠 Residential Inspectors</div>
                    <div className="text-green-600">Excel "Slipstream" green scheme for inspected rows</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Tab */}
      {activeTab === 'upload' && (
        <div>
          {/* Job Name Input */}
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <h3 className="text-lg font-semibold text-yellow-800 mb-3">🏷️ Job Information</h3>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-yellow-700 mb-2">
                  Job Name *
                </label>
                <input
                  type="text"
                  value={currentJobName}
                  onChange={(e) => setCurrentJobName(e.target.value)}
                  placeholder="e.g., Township Revaluation 2025, Downtown Commercial Project"
                  className="w-full p-3 border border-yellow-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                />
                <p className="text-xs text-yellow-600 mt-1">
                  This will be used to track and compare multiple jobs
                </p>
              </div>
              {Object.keys(jobs).length > 0 && (
                <div>
                  <select
                    value=""
                    onChange={(e) => setCurrentJobName(e.target.value)}
                    className="p-3 border border-yellow-300 rounded-lg text-sm"
                  >
                    <option value="">Load Previous Job</option>
                    {Object.keys(jobs).map(jobName => (
                      <option key={jobName} value={jobName}>{jobName}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Settings Panel */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center mb-3">
              <Settings className="w-5 h-5 mr-2" />
              <h3 className="text-lg font-semibold">Data Cleaning Settings</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Project Start Date</label>
                <input
                  type="date"
                  value={settings.startDate}
                  onChange={(e) => setSettings({...settings, startDate: e.target.value})}
                  className="w-full p-2 border rounded-md"
                />
                <p className="text-xs text-gray-500 mt-1">Dates before this will be cleaned</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Last Payroll Update</label>
                <input
                  type="date"
                  value={settings.lastUpdateDate}
                  onChange={(e) => setSettings({...settings, lastUpdateDate: e.target.value})}
                  className="w-full p-2 border rounded-md"
                />
                <p className="text-xs text-gray-500 mt-1">Calculate pay for work since this date</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium mb-1">Pay Per Property ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={settings.payPerProperty}
                  onChange={(e) => setSettings({...settings, payPerProperty: parseFloat(e.target.value) || 0})}
                  className="w-full p-2 border rounded-md"
                />
                <p className="text-xs text-gray-500 mt-1">Bonus for Class 2 & 3A properties</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Target Property Classes</label>
                <input
                  type="text"
                  value={settings.targetPropertyClasses.join(', ')}
                  onChange={(e) => setSettings({...settings, targetPropertyClasses: e.target.value.split(',').map(c => c.trim())})}
                  className="w-full p-2 border rounded-md"
                  placeholder="2, 3A"
                />
                <p className="text-xs text-gray-500 mt-1">Classes eligible for bonus pay</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.cleanPreStartDates}
                    onChange={(e) => setSettings({...settings, cleanPreStartDates: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Clean dates before start date</span>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.cleanOrphanedInitials}
                    onChange={(e) => setSettings({...settings, cleanOrphanedInitials: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Clean orphaned initials (no date)</span>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.validateInitialsFormat}
                    onChange={(e) => setSettings({...settings, validateInitialsFormat: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Validate initials format (2-3 letters)</span>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.requireDateForInitials}
                    onChange={(e) => setSettings({...settings, requireDateForInitials: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Require date when initials present</span>
                </label>
              </div>
              
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.validatePropertyClass}
                    onChange={(e) => setSettings({...settings, validatePropertyClass: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Validate property class codes</span>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.flagDuplicateEntries}
                    onChange={(e) => setSettings({...settings, flagDuplicateEntries: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Flag duplicate Block/Lot entries</span>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.validateBlockLotFormat}
                    onChange={(e) => setSettings({...settings, validateBlockLotFormat: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Validate Block/Lot format</span>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.autoMarkInspected}
                    onChange={(e) => setSettings({...settings, autoMarkInspected: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Auto-mark "YES" in Inspected column</span>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.applyColorCoding}
                    onChange={(e) => setSettings({...settings, applyColorCoding: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Apply color coding</span>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.useSlipstreamColors}
                    onChange={(e) => setSettings({...settings, useSlipstreamColors: e.target.checked})}
                    className="mr-2"
                    disabled={!settings.applyColorCoding}
                  />
                  <span className="text-sm">Use Excel "Slipstream" color scheme</span>
                </label>
              </div>
            </div>
          </div>

          {/* File Upload Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <h3 className="text-lg font-semibold mb-2">Upload CSV File</h3>
              <p className="text-sm text-gray-600 mb-4">
                Select the REVAL PRODUCTION CSV file
              </p>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv"
                onChange={(e) => handleFileUpload(e.target.files[0], 'csv')}
                className="hidden"
              />
              <button
                onClick={() => csvInputRef.current.click()}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
              >
                Choose CSV File
              </button>
              {csvFile && (
                <p className="mt-2 text-sm text-green-600">
                  ✓ {csvFile.name}
                </p>
              )}
            </div>

            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <h3 className="text-lg font-semibold mb-2">Upload Excel File</h3>
              <p className="text-sm text-gray-600 mb-4">
                Select the Production Excel file to update
              </p>
              <input
                ref={excelInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => handleFileUpload(e.target.files[0], 'excel')}
                className="hidden"
              />
              <button
                onClick={() => excelInputRef.current.click()}
                className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
              >
                Choose Excel File
              </button>
              {excelFile && (
                <p className="mt-2 text-sm text-green-600">
                  ✓ {excelFile.name}
                </p>
              )}
            </div>
          </div>

          {/* Process Button */}
          <div className="text-center mb-6">
            <button
              onClick={processFiles}
              disabled={!csvFile || !excelFile || !currentJobName.trim() || processing}
              className="px-8 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-lg font-semibold"
            >
              {processing ? 'Processing...' : 'Update Production Data'}
            </button>
          </div>

          {/* Results Section */}
          {results && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
              <div className="flex items-center mb-4">
                <CheckCircle className="w-6 h-6 text-green-600 mr-2" />
                <h3 className="text-lg font-semibold text-green-800">Processing Complete!</h3>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{results.totalMatches}</div>
                  <div className="text-sm text-gray-600">Total Matches</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{results.updatedRecords}</div>
                  <div className="text-sm text-gray-600">Records Updated</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">{results.markedInspected}</div>
                  <div className="text-sm text-gray-600">Marked Inspected</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-indigo-600">{results.colorCodedRows}</div>
                  <div className="text-sm text-gray-600">Color Coded Rows</div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-2 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">{results.cleanedPreStart}</div>
                  <div className="text-sm text-gray-600">Pre-Start Cleaned</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{results.cleanedOrphaned}</div>
                  <div className="text-sm text-gray-600">Orphaned Cleaned</div>
                </div>
              </div>
              
              {(results.validationErrors > 0 || results.duplicatesFound > 0 || results.invalidInitials > 0 || results.missingDates > 0) && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 p-3 bg-yellow-50 rounded">
                  <div className="text-center">
                    <div className="text-xl font-bold text-yellow-600">{results.validationErrors}</div>
                    <div className="text-xs text-gray-600">Format Errors</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-red-600">{results.duplicatesFound}</div>
                    <div className="text-xs text-gray-600">Duplicates Found</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-orange-600">{results.invalidInitials}</div>
                    <div className="text-xs text-gray-600">Invalid Initials</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-purple-600">{results.missingDates}</div>
                    <div className="text-xs text-gray-600">Missing Dates</div>
                  </div>
                </div>
              )}
              
              {results.warnings && results.warnings.length > 0 && (
                <div className="mb-4">
                  <details className="bg-yellow-50 border border-yellow-200 rounded p-3">
                    <summary className="cursor-pointer font-semibold text-yellow-800 mb-2">
                      ⚠️ Validation Warnings ({results.warnings.length})
                    </summary>
                    <div className="max-h-40 overflow-y-auto">
                      {results.warnings.slice(0, 20).map((warning, index) => (
                        <div key={index} className="text-sm text-yellow-700 mb-1">• {warning}</div>
                      ))}
                      {results.warnings.length > 20 && (
                        <div className="text-sm text-yellow-600 italic">...and {results.warnings.length - 20} more warnings</div>
                      )}
                    </div>
                  </details>
                </div>
              )}

              {/* Payroll Analytics */}
              {results.payrollAnalytics && (
                <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h3 className="text-lg font-semibold text-blue-800 mb-4">📊 Payroll Analytics</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="text-center p-3 bg-white rounded">
                      <div className="text-2xl font-bold text-green-600">${results.payrollAnalytics.totalPayroll.toFixed(2)}</div>
                      <div className="text-sm text-gray-600">Total Payroll</div>
                    </div>
                    <div className="text-center p-3 bg-white rounded">
                      <div className="text-2xl font-bold text-blue-600">{results.payrollAnalytics.eligibleProperties}</div>
                      <div className="text-sm text-gray-600">Eligible Properties</div>
                    </div>
                    <div className="text-center p-3 bg-white rounded">
                      <div className="text-2xl font-bold text-purple-600">{Object.keys(results.payrollAnalytics.inspectorStats).length}</div>
                      <div className="text-sm text-gray-600">Active Inspectors</div>
                    </div>
                  </div>

                  {/* Inspector Breakdown with Enhanced Reporting */}
                  <div className="space-y-3">
                    <h4 className="font-semibold text-blue-700">Inspector Performance This Period:</h4>
                    {Object.entries(results.payrollAnalytics.inspectorStats).map(([initials, stats]) => (
                      <div key={initials} className={`p-4 rounded-lg border-l-4 ${
                        stats.type === 'commercial' 
                          ? 'bg-blue-50 border-blue-500' 
                          : 'bg-green-50 border-green-500'
                      }`}>
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className={`font-bold text-lg ${
                                stats.type === 'commercial' ? 'text-blue-800' : 'text-green-800'
                              }`}>
                                {initials} - {stats.name}
                              </span>
                              <span className={`px-2 py-1 text-xs rounded font-medium ${
                                stats.type === 'commercial' 
                                  ? 'bg-blue-200 text-blue-800' 
                                  : 'bg-green-200 text-green-800'
                              }`}>
                                {stats.type}
                              </span>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                              <div>
                                <div className="text-gray-600">Inspection Breakdown:</div>
                                <div>Exterior: {stats.inspectionTypes.exterior}</div>
                                <div>Interior: {stats.inspectionTypes.interior}</div>
                                <div>Commercial: {stats.inspectionTypes.commercial}</div>
                              </div>
                              
                              <div>
                                <div className="text-gray-600">Property Details:</div>
                                <div>Total Properties: {stats.totalProperties}</div>
                                <div>Eligible (Class 2/3A): {stats.eligibleProperties}</div>
                                <div>Pay Rate: ${settings.payPerProperty.toFixed(2)}/property</div>
                              </div>
                              
                              <div>
                                <div className="text-gray-600">Recent Work Since {settings.lastUpdateDate}:</div>
                                <div className="text-xs space-y-1 max-h-20 overflow-y-auto">
                                  {stats.recentWork.slice(0, 5).map((work, idx) => (
                                    <div key={idx} className={work.eligible ? 'text-green-700' : 'text-gray-600'}>
                                      Block {work.block}, Lot {work.lot} - {work.inspectionType}
                                      {work.eligible && ' ✓ Eligible'}
                                    </div>
                                  ))}
                                  {stats.recentWork.length > 5 && (
                                    <div className="text-gray-500 italic">...and {stats.recentWork.length - 5} more</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          <div className="text-right ml-4">
                            <div className={`text-2xl font-bold ${
                              stats.type === 'commercial' ? 'text-blue-600' : 'text-green-600'
                            }`}>
                              ${stats.payrollAmount.toFixed(2)}
                            </div>
                            <div className="text-sm text-gray-600">Field Pay This Period</div>
                            {stats.payrollAmount > 0 && (
                              <div className="text-xs text-gray-500 mt-1">
                                ({stats.eligibleProperties} × ${settings.payPerProperty.toFixed(2)})
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    {Object.keys(results.payrollAnalytics.inspectorStats).length === 0 && (
                      <div className="text-center text-gray-500 py-4">
                        No inspector activity found for this period
                      </div>
                    )}
                  </div>
                </div>
              )}

              {results.downloadUrl && (
                <div className="text-center">
                  <a
                    href={results.downloadUrl}
                    download={results.fileName}
                    className="inline-flex items-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    Download Updated Excel File
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Instructions */}
          <div className="mt-8 p-4 bg-blue-50 rounded-lg">
            <h3 className="text-lg font-semibold mb-2 text-blue-800">📋 How it works:</h3>
            <ol className="list-decimal list-inside space-y-1 text-sm text-blue-700">
              <li>Enter a unique job name to track this project</li>
              <li>Upload your CSV file (e.g., "2026.1526.REVAL PRODUCTION.csv")</li>
              <li>Upload your Excel file (e.g., "1525Production.xlsx")</li>
              <li>Configure validation and cleaning settings</li>
              <li>Set "Last Payroll Update" date for bimonthly/monthly reporting</li>
              <li>Click "Update Production Data" to process</li>
              <li>The tool will match BLOCK/LOT combinations and update columns Q and T-AM</li>
              <li>Enhanced data validation and cleaning rules will be applied:
                <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                  <li>Remove dates before project start date</li>
                  <li>Validate initials format (2-3 uppercase letters)</li>
                  <li>Ensure dates exist when initials are present</li>
                  <li>Flag duplicate Block/Lot combinations</li>
                  <li>Validate Block/Lot number formats</li>
                </ul>
              </li>
              <li>Apply Excel "Slipstream" color coding for inspected properties</li>
              <li>Review comprehensive job metrics and completion analytics</li>
              <li>View projected completion dates based on inspector productivity</li>
              <li>Download the updated Excel file with all formatting applied</li>
            </ol>
            
            <div className="mt-4 p-3 bg-white rounded border border-blue-200">
              <h4 className="font-semibold text-blue-800 mb-2">🎨 Color Coding System:</h4>
              <div className="text-sm text-blue-700 space-y-1">
                <div className="flex items-center">
                  <div className="w-4 h-4 bg-blue-200 border border-blue-300 rounded mr-2"></div>
                  <span><strong>🏭 Commercial Inspectors:</strong> Excel "Slipstream" blue scheme</span>
                </div>
                <div className="flex items-center">
                  <div className="w-4 h-4 bg-green-200 border border-green-300 rounded mr-2"></div>
                  <span><strong>🏠 Residential Inspectors:</strong> Excel "Slipstream" green scheme</span>
                </div>
                <div className="flex items-center">
                  <div className="w-4 h-4 bg-white border border-gray-300 rounded mr-2"></div>
                  <span><strong>Uninspected Properties:</strong> No highlighting</span>
                </div>
              </div>
            </div>
            
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
              <h4 className="font-semibold text-yellow-800 mb-2">💰 Payroll Calculation:</h4>
              <div className="text-sm text-yellow-700">
                <strong>$2.00 per property bonus</strong> for Class 2 & 3A properties only, calculated from work completed since the "Last Payroll Update" date. Perfect for bimonthly and monthly payroll processing.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metrics Tab */}
      {activeTab === 'metrics' && jobMetrics && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-blue-50 to-green-50 p-6 rounded-lg border-2 border-blue-200">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">📊 Job Performance Analytics</h2>
            
            {/* Overall Completion */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="bg-white p-6 rounded-lg shadow-md border-l-4 border-blue-500">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">🏠 Overall Completion</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total Properties:</span>
                    <span className="font-bold">{jobMetrics.overallCompletion.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Inspected:</span>
                    <span className="font-bold text-green-600">{jobMetrics.overallCompletion.inspected.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Remaining:</span>
                    <span className="font-bold text-orange-600">{jobMetrics.projectedCompletion.remainingProperties.toLocaleString()}</span>
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Progress</span>
                      <span className="text-sm font-medium">{jobMetrics.overallCompletion.percentage.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className="bg-blue-500 h-3 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, jobMetrics.overallCompletion.percentage)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow-md border-l-4 border-green-500">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">🏡 Interior Inspections</h3>
                <p className="text-sm text-gray-600 mb-3">Class 2 & 3A Properties</p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Eligible Properties:</span>
                    <span className="font-bold">{jobMetrics.interiorInspections.class2_3A.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Listed:</span>
                    <span className="font-bold text-green-600">{jobMetrics.interiorInspections.class2_3A.listed.toLocaleString()}</span>
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Entry Rate</span>
                      <span className="text-sm font-medium">{jobMetrics.interiorInspections.class2_3A.percentage.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className="bg-green-500 h-3 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, jobMetrics.interiorInspections.class2_3A.percentage)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow-md border-l-4 border-purple-500">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">🏢 Pricing Inspections</h3>
                <p className="text-sm text-gray-600 mb-3">Class 4A, 4B & 4C Properties</p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Eligible Properties:</span>
                    <span className="font-bold">{jobMetrics.pricingInspections.class4ABC.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Priced:</span>
                    <span className="font-bold text-purple-600">{jobMetrics.pricingInspections.class4ABC.priced.toLocaleString()}</span>
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Pricing Rate</span>
                      <span className="text-sm font-medium">{jobMetrics.pricingInspections.class4ABC.percentage.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className="bg-purple-500 h-3 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, jobMetrics.pricingInspections.class4ABC.percentage)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Projected Completion */}
            {jobMetrics.projectedCompletion.estimatedFinishDate && (
              <div className="bg-white p-6 rounded-lg shadow-md border-l-4 border-indigo-500 mb-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">📅 Projected Completion</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-indigo-600">
                      {jobMetrics.projectedCompletion.businessDaysToComplete}
                    </div>
                    <div className="text-sm text-gray-600">Business Days Remaining</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {jobMetrics.projectedCompletion.estimatedFinishDate.toLocaleDateString()}
                    </div>
                    <div className="text-sm text-gray-600">Estimated Finish Date</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {Object.keys(jobMetrics.inspectorActivity).length}
                    </div>
                    <div className="text-sm text-gray-600">Active Inspectors</div>
                  </div>
                </div>
              </div>
            )}

            {/* Inspector Performance */}
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">👥 Inspector Performance</h3>
              <div className="space-y-4">
                {Object.entries(jobMetrics.inspectorActivity).map(([initials, inspector]) => (
                  <div key={initials} className={`p-4 rounded-lg border-l-4 ${
                    inspector.type === 'commercial' 
                      ? 'bg-blue-50 border-blue-500' 
                      : 'bg-green-50 border-green-500'
                  }`}>
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`font-bold text-lg ${
                            inspector.type === 'commercial' ? 'text-blue-800' : 'text-green-800'
                          }`}>
                            {initials} - {inspector.name}
                          </span>
                          <span className={`px-2 py-1 text-xs rounded font-medium ${
                            inspector.type === 'commercial' 
                              ? 'bg-blue-200 text-blue-800' 
                              : 'bg-green-200 text-green-800'
                          }`}>
                            {inspector.type === 'commercial' ? '🏭 commercial' : '🏠 residential'}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          <div>
                            <div className="text-gray-600">Recent Work:</div>
                            <div className="font-semibold">{inspector.recentWork} properties</div>
                          </div>
                          
                          <div>
                            <div className="text-gray-600">Daily Average:</div>
                            <div className="font-semibold">{inspector.dailyAverage.toFixed(1)} properties/day</div>
                          </div>
                          
                          <div>
                            <div className="text-gray-600">Last Work Date:</div>
                            <div className="font-semibold">
                              {inspector.lastWorkDate ? inspector.lastWorkDate.toLocaleDateString() : 'N/A'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                
                {Object.keys(jobMetrics.inspectorActivity).length === 0 && (
                  <div className="text-center text-gray-500 py-4">
                    No inspector activity found for this job
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Jobs Tab */}
      {activeTab === 'jobs' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-6 rounded-lg border-2 border-purple-200">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">📋 All Jobs Overview</h2>
            
            {Object.keys(jobs).length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                <p className="text-lg">No jobs processed yet.</p>
                <p>Upload and process your first job to see it here!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(jobs).map(([jobName, jobData]) => (
                  <div key={jobName} className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-800">{jobName}</h3>
                        <p className="text-sm text-gray-600">
                          Processed: {new Date(jobData.date).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setJobMetrics(jobData.metrics);
                            setActiveTab('metrics');
                          }}
                          className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                        >
                          View Metrics
                        </button>
                        <button
                          onClick={() => {
                            setCurrentJobName(jobName);
                            setActiveTab('upload');
                          }}
                          className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
                        >
                          Reload Job
                        </button>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="text-center p-3 bg-blue-50 rounded">
                        <div className="text-xl font-bold text-blue-600">
                          {jobData.metrics.overallCompletion.percentage.toFixed(1)}%
                        </div>
                        <div className="text-xs text-gray-600">Overall Complete</div>
                      </div>
                      
                      <div className="text-center p-3 bg-green-50 rounded">
                        <div className="text-xl font-bold text-green-600">
                          {jobData.metrics.interiorInspections.class2_3A.percentage.toFixed(1)}%
                        </div>
                        <div className="text-xs text-gray-600">Interior Entry Rate</div>
                      </div>
                      
                      <div className="text-center p-3 bg-purple-50 rounded">
                        <div className="text-xl font-bold text-purple-600">
                          {jobData.metrics.pricingInspections.class4ABC.percentage.toFixed(1)}%
                        </div>
                        <div className="text-xs text-gray-600">Pricing Rate</div>
                      </div>
                      
                      <div className="text-center p-3 bg-orange-50 rounded">
                        <div className="text-xl font-bold text-orange-600">
                          {jobData.metrics.projectedCompletion.businessDaysToComplete || 'N/A'}
                        </div>
                        <div className="text-xs text-gray-600">Days to Complete</div>
                      </div>
                    </div>
                    
                    <div className="mt-4 pt-3 border-t border-gray-200">
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>Total Properties: {jobData.metrics.overallCompletion.total.toLocaleString()}</span>
                        <span>Active Inspectors: {Object.keys(jobData.metrics.inspectorActivity).length}</span>
                        {jobData.metrics.projectedCompletion.estimatedFinishDate && (
                          <span>Est. Finish: {jobData.metrics.projectedCompletion.estimatedFinishDate.toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PayrollProductionUpdater;
