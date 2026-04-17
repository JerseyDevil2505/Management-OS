// ============================================================
// Appellant Comp Evaluator ("BS Meter")
// ------------------------------------------------------------
// Evaluates each appellant-supplied comparable sale against:
//   - the subject property
//   - the job's CME search range (sale date)
//   - acceptable NU sale code rules
// Returns per-field color flags ('green' | 'yellow' | 'red' | 'na')
// plus an auto-generated narrative line in the legacy phrasing.
// ============================================================

import { interpretCodes, supabase } from './supabaseClient';

// ---------- Type & Use grouping (mirrors OverallAnalysisTab.getTypeCategory) ----------
export const getTypeUseCategory = (typeCode) => {
  if (!typeCode) return 'Unknown';
  const code = String(typeCode);
  const firstChar = code.charAt(0);

  switch (firstChar) {
    case '1': return 'Single Family';
    case '2': return 'Semi-Detached';
    case '3':
      if (code === '31' || code === '3E') return 'Row/Town End';
      if (code === '30' || code === '3I') return 'Row/Town Interior';
      return 'Row/Townhouse';
    case '4':
      if (code === '42') return 'Two Family';
      if (code === '43') return 'Three Family';
      if (code === '44') return 'Four Family';
      return 'Multi-Family';
    case '5':
      if (code === '51') return 'Conversion One';
      if (code === '52') return 'Conversion Two';
      return 'Conversion';
    case '6': return 'Condominium';
    default:  return 'Other';
  }
};

// ---------- NU acceptability (mirrors DataVisualizations rules + farm mode) ----------
// Acceptable: blank, '00', '07', '32', '36'
// Farm mode: '33' is also acceptable
const BASE_ACCEPTABLE_NU = new Set(['', '00', '07', '32', '36']);
export const isAcceptableNuCode = (nuCode, farmMode = false) => {
  const code = (nuCode == null ? '' : String(nuCode)).trim();
  if (BASE_ACCEPTABLE_NU.has(code)) return true;
  if (farmMode && code === '33') return true;
  return false;
};

// ---------- NU code dictionary ----------
// SOURCE OF TRUTH: public.nu_code_dictionary in Supabase. Loaded once per
// session via loadNuDictionary() and cached at module scope. The hard-coded
// values below are only a synchronous fallback for the brief window before
// the table loads (or when offline).
//
// Source: NJ Div. of Taxation - Guidelines for Use of 36 Nonusable Categories (May 2025)
export const NU_CODE_DICTIONARY = {
  '00': 'usable sale',
  '01': 'family sale',
  '02': 'love & affection',
  '03': 'corporate affiliate',
  '04': 'transfer of convenience',
  '05': 'outside sampling period',
  '06': 'split-off / apportionment',
  '07': 'added assessment',
  '08': 'undivided interest',
  '09': 'tax sale / gov lien',
  '10': 'estate sale',
  '11': 'eminent domain',
  '12': 'gov / nonprofit buyer',
  '13': 'institutional buyer',
  '14': 'lender / REO',
  '15': 'foreclosure / short sale',
  '16': 'unconfirmed price',
  '17': 'sale incl. personal prop.',
  '18': 'sale incl. multiple parcels',
  '19': 'trade / exchange',
  '20': 'plottage / assemblage',
  '21': 'unusual financing',
  '22': 'sale-leaseback',
  '23': 'partial assessment',
  '24': 'zoning change pending',
  '25': 'use change',
  '26': 'auction sale',
  '27': 'partial interest in entity',
  '28': 'easement / right-of-way',
  '29': 'leasehold sale',
  '30': 'mineral / air rights',
  '31': 'unbuildable parcel',
  '32': 'farmland assessed',
  '33': 'contaminated property',
  '34': 'partial demolition / fire',
  '35': 'other nonusable',
  '36': 'outlier ratio'
};

export const getNuShortForm = (nuCode) => {
  const code = (nuCode == null ? '' : String(nuCode)).trim().padStart(2, '0');
  return NU_CODE_DICTIONARY[code] || null;
};

// ---------- Async dictionary loader (call once on app/panel mount) ----------
// Merges Supabase nu_code_dictionary.short_form into the in-memory dictionary
// so any future codes added to the table are picked up without a code change.
let nuDictLoadPromise = null;
export const loadNuDictionary = () => {
  if (nuDictLoadPromise) return nuDictLoadPromise;
  nuDictLoadPromise = supabase
    .from('nu_code_dictionary')
    .select('code, short_form')
    .then(({ data, error }) => {
      if (error || !Array.isArray(data)) return NU_CODE_DICTIONARY;
      data.forEach(row => {
        if (!row?.code) return;
        const key = String(row.code).trim().padStart(2, '0');
        if (row.short_form) NU_CODE_DICTIONARY[key] = String(row.short_form).toLowerCase();
      });
      return NU_CODE_DICTIONARY;
    })
    .catch(() => NU_CODE_DICTIONARY);
  return nuDictLoadPromise;
};

// ---------- Card classification ----------
// BRT main = '1', Microsystems main = 'M' (or numeric main)
const isMainCard = (card) => {
  if (card == null || card === '') return true; // missing → assume main
  const c = String(card).trim().toUpperCase();
  return c === '1' || c === 'M';
};
const hasAdditionalCards = (property) => {
  // Property-level rollup if available
  if (property?.additional_cards_count != null) return Number(property.additional_cards_count) > 0;
  // Fallback: heuristic — if THIS row is itself an additional card, the property has add'l cards
  return !isMainCard(property?.property_addl_card ?? property?.property_card);
};

// ---------- Lot size resolution (reuses interpretCodes.getCalculatedAcreage) ----------
// Returns { value, unit } where unit is 'ff' | 'ac' | 'sf' | null
export const resolveLotSize = (property, vendorType, landMethod) => {
  if (!property) return { value: null, unit: null };

  const method = (landMethod || '').toLowerCase();

  // Front foot: direct read of asset_lot_frontage
  if (method === 'ff' || method === 'front_foot' || method === 'frontfoot') {
    const ff = parseFloat(property.asset_lot_frontage);
    return Number.isFinite(ff) && ff > 0
      ? { value: ff, unit: 'ff' }
      : { value: null, unit: 'ff' };
  }

  // Acre / SF: use the shared resolver which already handles asset → market_manual fallback
  try {
    const acres = parseFloat(interpretCodes.getCalculatedAcreage(property, vendorType));
    if (Number.isFinite(acres) && acres > 0) {
      return method === 'sf' || method === 'square_foot'
        ? { value: acres * 43560, unit: 'sf' }
        : { value: acres, unit: 'ac' };
    }
  } catch (e) {
    // fall through
  }
  return { value: null, unit: method === 'sf' || method === 'square_foot' ? 'sf' : 'ac' };
};

// ---------- Per-field comparators ----------
const flag = (color, detail = null) => ({ color, detail });

const compareCard = (subject, comp) => {
  const subjHasAddl = hasAdditionalCards(subject);
  const compHasAddl = hasAdditionalCards(comp);
  if (subjHasAddl === compHasAddl) return flag('green');
  return flag('red', subjHasAddl ? 'subject has additional cards, comp does not' : 'comp has additional cards, subject does not');
};

const compareSaleDate = (compDateStr, rangeStart, rangeEnd) => {
  if (!compDateStr) return flag('red', 'no sale date');
  const d = new Date(compDateStr);
  if (Number.isNaN(d.getTime())) return flag('red', 'invalid sale date');
  if (rangeStart && d < new Date(rangeStart)) return flag('red', 'before sample range');
  if (rangeEnd && d > new Date(rangeEnd)) return flag('red', 'after sample range');
  return flag('green');
};

const compareNu = (nu, farmMode) => {
  if (isAcceptableNuCode(nu, farmMode)) return flag('green');
  const short = getNuShortForm(nu);
  return flag('red', short ? `NU ${nu} - ${short}` : `NU ${nu || 'blank'} not acceptable`);
};

const compareExact = (subjVal, compVal, label) => {
  const a = (subjVal == null ? '' : String(subjVal)).trim();
  const b = (compVal == null ? '' : String(compVal)).trim();
  if (!a || !b) return flag('na', `missing ${label}`);
  return a.toUpperCase() === b.toUpperCase()
    ? flag('green')
    : flag('red', `different ${label}`);
};

const compareTypeUse = (subjTU, compTU) => {
  if (!subjTU || !compTU) return flag('na', 'missing T&U');
  const subjGroup = getTypeUseCategory(subjTU);
  const compGroup = getTypeUseCategory(compTU);
  if (subjGroup === 'Unknown' || compGroup === 'Unknown') return flag('na', 'unknown T&U group');
  return subjGroup === compGroup ? flag('green') : flag('red', 'different T&U group');
};

const conditionBuckets = ['UN', 'PR', 'FR', 'AV', 'GD', 'VG', 'EX']; // ordered worst→best
const compareCondition = (subjCond, compCond) => {
  if (!subjCond || !compCond) return flag('na', 'missing condition');
  const a = String(subjCond).trim().toUpperCase();
  const b = String(compCond).trim().toUpperCase();
  if (a === b) return flag('green');
  const ai = conditionBuckets.indexOf(a);
  const bi = conditionBuckets.indexOf(b);
  if (ai === -1 || bi === -1) return flag('red', 'different condition');
  const diff = Math.abs(ai - bi);
  if (diff === 1) return flag('yellow', 'one bucket off');
  return flag('red', `${diff} buckets off`);
};

const compareYearBuilt = (subjYB, compYB) => {
  const a = parseInt(subjYB, 10);
  const b = parseInt(compYB, 10);
  if (!a || !b) return flag('na', 'missing year built');
  const diff = Math.abs(a - b);
  if (diff <= 10) return flag('green');
  if (diff <= 25) return flag('yellow');
  return flag('red', `${diff} yrs apart`);
};

const compareSfla = (subjSf, compSf) => {
  const a = parseFloat(subjSf);
  const b = parseFloat(compSf);
  if (!a || !b) return flag('na', 'missing SFLA');
  const diff = Math.abs(a - b);
  if (diff <= 250) return flag('green');
  if (diff <= 500) return flag('yellow');
  return flag('red', `${Math.round(diff)} sf apart`);
};

const compareLotSize = (subjLot, compLot) => {
  if (!subjLot.value || !compLot.value) return flag('na', 'lot size unresolved');
  if (subjLot.unit && compLot.unit && subjLot.unit !== compLot.unit) {
    return flag('yellow', `unit mismatch (${subjLot.unit} vs ${compLot.unit})`);
  }
  const ratio = subjLot.value > compLot.value
    ? subjLot.value / compLot.value
    : compLot.value / subjLot.value;
  if (ratio <= 1.25) return flag('green');
  if (ratio <= 2.0)  return flag('yellow');
  return flag('red', `${ratio.toFixed(1)}× size diff`);
};

// ---------- Main evaluator ----------
// subject: property_records row (matched by appeal.property_composite_key)
// comp:    property_records row (matched by user-entered block/lot/qual/card)
// userComp: the user-entered slot data { sales_date, sales_price, sales_nu }
// ctx:     { vendorType, landMethod, sampleRange: {start,end}, farmMode }
export const evaluateAppellantComp = (subject, comp, userComp, ctx = {}) => {
  const { vendorType, landMethod, sampleRange = {}, farmMode = false } = ctx;

  if (!comp) {
    return {
      resolved: false,
      flags: {},
      worstColor: 'red',
      counts: { green: 0, yellow: 0, red: 1, na: 0 },
      autoNote: 'COMP NOT FOUND IN PROPERTY RECORDS'
    };
  }

  // Use user-entered sale date/nu when present, else fall back to comp's recorded values.
  // IMPORTANT: use `||` (not `??`) so empty-string slot values fall back to comp data.
  // The input UI displays comp values as the visible value when the slot is empty
  // (`value={slot.sales_nu || comp.sales_nu}`), so the evaluator must mirror that
  // exact fallback or we get a green NU flag while the screen shows a non-usable code.
  const compSaleDate  = userComp?.sales_date  || comp.sales_date;
  const compNu        = (userComp?.sales_nu != null && String(userComp.sales_nu).trim() !== '')
                          ? userComp.sales_nu
                          : comp.sales_nu;

  const subjLot = resolveLotSize(subject, vendorType, landMethod);
  const compLot = resolveLotSize(comp,    vendorType, landMethod);

  const flags = {
    card:         compareCard(subject, comp),
    sale_date:    compareSaleDate(compSaleDate, sampleRange.start, sampleRange.end),
    sale_price:   flag('na'),
    sale_nu:      compareNu(compNu, farmMode),
    vcs:          compareExact(subject?.new_vcs || subject?.property_vcs, comp.new_vcs || comp.property_vcs, 'VCS'),
    design:       compareExact(subject?.asset_design_style, comp.asset_design_style, 'design'),
    type_use:     compareTypeUse(subject?.asset_type_use, comp.asset_type_use),
    condition:    compareCondition(subject?.asset_int_cond, comp.asset_int_cond),
    year_built:   compareYearBuilt(subject?.asset_year_built, comp.asset_year_built),
    sfla:         compareSfla(subject?.asset_sfla, comp.asset_sfla),
    lot_size:     compareLotSize(subjLot, compLot)
  };

  const counts = { green: 0, yellow: 0, red: 0, na: 0 };
  Object.values(flags).forEach(f => { counts[f.color] = (counts[f.color] || 0) + 1; });

  let worstColor = 'green';
  if (counts.red > 0) worstColor = 'red';
  else if (counts.yellow > 0) worstColor = 'yellow';
  else if (counts.green === 0) worstColor = 'na';

  return {
    resolved: true,
    flags,
    counts,
    worstColor,
    autoNote: buildAutoNote(flags)
  };
};

// ---------- Auto-generated narrative line (legacy phrasing) ----------
// Example: "SOLD OUTSIDE SAMPLING PERIOD, DIFFERENT VCS, DIFFERENT DESIGN, SIMILAR AGE AND SIZE"
const buildAutoNote = (flags) => {
  const parts = [];

  // Sale date
  if (flags.sale_date.color === 'red') parts.push('SOLD OUTSIDE SAMPLING PERIOD');

  // NU - ALWAYS comment on the sale. Acceptable codes => "ARM'S LENGTH SALE".
  // Non-usable codes => "NON-USABLE: <SHORT FORM>" pulled from nu_code_dictionary.
  if (flags.sale_nu.color === 'red') {
    const short = flags.sale_nu.detail && flags.sale_nu.detail.includes(' - ')
      ? flags.sale_nu.detail.split(' - ').slice(1).join(' - ')
      : null;
    parts.push(short ? `NON-USABLE: ${short.toUpperCase()}` : 'NON-USABLE SALE CODE');
  } else if (flags.sale_nu.color === 'green') {
    parts.push("ARM'S LENGTH SALE");
  }

  // Card
  if (flags.card.color === 'red') parts.push('CARD COUNT MISMATCH');

  // VCS / Design / T&U / Condition (categorical "DIFFERENT X")
  if (flags.vcs.color === 'red')       parts.push('DIFFERENT VCS');
  if (flags.design.color === 'red')    parts.push('DIFFERENT DESIGN');
  if (flags.type_use.color === 'red')  parts.push('DIFFERENT TYPE & USE');
  if (flags.condition.color === 'red') parts.push('DIFFERENT INTERIOR CONDITION');
  else if (flags.condition.color === 'yellow') parts.push('SIMILAR INTERIOR CONDITION');

  // Year built / SFLA / Lot — use SIMILAR for yellow, OUT-OF-RANGE for red
  const ybNote = flags.year_built.color === 'green'  ? 'SIMILAR AGE'
                : flags.year_built.color === 'yellow' ? 'AGE WITHIN ACCEPTABLE RANGE'
                : flags.year_built.color === 'red'    ? 'AGE OUT OF RANGE'
                : null;
  const sfNote = flags.sfla.color === 'green'  ? 'SIMILAR SIZE'
                : flags.sfla.color === 'yellow' ? 'SIZE WITHIN ACCEPTABLE RANGE'
                : flags.sfla.color === 'red'    ? 'SIZE OUT OF RANGE'
                : null;
  const lotNote = flags.lot_size.color === 'green'  ? 'SIMILAR LOT SIZE'
                : flags.lot_size.color === 'yellow' ? 'LOT SIZE WITHIN ACCEPTABLE RANGE'
                : flags.lot_size.color === 'red'    ? 'LOT SIZE OUT OF RANGE'
                : null;

  // Combine age + size into one phrase if both green/yellow (matches legacy "SIMILAR AGE AND SIZE")
  if (ybNote && sfNote && flags.year_built.color === 'green' && flags.sfla.color === 'green') {
    parts.push('SIMILAR AGE AND SIZE');
  } else {
    if (ybNote) parts.push(ybNote);
    if (sfNote) parts.push(sfNote);
  }
  if (lotNote) parts.push(lotNote);

  if (parts.length === 0) return 'COMP IS A STRONG MATCH ON ALL FIELDS';
  return parts.join(', ');
};

// ---------- Pastel color classes (Tailwind) ----------
export const COLOR_CLASSES = {
  green:  { bg: 'bg-green-100',  text: 'text-green-800',  border: 'border-green-200',  chip: 'bg-green-100 text-green-800' },
  yellow: { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-200', chip: 'bg-yellow-100 text-yellow-800' },
  red:    { bg: 'bg-red-100',    text: 'text-red-800',    border: 'border-red-200',    chip: 'bg-red-100 text-red-800' },
  na:     { bg: 'bg-gray-100',   text: 'text-gray-600',   border: 'border-gray-200',   chip: 'bg-gray-100 text-gray-600' }
};
