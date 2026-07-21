import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';
import * as XLSX from 'xlsx-js-style';
import { Download, Save, RefreshCw } from 'lucide-react';

const SETTING_KEY = 'vcs_analysis';

// VCS codes intentionally excluded from the Class 2 residential rationalization guide.
const EXCLUDED_VCS = new Set(['NOVC', 'FF01']);

const MERGE_OPTIONS = ['Yes', 'No', 'Review'];

// Merge? colors: Yes = consolidate (red), No = keep (green), Review = check (yellow).
// Inline hex is used everywhere (not Tailwind utility classes) because the v2 CDN
// build + native select styling make dynamic color classes unreliable.
const MERGE_COLORS = {
  Yes: { bg: '#FECACA', fg: '#991B1B' },
  No: { bg: '#BBF7D0', fg: '#166534' },
  Review: { bg: '#FEF9C3', fg: '#854D0E' },
};
const mergeColor = (v) => MERGE_COLORS[v] || MERGE_COLORS.Review;

const mergeFill = (v) =>
  v === 'Yes' ? 'FFC7CE' : v === 'No' ? 'C6EFCE' : 'FFEB9C';

// Commercial class colors: blue=4A, green=4B, yellow=4C.
const classFill = (cls) =>
  cls === '4A' ? 'BDD7EE' : cls === '4B' ? 'C6EFCE' : cls === '4C' ? 'FFEB9C' : 'FFFFFF';

// Canonical type/use labels from the Type/Use Mapper (STANDARD_TARGETS). Used as a
// fallback when the town's parsed code file doesn't define a code (e.g. 60/6 = Condo).
const STANDARD_TYPE_LABELS = {
  BRT: {
    '00': 'Vacant / Other', '10': 'Single Family', '20': 'Semi-Detached',
    '30': 'Row/Townhouse', '31': 'End Row', '42': 'MultiFamily Duplex',
    '43': 'MultiFamily Triplex', '44': 'MultiFamily Quad+',
    '51': 'Conversion 2-Fam', '52': 'Conversion 3-Fam', '53': 'Conversion 4-Fam',
    '60': 'Condo',
  },
  Microsystems: {
    '1': 'Single Family', '2': 'Semi-Detached', '3E': 'End Row',
    '3I': 'Row/Townhouse (Interior)', '42': 'MultiFamily Duplex',
    '43': 'MultiFamily Triplex', '44': 'MultiFamily Quad+', '6': 'Condo',
  },
};
const standardTypeLabel = (code, vt) =>
  (STANDARD_TYPE_LABELS[vt] || {})[(code || '').toString().trim()] || null;

// Detect a single-family type from the town's own decoded label (or common raw codes),
// so tier/outlier math doesn't depend on a hardcoded vendor code map.
const isSFType = (label, code) => {
  if ((label || '').toLowerCase().includes('single')) return true;
  const c = (code || '').toString().trim().toUpperCase();
  return c === '1' || c === '10';
};

const streetName = (loc) => {
  if (!loc) return '';
  let s = loc.toString().trim().toUpperCase();
  s = s.replace(/^\s*\d+[A-Z]?(-\d+)?\s+/, '');
  return s.trim();
};

const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);
const median = (nums) => {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const fmtMoney = (n) => (n ? `$${Math.round(n).toLocaleString()}` : '—');
const fmtNum = (n) => (n ? Math.round(n).toLocaleString() : '—');

const VcsAnalyzerSubTab = ({ jobData, properties, vendorType, codeDefinitions }) => {
  const [overrides, setOverrides] = useState({}); // { [vcs]: { merge, commentary } }
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const jobId = jobData?.id;

  // ---- Load persisted overrides -------------------------------------------
  useEffect(() => {
    let cancelled = false;
    if (!jobId) return;
    (async () => {
      const { data, error } = await supabase
        .from('job_settings')
        .select('setting_value')
        .eq('job_id', jobId)
        .eq('setting_key', SETTING_KEY)
        .maybeSingle();
      if (cancelled) return;
      if (!error && data?.setting_value) {
        try {
          const parsed =
            typeof data.setting_value === 'string'
              ? JSON.parse(data.setting_value)
              : data.setting_value;
          setOverrides(parsed?.overrides || {});
        } catch {
          setOverrides({});
        }
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  // ---- Decode helpers ------------------------------------------------------
  const designName = useCallback(
    (p) => {
      if (codeDefinitions && vendorType) {
        const decoded = interpretCodes.getDesignName(p, codeDefinitions, vendorType);
        if (decoded) return decoded;
      }
      return (p.asset_design_style || '').toString().trim();
    },
    [codeDefinitions, vendorType]
  );

  // ---- Core computation ----------------------------------------------------
  const { residential, commercial, townMedianSF } = useMemo(() => {
    const props = properties || [];
    const vcsOf = (p) => (p.property_vcs || '').toString().trim();

    // Map raw design code -> decoded label for predominant-style display,
    // decoded per-town via interpretCodes (definitions vary by municipality).
    const codeToLabel = {};
    for (const p of props) {
      const raw = (p.asset_design_style || '').toString().trim();
      if (raw && !codeToLabel[raw]) codeToLabel[raw] = designName(p) || raw;
    }

    // Map raw type/use code -> decoded label, also per-town via interpretCodes.
    const codeToType = {};
    for (const p of props) {
      const raw = (p.asset_type_use || '').toString().trim();
      if (raw && !(raw in codeToType)) {
        const decoded =
          codeDefinitions && vendorType
            ? interpretCodes.getTypeName(p, codeDefinitions, vendorType)
            : null;
        codeToType[raw] = decoded || standardTypeLabel(raw, vendorType) || raw;
      }
    }
    // --- Class 2 residential ---
    const class2 = props.filter((p) => {
      const cls = (p.property_m4_class || '').toString().trim();
      const vcs = vcsOf(p);
      return cls === '2' && vcs && !EXCLUDED_VCS.has(vcs.toUpperCase());
    });

    const vcsMap = new Map();
    for (const p of class2) {
      const vcs = vcsOf(p);
      if (!vcsMap.has(vcs)) vcsMap.set(vcs, []);
      vcsMap.get(vcs).push(p);
    }

    const residential = [];
    for (const [vcs, parcels] of vcsMap.entries()) {
      // street dominance across the whole VCS
      const streetCounts = {};
      for (const p of parcels) {
        const st = streetName(p.property_location);
        if (!st) continue;
        streetCounts[st] = (streetCounts[st] || 0) + 1;
      }
      const streetEntries = Object.entries(streetCounts).sort((a, b) => b[1] - a[1]);
      const dominantStreet = streetEntries[0]?.[0] || '';
      const dominantStreetPct = streetEntries.length
        ? Math.round((streetEntries[0][1] / parcels.length) * 100)
        : 0;

      // per-type breakdown, grouped by the town's own raw type/use code
      const typeMap = new Map();
      for (const p of parcels) {
        const code = (p.asset_type_use || '').toString().trim() || 'Unknown';
        if (!typeMap.has(code)) typeMap.set(code, []);
        typeMap.get(code).push(p);
      }

      const types = [];
      for (const [tLabel, tProps] of typeMap.entries()) {
        const normTimes = tProps
          .map((p) => Number(p.values_norm_time))
          .filter((n) => n > 0);
        const normSizes = tProps
          .map((p) => Number(p.values_norm_size))
          .filter((n) => n > 0);
        const sflas = tProps.map((p) => Number(p.asset_sfla)).filter((n) => n > 0);
        const years = tProps
          .map((p) => parseInt(p.asset_year_built, 10))
          .filter((n) => n > 0);

        // style mix
        const styleCounts = {};
        for (const p of tProps) {
          const raw = (p.asset_design_style || '').toString().trim() || '—';
          styleCounts[raw] = (styleCounts[raw] || 0) + 1;
        }
        const styleSorted = Object.entries(styleCounts).sort((a, b) => b[1] - a[1]);
        let styleMix = '—';
        if (styleSorted.length) {
          const topPct = Math.round((styleSorted[0][1] / tProps.length) * 100);
          if (topPct >= 80) {
            const code = styleSorted[0][0];
            styleMix = `${codeToLabel[code] || code} (${topPct}%)`;
          } else {
            styleMix =
              'Mixed: ' +
              styleSorted
                .slice(0, 3)
                .map(
                  ([code, n]) =>
                    `${code}:${Math.round((n / tProps.length) * 100)}`
                )
                .join('/');
          }
        }

        types.push({
          typeLabel:
            codeToType[tLabel] && codeToType[tLabel] !== tLabel
              ? tLabel + ' — ' + codeToType[tLabel]
              : tLabel || 'Unknown',
          parcels: tProps.length,
          usableSales: normTimes.length,
          avgNormTime: avg(normTimes),
          avgNormSize: avg(normSizes),
          avgSfla: avg(sflas),
          yrMin: years.length ? Math.min(...years) : null,
          yrMax: years.length ? Math.max(...years) : null,
          styleMix,
        });
      }
      types.sort((a, b) => b.parcels - a.parcels);

      const allNormSizes = parcels
        .map((p) => Number(p.values_norm_size))
        .filter((n) => n > 0);
      const vcsAvgNormSize = avg(allNormSizes);

      // SF-only norm size (for tier/outlier detection), using town-decoded labels
      const sfNormSizes = parcels
        .filter((p) => {
          const code = (p.asset_type_use || '').toString().trim();
          return isSFType(codeToType[code], code);
        })
        .map((p) => Number(p.values_norm_size))
        .filter((n) => n > 0);
      const sfAvgNormSize = avg(sfNormSizes);

      residential.push({
        vcs,
        totalParcels: parcels.length,
        dominantStreet,
        dominantStreetPct,
        types,
        typeCount: typeMap.size,
        vcsAvgNormSize,
        sfAvgNormSize,
      });
    }

    residential.sort((a, b) => a.vcs.localeCompare(b.vcs));

    // town median SF norm size across VCS (for outlier logic)
    const townMedianSF = median(
      residential.map((r) => r.sfAvgNormSize).filter((n) => n > 0)
    );

    // --- Commercial 4A/4B/4C ---
    const commClasses = new Set(['4A', '4B', '4C']);
    const comm = props.filter((p) =>
      commClasses.has((p.property_m4_class || '').toString().trim().toUpperCase())
    );
    const commMap = new Map();
    for (const p of comm) {
      const vcs = vcsOf(p) || 'NOVC';
      const cls = (p.property_m4_class || '').toString().trim().toUpperCase();
      const key = `${vcs}||${cls}`;
      if (!commMap.has(key)) commMap.set(key, { vcs, cls, props: [] });
      commMap.get(key).props.push(p);
    }
    const commercial = [];
    for (const { vcs, cls, props: cp } of commMap.values()) {
      const sflas = cp.map((p) => Number(p.asset_sfla)).filter((n) => n > 0);
      const years = cp.map((p) => parseInt(p.asset_year_built, 10)).filter((n) => n > 0);
      const typeSet = [
        ...new Set(
          cp.map((p) => {
            const code = (p.asset_type_use || '').toString().trim();
            const nm = codeToType[code];
            return nm && nm !== code ? code + ' — ' + nm : code || 'Unknown';
          })
        ),
      ];
      commercial.push({
        vcs,
        cls,
        type: typeSet.join(', '),
        parcels: cp.length,
        avgSfla: avg(sflas),
        yrMin: years.length ? Math.min(...years) : null,
        yrMax: years.length ? Math.max(...years) : null,
      });
    }
    commercial.sort(
      (a, b) => a.vcs.localeCompare(b.vcs) || a.cls.localeCompare(b.cls)
    );

    return { residential, commercial, townMedianSF };
  }, [properties, designName, codeDefinitions, vendorType]);

  // ---- Heuristic suggestion + auto commentary ------------------------------
  const enrichVcs = useCallback(
    (row) => {
      const sizeRef = row.sfAvgNormSize || row.vcsAvgNormSize;
      const dev =
        townMedianSF > 0 && sizeRef > 0
          ? (sizeRef - townMedianSF) / townMedianSF
          : 0;

      let suggested = 'Review';
      if (row.totalParcels <= 5) {
        suggested = 'Yes';
      } else if (row.dominantStreetPct >= 90 && Math.abs(dev) <= 0.1) {
        suggested = 'Yes';
      } else if (Math.abs(dev) >= 0.25) {
        suggested = 'No';
      }

      const notes = [];
      if (row.dominantStreet) {
        notes.push(`${row.dominantStreet} ${row.dominantStreetPct}%`);
        if (row.dominantStreetPct >= 90) notes.push('single-street carve-out');
      }
      if (row.typeCount > 1) {
        notes.push(`type mixing (${row.typeCount} types)`);
      }
      if (townMedianSF > 0 && sizeRef > 0) {
        if (dev >= 0.25) notes.push('upper-tier / outlier norm size');
        else if (dev <= -0.25) notes.push('low outlier norm size');
      }
      if (row.totalParcels <= 5) notes.push('very small parcel count');

      return { suggested, autoCommentary: notes.join('; ') };
    },
    [townMedianSF]
  );

  // ---- Override editing ----------------------------------------------------
  const setOverride = (vcs, field, value) => {
    setOverrides((prev) => ({
      ...prev,
      [vcs]: { ...prev[vcs], [field]: value },
    }));
    setSaveMsg('');
  };

  const save = async () => {
    if (!jobId) return;
    setSaving(true);
    setSaveMsg('');
    // Prune empty overrides so we don't persist noise.
    const clean = {};
    for (const [vcs, o] of Object.entries(overrides)) {
      const merge = o?.merge;
      const commentary = (o?.commentary || '').trim();
      if (merge || commentary) clean[vcs] = { merge: merge || null, commentary };
    }
    const { error } = await supabase.from('job_settings').upsert(
      {
        job_id: jobId,
        setting_key: SETTING_KEY,
        setting_value: { overrides: clean },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'job_id,setting_key' }
    );
    setSaving(false);
    setSaveMsg(error ? `Error: ${error.message}` : 'Saved');
  };

  // ---- Excel export --------------------------------------------------------
  const exportWorkbook = () => {
    const wb = XLSX.utils.book_new();

    const headerStyle = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '374151' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    };

    // Tab 1: Class 2 Residential
    const resHeaders = [
      'VCS',
      'Type',
      'Parcels',
      'Usable Sales',
      'Norm Time',
      'Norm Size',
      'Avg SFLA',
      'Yr Min',
      'Yr Max',
      'Style/Mix',
      'Commentary',
      'Merge?',
    ];
    const resAoa = [resHeaders];
    const resMerges = [];
    let r = 1;
    for (const row of residential) {
      const { suggested, autoCommentary } = enrichVcs(row);
      const ov = overrides[row.vcs] || {};
      const mergeVal = ov.merge || suggested;
      const commentary = (ov.commentary || '').trim() || autoCommentary;
      const startRow = r;
      for (let idx = 0; idx < row.types.length; idx++) {
        const t = row.types[idx];
        resAoa.push([
          idx === 0 ? row.vcs : '',
          t.typeLabel,
          t.parcels,
          t.usableSales,
          t.avgNormTime ? Math.round(t.avgNormTime) : '',
          t.avgNormSize ? Math.round(t.avgNormSize) : '',
          t.avgSfla ? Math.round(t.avgSfla) : '',
          t.yrMin || '',
          t.yrMax || '',
          t.styleMix,
          idx === 0 ? commentary : '',
          idx === 0 ? mergeVal : '',
        ]);
        r++;
      }
      const endRow = r - 1;
      if (endRow > startRow) {
        // merge VCS / Commentary / Merge? cells across the type rows
        resMerges.push({ s: { r: startRow, c: 0 }, e: { r: endRow, c: 0 } });
        resMerges.push({ s: { r: startRow, c: 10 }, e: { r: endRow, c: 10 } });
        resMerges.push({ s: { r: startRow, c: 11 }, e: { r: endRow, c: 11 } });
      }
    }
    const resWs = XLSX.utils.aoa_to_sheet(resAoa);
    resWs['!merges'] = resMerges;
    resWs['!cols'] = [
      { wch: 8 }, { wch: 22 }, { wch: 8 }, { wch: 11 }, { wch: 11 },
      { wch: 11 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 22 },
      { wch: 40 }, { wch: 9 },
    ];
    // style header row + Merge? cells
    for (let c = 0; c < resHeaders.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (resWs[addr]) resWs[addr].s = headerStyle;
    }
    for (let i = 1; i < resAoa.length; i++) {
      const mv = resAoa[i][11];
      if (mv) {
        const addr = XLSX.utils.encode_cell({ r: i, c: 11 });
        if (resWs[addr])
          resWs[addr].s = {
            fill: { fgColor: { rgb: mergeFill(mv) } },
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { bold: true },
          };
      }
    }
    XLSX.utils.book_append_sheet(wb, resWs, 'Class 2 Residential');

    // Tab 2: Commercial 4A-4C
    const commHeaders = [
      'VCS', 'Class', 'Type', 'Parcels', 'Avg SFLA', 'Yr Min', 'Yr Max', 'Commentary',
    ];
    const commAoa = [commHeaders];
    for (const row of commercial) {
      const ov = overrides[`COMM::${row.vcs}::${row.cls}`] || {};
      commAoa.push([
        row.vcs,
        row.cls,
        row.type,
        row.parcels,
        row.avgSfla ? Math.round(row.avgSfla) : '',
        row.yrMin || '',
        row.yrMax || '',
        (ov.commentary || '').trim(),
      ]);
    }
    const commWs = XLSX.utils.aoa_to_sheet(commAoa);
    commWs['!cols'] = [
      { wch: 8 }, { wch: 7 }, { wch: 20 }, { wch: 8 }, { wch: 10 },
      { wch: 8 }, { wch: 8 }, { wch: 40 },
    ];
    for (let c = 0; c < commHeaders.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (commWs[addr]) commWs[addr].s = headerStyle;
    }
    for (let i = 1; i < commAoa.length; i++) {
      const cls = commAoa[i][1];
      const addr = XLSX.utils.encode_cell({ r: i, c: 1 });
      if (commWs[addr])
        commWs[addr].s = {
          fill: { fgColor: { rgb: classFill(cls) } },
          alignment: { horizontal: 'center' },
          font: { bold: true },
        };
    }
    XLSX.utils.book_append_sheet(wb, commWs, 'Commercial 4A-4C');

    const safeName = (jobData?.job_name || 'job').replace(/[^a-zA-Z0-9._-]/g, '_');
    XLSX.writeFile(wb, `${safeName}_VCS_Analyzer.xlsx`);
  };

  // ---- Render --------------------------------------------------------------
  return (
    <div className="w-full space-y-4 px-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">VCS Analyzer</h3>
          <p className="text-sm text-gray-600 mt-1 max-w-3xl">
            A consolidation guide for the town's Value Control Sections. Metrics are
            computed live; the <strong>Merge?</strong> flag is a heuristic suggestion you
            can override. Commentary and overrides are saved per job — nothing here changes
            property data.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {saveMsg && (
            <span
              className={`text-sm ${
                saveMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'
              }`}
            >
              {saveMsg}
            </span>
          )}
          <button
            onClick={save}
            disabled={saving || !loaded}
            className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
          >
            {saving ? (
              <RefreshCw className="animate-spin" size={16} />
            ) : (
              <Save size={16} />
            )}
            Save
          </button>
          <button
            onClick={exportWorkbook}
            className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1"
          >
            <Download size={16} />
            Export Workbook
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-600">
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-3 h-3 rounded"
            style={{ backgroundColor: MERGE_COLORS.Yes.bg }}
          />{' '}
          Yes — consolidate
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-3 h-3 rounded"
            style={{ backgroundColor: MERGE_COLORS.No.bg }}
          />{' '}
          No — keep
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-3 h-3 rounded"
            style={{ backgroundColor: MERGE_COLORS.Review.bg }}
          />{' '}
          Review
        </span>
        <span className="ml-4">
          {residential.length} Class 2 VCS · {commercial.length} commercial rows
        </span>
      </div>

      {/* Class 2 Residential */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <div className="px-4 py-2 border-b font-semibold text-sm bg-gray-50">
          Class 2 Residential
        </div>
        <table className="min-w-full text-xs">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              {[
                'VCS', 'Type', 'Parcels', 'Usable Sales', 'Norm Time', 'Norm Size',
                'Avg SFLA', 'Yr Min', 'Yr Max', 'Style/Mix', 'Commentary', 'Merge?',
              ].map((h) => (
                <th key={h} className="px-2 py-2 text-left font-semibold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {residential.map((row) => {
              const { suggested, autoCommentary } = enrichVcs(row);
              const ov = overrides[row.vcs] || {};
              const mergeVal = ov.merge || suggested;
              const mc = mergeColor(mergeVal);
              const commentaryVal =
                ov.commentary != null ? ov.commentary : autoCommentary;
              return row.types.map((t, idx) => (
                <tr key={`${row.vcs}-${t.typeLabel}`} className="border-t align-top">
                  {idx === 0 && (
                    <td
                      rowSpan={row.types.length}
                      className="px-2 py-1.5 font-semibold border-r"
                    >
                      {row.vcs}
                    </td>
                  )}
                  <td className="px-2 py-1.5 whitespace-nowrap">{t.typeLabel}</td>
                  <td className="px-2 py-1.5 text-right">{t.parcels}</td>
                  <td className="px-2 py-1.5 text-right">{t.usableSales}</td>
                  <td className="px-2 py-1.5 text-right">{fmtMoney(t.avgNormTime)}</td>
                  <td className="px-2 py-1.5 text-right">{fmtMoney(t.avgNormSize)}</td>
                  <td className="px-2 py-1.5 text-right">{fmtNum(t.avgSfla)}</td>
                  <td className="px-2 py-1.5 text-right">{t.yrMin || '—'}</td>
                  <td className="px-2 py-1.5 text-right">{t.yrMax || '—'}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{t.styleMix}</td>
                  {idx === 0 && (
                    <td rowSpan={row.types.length} className="px-2 py-1.5 border-l">
                      <textarea
                        value={commentaryVal}
                        onChange={(e) =>
                          setOverride(row.vcs, 'commentary', e.target.value)
                        }
                        placeholder={autoCommentary || 'Add commentary…'}
                        rows={2}
                        className="w-56 text-xs border rounded px-1 py-0.5 resize-y"
                      />
                    </td>
                  )}
                  {idx === 0 && (
                    <td
                      rowSpan={row.types.length}
                      className="px-2 py-1.5 border-l text-center"
                      style={{ backgroundColor: mc.bg, color: mc.fg }}
                    >
                      <div className="text-sm font-bold mb-1">{mergeVal}</div>
                      <select
                        value={mergeVal}
                        onChange={(e) => setOverride(row.vcs, 'merge', e.target.value)}
                        className="text-xs font-semibold rounded px-1 py-1 border"
                      >
                        {MERGE_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                      {ov.merge && ov.merge !== suggested && (
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          (auto: {suggested})
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ));
            })}
            {residential.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-6 text-center text-gray-400">
                  No Class 2 residential parcels found for this job.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Commercial */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <div className="px-4 py-2 border-b font-semibold text-sm bg-gray-50">
          Commercial 4A–4C
        </div>
        <table className="min-w-full text-xs">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              {['VCS', 'Class', 'Type', 'Parcels', 'Avg SFLA', 'Yr Min', 'Yr Max', 'Commentary'].map(
                (h) => (
                  <th key={h} className="px-2 py-2 text-left font-semibold whitespace-nowrap">
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {commercial.map((row) => {
              const key = `COMM::${row.vcs}::${row.cls}`;
              const ov = overrides[key] || {};
              return (
                <tr key={key} className="border-t">
                  <td className="px-2 py-1.5 font-semibold">{row.vcs}</td>
                  <td className="px-2 py-1.5">
                    <span
                      className="px-1.5 py-0.5 rounded text-xs font-semibold"
                      style={{ backgroundColor: `#${classFill(row.cls)}` }}
                    >
                      {row.cls}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{row.type}</td>
                  <td className="px-2 py-1.5 text-right">{row.parcels}</td>
                  <td className="px-2 py-1.5 text-right">{fmtNum(row.avgSfla)}</td>
                  <td className="px-2 py-1.5 text-right">{row.yrMin || '—'}</td>
                  <td className="px-2 py-1.5 text-right">{row.yrMax || '—'}</td>
                  <td className="px-2 py-1.5">
                    <textarea
                      value={ov.commentary || ''}
                      onChange={(e) => setOverride(key, 'commentary', e.target.value)}
                      placeholder="Add commentary…"
                      rows={1}
                      className="w-56 text-xs border rounded px-1 py-0.5 resize-y"
                    />
                  </td>
                </tr>
              );
            })}
            {commercial.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-400">
                  No commercial 4A–4C parcels found for this job.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default VcsAnalyzerSubTab;
