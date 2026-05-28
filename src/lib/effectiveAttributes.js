// Effective-attribute derivation shared across every surface that reads
// per-property SFLA / card-status (Sales Review, Sales Pool, SalesComparisonTab,
// DetailedAppraisalGrid, etc.). Runs once in JobContainer; consumers read the
// `_effectiveSfla`, `_isMainCard`, `_baseKey`, `_cardCount`, `_additionalCardsCount`,
// and `_cardMode` markers stamped on each property.
//
// Two config inputs:
//   - market_land_valuation.basement_type_config     -> reduces SFLA per the
//     configured "subtract" basement codes (matches getAdjustedSFLA in
//     SalesComparisonTab).
//   - market_land_valuation.additional_card_handling_config = { mode }
//       'combine'  (default) -> main card's _effectiveSfla = sum of every sibling
//                               card's basement-adjusted SFLA. Additional cards
//                               keep their own basement-adjusted SFLA (consumers
//                               should filter by _isMainCard to dedupe).
//       'separate'           -> every card's _effectiveSfla is its OWN basement-
//                               adjusted SFLA, no sibling sum. Detailed grid +
//                               CME stop aggregating bath/bedroom/amenity rollups
//                               too — that branch is checked off _cardMode by the
//                               existing aggregate helpers in each consumer.

// Vendor-aware main-card check. Mirrors the inline helpers in
// SalesComparisonTab/DetailedAppraisalGrid/MarketDataTab/etc.
export const isMainCard = (cardValue, vendorType) => {
  const card = (cardValue || '').toString().trim();
  if (vendorType === 'Microsystems') {
    const u = card.toUpperCase();
    return u === 'M' || u === 'MAIN' || u === '';
  }
  // BRT default
  const n = parseInt(card, 10);
  return n === 1 || card === '' || Number.isNaN(n);
};

// Basement-aware adjusted SFLA for a single property. Mirrors the
// SalesComparisonTab.getAdjustedSFLA semantics so the derived field matches
// what the Sales Pool table has always shown.
export const getBasementAdjustedSFLA = (prop, basementTypeConfig, vendorType) => {
  if (!prop) return 0;
  const raw = Number(prop.asset_sfla);
  if (!Number.isFinite(raw) || raw <= 0) return Number(prop.asset_sfla) || 0;
  let sfla = raw;
  const codes = basementTypeConfig?.codes || {};
  const getMode = (code) => {
    if (!code) return null;
    return codes[String(code).trim().toUpperCase()]?.mode || null;
  };
  if (vendorType === 'BRT') {
    if (getMode(prop.fin_basement_code_1) === 'subtract') {
      sfla -= Number(prop.fin_basement_area_1) || 0;
    }
    if (getMode(prop.fin_basement_code_2) === 'subtract') {
      sfla -= Number(prop.fin_basement_area_2) || 0;
    }
  } else if (vendorType === 'Microsystems') {
    if (basementTypeConfig?.microsystemsMode === 'subtract' && prop.living_basement_area) {
      sfla -= Number(prop.living_basement_area) || 0;
    }
  }
  return Math.max(0, sfla);
};

// Stamp _baseKey, _isMainCard, _cardCount, _additionalCardsCount, _effectiveSfla,
// _cardMode onto each property. Returns a NEW array (does not mutate inputs).
// Cheap enough to re-run on every config change.
export const deriveEffectiveAttributes = (properties, marketLandData, vendorType) => {
  if (!properties || properties.length === 0) return properties || [];
  const basementCfg = marketLandData?.basement_type_config || null;
  const cardCfg = marketLandData?.additional_card_handling_config || null;
  const cardMode = cardCfg?.mode === 'separate' ? 'separate' : 'combine';

  // Group by base key (block-lot-qualifier) for sibling roll-ups.
  const groups = new Map();
  for (const p of properties) {
    const key = `${p.property_block || ''}|${p.property_lot || ''}|${p.property_qualifier || ''}`;
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(p);
  }

  return properties.map((p) => {
    const baseKey = `${p.property_block || ''}|${p.property_lot || ''}|${p.property_qualifier || ''}`;
    const siblings = groups.get(baseKey) || [p];
    const isMain = isMainCard(p.property_addl_card, vendorType);
    const additionalCount = siblings.filter(
      (s) => !isMainCard(s.property_addl_card, vendorType)
    ).length;

    let effectiveSfla;
    if (cardMode === 'separate' || siblings.length <= 1) {
      // Per-card basement-adjusted SFLA only.
      effectiveSfla = getBasementAdjustedSFLA(p, basementCfg, vendorType);
    } else if (isMain) {
      // Main card carries the sum of every sibling's basement-adjusted SFLA.
      effectiveSfla = siblings.reduce(
        (sum, s) => sum + getBasementAdjustedSFLA(s, basementCfg, vendorType),
        0
      );
    } else {
      // Additional cards keep their own value; consumers should filter by _isMainCard.
      effectiveSfla = getBasementAdjustedSFLA(p, basementCfg, vendorType);
    }

    return {
      ...p,
      _baseKey: baseKey,
      _isMainCard: isMain,
      _cardCount: siblings.length,
      _additionalCardsCount: additionalCount,
      _effectiveSfla: effectiveSfla,
      _cardMode: cardMode,
    };
  });
};
