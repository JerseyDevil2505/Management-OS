// Single source for the Market Data effective-age formulas so the Market Data
// tab and the Class / Effective Age report never drift apart.

export const propertyQualifiesForEFA = (property) => {
  const typeUse = property?.asset_type_use;
  const buildingClass = property?.asset_building_class;

  if (!typeUse || String(typeUse).trim() === '') return false;
  if (!buildingClass || parseInt(buildingClass, 10) <= 10) return false;

  return true;
};

// BRT: outputs a calendar year (e.g. 2015)
// Microsystems: outputs an age in years (e.g. 10)
export const calculateRecommendedEFA = (property, vendorType, yearPriorToDueYear) => {
  if (!property?.values_norm_time) return null;

  const normTime = property.values_norm_time;
  const camaLand = property.values_cama_land || 0;
  const detItems = property.values_det_items || 0;
  const replCost = property.values_repl_cost || 0;

  if (replCost === 0) return null;

  const deprAge = (1 - ((normTime - camaLand - detItems) / replCost)) * 100;

  if (vendorType === 'Microsystems') return Math.round(deprAge);
  return Math.round(yearPriorToDueYear - deprAge);
};

// Stored override wins over the value carried in the data file.
export const resolveActualEFA = (property, storedRow, vendorType, yearPriorToDueYear) => {
  if (!propertyQualifiesForEFA(property)) return null;

  if (storedRow?.actual_efa !== null && storedRow?.actual_efa !== undefined) {
    return storedRow.actual_efa;
  }

  let efa = property?.asset_effective_age;
  if (typeof efa === 'string' && efa !== '') efa = parseFloat(efa);
  if (efa === '' || efa === null || efa === undefined || isNaN(efa)) return null;

  // Microsystems stores effective age as (yearPrior - age), which reads like a
  // year; convert it back to an age.
  if (vendorType === 'Microsystems' && yearPriorToDueYear) {
    return yearPriorToDueYear - efa;
  }
  return efa;
};
