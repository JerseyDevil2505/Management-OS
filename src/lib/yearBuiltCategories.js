// The five Year Built Analysis categories, shared by Overall Analysis and the
// Class / Effective Age report so a band means the same thing everywhere.
//
// These are system-level defaults, not per-town settings. Rebasing belongs at
// the start of a reval cycle, so callers pass the job's assessment year as the
// base rather than letting the wall clock roll the bands on January 1.

export const YEAR_BUILT_CONFIG = {
  newOffset: 10,        // New covers base-10 .. base
  newerOffset: 20,      // Newer covers base-20 .. base-11
  moderateLowerBound: 1990,
  olderLowerBound: 1950
};

export const YEAR_BUILT_CATEGORY_ORDER = ['New', 'Newer', 'Moderate', 'Older', 'Historic'];

// Moderate's upper bound is always (Newer lower bound - 1). Hardcoding it opens
// a silent one-year gap the moment Newer rolls forward.
export function buildYearBuiltCategories(baseYear, config = YEAR_BUILT_CONFIG) {
  const cfg = { ...YEAR_BUILT_CONFIG, ...config };
  const base = parseInt(baseYear, 10) || new Date().getFullYear();

  const newLower = base - cfg.newOffset;
  const newerLower = base - cfg.newerOffset;
  const moderateUpper = newerLower - 1;

  return [
    {
      key: 'New',
      min: newLower,
      max: Infinity,
      label: `New (${newLower}+)`
    },
    {
      key: 'Newer',
      min: newerLower,
      max: newLower - 1,
      label: `Newer (${newerLower}-${newLower - 1})`
    },
    {
      key: 'Moderate',
      min: cfg.moderateLowerBound,
      max: moderateUpper,
      label: `Moderate (${cfg.moderateLowerBound}-${moderateUpper})`
    },
    {
      key: 'Older',
      min: cfg.olderLowerBound,
      max: cfg.moderateLowerBound - 1,
      label: `Older (${cfg.olderLowerBound}-${cfg.moderateLowerBound - 1})`
    },
    {
      key: 'Historic',
      min: -Infinity,
      max: cfg.olderLowerBound - 1,
      label: `Historic (pre-${cfg.olderLowerBound})`
    }
  ].filter(cat => cat.max >= cat.min);
}

export function categorizeYearBuilt(yearBuilt, categories) {
  const yb = parseInt(yearBuilt, 10);
  if (!Number.isFinite(yb) || yb <= 0) return null;
  return categories.find(cat => yb >= cat.min && yb <= cat.max) || null;
}
