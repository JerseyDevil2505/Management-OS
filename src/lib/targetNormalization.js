/**
 * TARGET NORMALIZATION SERVICE
 * ============================
 * Targeted time normalization that runs ONLY for specific changed sales
 * after file upload comparison. Returns computed values for user review
 * before saving — no auto-decisions.
 *
 * Split into two phases:
 *   1. computeTargetNormalization() — computes normalized values, returns them
 *   2. saveNormalizationDecisions() — writes user keep/reject decisions to DB
 *
 * Also handles cleanup of stale normalized values (≤100, NU'd, removed sales).
 */

import { supabase, worksheetService } from './supabaseClient';

/**
 * Compute time-normalized prices for a specific set of changed sales.
 * Does NOT save anything — returns results for user review in the comparison modal.
 *
 * @param {string} jobId - The job ID
 * @param {string} vendorType - 'BRT' or 'Microsystems'
 * @param {string} county - County name for HPI lookup
 * @param {string[]} changedKeys - Composite keys of properties with sales changes
 * @param {Map} salesDecisions - Map of compositeKey → sales decision from Phase 1
 * @returns {{ results: Array, existing: Array, error?: string }}
 *   results: normalized sale objects for display
 *   existing: previously normalized sales for this job (for merge on save)
 */
export async function computeTargetNormalization(jobId, vendorType, county, changedKeys, salesDecisions) {
  console.log(`🎯 Target normalization: computing for ${changedKeys.length} changed sales (${vendorType}, ${county})`);

  if (!changedKeys || changedKeys.length === 0) {
    return { results: [], existing: [], removedKeys: [] };
  }

  // 1. Load existing normalization config for saved settings
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

  // 2. Load HPI data
  const { data: hpiData, error: hpiError } = await supabase
    .from('county_hpi_data')
    .select('observation_year, hpi_index')
    .ilike('county_name', county || 'Bergen')
    .order('observation_year');

  if (hpiError) {
    console.error('Target normalization: failed to load HPI data', hpiError);
    return { results: [], existing: [], error: 'HPI data unavailable' };
  }

  if (!hpiData || hpiData.length === 0) {
    console.warn('Target normalization: no HPI data found for county', county);
    return { results: [], existing: [], error: 'No HPI data for county' };
  }

  // Build HPI multiplier function
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

  // 3. Load ONLY the changed properties (targeted, not all properties)
  // Batch in groups of 100 to avoid query limits
  let changedProperties = [];
  for (let i = 0; i < changedKeys.length; i += 100) {
    const batch = changedKeys.slice(i, i + 100);
    const { data, error } = await supabase
      .from('property_records')
      .select('id, property_composite_key, sales_price, sales_date, sales_nu, values_mod_total, values_mod_improvement, asset_year_built, asset_building_class, asset_type_use, asset_design_style, asset_sfla, property_m4_class, property_block, property_lot, property_qualifier, property_location')
      .eq('job_id', jobId)
      .in('property_composite_key', batch);

    if (!error && data) {
      changedProperties = changedProperties.concat(data);
    }
  }

  if (changedProperties.length === 0) {
    console.log('Target normalization: no matching properties found');
    return { results: [], existing: [] };
  }

  // 4. Load existing normalized sales for context (merge later)
  let existingNormalizedSales = [];
  try {
    const existingData = await worksheetService.loadNormalizationData(jobId);
    if (existingData?.time_normalized_sales) {
      existingNormalizedSales = existingData.time_normalized_sales;
    }
  } catch (e) {
    // No existing data — fine
  }

  // Also load existing values_norm_time from property_market_analysis for "old norm" display
  let existingNormValues = {};
  try {
    for (let i = 0; i < changedKeys.length; i += 100) {
      const batch = changedKeys.slice(i, i + 100);
      const { data } = await supabase
        .from('property_market_analysis')
        .select('property_composite_key, values_norm_time')
        .eq('job_id', jobId)
        .in('property_composite_key', batch);

      if (data) {
        data.forEach(row => {
          existingNormValues[row.property_composite_key] = row.values_norm_time;
        });
      }
    }
  } catch (e) {
    console.warn('Could not load existing norm values:', e);
  }

  // 5. Composite key parser — matches PreValuationTab format: YEAR+CCDD-BLOCK-LOT_QUALIFIER-CARD-LOCATION
  const parseCompositeKey = (key) => {
    if (!key) return {};
    const parts = key.split('-');
    if (parts.length < 3) return {};
    const block = parts[1] || '';
    const lotQual = parts[2] || '';
    const [lot, qualifier] = lotQual.split('_');
    return {
      block,
      lot: lot || '',
      qualifier: qualifier === 'NONE' ? '' : qualifier || '',
      card: parts[3] === 'NONE' ? '' : parts[3] || ''
    };
  };

  // 6. Compute normalized values for each changed property
  const results = changedProperties.map(prop => {
    const salesDecision = salesDecisions?.get(prop.property_composite_key);

    // Determine which sale price/date to use based on sales decision
    // (by this point, property_records already has the correct values from the updater)
    const salePrice = prop.sales_price;
    const saleDate = prop.sales_date;
    const salesNu = prop.sales_nu;

    // Flag conditions
    const isNUd = salesNu && !['', ' ', '0', '00', '07', '7', '32', '36'].includes(String(salesNu).trim());
    const hasSale = salePrice && salePrice > minSalePrice && saleDate;
    const saleYear = saleDate ? new Date(saleDate).getFullYear() : null;
    const inYearRange = saleYear && saleYear >= salesFromYear;

    // Check card validity
    const parsed = parseCompositeKey(prop.property_composite_key);
    const card = parsed.card?.toUpperCase();
    let validCard = false;
    if (vendorType === 'Microsystems') {
      validCard = card === 'M' || card === 'A';
    } else {
      validCard = card === '1';
    }

    // Check building class validity
    const buildingClass = prop.asset_building_class?.toString().trim();
    const validClass = buildingClass && parseInt(buildingClass) > 10;

    // Check year_built vs sale year (same as PreValuationTab)
    const yearBuilt = prop.asset_year_built;
    const yearBuiltValid = !yearBuilt || !saleYear || yearBuilt <= saleYear;

    // Determine if this sale qualifies for normalization
    const qualifiesForNorm = hasSale && inYearRange && validCard && validClass && yearBuiltValid &&
      prop.asset_type_use?.toString().trim() &&
      prop.asset_design_style?.toString().trim() &&
      prop.asset_sfla && prop.asset_sfla > 0 &&
      prop.values_mod_improvement && prop.values_mod_improvement >= 10000;

    let timeNormalizedPrice = null;
    let hpiMultiplier = null;
    let salesRatio = null;
    let isOutlier = false;

    if (qualifiesForNorm && !isNUd) {
      hpiMultiplier = getHPIMultiplier(saleYear, normalizeToYear);
      timeNormalizedPrice = Math.round(salePrice * hpiMultiplier);

      const assessedValue = prop.values_mod_total || 0;
      salesRatio = assessedValue > 0 && timeNormalizedPrice > 0
        ? assessedValue / timeNormalizedPrice
        : 0;

      isOutlier = eqRatio && outThreshold
        ? Math.abs((salesRatio * 100) - eqRatio) > outThreshold
        : false;
    }

    // Auto-flag conditions for the UI
    const normValueTooLow = timeNormalizedPrice !== null && timeNormalizedPrice <= 100;
    const autoFlagReason = isNUd ? 'NU Code' :
      normValueTooLow ? 'Norm value ≤ 100' :
      !qualifiesForNorm ? 'Does not qualify' :
      null;

    return {
      id: prop.id,
      property_composite_key: prop.property_composite_key,
      property_block: prop.property_block,
      property_lot: prop.property_lot,
      property_qualifier: prop.property_qualifier,
      property_location: prop.property_location,
      sales_price: salePrice,
      sales_date: saleDate,
      sales_nu: salesNu,
      sales_decision: salesDecision || 'Keep New',
      values_mod_total: prop.values_mod_total,
      asset_sfla: prop.asset_sfla,
      property_m4_class: prop.property_m4_class,
      // Normalization results
      time_normalized_price: timeNormalizedPrice,
      hpi_multiplier: hpiMultiplier,
      sales_ratio: salesRatio,
      is_outlier: isOutlier,
      // Previous normalized value (for comparison)
      previous_norm_value: existingNormValues[prop.property_composite_key] || null,
      // Flags
      qualifies_for_norm: qualifiesForNorm && !isNUd,
      auto_flag_reason: autoFlagReason,
      is_nud: isNUd,
      norm_value_too_low: normValueTooLow
    };
  });

  // 7. Also check for previously normalized sales that were REMOVED from the file
  // (deletions from comparison — these need their norm values cleaned up)
  const removedKeys = changedKeys.filter(key => {
    return !changedProperties.some(p => p.property_composite_key === key);
  });

  console.log(`🎯 Target normalization computed: ${results.length} results, ${removedKeys.length} removed`);

  return {
    results,
    existing: existingNormalizedSales,
    removedKeys,
    config: { normalizeToYear, salesFromYear, minSalePrice, eqRatio, outThreshold }
  };
}

/**
 * Save normalization decisions from Phase 2 of comparison modal.
 * Updates both property_market_analysis.values_norm_time and
 * market_land_valuation.time_normalized_sales.
 *
 * @param {string} jobId - The job ID
 * @param {Array} normResults - Results from computeTargetNormalization
 * @param {Map} normDecisions - Map of compositeKey → 'keep' | 'reject'
 * @param {Array} existingNormalizedSales - Previous normalized sales list
 * @param {string[]} removedKeys - Composite keys removed from the file
 */
export async function saveNormalizationDecisions(jobId, normResults, normDecisions, existingNormalizedSales, removedKeys = []) {
  console.log(`💾 Saving normalization decisions: ${normDecisions.size} decisions`);

  // 1. Update property_market_analysis.values_norm_time for kept sales
  const keptUpdates = [];
  const rejectedKeys = [];

  for (const result of normResults) {
    const decision = normDecisions.get(result.property_composite_key);
    if (!decision) continue;

    if (decision === 'keep' && result.time_normalized_price && result.time_normalized_price > 100) {
      keptUpdates.push({
        job_id: jobId,
        property_composite_key: result.property_composite_key,
        values_norm_time: result.time_normalized_price,
        updated_at: new Date().toISOString()
      });
    } else {
      // Reject or doesn't qualify — clear the norm value
      rejectedKeys.push(result.property_composite_key);
    }
  }

  // Also add removed keys to the reject/clear list
  rejectedKeys.push(...removedKeys);

  // 2. Upsert kept values to property_market_analysis
  if (keptUpdates.length > 0) {
    for (let i = 0; i < keptUpdates.length; i += 500) {
      const batch = keptUpdates.slice(i, i + 500);
      const { error } = await supabase
        .from('property_market_analysis')
        .upsert(batch, { onConflict: 'job_id,property_composite_key' });

      if (error) {
        console.warn('Failed to upsert kept normalized values:', error);
      }
    }
    console.log(`✅ Saved ${keptUpdates.length} kept normalized values to property_market_analysis`);
  }

  // 3. Clear values_norm_time for rejected/removed sales
  if (rejectedKeys.length > 0) {
    for (let i = 0; i < rejectedKeys.length; i += 500) {
      const batch = rejectedKeys.slice(i, i + 500);
      await supabase
        .from('property_market_analysis')
        .update({ values_norm_time: null, updated_at: new Date().toISOString() })
        .eq('job_id', jobId)
        .in('property_composite_key', batch);
    }
    console.log(`🧹 Cleared ${rejectedKeys.length} rejected/removed normalized values`);
  }

  // 4. Update market_land_valuation.time_normalized_sales — merge decisions into existing list
  try {
    // Build a map of existing sales by composite key
    const existingMap = new Map();
    if (existingNormalizedSales && existingNormalizedSales.length > 0) {
      existingNormalizedSales.forEach(sale => {
        existingMap.set(sale.property_composite_key, sale);
      });
    }

    // Remove deleted sales
    removedKeys.forEach(key => existingMap.delete(key));

    // Update/add changed sales with new decisions
    for (const result of normResults) {
      const decision = normDecisions.get(result.property_composite_key);
      if (!decision) continue;

      const entry = {
        id: result.id,
        property_composite_key: result.property_composite_key,
        property_location: result.property_location,
        property_m4_class: result.property_m4_class,
        sales_price: result.sales_price,
        sales_date: result.sales_date,
        sales_nu: result.sales_nu,
        values_mod_total: result.values_mod_total,
        asset_sfla: result.asset_sfla,
        time_normalized_price: result.time_normalized_price,
        hpi_multiplier: result.hpi_multiplier,
        sales_ratio: result.sales_ratio,
        is_outlier: result.is_outlier,
        keep_reject: decision,  // 'keep' or 'reject' — never 'pending'
        decided_in: 'comparison_modal',
        decided_at: new Date().toISOString()
      };

      existingMap.set(result.property_composite_key, entry);
    }

    // Convert back to array
    const mergedSales = Array.from(existingMap.values());

    // Compute updated stats
    const stats = {
      totalSales: mergedSales.length,
      timeNormalized: mergedSales.filter(s => s.time_normalized_price).length,
      keptCount: mergedSales.filter(s => s.keep_reject === 'keep').length,
      rejectedCount: mergedSales.filter(s => s.keep_reject === 'reject').length,
      pendingReview: 0,  // No pending — everything is decided
      flaggedOutliers: mergedSales.filter(s => s.is_outlier).length,
      averageRatio: (() => {
        const ratios = mergedSales.filter(s => s.sales_ratio > 0);
        return ratios.length > 0
          ? (ratios.reduce((sum, s) => sum + s.sales_ratio, 0) / ratios.length).toFixed(2)
          : '0';
      })(),
      excluded: 0,
      sizeNormalized: 0,
      acceptedSales: 0
    };

    await worksheetService.saveTimeNormalizedSales(jobId, mergedSales, stats);
    console.log(`✅ Saved ${mergedSales.length} normalized sales to market_land_valuation`);
  } catch (saveError) {
    console.error('Failed to save to market_land_valuation:', saveError);
  }

  return {
    kept: keptUpdates.length,
    rejected: rejectedKeys.length
  };
}
