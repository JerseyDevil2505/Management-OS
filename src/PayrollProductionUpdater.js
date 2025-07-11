// 🚀 PayrollProductionUpdater.js — Phase 3: Bonus Calculation + Report Output
import React, { useState, useRef } from 'react';
import { Upload, Settings, Users, FileCheck2, FileWarning } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

const PayrollProductionUpdater = () => {
  const [csvFile, setCsvFile] = useState(null);
  const [excelFile, setExcelFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [currentJobName, setCurrentJobName] = useState('');
  const [activeTab, setActiveTab] = useState('upload');

  const [inspectorRoster, setInspectorRoster] = useState({});
  const [settings, setSettings] = useState({
    startDate: '2025-04-01',
    payPerProperty: 2.00,
    eligibleClasses: ['2', '3A'],
    lastPayrollDate: '2025-06-26',
    infoByCodes: {
      entry: ['01', '02', '03', '04'],
      refusal: ['06'],
      estimation: ['07'],
      error: ['00', '05']
    },
    inspectorRolesToInclude: ['residential', 'commercial', 'project manager']
  });

  const [parsedData, setParsedData] = useState([]);
  const [errorRows, setErrorRows] = useState([]);
  const [payrollReport, setPayrollReport] = useState([]);

  const csvInputRef = useRef();
  const excelInputRef = useRef();

  const handleFileUpload = (file, type) => {
    if (type === 'csv') setCsvFile(file);
    if (type === 'excel') setExcelFile(file);
  };

  const loadInspectorRoster = async () => {
    if (!excelFile) return;
    const data = await excelFile.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet);
    const roster = {};

    json.forEach(row => {
      const initials = row['Initials']?.trim();
      const name = row['Name']?.trim();
      const role = row['Role']?.toLowerCase();
      if (initials && name && settings.inspectorRolesToInclude.includes(role)) {
        roster[initials] = { name, role };
      }
    });

    setInspectorRoster(roster);
  };

  const isValidDate = (d) => {
    return d && !isNaN(new Date(d)) && new Date(d) >= new Date(settings.startDate);
  };

  const isValidInitials = (i) => i && inspectorRoster[i];

  const scrubAndValidate = (data) => {
    const cleaned = [];
    const errors = [];

    data.forEach((row, index) => {
      const rowCopy = { ...row };
      const measuredDate = row['Measured Date'];
      const measuredBy = row['Measured By'];
      const infoBy = row['InfoBY'];
      const listedBy = row['Listed By'];
      const listedDate = row['Listed Date'];
      const taxableValue = parseFloat(row['VALUES_IMPROVTAXABLEVALUE'] || '0');
      const propClass = (row['Property Class'] || '').trim();

      // Scrub: Remove pre-start or unpaired values
      if (!isValidDate(measuredDate) || !isValidInitials(measuredBy)) {
        rowCopy['Measured By'] = '';
        rowCopy['Measured Date'] = '';
        if (['00', '05'].includes(infoBy)) rowCopy['InfoBY'] = ''; // Scrub infoBy too
      }
      if (!isValidDate(listedDate) || !isValidInitials(listedBy)) {
        rowCopy['Listed By'] = '';
        rowCopy['Listed Date'] = '';
      }

      // Error 1: Invalid InfoBY code
      if (['00', '05'].includes(infoBy) && isValidInitials(measuredBy) && isValidDate(measuredDate)) {
        errors.push({ index, error: 'Invalid Info By Code – Please Review' });
      }

      // Error 2: Listed but no Measured
      if (isValidInitials(listedBy) && isValidDate(listedDate) && (!isValidInitials(measuredBy) || !isValidDate(measuredDate))) {
        errors.push({ index, error: 'Missing Measured By and Date' });
      }

      // Error 3: InfoBY is entry/refusal but Listed missing
      if ([...settings.infoByCodes.entry, ...settings.infoByCodes.refusal].includes(infoBy) && (!isValidInitials(listedBy) || !isValidDate(listedDate))) {
        errors.push({ index, error: 'Please Review InfoBy Code and Listed By/Date' });
      }

      // Error 4: InfoBY is estimation but Listed is filled
      if (settings.infoByCodes.estimation.includes(infoBy) && isValidInitials(listedBy) && isValidDate(listedDate)) {
        errors.push({ index, error: 'Please Review InfoBy Code and Listed By/Date' });
      }

      // Error 5: Taxable = 0 and InfoBY not 01 and no Listed
      if (taxableValue === 0 && infoBy !== '01' && (!isValidInitials(listedBy) || !isValidDate(listedDate))) {
        errors.push({ index, error: 'Please Update InfoBy Code and Listed By and Listed Date' });
      }

      cleaned.push(rowCopy);
    });

    return { cleaned, errors };
  };

  const calculateBonuses = (data) => {
    const bonuses = {};
    data.forEach((row) => {
      const inspector = row['Measured By'];
      const date = row['Measured Date'];
      const propClass = (row['Property Class'] || '').trim();

      if (isValidInitials(inspector) && isValidDate(date) && settings.eligibleClasses.includes(propClass)) {
        if (!bonuses[inspector]) bonuses[inspector] = 0;
        bonuses[inspector] += settings.payPerProperty;
      }
    });
    return bonuses;
  };

  const handleStartProcessing = () => {
    if (!csvFile || !excelFile) return;
    setProcessing(true);

    Papa.parse(csvFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const { cleaned, errors } = scrubAndValidate(results.data);
        setParsedData(cleaned);
        setErrorRows(errors);

        const bonuses = calculateBonuses(cleaned);
        const report = Object.entries(bonuses).map(([initials, amount]) => ({
          initials,
          name: inspectorRoster[initials]?.name || 'Unknown',
          amount
        }));

        setPayrollReport(report);

        console.log('Scrubbed ✅', cleaned);
        console.log('Errors ⚠️', errors);
        console.log('Payroll 💰', report);

        // 💾 Auto-generate XLSX report
        const workbook = XLSX.utils.book_new();
        const sheet = XLSX.utils.json_to_sheet(report);
        XLSX.utils.book_append_sheet(workbook, sheet, 'Payroll Report');
        XLSX.writeFile(workbook, 'Payroll_Report.xlsx');
      }
    });
  };

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold mb-4">📋 Payroll Production Updater</h1>

      <div className="flex gap-4 mb-4">
        <button onClick={() => setActiveTab('upload')}><Upload className="inline mr-1" /> Upload</button>
        <button onClick={() => setActiveTab('inspectors')}><Users className="inline mr-1" /> Inspectors</button>
        <button onClick={() => setActiveTab('settings')}><Settings className="inline mr-1" /> Settings</button>
        <button onClick={handleStartProcessing}><FileCheck2 className="inline mr-1" /> Process</button>
      </div>

      {activeTab === 'upload' && (
        <div className="space-y-4">
          <div>
            <label className="block font-semibold">📎 Upload CSV Report</label>
            <input ref={csvInputRef} type="file" accept=".csv" onChange={(e) => handleFileUpload(e.target.files[0], 'csv')} />
          </div>
          <div>
            <label className="block font-semibold">📎 Upload Excel Inspector Roster</label>
            <input ref={excelInputRef} type="file" accept=".xlsx" onChange={(e) => handleFileUpload(e.target.files[0], 'excel')} />
            <button className="mt-2" onClick={loadInspectorRoster}>📥 Load Roster</button>
          </div>
        </div>
      )}

      {activeTab === 'inspectors' && (
        <div>
          <h2 className="text-lg font-bold mb-2">👷 Inspector Roster</h2>
          <ul className="list-disc pl-5">
            {Object.entries(inspectorRoster).map(([initials, { name, role }]) => (
              <li key={initials}>{initials} - {name} ({role})</li>
            ))}
          </ul>
        </div>
      )}

      {activeTab === 'settings' && (
        <div>
          <h2 className="text-lg font-bold mb-2">⚙️ Settings</h2>
          <pre className="bg-gray-100 p-2 rounded text-sm">{JSON.stringify(settings, null, 2)}</pre>
        </div>
      )}

      {payrollReport.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-bold mb-2">💰 Payroll Summary</h2>
          <ul className="list-disc pl-5">
            {payrollReport.map(row => (
              <li key={row.initials}>{row.name} ({row.initials}): ${row.amount.toFixed(2)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default PayrollProductionUpdater;
