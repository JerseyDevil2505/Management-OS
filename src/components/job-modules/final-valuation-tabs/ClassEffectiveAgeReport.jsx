import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Settings, ChevronDown, ChevronUp, AlertCircle, Save } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';
import { calculateRecommendedEFA, resolveActualEFA } from '../../../lib/effectiveAge';
import { buildYearBuiltCategories, categorizeYearBuilt } from '../../../lib/yearBuiltCategories';

const EMPTY = '\u2014';

const DEFAULT_CONDO_COLUMNS = [
  { label: 'Flats', match: 'flat' },
  { label: 'Twins', match: 'twin' },
  { label: 'Row Int', match: 'row int|interior' },
  { label: 'Row End', match: 'row end|end unit' },
  { label: 'Studios', match: 'studio|efficiency' },
  { label: 'One/Two/Three Bedroom', match: 'bedroom|bdrm|\\bbr\\b' }
];

const defaultConfig = (assessmentYear) => ({
  samplingWindowStart: `${assessmentYear - 3}-10-01`,
  tabs: {
    class2: { typeUseCodes: ['10'], label: 'Class 2' },
    multiFamily: {
      typeUseCodes: ['42', '43'],
      label: 'Multi-Family',
      typeUseLabels: { 42: 'Two Family', 43: 'Three Family' }
    },
    condo: { typeUseCodes: ['60'], label: 'Condo' }
  },
  condoColumns: DEFAULT_CONDO_COLUMNS,
  designLabels: {}
});

const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);

const ClassEffectiveAgeReport = ({
  jobData,
  properties,
  finalValuationData,
  vendorType,
  assessmentYear,
  yearPriorToDueYear,
  onReloadFinalValuationData
}) => {
  const [activeTab, setActiveTab] = useState('class2');
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState(() => defaultConfig(assessmentYear));
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingEFA, setSavingEFA] = useState(false);
  const [hideEmptyCategories, setHideEmptyCategories] = useState(true);
  const [includeClass10, setIncludeClass10] = useState(false);

  useEffect(() => {
    const stored = jobData?.class_efa_report_config;
    setConfig(stored && typeof stored === 'object'
      ? { ...defaultConfig(assessmentYear), ...stored }
      : defaultConfig(assessmentYear));
  }, [jobData?.class_efa_report_config, assessmentYear]);

  const codeDefinitions = jobData?.parsed_code_definitions;

  const designLabel = useCallback((code) => {
    if (!code) return 'No Design';
    if (config.designLabels?.[code]) return config.designLabels[code];
    const name = codeDefinitions
      ? interpretCodes.getDesignName({ asset_design_style: code }, codeDefinitions, vendorType)
      : null;
    return name && name !== code ? `${code} - ${name}` : code;
  }, [config.designLabels, codeDefinitions, vendorType]);

  const rawDesignName = useCallback((code) => {
    if (!code || !codeDefinitions) return '';
    return interpretCodes.getDesignName({ asset_design_style: code }, codeDefinitions, vendorType) || '';
  }, [codeDefinitions, vendorType]);

  // Base the rolling bands on the job's assessment year, not the wall clock, so
  // they only move when a new reval cycle is set up.
  const categories = useMemo(() => buildYearBuiltCategories(assessmentYear), [assessmentYear]);

  const windowStart = useMemo(() => {
    const raw = config.samplingWindowStart;
    if (!raw) return null;
    const d = new Date(`${String(raw).split('T')[0]}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [config.samplingWindowStart]);

  // Stored recommended EFA only. This report never recalculates on open.
  const storedRecEFA = useCallback((property) => {
    const row = finalValuationData?.[property.property_composite_key];
    const value = row?.recommended_efa;
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }, [finalValuationData]);

  const hasMarketDataRun = useMemo(
    () => Object.values(finalValuationData || {}).some(
      row => row?.recommended_efa !== null && row?.recommended_efa !== undefined
    ),
    [finalValuationData]
  );

  const lastRunAt = useMemo(() => {
    let latest = null;
    Object.values(finalValuationData || {}).forEach(row => {
      if (!row?.recommended_efa_calculated_at) return;
      if (!latest || row.recommended_efa_calculated_at > latest) latest = row.recommended_efa_calculated_at;
    });
    return latest;
  }, [finalValuationData]);

  const bandFor = useCallback(
    (yearBuilt) => categorizeYearBuilt(yearBuilt, categories),
    [categories]
  );

  const inWindow = useCallback((property) => {
    if (!windowStart || !property.sales_date) return false;
    const d = new Date(`${String(property.sales_date).split('T')[0]}T12:00:00`);
    return !Number.isNaN(d.getTime()) && d >= windowStart;
  }, [windowStart]);

  // One pass per tab: bucket parcels into row/column groups and accumulate the
  // four cell slots. Reads only in-memory properties + stored EFA values.
  const buildGrid = useCallback((tabKey) => {
    const tabCfg = config.tabs?.[tabKey] || {};
    const codes = (tabCfg.typeUseCodes || []).map(c => String(c).trim()).filter(Boolean);
    const useBands = tabKey !== 'condo';

    const matches = properties.filter(p => {
      const tu = String(p.asset_type_use || '').trim();
      if (!tu || !codes.includes(tu)) return false;

      // Building class 10 and below carries no structure, so it never produces an
      // EFA and only widens the class min/max that flags real breaks.
      if (!includeClass10) {
        const bldgClass = parseInt(p.asset_building_class, 10);
        if (Number.isFinite(bldgClass) && bldgClass <= 10) return false;
      }
      return true;
    });

    const columnFor = (p) => {
      if (tabKey === 'multiFamily') {
        const tu = String(p.asset_type_use || '').trim();
        return { key: tu, label: tabCfg.typeUseLabels?.[tu] || tu };
      }
      if (tabKey === 'condo') {
        const name = rawDesignName(p.asset_design_style).toLowerCase();
        const group = (config.condoColumns || []).find(col => {
          if (!col.match) return false;
          try {
            return new RegExp(col.match, 'i').test(name);
          } catch {
            return false;
          }
        });
        return group
          ? { key: group.label, label: group.label }
          : { key: '__other__', label: 'Other' };
      }
      const code = String(p.asset_design_style || '').trim() || '__none__';
      return { key: code, label: designLabel(code === '__none__' ? '' : code) };
    };

    const cells = new Map();
    const rowCounts = new Map();
    const vcsSet = new Set();
    const colKeys = new Map();

    matches.forEach(p => {
      const vcs = p.property_vcs || 'Unknown';
      const band = useBands ? bandFor(p.asset_year_built) : null;
      if (useBands && !band) return;

      vcsSet.add(vcs);
      const rowKey = useBands ? `${vcs}||${band.key}` : vcs;
      rowCounts.set(rowKey, (rowCounts.get(rowKey) || 0) + 1);

      const col = columnFor(p);
      if (!colKeys.has(col.key)) colKeys.set(col.key, col.label);

      const cellKey = `${rowKey}##${col.key}`;
      if (!cells.has(cellKey)) {
        cells.set(cellKey, { classes: new Set(), recAll: [], recWindow: [], actual: [], count: 0 });
      }
      const cell = cells.get(cellKey);
      cell.count += 1;

      const bldgClass = String(p.asset_building_class || '').trim();
      if (bldgClass) cell.classes.add(bldgClass);

      const rec = storedRecEFA(p);
      if (rec !== null) {
        cell.recAll.push(rec);
        if (inWindow(p)) cell.recWindow.push(rec);
      }

      const actual = resolveActualEFA(
        p,
        finalValuationData?.[p.property_composite_key],
        vendorType,
        yearPriorToDueYear
      );
      if (actual !== null && actual !== undefined && Number.isFinite(Number(actual))) {
        cell.actual.push(Number(actual));
      }
    });

    // Every VCS carries the full category ladder so a missing band reads as a
    // gap in the stock rather than a missing row.
    const rows = [];
    [...vcsSet].sort((a, b) => a.localeCompare(b)).forEach(vcs => {
      if (!useBands) {
        rows.push({ key: vcs, vcs, band: null, count: rowCounts.get(vcs) || 0 });
        return;
      }
      categories.forEach(cat => {
        const key = `${vcs}||${cat.key}`;
        const count = rowCounts.get(key) || 0;
        if (hideEmptyCategories && count === 0) return;
        rows.push({ key, vcs, band: cat.label, count });
      });
    });

    const sortedCols = [...colKeys.entries()].sort((a, b) => {
      if (tabKey === 'condo') {
        const order = (config.condoColumns || []).map(c => c.label);
        const ai = order.indexOf(a[0]);
        const bi = order.indexOf(b[0]);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      }
      return String(a[0]).localeCompare(String(b[0]));
    });

    return {
      useBands,
      rows,
      columns: sortedCols.map(([key, label]) => ({ key, label })),
      cells
    };
  }, [config, properties, categories, hideEmptyCategories, includeClass10, bandFor, inWindow, storedRecEFA, designLabel, rawDesignName, finalValuationData, vendorType, yearPriorToDueYear]);

  const formatCell = useCallback((cell) => {
    if (!cell || cell.count === 0) return EMPTY;

    const classes = [...cell.classes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const classSlot = classes.length === 0
      ? EMPTY
      : classes.length === 1
        ? classes[0]
        : `${classes[0]}/${classes[classes.length - 1]}`;

    const slots = [
      classSlot,
      avg(cell.recAll) ?? EMPTY,
      avg(cell.recWindow) ?? EMPTY,
      avg(cell.actual) ?? EMPTY
    ];
    return slots.join('/');
  }, []);

  const grids = useMemo(() => ({
    class2: buildGrid('class2'),
    multiFamily: buildGrid('multiFamily'),
    condo: buildGrid('condo')
  }), [buildGrid]);

  const grid = grids[activeTab];
  const mixedClassCells = useMemo(() => {
    let n = 0;
    grid.cells.forEach(c => { if (c.classes.size > 1) n += 1; });
    return n;
  }, [grid]);

  // Persist Recommended EFA so this report reads stored values instead of
  // recalculating on open.
  const saveRecommendedEFA = async () => {
    try {
      setSavingEFA(true);
      const calculatedAt = new Date().toISOString();
      const rows = [];

      properties.forEach(property => {
        const rec = calculateRecommendedEFA(property, vendorType, yearPriorToDueYear);
        if (rec === null || rec === undefined) return;
        rows.push({
          job_id: jobData.id,
          property_composite_key: property.property_composite_key,
          recommended_efa: rec,
          recommended_efa_calculated_at: calculatedAt,
          updated_at: calculatedAt
        });
      });

      if (rows.length === 0) {
        alert('No normalized sales, so there is no Recommended EFA to store.');
        return;
      }

      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabase
          .from('final_valuation_data')
          .upsert(rows.slice(i, i + CHUNK), { onConflict: 'job_id,property_composite_key' });
        if (error) throw error;
      }

      if (onReloadFinalValuationData) await onReloadFinalValuationData();
      alert(`Stored Recommended EFA for ${rows.length.toLocaleString()} sales.`);
    } catch (error) {
      alert('Error storing Recommended EFA: ' + error.message);
    } finally {
      setSavingEFA(false);
    }
  };

  const saveConfig = async () => {
    try {
      setSavingConfig(true);
      const { error } = await supabase
        .from('jobs')
        .update({ class_efa_report_config: config })
        .eq('id', jobData.id);
      if (error) throw error;
      setShowSettings(false);
    } catch (error) {
      alert('Error saving report settings: ' + error.message);
    } finally {
      setSavingConfig(false);
    }
  };

  const gridToRows = (key, gridData) => {
    const header = [
      ...(gridData.useBands ? ['VCS', 'Year Built'] : ['VCS']),
      ...gridData.columns.map(c => c.label),
      'Parcels'
    ];
    const body = gridData.rows.map(row => {
      let count = 0;
      const cellValues = gridData.columns.map(col => {
        const cell = gridData.cells.get(`${row.key}##${col.key}`);
        if (cell) count += cell.count;
        return formatCell(cell);
      });
      return [
        ...(gridData.useBands ? [row.vcs, row.band] : [row.vcs]),
        ...cellValues,
        count
      ];
    });
    return [header, ...body];
  };

  const exportToExcel = () => {
    const workbook = XLSX.utils.book_new();
    const sheets = [
      ['Class 2', grids.class2],
      ['Multi-Family', grids.multiFamily],
      ['Condo', grids.condo]
    ];

    sheets.forEach(([name, gridData]) => {
      const rows = gridData.rows.length
        ? gridToRows(name, gridData)
        : [['No parcels match this tab\u2019s type/use codes']];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = Array(rows[0].length).fill({ wch: 20 });
      XLSX.utils.book_append_sheet(workbook, ws, name);
    });

    XLSX.writeFile(
      workbook,
      `Class_Effective_Age_${jobData.job_name}_${new Date().toISOString().split('T')[0]}.xlsx`
    );
  };

  const tabButton = (key, label) => (
    <button
      key={key}
      onClick={() => setActiveTab(key)}
      className={`px-4 py-2 text-sm font-semibold rounded-t-lg border border-b-0 ${
        activeTab === key
          ? 'bg-white text-indigo-700 border-gray-300'
          : 'bg-gray-100 text-gray-600 border-transparent hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="bg-white border border-gray-300 rounded-lg p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Class / Effective Age Analysis</h3>
          <p className="text-sm text-gray-600 mt-1">
            Cell format: building class / avg rec EFA (all sales) / avg rec EFA (sampling window) / avg actual EFA
            {lastRunAt && (
              <span className="ml-2 text-gray-500">
                &middot; Rec EFA stored {new Date(lastRunAt).toLocaleString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab !== 'condo' && (
            <label className="flex items-center gap-2 text-sm text-gray-700 mr-1">
              <input
                type="checkbox"
                checked={hideEmptyCategories}
                onChange={(e) => setHideEmptyCategories(e.target.checked)}
              />
              Hide empty categories
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-700 mr-1">
            <input
              type="checkbox"
              checked={includeClass10}
              onChange={(e) => setIncludeClass10(e.target.checked)}
            />
            Include class 10
          </label>
          <button
            onClick={saveRecommendedEFA}
            disabled={savingEFA}
            title="Compute and store Recommended EFA for every normalized sale"
            className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {savingEFA ? 'Storing...' : 'Save Effective Age Results'}
          </button>
          <button
            onClick={() => setShowSettings(v => !v)}
            className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
          >
            <Settings className="w-4 h-4" />
            Settings
            {showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={exportToExcel}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {!hasMarketDataRun && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4">
          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
          <div className="text-sm text-amber-900">
            Market Data has not been run for this job, so no recommended effective ages are stored.
            Building class and actual EFA are shown; both rec EFA slots read {EMPTY}. Use
            <strong> Save Effective Age Results</strong> to populate them.
          </div>
        </div>
      )}

      {showSettings && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Year Built categories
              </label>
              <div className="px-3 py-2 border border-gray-200 bg-white rounded text-sm text-gray-700">
                {categories.map(c => c.label).join(' \u00b7 ')}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Global categories based on assessment year {assessmentYear}. New and Newer roll with
                the reval cycle; Moderate always ends the year before Newer opens.
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Sampling window start
              </label>
              <input
                type="date"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                value={config.samplingWindowStart || ''}
                onChange={(e) => setConfig(c => ({ ...c, samplingWindowStart: e.target.value }))}
              />
              <div className="text-xs text-gray-500 mt-1">
                Default 10/1 three years back (HSP open) for assessment year {assessmentYear}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {[
              ['class2', 'Class 2 type/use codes'],
              ['multiFamily', 'Multi-Family type/use codes'],
              ['condo', 'Condo type/use codes']
            ].map(([key, label]) => (
              <div key={key}>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                  value={(config.tabs?.[key]?.typeUseCodes || []).join(', ')}
                  onChange={(e) => setConfig(c => ({
                    ...c,
                    tabs: {
                      ...c.tabs,
                      [key]: {
                        ...c.tabs?.[key],
                        typeUseCodes: e.target.value.split(',').map(v => v.trim()).filter(Boolean)
                      }
                    }
                  }))}
                />
              </div>
            ))}
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-600 mb-2">
              Condo columns (label and design-name match pattern)
            </div>
            <div className="space-y-2">
              {(config.condoColumns || []).map((col, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    type="text"
                    className="w-1/3 px-3 py-2 border border-gray-300 rounded text-sm"
                    value={col.label}
                    onChange={(e) => setConfig(c => {
                      const next = [...c.condoColumns];
                      next[idx] = { ...next[idx], label: e.target.value };
                      return { ...c, condoColumns: next };
                    })}
                  />
                  <input
                    type="text"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm font-mono"
                    value={col.match}
                    onChange={(e) => setConfig(c => {
                      const next = [...c.condoColumns];
                      next[idx] = { ...next[idx], match: e.target.value };
                      return { ...c, condoColumns: next };
                    })}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={saveConfig}
              disabled={savingConfig}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {savingConfig ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-300">
        {tabButton('class2', config.tabs?.class2?.label || 'Class 2')}
        {tabButton('multiFamily', config.tabs?.multiFamily?.label || 'Multi-Family')}
        {tabButton('condo', config.tabs?.condo?.label || 'Condo')}
      </div>

      {mixedClassCells > 0 && (
        <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-3 py-2 mt-3">
          {mixedClassCells} group{mixedClassCells === 1 ? '' : 's'} span more than one building class (shown as min/max).
        </div>
      )}

      <div className="overflow-x-auto mt-3">
        {grid.rows.length === 0 ? (
          <div className="text-sm text-gray-500 py-8 text-center">
            No parcels match the type/use codes configured for this tab.
          </div>
        ) : (
          <table className="text-xs border-collapse w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold border border-gray-300 sticky left-0 bg-gray-50">VCS</th>
                {grid.useBands && (
                  <th className="px-3 py-2 text-left font-semibold border border-gray-300">Year Built</th>
                )}
                {grid.columns.map(col => (
                  <th key={col.key} className="px-3 py-2 text-center font-semibold border border-gray-300">
                    {col.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-semibold border border-gray-300 bg-gray-100">Parcels</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map(row => {
                let count = 0;
                const cellNodes = grid.columns.map(col => {
                  const cell = grid.cells.get(`${row.key}##${col.key}`);
                  if (cell) count += cell.count;
                  return (
                    <td
                      key={col.key}
                      className={`px-3 py-2 text-center border border-gray-300 ${
                        cell?.classes.size > 1 ? 'bg-orange-50 font-semibold' : ''
                      }`}
                    >
                      {formatCell(cell)}
                    </td>
                  );
                });
                return (
                  <tr key={row.key} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium border border-gray-300 sticky left-0 bg-white">{row.vcs}</td>
                    {grid.useBands && (
                      <td className="px-3 py-2 border border-gray-300">{row.band}</td>
                    )}
                    {cellNodes}
                    <td className="px-3 py-2 text-center font-semibold border border-gray-300 bg-gray-50">{count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default ClassEffectiveAgeReport;
