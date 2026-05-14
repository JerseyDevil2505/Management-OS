// src/lib/salesCodes.js
//
// Single source of truth for the sales-code vocabulary used across CME,
// Adjustment Study, and any other downstream consumers. Extracted from
// SalesComparisonTab.jsx so multiple tabs don't drift on which codes are
// "qualified" for analysis.
//
// `normalizeSalesCode` mirrors the helper at SalesComparisonTab.jsx:615 —
// trims, uppercases, and collapses '00' to '' so comparisons against the
// allowlist work uniformly across BRT (typically padded) and Microsystems
// (typically unpadded) source files.

export const CME_DEFAULT_SALES_CODES = [
  '00', '0', '07', '7', '32', '33', '3', '36',
];

// Codes considered usable for the Adjustment Study by default. Same as CME.
export const STUDY_DEFAULT_SALES_CODES = CME_DEFAULT_SALES_CODES;

export function normalizeSalesCode(code) {
  if (code == null) return '';
  const s = String(code).trim().toUpperCase();
  if (s === '00') return '';
  return s;
}

export function isAllowableSalesCode(code, allowList = CME_DEFAULT_SALES_CODES) {
  const norm = normalizeSalesCode(code);
  return allowList.some((c) => normalizeSalesCode(c) === norm);
}
