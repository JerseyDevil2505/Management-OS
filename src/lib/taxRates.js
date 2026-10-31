import { supabase } from './supabaseClient';

// Mirrors RatableComparisonTab.projectedRatableBase so the roster's estimated
// rate matches the Tax Rate Calculator to the penny. Keep the two in sync.
const projectedRatableTotal = (properties, vendorType, projected6Overrides) => {
  const grouped = {};
  properties.forEach(property => {
    const baseKey = `${property.property_block}-${property.property_lot}-${property.property_qualifier || 'NONE'}-${property.property_location || 'NONE'}`;
    const card = property.property_addl_card;
    const isMainCard = vendorType === 'BRT'
      ? (!card || card === '1')
      : (!card || card.toUpperCase() === 'M');
    if (isMainCard) grouped[baseKey] = property;
  });

  let total = 0;
  Object.values(grouped).forEach(property => {
    if (!property.property_composite_key || property.property_facility === 'EXEMPT') return;
    const cls = property.property_m4_class || property.property_cama_class || '';
    if (['1', '2', '3A', '3B', '4A', '4B', '4C'].includes(cls)) {
      total += property.values_cama_total || 0;
    } else if (['6A', '6B'].includes(cls)) {
      const override = projected6Overrides[property.property_composite_key];
      total += (override !== null && override !== undefined)
        ? (parseFloat(override) || 0)
        : (property.values_cama_land || 0) * ((property.values_cama_improvement || 0) / 100);
    }
  });
  return total;
};

// Rates are per $100 of assessed value, as entered on Ratable Comparison.
export const loadRosterTaxRates = async ({ jobId, properties, vendorType }) => {
  const [{ data: job, error: jobErr }, { data: overrides, error: ovErr }] = await Promise.all([
    supabase.from('jobs').select('rate_calc_budget, rate_calc_current_rate, rate_calc_buffer_for_loss').eq('id', jobId).single(),
    supabase.from('final_valuation_data').select('property_composite_key, projected_6_override')
      .eq('job_id', jobId).not('projected_6_override', 'is', null)
  ]);
  if (jobErr) throw jobErr;
  if (ovErr) throw ovErr;

  const overrideMap = {};
  (overrides || []).forEach(o => { overrideMap[o.property_composite_key] = o.projected_6_override; });

  const budget = Number(job?.rate_calc_budget) || 0;
  const buffer = Number(job?.rate_calc_buffer_for_loss) || 0;
  const netRatables = projectedRatableTotal(properties || [], vendorType, overrideMap) * (1 - buffer / 100);

  return {
    current_total_rate: Number(job?.rate_calc_current_rate) || 0,
    projected_total_rate: budget && netRatables > 0 ? Math.round((budget / netRatables) * 100 * 1000) / 1000 : 0
  };
};
