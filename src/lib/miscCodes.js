// BRT misc_1_brt..5 / Microsystems misc_item_1..3. Codes are normalized the same
// way the CME misc adjustments compare them (trim, strip leading zeros, upper).
export const normalizeMiscCode = (c) => String(c).trim().replace(/^0+/, '').toUpperCase() || '0';

export const getMiscCodes = (prop, vendorType) => {
  if (!prop) return [];
  const fields = vendorType === 'Microsystems'
    ? ['misc_item_1', 'misc_item_2', 'misc_item_3']
    : ['misc_1_brt', 'misc_2_brt', 'misc_3_brt', 'misc_4_brt', 'misc_5_brt'];
  const out = [];
  for (const f of fields) {
    const raw = prop[f];
    if (raw == null || String(raw).trim() === '') continue;
    const code = normalizeMiscCode(raw);
    if (code === '0') continue;
    if (!out.includes(code)) out.push(code);
  }
  return out;
};

// Map normalized code -> { code (as written in the code file), description }.
// Microsystems field_codes 590-593; BRT Residential section with KEY '39'.
// BRT MAP keys are positions, not codes (position 19 = code 26), so the code is item.KEY.
export const buildMiscDescriptions = (codeDefinitions, vendorType) => {
  const map = new Map();
  if (!codeDefinitions) return map;
  const add = (code, description) => {
    if (!description) return;
    const key = normalizeMiscCode(code);
    if (!map.has(key)) map.set(key, { code: String(code).trim(), description: String(description).trim() });
  };

  if (vendorType === 'Microsystems') {
    const fc = codeDefinitions.field_codes || {};
    ['590', '591', '592', '593'].forEach(prefix => {
      Object.entries(fc[prefix] || {}).forEach(([code, data]) => add(code, data?.description));
    });
    return map;
  }

  const sections = codeDefinitions.sections || codeDefinitions || {};
  const residential = sections.Residential || sections.residential || {};
  Object.values(residential).forEach(parent => {
    const key = parent?.KEY || parent?.key;
    if (key !== '39') return;
    const codeMap = parent.MAP || parent.map || {};
    Object.entries(codeMap).forEach(([idx, item]) => {
      if (idx === 'KEY' || idx === 'DATA' || idx === 'MAP') return;
      const description = item?.DATA?.VALUE || item?.VALUE || (typeof item === 'string' ? item : '');
      add(item?.KEY || idx, description);
    });
  });
  return map;
};

export const miscCodeLabel = (code, descriptions) => {
  const d = descriptions?.get(code);
  return d ? `${d.code} - ${d.description}` : code;
};
