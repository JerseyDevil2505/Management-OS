// src/lib/conditionRanking.js
//
// Single source of truth for translating raw condition codes (e.g. "G",
// "AVG", "Good") and NCOVR percentages (Franklin) into a numeric rank that
// honors the user's per-job `attribute_condition_config`.
//
// Logic mirrors `SalesComparisonTab.getConditionRank` /
// `DetailedAppraisalGrid.getConditionRank` so CME, the Detailed grid, and
// the Adjustment Study all agree on what "Good" means for THIS job. Do not
// fork this file's logic — fix it here and let consumers re-import.
//
// The function `buildConditionRanker(jobData)` returns a closure that the
// Adjustment Study engine can pass into the OLS variable extractor, so the
// engine itself stays job-agnostic.

// Single-letter / abbreviation translation. Vendor-agnostic.
const CONDITION_LETTER_MAP = {
  'E': 'EXCELLENT',
  'G': 'GOOD',
  'A': 'AVERAGE',
  'F': 'FAIR',
  'P': 'POOR',
};

export function translateConditionCode(code) {
  if (!code) return null;
  const normalized = String(code).trim().toUpperCase();
  return CONDITION_LETTER_MAP[normalized] || null;
}

// Franklin NCOVR percentage scale (stored as 0.00-1.00 decimal)
export function mapNCOVRToConditionName(ncovrPct) {
  if (ncovrPct == null) return null;
  const pct = parseFloat(ncovrPct);
  if (!Number.isFinite(pct)) return null;
  if (pct >= 0.86) return 'EXCELLENT';
  if (pct >= 0.71) return 'GOOD';
  if (pct >= 0.56) return 'AVERAGE';
  if (pct >= 0.41) return 'FAIR';
  if (pct >= 0.26) return 'POOR';
  if (pct >= 0.01) return 'DILAPIDATED';
  return null;
}

// Resolve a raw condition string (which may be a letter code, full word,
// or NCOVR percentage when conditionHandlingMethod === 'ncovr_override')
// into its full canonical name (EXCELLENT / GOOD / AVERAGE / FAIR / POOR /
// DILAPIDATED). Returns null if it cannot be resolved.
export function resolveConditionName(raw, conditionConfig, opts = {}) {
  if (raw == null) return null;
  const method = conditionConfig?.conditionHandlingMethod;

  // NCOVR override: caller passes the raw NCOVR percentage instead of a label.
  if (method === 'ncovr_override' && opts.ncovrPct != null) {
    return mapNCOVRToConditionName(opts.ncovrPct);
  }

  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Single-letter shortcut
  const letter = translateConditionCode(trimmed);
  if (letter) return letter;

  // Otherwise assume it's already a name
  return trimmed.toUpperCase();
}

// Get the numeric rank for a resolved condition name using the job's
// configured baseline / better / worse arrays. Better = positive ints,
// baseline = 0, worse = negative ints, unknown = 0.
export function getConditionRank(conditionName, configType, jobData) {
  if (!conditionName || !String(conditionName).trim()) return 0;
  const conditionConfig = jobData?.attribute_condition_config;
  if (!conditionConfig || !conditionConfig[configType]) return 0;

  const cfg = conditionConfig[configType];
  let code = String(conditionName).toUpperCase().trim();

  const equivalents = conditionConfig?.conditionEquivalents || {};
  if (equivalents[code]) {
    code = String(equivalents[code]).toUpperCase().trim();
  }

  const baseline = cfg.baseline ? String(cfg.baseline).toUpperCase().trim() : null;
  const better = (cfg.better || []).map((c) => String(c).toUpperCase().trim());
  const worse = (cfg.worse || []).map((c) => String(c).toUpperCase().trim());

  if (code === baseline) return 0;
  const bi = better.indexOf(code);
  if (bi >= 0) return bi + 1;
  const wi = worse.indexOf(code);
  if (wi >= 0) return -(wi + 1);
  return 0;
}

// Convenience: build a closure the Adjustment Study engine can call without
// having to know about jobData internals. Pass `kind` = 'interior' or
// 'exterior'. Returns a numeric rank or null when the property has no
// usable condition data.
export function buildConditionRanker(jobData) {
  return function rank(rawCode, kind, opts = {}) {
    const name = resolveConditionName(rawCode, jobData?.attribute_condition_config, opts);
    if (!name) return null;
    const r = getConditionRank(name, kind, jobData);
    // We treat 0 = baseline as a real value (not null). Only return null
    // when we genuinely couldn't resolve a name.
    return r;
  };
}
