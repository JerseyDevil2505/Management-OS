/**
 * AUTO-NORMALIZATION SERVICE
 * ==========================
 * Lightweight time normalization that runs automatically after file upload
 * for LOJIK/assessor jobs. Populates time_normalized_price so downstream
 * features (Sales Review, CME tool) pass their gate checks.
 *
 * This is intentionally simpler than the full PreValuationTab normalization:
 * - Uses saved config or sensible defaults
 * - No UI state management
 * - No outlier detection (leaves keep_reject as 'pending')
 * - Manual normalization via PreValuationTab remains fully available
 */

import { supabase, worksheetService } from './supabaseClient';

/**
 * Run lightweight time normalization for a job.
 * Loads properties + HPI data, computes time_normalized_price, saves results.
 *
 * @param {string} jobId - The job ID
 * @param {string} vendorType - 'BRT' or 'Microsystems'
 * @param {string} county - County name for HPI lookup
 * @returns {{ normalized: number, total: number }} count of normalized sales
 */
export async function autoNormalizeJob(jobId, vendorType, county) {
  console.log(`🔄 Auto-normalization starting for job ${jobId} (${vendorType}, ${county})`);

  // 1. Load existing normalization config (if any) for saved settings
  let config = {};
  try {
    const existing = await worksheetService.loadNormalizationData(jobId);
    config = existing?.normalization_config || {};
  } catch (e) {
    console.warn('Could not load existing normalization config:', e);
  }

  const normalizeToYear = config.normalizeToYear || 2025;
  const salesFromYear = config.salesFromYear || 2012;
  const minSalePrice = (typeof config.minSalePrice === 'number' && !isNaN(config.minSalePrice)) ? config.minSalePrice : 100;
  const eqRatio = config.equalizationRatio ? parseFloat(config.equalizationRatio) : 0;
  const outThreshold = config.outlierThreshold ? parseFloat(config.outlierThreshold) : 0;

  // 2. Load HPI data for the county
  const { data: hpiData, error: hpiError } = await supabase
    .from('county_hpi')
    .select('observation_year, hpi_index')
    .ilike('county_name', county || 'Bergen')
    .order('observation_year');

  if (hpiError) {
    console.error('Auto-normalization: failed to load HPI data', hpiError);
    return { normalized: 0, total: 0, error: 'HPI data unavailable' };
  }

  if (!hpiData || hpiData.length === 0) {
    console.warn('Auto-normalization: no HPI data found for county', county);
    return { normalized: 0, total: 0, error: 'No HPI data for county' };
  }

  // Build HPI lookup
  const getHPIMultiplier = (saleYear, targetYear) => {
    const maxHPIYear = Math.max(...hpiData.map(h => h.observation_year));
    if (saleYear > maxHPIYear) return 1.0;
    const effectiveTargetYear = targetYear > maxHPIYear ? maxHPIYear : targetYear;
    if (saleYear === effectiveTargetYear) return 1.0;

    const saleYearData = hpiData.find(h => h.observation_year === saleYear);
    const targetYearData = hpiData.find(h => h.observation_year === effectiveTargetYear);
    if (!saleYearData || !targetYearData) return 1.0;

    return (targetYearData.hpi_index || 100) / (saleYearData.hpi_index || 100);
  };

  // 3. Load properties with sales data (only fields needed for normalization)
  const { data: properties, error: propError } = await supabase
    .from('property_records')
    .select('id, property_composite_key, sales_price, sales_date, sales_nu, values_mod_total, values_mod_improvement, asset_year_built, asset_building_class, asset_type_use, asset_design_style, asset_sfla, property_m4_class')
    .eq('job_id', jobId);

  if (propError) {
    console.error('Auto-normalization: failed to load properties', propError);
    return { normalized: 0, total: properties?.length || 0, error: 'Property load failed' };
  }

  if (!properties || properties.length === 0) {
    console.log('Auto-normalization: no properties found');
    return { normalized: 0, total: 0 };
  }

  // 4. Parse composite key helper (lightweight version)
  const parseCompositeKey = (key) => {
    if (!key) return {};
    const parts = key.split('_');
    if (parts.length >= 3) {
      const blockLot = parts[0].split('-');
      return {
        block: blockLot[0] || '',
        lot: blockLot[1] || '',
        qualifier: parts[1] || '',
        card: parts[2] || ''
      };
    }
    return {};
  };

  // 5. Filter valid residential sales
  const validSales = properties.filter(p => {
    if (!p.sales_price || p.sales_price <= minSalePrice) return false;
    if (!p.sales_date) return false;
    if (!p.values_mod_improvement || p.values_mod_improvement < 10000) return false;

    const saleYear = new Date(p.sales_date).getFullYear();
    if (saleYear < salesFromYear) return false;
    if (p.asset_year_built && p.asset_year_built > saleYear) return false;

    const parsed = parseCompositeKey(p.property_composite_key);
    const card = parsed.card?.toUpperCase();

    if (vendorType === 'Microsystems') {
      if (card === 'M') return true;
      if (card === 'A') {
        const baseKey = `${parsed.block}-${parsed.lot}_${parsed.qualifier}`;
        const hasMCard = properties.some(other => {
          const op = parseCompositeKey(other.property_composite_key);
          return `${op.block}-${op.lot}_${op.qualifier}` === baseKey && op.card?.toUpperCase() === 'M';
        });
        return !hasMCard;
      }
      return false;
    } else {
      if (card !== '1') return false;
    }

    const buildingClass = p.asset_building_class?.toString().trim();
    if (!buildingClass || parseInt(buildingClass) <= 10) return false;
    if (!p.asset_type_use?.toString().trim()) return false;
    if (!p.asset_design_style?.toString().trim()) return false;
    if (!p.asset_sfla || p.asset_sfla <= 0) return false;

    return true;
  });

  if (validSales.length === 0) {
    console.log('Auto-normalization: no valid sales found to normalize');
    return { normalized: 0, total: properties.length };
  }

  // 6. Compute time-normalized prices
  // Load existing normalized sales to preserve keep/reject decisions
  let existingDecisions = {};
  try {
    const existingData = await worksheetService.loadNormalizationData(jobId);
    if (existingData?.time_normalized_sales) {
      existingData.time_normalized_sales.forEach(sale => {
        if (sale.keep_reject && sale.keep_reject !== 'pending') {
          existingDecisions[sale.id] = {
            decision: sale.keep_reject,
            sales_price: sale.sales_price,
            sales_date: sale.sales_date,
            sales_nu: sale.sales_nu
          };
        }
      });
    }
  } catch (e) {
    // No existing data - fine, all decisions will be 'pending'
  }

  const normalized = validSales.map(prop => {
    const saleYear = new Date(prop.sales_date).getFullYear();
    const hpiMultiplier = getHPIMultiplier(saleYear, normalizeToYear);
    const timeNormalizedPrice = Math.round(prop.sales_price * hpiMultiplier);

    const assessedValue = prop.values_mod_total || 0;
    const salesRatio = assessedValue > 0 && timeNormalizedPrice > 0
      ? assessedValue / timeNormalizedPrice
      : 0;

    // Basic outlier check if config has values
    const isOutlier = eqRatio && outThreshold
      ? Math.abs((salesRatio * 100) - eqRatio) > outThreshold
      : false;

    // Preserve existing decisions if sale data hasn't changed
    let finalDecision = 'pending';
    const existing = existingDecisions[prop.id];
    if (existing) {
      const dataChanged = existing.sales_price !== prop.sales_price ||
        existing.sales_date !== prop.sales_date ||
        existing.sales_nu !== prop.sales_nu;
      finalDecision = dataChanged ? 'pending' : existing.decision;
    }

    return {
      ...prop,
      time_normalized_price: timeNormalizedPrice,
      hpi_multiplier: hpiMultiplier,
      sales_ratio: salesRatio,
      is_outlier: isOutlier,
      keep_reject: finalDecision
    };
  });

  // 7. Compute stats
  const excludedCount = properties.filter(p =>
    !p.sales_price || p.sales_price <= minSalePrice || !p.sales_date ||
    new Date(p.sales_date).getFullYear() < salesFromYear
  ).length;

  const totalRatio = normalized.reduce((sum, s) => sum + (s.sales_ratio || 0), 0);
  const avgRatio = normalized.length > 0 ? totalRatio / normalized.length : 0;

  const stats = {
    totalSales: normalized.length,
    timeNormalized: normalized.length,
    excluded: excludedCount,
    flaggedOutliers: normalized.filter(s => s.is_outlier).length,
    pendingReview: normalized.filter(s => s.keep_reject === 'pending').length,
    keptCount: normalized.filter(s => s.keep_reject === 'keep').length,
    rejectedCount: normalized.filter(s => s.keep_reject === 'reject').length,
    averageRatio: avgRatio.toFixed(2),
    sizeNormalized: 0,
    acceptedSales: 0,
    autoNormalized: true  // Flag so PreValuationTab knows this was auto-generated
  };

  // 8. Save config and results
  const updatedConfig = {
    ...config,
    normalizeToYear,
    salesFromYear,
    minSalePrice,
    selectedCounty: county,
    lastTimeNormalizationRun: new Date().toISOString(),
    autoNormalized: true
  };

  await worksheetService.saveNormalizationConfig(jobId, updatedConfig);
  await worksheetService.saveTimeNormalizedSales(jobId, normalized, stats);

  console.log(`✅ Auto-normalization complete: ${normalized.length} sales normalized out of ${properties.length} properties`);
  return { normalized: normalized.length, total: properties.length };
}
