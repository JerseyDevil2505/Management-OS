import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';
import * as XLSX from 'xlsx-js-style';
import { Download, Save, RefreshCw } from 'lucide-react';

const SETTING_KEY = 'vcs_analysis';

// VCS codes intentionally excluded from the Class 2 residential rationalization guide.
const EXCLUDED_VCS = new Set(['NOVC', 'FF01']);

const MERGE_OPTIONS = ['Yes', 'No', 'Review'];

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
    // Decode from the town's original (unmapped) code so the town's own table
    // definition is used (e.g. 60 = Condo), not the app-normalized code (6).
    const codeToType = {};
    for (const p of props) {
      const raw = (p.asset_type_use_raw || p.asset_type_use || '').toString().trim();
      if (raw && !(raw in codeToType)) {
        const probe = { ...p, asset_type_use: raw };
        const decoded =
          codeDefinitions && vendorType
            ? interpretCodes.getTypeName(probe, codeDefinitions, vendorType)
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

      // per-type breakdown, grouped by the town's own original (unmapped) code
      const typeMap = new Map();
      for (const p of parcels) {
        const code =
          (p.asset_type_use_raw || p.asset_type_use || '').toString().trim() || 'Unknown';
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
          sflaGap: sflas.length ? Math.max(...sflas) - Math.min(...sflas) : null,
          yrMin: years.length ? Math.min(...years) : null,
          yrMax: years.length ? Math.max(...years) : null,
          ageGap: years.length ? Math.max(...years) - Math.min(...years) : null,
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
          const code = (p.asset_type_use_raw || p.asset_type_use || '').toString().trim();
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

    // --- Commercial 4A/4B/4C, one row per VCS ---
    // Main concern: is a commercial VCS standalone (only 4A/4B/4C, plus exempt
    // and vacant parcels are OK) or does it have residential mixed in?
    const classOf = (p) => (p.property_m4_class || '').toString().trim().toUpperCase();
    const isCommercial = (c) => c === '4A' || c === '4B' || c === '4C';

    const commVcsSet = new Set(
      props.filter((p) => isCommercial(classOf(p))).map((p) => vcsOf(p) || 'NOVC')
    );

    const commercial = [];
    for (const vcs of commVcsSet) {
      const inVcs = props.filter((p) => (vcsOf(p) || 'NOVC') === vcs);
      const commParcels = inVcs.filter((p) => isCommercial(classOf(p)));

      const clsCounts = {};
      for (const p of commParcels) {
        const c = classOf(p);
        clsCounts[c] = (clsCounts[c] || 0) + 1;
      }
      const classesLabel = Object.entries(clsCounts)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([c, n]) => `${c} (${n})`)
        .join(', ');

      // composition of everything else in the VCS
      let residentialN = 0;
      let vacantN = 0;
      let exemptN = 0;
      let otherN = 0;
      for (const p of inVcs) {
        const c = classOf(p);
        if (isCommercial(c)) continue;
        if (c === '2' || c.startsWith('3')) residentialN++;
        else if (c === '1') vacantN++;
        else if (c.startsWith('15') || c === '5A' || c === '5B') exemptN++;
        else otherN++;
      }
      let composition = residentialN > 0 ? `Mixed — residential ${residentialN}` : 'Standalone';
      const extras = [];
      if (vacantN) extras.push(`vacant ${vacantN}`);
      if (exemptN) extras.push(`exempt ${exemptN}`);
      if (otherN) extras.push(`other ${otherN}`);
      if (extras.length) composition += ` (${extras.join(', ')})`;

      const sflas = commParcels.map((p) => Number(p.asset_sfla)).filter((n) => n > 0);
      const years = commParcels
        .map((p) => parseInt(p.asset_year_built, 10))
        .filter((n) => n > 0);

      const rec = {
        vcs,
        classes: classesLabel,
        parcels: commParcels.length,
        avgSfla: avg(sflas),
        avgYear: years.length ? Math.round(avg(years)) : null,
        composition,
        standalone: residentialN === 0,
      };
      commercial.push(rec);
    }
    commercial.sort((a, b) => a.vcs.localeCompare(b.vcs));

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
      'SFLA Gap',
      'Yr Min',
      'Yr Max',
      'Age Gap',
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
          t.sflaGap != null ? Math.round(t.sflaGap) : '',
          t.yrMin || '',
          t.yrMax || '',
          t.ageGap != null ? t.ageGap : '',
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
        resMerges.push({ s: { r: startRow, c: 12 }, e: { r: endRow, c: 12 } });
        resMerges.push({ s: { r: startRow, c: 13 }, e: { r: endRow, c: 13 } });
      }
    }
    const resWs = XLSX.utils.aoa_to_sheet(resAoa);
    resWs['!merges'] = resMerges;
    resWs['!cols'] = [
      { wch: 8 }, { wch: 22 }, { wch: 8 }, { wch: 11 }, { wch: 11 },
      { wch: 11 }, { wch: 10 }, { wch: 9 }, { wch: 8 }, { wch: 8 },
      { wch: 8 }, { wch: 22 }, { wch: 40 }, { wch: 9 },
    ];
    // style header row only (no data-row coloring)
    for (let c = 0; c < resHeaders.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (resWs[addr]) resWs[addr].s = headerStyle;
    }
    XLSX.utils.book_append_sheet(wb, resWs, 'Class 2 Residential');

    // Tab 2: Commercial 4A-4C (one row per VCS)
    const commHeaders = [
      'VCS', 'Class(es)', 'Parcels', 'Avg SFLA', 'Avg Year', 'Standalone?', 'Commentary',
    ];
    const commAoa = [commHeaders];
    for (const row of commercial) {
      const ov = overrides[`COMM::${row.vcs}`] || {};
      commAoa.push([
        row.vcs,
        row.classes,
        row.parcels,
        row.avgSfla ? Math.round(row.avgSfla) : '',
        row.avgYear || '',
        row.composition,
        (ov.commentary || '').trim(),
      ]);
    }
    const commWs = XLSX.utils.aoa_to_sheet(commAoa);
    commWs['!cols'] = [
      { wch: 8 }, { wch: 16 }, { wch: 8 }, { wch: 10 }, { wch: 9 },
      { wch: 28 }, { wch: 40 },
    ];
    for (let c = 0; c < commHeaders.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (commWs[addr]) commWs[addr].s = headerStyle;
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

      <div className="text-xs text-gray-600">
        {residential.length} Class 2 VCS · {commercial.length} commercial VCS
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
                'Avg SFLA', 'SFLA Gap', 'Yr Min', 'Yr Max', 'Age Gap', 'Style/Mix',
                'Commentary', 'Merge?',
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
              const commentaryVal =
                ov.commentary != null ? ov.commentary : autoCommentary;
              return row.types.map((t, idx) => (
                <tr
                  key={`${row.vcs}-${t.typeLabel}`}
                  className="border-t align-top"
                >
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
                  <td className="px-2 py-1.5 text-right">{fmtNum(t.sflaGap)}</td>
                  <td className="px-2 py-1.5 text-right">{t.yrMin || '—'}</td>
                  <td className="px-2 py-1.5 text-right">{t.yrMax || '—'}</td>
                  <td className="px-2 py-1.5 text-right">{t.ageGap != null ? t.ageGap : '—'}</td>
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
                    >
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
                <td colSpan={14} className="px-4 py-6 text-center text-gray-400">
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
              {['VCS', 'Class(es)', 'Parcels', 'Avg SFLA', 'Avg Year', 'Standalone?', 'Commentary'].map(
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
              const key = `COMM::${row.vcs}`;
              const ov = overrides[key] || {};
              return (
                <tr key={key} className="border-t align-top">
                  <td className="px-2 py-1.5 font-semibold">{row.vcs}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{row.classes}</td>
                  <td className="px-2 py-1.5 text-right">{row.parcels}</td>
                  <td className="px-2 py-1.5 text-right">{fmtNum(row.avgSfla)}</td>
                  <td className="px-2 py-1.5 text-right">{row.avgYear || '—'}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <span className={row.standalone ? '' : 'font-semibold'}>
                      {row.composition}
                    </span>
                  </td>
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
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
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
