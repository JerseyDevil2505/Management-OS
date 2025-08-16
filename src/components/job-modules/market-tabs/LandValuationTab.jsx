// LandValuationTab.jsx - BASE STRUCTURE
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Check, X, Plus, Search, TrendingUp, AlertCircle, 
  Calculator, Download, Trash2, RefreshCw, Filter, 
  Save, FileDown, ChevronDown, ChevronUp, MapPin, 
  Home, DollarSign 
} from 'lucide-react';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';

const LandValuationTab = ({
  properties,
  jobData,
  vendorType,
  marketLandData,
  onAnalysisUpdate
}) => {
  // ========== MAIN TAB STATE ==========
  const [activeSubTab, setActiveSubTab] = useState('land-rates');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  // ========== SPECIAL REGIONS CONFIG ==========
  const SPECIAL_REGIONS = [
    'Normal',
    'Pinelands',
    'Highlands', 
    'Coastal',
    'Wetlands',
    'Conservation',
    'Historic District',
    'Redevelopment Zone',
    'Transit Village'
  ];

  // ========== LAND RATES STATE ==========
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().getFullYear() - 5, 0, 1),
    end: new Date()
  });
  const [vacantSales, setVacantSales] = useState([]);
  const [includedSales, setIncludedSales] = useState(new Set());
  const [saleCategories, setSaleCategories] = useState({});
  const [specialRegions, setSpecialRegions] = useState({});
  const [landNotes, setLandNotes] = useState({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchFilters, setSearchFilters] = useState({
    class: '',
    block: '',
    lot: '',
    priceMin: '',
    priceMax: '',
    specialRegion: ''
  });
  const [searchResults, setSearchResults] = useState([]);
  const [selectedToAdd, setSelectedToAdd] = useState(new Set());
  
  // Cascade Configuration
  const [cascadeConfig, setCascadeConfig] = useState({
    prime: null,
    secondary: null,
    excess: null,
    residual: null
  });
  
  const cascadeBreaks = {
    primeMax: 1,
    secondaryMax: 5,
    excessMax: 10
  };
  
  // VCS Analysis
  const [showAllVCS, setShowAllVCS] = useState(false);
  const [vcsFilter, setVcsFilter] = useState('');
  const [bracketAnalysis, setBracketAnalysis] = useState({});

  // ========== ALLOCATION STUDY STATE ==========
  const [vacantTestSales, setVacantTestSales] = useState([]);
  const [improvedTestSales, setImprovedTestSales] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [allocationVcsFilter, setAllocationVcsFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [actualAllocations, setActualAllocations] = useState({});
  const [vcsSiteValues, setVcsSiteValues] = useState({});

  // ========== VCS SHEET STATE ==========
  const [vcsSheetData, setVcsSheetData] = useState({});
  const [vcsManualSiteValues, setVcsManualSiteValues] = useState({});
  const [vcsPropertyCounts, setVcsPropertyCounts] = useState({});
  const [vcsZoningData, setVcsZoningData] = useState({});
  const [vcsDescriptions, setVcsDescriptions] = useState({});

  // ========== ECONOMIC OBSOLESCENCE STATE ==========
  const [ecoObsFactors, setEcoObsFactors] = useState({});
  const [trafficLevels, setTrafficLevels] = useState({});
  const [computedAdjustments, setComputedAdjustments] = useState({});
  const [actualAdjustments, setActualAdjustments] = useState({});
  const [ecoObsFilter, setEcoObsFilter] = useState('');
  // ========== INITIALIZE FROM PROPS ==========
  useEffect(() => {
    if (!marketLandData) {
      setIsLoading(false);
      return;
    }

    // Restore all saved states from marketLandData
    if (marketLandData.raw_land_config) {
      if (marketLandData.raw_land_config.date_range) {
        setDateRange({
          start: new Date(marketLandData.raw_land_config.date_range.start),
          end: new Date(marketLandData.raw_land_config.date_range.end)
        });
      }
      if (marketLandData.raw_land_config.cascade_config) {
        setCascadeConfig(marketLandData.raw_land_config.cascade_config);
      }
    }

    if (marketLandData.vacant_sales_analysis?.sales) {
      const savedCategories = {};
      const savedNotes = {};
      const savedRegions = {};
      const savedIncluded = new Set();
      
      marketLandData.vacant_sales_analysis.sales.forEach(s => {
        if (s.category) savedCategories[s.id] = s.category;
        if (s.notes) savedNotes[s.id] = s.notes;
        if (s.special_region) savedRegions[s.id] = s.special_region;
        if (s.included) savedIncluded.add(s.id);
      });
      
      setSaleCategories(savedCategories);
      setLandNotes(savedNotes);
      setSpecialRegions(savedRegions);
      setIncludedSales(savedIncluded);
    }

    if (marketLandData.cascade_rates) {
      setCascadeConfig(marketLandData.cascade_rates);
    }

    if (marketLandData.allocation_study) {
      if (marketLandData.allocation_study.actual_allocations) {
        setActualAllocations(marketLandData.allocation_study.actual_allocations);
      }
      if (marketLandData.allocation_study.vcs_site_values) {
        setVcsSiteValues(marketLandData.allocation_study.vcs_site_values);
      }
    }

    if (marketLandData.vcs_sheet_data) {
      setVcsSheetData(marketLandData.vcs_sheet_data);
      if (marketLandData.vcs_sheet_data.manual_site_values) {
        setVcsManualSiteValues(marketLandData.vcs_sheet_data.manual_site_values);
      }
      if (marketLandData.vcs_sheet_data.descriptions) {
        setVcsDescriptions(marketLandData.vcs_sheet_data.descriptions);
      }
    }

    if (marketLandData.economic_obsolescence) {
      setEcoObsFactors(marketLandData.economic_obsolescence.factors || {});
      setTrafficLevels(marketLandData.economic_obsolescence.traffic_levels || {});
      setActualAdjustments(marketLandData.economic_obsolescence.actual_adjustments || {});
    }

    setLastSaved(marketLandData.updated_at ? new Date(marketLandData.updated_at) : null);
    setIsLoading(false);
  }, [marketLandData]);

  // ========== CALCULATE ACREAGE HELPER ==========
  const calculateAcreage = useCallback((property) => {
    return interpretCodes.getCalculatedAcreage(property, vendorType);
  }, [vendorType]);

  // ========== GET VCS DESCRIPTION HELPER ==========
  const getVCSDescription = useCallback((vcsCode) => {
    // First check manual descriptions
    if (vcsDescriptions[vcsCode]) {
      return vcsDescriptions[vcsCode];
    }
    
    // Then try to get from code definitions
    if (jobData?.parsed_code_definitions && vendorType) {
      if (vendorType === 'BRT') {
        const vcsSection = jobData.parsed_code_definitions.sections?.VCS;
        if (vcsSection && vcsSection[vcsCode]) {
          const vcsData = vcsSection[vcsCode];
          if (vcsData.MAP && vcsData.MAP['9']) {
            return vcsData.MAP['9'].DATA?.VALUE || vcsCode;
          }
        }
      } else if (vendorType === 'Microsystems') {
        const codes = jobData.parsed_code_definitions.codes;
        if (codes) {
          const vcsEntry = codes.find(c => 
            c.code && c.code.startsWith('210') && 
            c.code.includes(vcsCode)
          );
          if (vcsEntry) return vcsEntry.description;
        }
      }
    }
    
    return vcsCode; // Return code if no description found
  }, [jobData, vendorType, vcsDescriptions]);
// ========== LOAD DATA EFFECTS ==========
  useEffect(() => {
    if (properties && properties.length > 0) {
      filterVacantSales();
      performBracketAnalysis();
      loadVCSPropertyCounts();
    }
  }, [properties, dateRange]);

  useEffect(() => {
    if (activeSubTab === 'allocation' && cascadeConfig.prime) {
      loadAllocationStudyData();
    }
  }, [activeSubTab, cascadeConfig]);

  useEffect(() => {
    if (activeSubTab === 'eco-obs' && properties) {
      analyzeEconomicObsolescence();
    }
  }, [activeSubTab, properties]);

  // Auto-save every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      saveAnalysis();
    }, 30000);
    return () => clearInterval(interval);
  }, [cascadeConfig, landNotes, saleCategories, specialRegions, actualAllocations, vcsManualSiteValues, actualAdjustments, onAnalysisUpdate]);

  // ========== LAND RATES FUNCTIONS ==========
  const filterVacantSales = useCallback(() => {
    if (!properties) return;

    const vacant = properties.filter(prop => {
      // Include Class 1 (vacant) and 3B (qualified farmland)
      const isVacantClass = prop.property_m4_class === '1' || prop.property_m4_class === '3B';
      const hasValidSale = prop.sales_date && prop.sales_price && prop.sales_price > 0;
      const inDateRange = prop.sales_date >= dateRange.start.toISOString().split('T')[0] &&
                          prop.sales_date <= dateRange.end.toISOString().split('T')[0];
      
      // Check NU codes for valid sales
      const nu = prop.sales_nu || '';
      const validNu = !nu || nu === '' || nu === ' ' || nu === '00' || nu.trim() === '';
      
      return isVacantClass && hasValidSale && inDateRange && validNu;
    });

    const enriched = vacant.map(prop => {
      const packageData = checkForPackageSale(prop);
      const acres = calculateAcreage(prop);
      
      return {
        ...prop,
        packageData,
        totalAcres: parseFloat(acres),
        pricePerAcre: parseFloat(acres) > 0 ? Math.round(prop.sales_price / parseFloat(acres)) : 0
      };
    });

    setVacantSales(enriched);
    // Auto-include all new sales
    setIncludedSales(new Set(enriched.map(s => s.id)));
  }, [properties, dateRange, calculateAcreage]);

  const checkForPackageSale = (property) => {
    if (!properties || !property.sales_book || !property.sales_page) return null;

    const sameBookPage = properties.filter(p => 
      p.sales_book === property.sales_book && 
      p.sales_page === property.sales_page &&
      p.id !== property.id
    );

    if (sameBookPage.length === 0) return null;

    const totalPrice = sameBookPage.reduce((sum, p) => sum + (p.sales_price || 0), 0) + property.sales_price;
    const totalProps = sameBookPage.length + 1;

    return {
      is_package: true,
      package_count: totalProps,
      total_package_price: totalPrice,
      properties_in_package: sameBookPage.map(p => p.property_composite_key)
    };
  };

  const performBracketAnalysis = useCallback(() => {
    if (!properties) return;

    const vcsSales = {};

    properties.forEach(prop => {
      if (!prop.new_vcs || !prop.sales_price || prop.sales_price <= 0) return;
      // Only residential for bracket analysis
      if (prop.property_m4_class !== '2' && prop.property_m4_class !== '3A') return;
      
      const vcs = prop.new_vcs;
      if (!vcsSales[vcs]) {
        vcsSales[vcs] = [];
      }
      
      const acres = parseFloat(calculateAcreage(prop));
      
      vcsSales[vcs].push({
        acres,
        normalizedPrice: prop.values_norm_size || prop.sales_price,
        address: prop.property_location
      });
    });

    const analysis = {};

    Object.keys(vcsSales).forEach(vcs => {
      const sales = vcsSales[vcs];
      if (sales.length < 5) return; // Need minimum sales for analysis
      
      // Sort by acreage for bracketing
      sales.sort((a, b) => a.acres - b.acres);
      
      const brackets = {
        small: sales.filter(s => s.acres < 1),
        medium: sales.filter(s => s.acres >= 1 && s.acres < 5),
        large: sales.filter(s => s.acres >= 5 && s.acres < 10),
        xlarge: sales.filter(s => s.acres >= 10)
      };
      
      const avgPrice = (arr) => arr.length > 0 ? 
        arr.reduce((sum, s) => sum + s.normalizedPrice, 0) / arr.length : null;
      const avgAcres = (arr) => arr.length > 0 ? 
        arr.reduce((sum, s) => sum + s.acres, 0) / arr.length : null;
      
      let impliedRate = null;
      
      // Calculate implied rate from bracket differences
      if (brackets.small.length > 0 && brackets.medium.length > 0) {
        const priceDiff = avgPrice(brackets.medium) - avgPrice(brackets.small);
        const acresDiff = avgAcres(brackets.medium) - avgAcres(brackets.small);
        if (acresDiff > 0 && priceDiff > 0) {
          impliedRate = Math.round(priceDiff / acresDiff);
        }
      }
      
      // NULL for negative rates (don't poison averages)
      if (impliedRate && impliedRate < 0) {
        impliedRate = null;
      }
      
      analysis[vcs] = {
        totalSales: sales.length,
        brackets: {
          small: { 
            count: brackets.small.length, 
            avgAcres: avgAcres(brackets.small), 
            avgPrice: avgPrice(brackets.small) 
          },
          medium: { 
            count: brackets.medium.length, 
            avgAcres: avgAcres(brackets.medium), 
            avgPrice: avgPrice(brackets.medium) 
          },
          large: { 
            count: brackets.large.length, 
            avgAcres: avgAcres(brackets.large), 
            avgPrice: avgPrice(brackets.large) 
          },
          xlarge: { 
            count: brackets.xlarge.length, 
            avgAcres: avgAcres(brackets.xlarge), 
            avgPrice: avgPrice(brackets.xlarge) 
          }
        },
        impliedRate
      };
    });

    setBracketAnalysis(analysis);
  }, [properties, calculateAcreage]);

  const calculateRates = useCallback((regionFilter = null) => {
    const included = vacantSales.filter(s => {
      if (!includedSales.has(s.id)) return false;
      // Exclude special categories from rate calculation
      if (saleCategories[s.id] === 'wetlands' || 
          saleCategories[s.id] === 'landlocked' ||
          saleCategories[s.id] === 'conservation') return false;
      // Filter by special region if specified
      if (regionFilter && specialRegions[s.id] !== regionFilter) return false;
      return true;
    });

    if (included.length === 0) return { average: 0, median: 0, count: 0, min: 0, max: 0 };

    const rates = included.map(s => s.pricePerAcre).filter(r => r > 0);
    rates.sort((a, b) => a - b);

    const average = Math.round(rates.reduce((sum, r) => sum + r, 0) / rates.length);
    const median = rates.length % 2 === 0 ?
      Math.round((rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2) :
      rates[Math.floor(rates.length / 2)];
    const min = rates[0];
    const max = rates[rates.length - 1];

    return { average, median, count: included.length, min, max };
  }, [vacantSales, includedSales, saleCategories, specialRegions]);

  const searchProperties = () => {
    if (!properties) return;

    let results = properties;

    // Class filter - now includes multiple classes
    if (searchFilters.class) {
      results = results.filter(p => p.property_m4_class === searchFilters.class);
    } else {
      // Default to showing Classes 1, 2, and 3B (vacant, residential teardowns, farmland)
      results = results.filter(p => 
        p.property_m4_class === '1' || 
        p.property_m4_class === '2' || 
        p.property_m4_class === '3B'
      );
    }

    if (searchFilters.block) {
      results = results.filter(p => p.property_block?.toLowerCase().includes(searchFilters.block.toLowerCase()));
    }
    if (searchFilters.lot) {
      results = results.filter(p => p.property_lot?.toLowerCase().includes(searchFilters.lot.toLowerCase()));
    }
    if (searchFilters.priceMin) {
      results = results.filter(p => p.sales_price >= parseInt(searchFilters.priceMin));
    }
    if (searchFilters.priceMax) {
      results = results.filter(p => p.sales_price <= parseInt(searchFilters.priceMax));
    }
    if (searchFilters.specialRegion) {
      results = results.filter(p => specialRegions[p.id] === searchFilters.specialRegion);
    }

    // Exclude already added properties
    const existingIds = new Set(vacantSales.map(s => s.id));
    results = results.filter(p => {
      const inDateRange = p.sales_date >= dateRange.start.toISOString().split('T')[0] &&
                          p.sales_date <= dateRange.end.toISOString().split('T')[0];
      return inDateRange && !existingIds.has(p.id) && p.sales_price > 0;
    });

    setSearchResults(results.slice(0, 100)); // Limit to 100 results
  };

  const addSelectedProperties = () => {
    const toAdd = properties.filter(p => selectedToAdd.has(p.id));

    const enriched = toAdd.map(prop => {
      const acres = calculateAcreage(prop);
      return {
        ...prop,
        totalAcres: parseFloat(acres),
        pricePerAcre: parseFloat(acres) > 0 ? Math.round(prop.sales_price / parseFloat(acres)) : 0,
        manuallyAdded: true
      };
    });

    setVacantSales([...vacantSales, ...enriched]);
    setIncludedSales(new Set([...includedSales, ...toAdd.map(p => p.id)]));
    
    // Check if any are teardowns (Class 2)
    toAdd.forEach(p => {
      if (p.property_m4_class === '2') {
        setSaleCategories(prev => ({...prev, [p.id]: 'teardown'}));
      }
    });
    
    setSelectedToAdd(new Set());
    setShowAddModal(false);
    setSearchResults([]);
  };

const handlePropertyResearch = async (property) => {
  const prompt = `Analyze this land sale in ${jobData?.municipality || 'Unknown'}, ${jobData?.county || 'Unknown'} County, NJ:

Block ${property.property_block} Lot ${property.property_lot}
Address: ${property.property_location}
Sale Date: ${property.sales_date}
Sale Price: $${property.sales_price?.toLocaleString()}
Acres: ${property.totalAcres?.toFixed(2)}
Price/Acre: $${property.pricePerAcre?.toLocaleString()}
Class: ${property.property_m4_class === '2' ? 'Residential (possible teardown)' : property.property_m4_class}

Identify likely factors affecting this sale price (wetlands, access, zoning, teardown value, etc.). Be specific and actionable for valuation purposes. 2-3 sentences.`;

  try {
    await navigator.clipboard.writeText(prompt);
    
    // Update notes field with success message
    setLandNotes(prev => ({
      ...prev, 
      [property.id]: '📋 Prompt copied! Opening Claude.ai... Paste your prompt there, then paste the response back here.'
    }));
    
    // Show a temporary success notification (optional)
    const originalNotes = landNotes[property.id] || '';
    
    // Open Claude in a new tab
    window.open('https://claude.ai/new', '_blank');
    
    // After 5 seconds, update the message to remind them to paste the response
    setTimeout(() => {
      setLandNotes(prev => ({
        ...prev,
        [property.id]: prev[property.id]?.includes('📋') ? '[Paste Claude\'s response here]' : prev[property.id]
      }));
    }, 5000);
    
  } catch (err) {
    console.error('Failed to copy prompt:', err);
    
    // Fallback: put the prompt in the notes field so they can copy it manually
    setLandNotes(prev => ({
      ...prev, 
      [property.id]: `[Copy this prompt to Claude.ai]:\n${prompt}`
    }));
    
    // Still try to open Claude
    window.open('https://claude.ai/new', '_blank');
  }
};

  const removeSale = (saleId) => {
    setVacantSales(prev => prev.filter(s => s.id !== saleId));
    setIncludedSales(prev => {
      const newSet = new Set(prev);
      newSet.delete(saleId);
      return newSet;
    });
  };
  // ========== ALLOCATION STUDY FUNCTIONS ==========
  const loadAllocationStudyData = useCallback(() => {
    if (!cascadeConfig.prime) return;

    const processedVacant = [];
    const siteValuesByVCS = {};

    // Process vacant sales for allocation testing
    vacantSales.filter(s => includedSales.has(s.id)).forEach(sale => {
      const processed = processVacantSaleForAllocation(sale);
      processedVacant.push(processed);
      
      // Build site values by VCS
      if (sale.new_vcs && processed.calculatedSiteValue > 0) {
        if (!siteValuesByVCS[sale.new_vcs]) {
          siteValuesByVCS[sale.new_vcs] = {
            sales: [],
            avgSiteValue: 0,
            medianSiteValue: 0,
            count: 0
          };
        }
        siteValuesByVCS[sale.new_vcs].sales.push({
          siteValue: processed.calculatedSiteValue,
          year: new Date(sale.sales_date).getFullYear(),
          acres: processed.acres,
          address: sale.property_location
        });
      }
    });

    // Calculate average and median site values per VCS
    Object.keys(siteValuesByVCS).forEach(vcs => {
      const sales = siteValuesByVCS[vcs].sales;
      const siteValues = sales.map(s => s.siteValue).sort((a, b) => a - b);
      
      const avgSite = sales.reduce((sum, s) => sum + s.siteValue, 0) / sales.length;
      const medianSite = siteValues.length % 2 === 0 ?
        (siteValues[siteValues.length / 2 - 1] + siteValues[siteValues.length / 2]) / 2 :
        siteValues[Math.floor(siteValues.length / 2)];
      
      siteValuesByVCS[vcs].avgSiteValue = avgSite;
      siteValuesByVCS[vcs].medianSiteValue = medianSite;
      siteValuesByVCS[vcs].count = sales.length;
    });

    setVacantTestSales(processedVacant);
    setVcsSiteValues(siteValuesByVCS);
    loadImprovedSales(siteValuesByVCS);
  }, [cascadeConfig, vacantSales, includedSales]);

  const processVacantSaleForAllocation = (prop) => {
    const acres = prop.totalAcres || parseFloat(calculateAcreage(prop));
    const category = saleCategories[prop.id] || 'uncategorized';
    const specialRegion = specialRegions[prop.id] || 'Normal';

    // Apply cascade breaks to calculate land value
    let primeAcres = 0, secondaryAcres = 0, excessAcres = 0, residualAcres = 0;
    let remainingAcres = acres;

    // Prime acres (up to 1 acre)
    primeAcres = Math.min(remainingAcres, cascadeBreaks.primeMax);
    remainingAcres -= primeAcres;

    // Secondary acres (1-5 acres)
    if (remainingAcres > 0) {
      secondaryAcres = Math.min(remainingAcres, cascadeBreaks.secondaryMax - cascadeBreaks.primeMax);
      remainingAcres -= secondaryAcres;
    }

    // Excess acres (5-10 acres)
    if (remainingAcres > 0) {
      excessAcres = Math.min(remainingAcres, cascadeBreaks.excessMax - cascadeBreaks.secondaryMax);
      remainingAcres -= excessAcres;
    }

    // Residual acres (10+ acres)
    residualAcres = remainingAcres;

    const rawLandValue = 
      (primeAcres * (cascadeConfig.prime || 0)) +
      (secondaryAcres * (cascadeConfig.secondary || 0)) +
      (excessAcres * (cascadeConfig.excess || 0)) +
      (residualAcres * (cascadeConfig.residual || 0));

    const calculatedSiteValue = prop.sales_price - rawLandValue;
    const totalLandValue = rawLandValue + Math.max(0, calculatedSiteValue);
    const ratio = prop.sales_price > 0 ? totalLandValue / prop.sales_price : 0;

    return {
      ...prop,
      category,
      specialRegion,
      acres,
      primeAcres,
      secondaryAcres,
      excessAcres,
      residualAcres,
      rawLandValue,
      calculatedSiteValue,
      totalLandValue,
      ratio,
      ratioStatus: ratio >= 0.9 && ratio <= 1.1 ? 'good' : 
                   ratio >= 0.8 && ratio <= 1.2 ? 'warning' : 'error',
      saleYear: new Date(prop.sales_date).getFullYear()
    };
  };

  const loadImprovedSales = useCallback((siteValues) => {
    if (!properties || Object.keys(siteValues).length === 0) return;

    const vcsWithSites = Object.keys(siteValues);

    // Get improved sales in VCS areas with site values
    const improved = properties.filter(prop => {
      const isResidential = prop.property_m4_class === '2' || prop.property_m4_class === '3A';
      const hasValidSale = prop.sales_date && prop.sales_price && prop.sales_price > 0;
      const inTargetVCS = vcsWithSites.includes(prop.new_vcs);
      const hasBuilding = prop.asset_year_built && prop.asset_year_built > 0;
      const hasCurrentValues = prop.values_mod_land > 0 && prop.values_mod_total > 0;
      
      return isResidential && hasValidSale && inTargetVCS && hasBuilding && hasCurrentValues;
    }).slice(0, 200); // Limit for performance

    const processed = improved.map(prop => processImprovedSale(prop, siteValues));
    setImprovedTestSales(processed);
  }, [properties, calculateAcreage]);

  const processImprovedSale = (prop, siteValues) => {
    const acres = parseFloat(calculateAcreage(prop));
    const vcsData = siteValues[prop.new_vcs];
    const siteValue = vcsData?.avgSiteValue || 0;
    const specialRegion = specialRegions[prop.id] || 'Normal';

    // Apply cascade calculation
    let remainingAcres = acres;
    const primeAcres = Math.min(remainingAcres, cascadeBreaks.primeMax);
    remainingAcres -= primeAcres;

    const secondaryAcres = Math.min(remainingAcres, cascadeBreaks.secondaryMax - cascadeBreaks.primeMax);
    remainingAcres -= secondaryAcres;

    const excessAcres = Math.min(remainingAcres, cascadeBreaks.excessMax - cascadeBreaks.secondaryMax);
    remainingAcres -= excessAcres;

    const residualAcres = remainingAcres;

    const rawLandValue = 
      (primeAcres * (cascadeConfig.prime || 0)) +
      (secondaryAcres * (cascadeConfig.secondary || 0)) +
      (excessAcres * (cascadeConfig.excess || 0)) +
      (residualAcres * (cascadeConfig.residual || 0));

    const calculatedLandValue = rawLandValue + siteValue;
    
    // Use normalized price if available
    const salePrice = prop.values_norm_size || prop.sales_price;
    const recommendedAllocation = salePrice > 0 ? calculatedLandValue / salePrice : 0;
    
    const currentAllocation = (prop.values_mod_land && prop.values_mod_total > 0) ? 
                             prop.values_mod_land / prop.values_mod_total : 0;

    // Get actual allocation if manually entered
    const actualAlloc = actualAllocations[prop.id] ? parseFloat(actualAllocations[prop.id]) / 100 : null;

    return {
      ...prop,
      specialRegion,
      acres,
      primeAcres,
      secondaryAcres,
      excessAcres,
      residualAcres,
      rawLandValue,
      siteValue,
      calculatedLandValue,
      recommendedAllocation,
      currentAllocation,
      actualAllocation: actualAlloc,
      allocationDelta: recommendedAllocation - currentAllocation,
      allocationStatus: recommendedAllocation >= 0.25 && recommendedAllocation <= 0.40 ? 'good' :
                       recommendedAllocation >= 0.20 && recommendedAllocation <= 0.45 ? 'warning' : 'error',
      saleYear: new Date(prop.sales_date).getFullYear(),
      adjustedSalePrice: salePrice
    };
  };

  const getUniqueRegions = useCallback(() => {
    const regions = new Set(['Normal']);
    Object.values(specialRegions).forEach(r => regions.add(r));
    return Array.from(regions);
  }, [specialRegions]);

  const getUniqueYears = useCallback(() => {
    const years = new Set();
    [...vacantTestSales, ...improvedTestSales].forEach(sale => {
      if (sale.saleYear) years.add(sale.saleYear);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [vacantTestSales, improvedTestSales]);

  const getUniqueVCS = useCallback(() => {
    const vcs = new Set();
    [...vacantTestSales, ...improvedTestSales].forEach(sale => {
      if (sale.new_vcs) vcs.add(sale.new_vcs);
    });
    return Array.from(vcs).sort();
  }, [vacantTestSales, improvedTestSales]);

  const calculateAllocationStats = useCallback((region = null) => {
    let filtered = improvedTestSales;
    
    if (region && region !== 'all') {
      filtered = filtered.filter(s => s.specialRegion === region);
    }
    
    if (filtered.length === 0) return null;
    
    const allocations = filtered.map(s => s.recommendedAllocation * 100);
    const avg = allocations.reduce((sum, a) => sum + a, 0) / allocations.length;
    const within25to40 = allocations.filter(a => a >= 25 && a <= 40).length;
    const percentInRange = (within25to40 / allocations.length) * 100;
    
    return {
      averageAllocation: avg.toFixed(1),
      percentInTargetRange: percentInRange.toFixed(1),
      totalSales: filtered.length
    };
  }, [improvedTestSales]);
  // ========== VCS SHEET FUNCTIONS ==========
  const loadVCSPropertyCounts = useCallback(() => {
    if (!properties) return;

    const counts = {};
    const zoning = {};
    const mapPages = {};
    const keyPages = {};

    properties.forEach(prop => {
      if (!prop.new_vcs) return;
      
      if (!counts[prop.new_vcs]) {
        counts[prop.new_vcs] = {
          total: 0,
          residential: 0,
          commercial: 0,
          vacant: 0,
          condo: 0
        };
        zoning[prop.new_vcs] = new Set();
        mapPages[prop.new_vcs] = new Set();
        keyPages[prop.new_vcs] = new Set();
      }
      
      counts[prop.new_vcs].total++;
      
      // Count by property class
      if (prop.property_m4_class === '2' || prop.property_m4_class === '3A') {
        counts[prop.new_vcs].residential++;
      } else if (prop.property_m4_class === '4A' || prop.property_m4_class === '4B' || prop.property_m4_class === '4C') {
        counts[prop.new_vcs].commercial++;
      } else if (prop.property_m4_class === '1' || prop.property_m4_class === '3B') {
        counts[prop.new_vcs].vacant++;
      } else if (prop.property_m4_class === '4D') {
        counts[prop.new_vcs].condo++;
      }
      
      // Collect unique zoning codes
      if (prop.asset_zoning) {
        zoning[prop.new_vcs].add(prop.asset_zoning);
      }
      
      // Collect map and key pages
      if (prop.asset_map_page) {
        mapPages[prop.new_vcs].add(prop.asset_map_page);
      }
      if (prop.asset_key_page) {
        keyPages[prop.new_vcs].add(prop.asset_key_page);
      }
    });

    // Convert sets to formatted strings
    const formattedZoning = {};
    const formattedMapPages = {};
    const formattedKeyPages = {};
    
    Object.keys(zoning).forEach(vcs => {
      formattedZoning[vcs] = Array.from(zoning[vcs]).sort().join(', ');
      
      // Format map pages (e.g., "12-15, 18, 22-24")
      const pages = Array.from(mapPages[vcs]).map(p => parseInt(p)).filter(p => !isNaN(p)).sort((a, b) => a - b);
      formattedMapPages[vcs] = formatPageRanges(pages);
      
      const keys = Array.from(keyPages[vcs]).map(p => parseInt(p)).filter(p => !isNaN(p)).sort((a, b) => a - b);
      formattedKeyPages[vcs] = formatPageRanges(keys);
    });

    setVcsPropertyCounts(counts);
    setVcsZoningData(formattedZoning);
    
    // Store in vcsSheetData for display
    const sheetData = {};
    Object.keys(counts).forEach(vcs => {
      sheetData[vcs] = {
        counts: counts[vcs],
        zoning: formattedZoning[vcs],
        mapPages: formattedMapPages[vcs],
        keyPages: formattedKeyPages[vcs]
      };
    });
    
    setVcsSheetData(sheetData);
  }, [properties]);

  const formatPageRanges = (pages) => {
    if (pages.length === 0) return '';
    
    const ranges = [];
    let start = pages[0];
    let end = pages[0];
    
    for (let i = 1; i < pages.length; i++) {
      if (pages[i] === end + 1) {
        end = pages[i];
      } else {
        ranges.push(start === end ? `${start}` : `${start}-${end}`);
        start = pages[i];
        end = pages[i];
      }
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    
    return ranges.join(', ');
  };

  const calculateVCSSiteValue = useCallback((vcs, salePrice = null) => {
    if (!vcsSiteValues[vcs]) return { computed: 0, recommended: 0 };

    const avgSiteValue = vcsSiteValues[vcs].avgSiteValue;
    const computed = Math.round(avgSiteValue);

    // Round down to nearest $5,000 (conservative approach)
    const recommended = Math.floor(computed / 5000) * 5000;

    return { computed, recommended };
  }, [vcsSiteValues]);

  const updateManualSiteValue = (vcs, value) => {
    setVcsManualSiteValues(prev => ({
      ...prev,
      [vcs]: value ? parseInt(value) : null
    }));
  };

  const updateVCSDescription = (vcs, description) => {
    setVcsDescriptions(prev => ({
      ...prev,
      [vcs]: description
    }));
  };

  const getVCSCompleteness = useCallback((vcs) => {
    const hasDescription = !!vcsDescriptions[vcs] || !!getVCSDescription(vcs);
    const hasZoning = !!vcsZoningData[vcs];
    const hasSiteValue = !!vcsManualSiteValues[vcs] || !!vcsSiteValues[vcs];
    const hasCounts = !!vcsPropertyCounts[vcs];
    
    const total = 4;
    const complete = [hasDescription, hasZoning, hasSiteValue, hasCounts].filter(Boolean).length;
    
    return {
      percentage: (complete / total) * 100,
      missing: {
        description: !hasDescription,
        zoning: !hasZoning,
        siteValue: !hasSiteValue,
        counts: !hasCounts
      }
    };
  }, [vcsDescriptions, vcsZoningData, vcsManualSiteValues, vcsSiteValues, vcsPropertyCounts, getVCSDescription]);

  const calculateFrontFootRate = useCallback((vcs) => {
    // Only calculate if we have zoning data with minimum frontage
    const zoningStr = vcsZoningData[vcs];
    if (!zoningStr || !marketLandData?.zone_min_frontage) return null;
    
    const siteValue = vcsManualSiteValues[vcs] || vcsSiteValues[vcs]?.avgSiteValue;
    if (!siteValue) return null;
    
    // Get average frontage for properties in this VCS
    const vcsProperties = properties.filter(p => p.new_vcs === vcs && p.asset_lot_frontage > 0);
    if (vcsProperties.length === 0) return null;
    
    const avgFrontage = vcsProperties.reduce((sum, p) => sum + p.asset_lot_frontage, 0) / vcsProperties.length;
    const avgAcres = vcsProperties.reduce((sum, p) => sum + parseFloat(calculateAcreage(p)), 0) / vcsProperties.length;
    
    // Calculate front foot rate
    const rawLandComponent = avgAcres * (cascadeConfig.prime || 0);
    const totalValue = rawLandComponent + siteValue;
    const frontFootRate = Math.round(totalValue / avgFrontage);
    
    return {
      prime: frontFootRate,
      excess: Math.round(frontFootRate * 0.5) // Excess is typically 50% of prime
    };
  }, [vcsZoningData, marketLandData, vcsManualSiteValues, vcsSiteValues, properties, calculateAcreage, cascadeConfig]);

  const exportVCSSheet = () => {
    let csv = 'VCS VALUATION SHEET\n';
    csv += `Municipality: ${jobData?.municipality || ''}\n`;
    csv += `Date: ${new Date().toLocaleDateString()}\n\n`;
    
    csv += 'VCS,Description,Count,Res,Com,Vacant,Condo,Zoning,Map Pages,Key Pages,Site Value (Computed),Site Value (Recommended),Prime FF,Excess FF\n';
    
    Object.keys(vcsSheetData).sort().forEach(vcs => {
      const data = vcsSheetData[vcs];
      const description = vcsDescriptions[vcs] || getVCSDescription(vcs);
      const siteValues = calculateVCSSiteValue(vcs);
      const ffRates = calculateFrontFootRate(vcs);
      
      csv += `"${vcs}","${description}",${data.counts.total},${data.counts.residential},${data.counts.commercial},${data.counts.vacant},${data.counts.condo},"${data.zoning}","${data.mapPages}","${data.keyPages}",${siteValues.computed},${siteValues.recommended},${ffRates?.prime || ''},${ffRates?.excess || ''}\n`;
    });
    
    return csv;
  };
  // ========== ECONOMIC OBSOLESCENCE FUNCTIONS ==========
  const analyzeEconomicObsolescence = useCallback(() => {
    if (!properties) return;

    const factors = {};
    const computed = {};

    // Group properties by VCS and location factor
    properties.forEach(prop => {
      if (!prop.new_vcs || !prop.sales_price || prop.sales_price <= 0) return;
      
      const vcs = prop.new_vcs;
      const location = prop.location_analysis || 'None';
      
      if (!factors[vcs]) {
        factors[vcs] = {};
      }
      
      if (!factors[vcs][location]) {
        factors[vcs][location] = {
          withFactor: [],
          withoutFactor: []
        };
      }
      
      // Add to appropriate group
      if (location !== 'None') {
        factors[vcs][location].withFactor.push({
          id: prop.id,
          price: prop.sales_price,
          normalized: prop.values_norm_size || prop.sales_price,
          acres: parseFloat(calculateAcreage(prop)),
          address: prop.property_location,
          year: new Date(prop.sales_date).getFullYear()
        });
      }
    });

    // Find comparable sales without factors for each VCS
    Object.keys(factors).forEach(vcs => {
      // Get baseline sales (no location factors)
      const baselineSales = properties.filter(prop => 
        prop.new_vcs === vcs && 
        (!prop.location_analysis || prop.location_analysis === 'None') &&
        prop.sales_price > 0
      ).map(prop => ({
        id: prop.id,
        price: prop.sales_price,
        normalized: prop.values_norm_size || prop.sales_price,
        acres: parseFloat(calculateAcreage(prop)),
        year: new Date(prop.sales_date).getFullYear()
      }));
      
      // Store baseline for all location factors in this VCS
      Object.keys(factors[vcs]).forEach(location => {
        if (location !== 'None') {
          factors[vcs][location].withoutFactor = baselineSales;
        }
      });
    });

    // Calculate impact percentages
    Object.keys(factors).forEach(vcs => {
      computed[vcs] = {};
      
      Object.keys(factors[vcs]).forEach(location => {
        if (location === 'None') return;
        
        const withFactor = factors[vcs][location].withFactor;
        const withoutFactor = factors[vcs][location].withoutFactor;
        
        if (withFactor.length > 0 && withoutFactor.length > 0) {
          const avgWith = withFactor.reduce((sum, s) => sum + s.normalized, 0) / withFactor.length;
          const avgWithout = withoutFactor.reduce((sum, s) => sum + s.normalized, 0) / withoutFactor.length;
          
          const impact = ((avgWith - avgWithout) / avgWithout) * 100;
          
          computed[vcs][location] = {
            impact: impact.toFixed(1),
            sampleWith: withFactor.length,
            sampleWithout: withoutFactor.length,
            avgPriceWith: Math.round(avgWith),
            avgPriceWithout: Math.round(avgWithout)
          };
        }
      });
    });

    setComputedAdjustments(computed);
    setEcoObsFactors(factors);
    
    // Analyze and simplify traffic patterns
    analyzeTrafficPatterns();
  }, [properties, calculateAcreage]);

  const analyzeTrafficPatterns = useCallback(() => {
    if (!properties) return;
    
    const traffic = {};
    const patterns = {
      heavy: ['highway', 'interstate', 'i-78', 'i-287', 'route 22', 'route 202', 'major road', 'busy road'],
      medium: ['road', 'street', 'avenue', 'boulevard', 'moderate traffic'],
      light: ['residential', 'quiet', 'cul-de-sac', 'dead end', 'low traffic']
    };
    
    properties.forEach(prop => {
      if (prop.location_analysis) {
        const location = prop.location_analysis.toLowerCase();
        
        // Determine traffic level
        let level = 'light'; // Default
        
        if (patterns.heavy.some(pattern => location.includes(pattern))) {
          level = 'heavy';
        } else if (patterns.medium.some(pattern => location.includes(pattern))) {
          level = 'medium';
        }
        
        traffic[prop.id] = level;
      }
    });
    
    setTrafficLevels(traffic);
  }, [properties]);

  const updateActualAdjustment = (vcs, location, value) => {
    const key = `${vcs}_${location}`;
    setActualAdjustments(prev => ({
      ...prev,
      [key]: value ? parseFloat(value) : null
    }));
  };

  const getLocationFactorsByVCS = useCallback((vcs) => {
    if (!ecoObsFactors[vcs]) return [];
    
    return Object.keys(ecoObsFactors[vcs])
      .filter(loc => loc !== 'None')
      .map(location => {
        const computed = computedAdjustments[vcs]?.[location];
        const actual = actualAdjustments[`${vcs}_${location}`];
        
        return {
          location,
          computed: computed?.impact ? parseFloat(computed.impact) : null,
          actual: actual || null,
          sampleSize: computed?.sampleWith || 0,
          avgPriceWith: computed?.avgPriceWith || 0,
          avgPriceWithout: computed?.avgPriceWithout || 0
        };
      })
      .sort((a, b) => Math.abs(b.computed || 0) - Math.abs(a.computed || 0));
  }, [ecoObsFactors, computedAdjustments, actualAdjustments]);

  const getStandardAdjustments = useCallback(() => {
    // Standard adjustments based on common factors
    return {
      'Highway/Major Road': { min: -25, typical: -15, max: -10 },
      'Railroad': { min: -25, typical: -15, max: -10 },
      'Power Lines': { min: -20, typical: -10, max: -5 },
      'Pipeline': { min: -15, typical: -10, max: -5 },
      'Commercial Adjacent': { min: -20, typical: -10, max: -5 },
      'Industrial Adjacent': { min: -30, typical: -20, max: -10 },
      'Creek/Stream Front': { min: 0, typical: 5, max: 10 },
      'Pond/Lake Front': { min: 5, typical: 10, max: 15 },
      'River Front': { min: 5, typical: 10, max: 20 },
      'Golf Course': { min: 5, typical: 10, max: 15 },
      'Park Adjacent': { min: 0, typical: 5, max: 10 },
      'Cemetery Adjacent': { min: -15, typical: -10, max: -5 }
    };
  }, []);

  const calculateCombinedImpact = useCallback((propertyId) => {
    const property = properties?.find(p => p.id === propertyId);
    if (!property || !property.location_analysis) return 0;
    
    const location = property.location_analysis.toLowerCase();
    const standards = getStandardAdjustments();
    
    let totalImpact = 0;
    let factorCount = 0;
    
    // Check each standard factor
    Object.entries(standards).forEach(([factor, values]) => {
      if (location.includes(factor.toLowerCase())) {
        totalImpact += values.typical;
        factorCount++;
      }
    });
    
    // Apply maximum cap for negative adjustments
    if (totalImpact < -30) totalImpact = -30;
    // Apply maximum cap for positive adjustments
    if (totalImpact > 20) totalImpact = 20;
    
    return totalImpact;
  }, [properties, getStandardAdjustments]);

  const exportEconomicObsolescence = () => {
    let csv = 'ECONOMIC OBSOLESCENCE ANALYSIS\n';
    csv += `Municipality: ${jobData?.municipality || ''}\n`;
    csv += `Date: ${new Date().toLocaleDateString()}\n\n`;
    
    csv += 'VCS,Location Factor,Computed Impact %,Sample Size (With),Sample Size (Without),Avg Price With,Avg Price Without,Actual Adjustment %\n';
    
    Object.keys(computedAdjustments).sort().forEach(vcs => {
      Object.keys(computedAdjustments[vcs]).forEach(location => {
        const computed = computedAdjustments[vcs][location];
        const actual = actualAdjustments[`${vcs}_${location}`] || '';
        
        csv += `"${vcs}","${location}",${computed.impact},${computed.sampleWith},${computed.sampleWithout},${computed.avgPriceWith},${computed.avgPriceWithout},${actual}\n`;
      });
    });
    
    csv += '\n\nTRAFFIC LEVEL ANALYSIS\n';
    csv += 'Property,Traffic Level\n';
    
    const trafficCounts = { light: 0, medium: 0, heavy: 0 };
    Object.entries(trafficLevels).forEach(([propId, level]) => {
      trafficCounts[level]++;
    });
    
    csv += `Light Traffic,${trafficCounts.light}\n`;
    csv += `Medium Traffic,${trafficCounts.medium}\n`;
    csv += `Heavy Traffic,${trafficCounts.heavy}\n`;
    
    return csv;
  };
  // ========== SAVE & EXPORT FUNCTIONS ==========
  const saveAnalysis = async () => {
    if (!jobData?.id) return;

    setIsSaving(true);

    try {
      const analysisData = {
        job_id: jobData.id,
        valuation_method: 'acre', // Default to acre
        raw_land_config: {
          date_range: dateRange,
          cascade_config: cascadeConfig
        },
        vacant_sales_analysis: {
          sales: vacantSales.map(s => ({
            id: s.id,
            included: includedSales.has(s.id),
            category: saleCategories[s.id] || null,
            special_region: specialRegions[s.id] || 'Normal',
            notes: landNotes[s.id] || null,
            manually_added: s.manuallyAdded || false
          })),
          rates: calculateRates(),
          rates_by_region: getUniqueRegions().map(region => ({
            region,
            rates: calculateRates(region)
          }))
        },
        bracket_analysis: bracketAnalysis,
        cascade_rates: cascadeConfig,
        allocation_study: {
          vcs_site_values: vcsSiteValues,
          actual_allocations: actualAllocations,
          stats: calculateAllocationStats()
        },
        vcs_sheet_data: {
          property_counts: vcsPropertyCounts,
          zoning_data: vcsZoningData,
          manual_site_values: vcsManualSiteValues,
          descriptions: vcsDescriptions,
          sheet_data: vcsSheetData
        },
        economic_obsolescence: {
          factors: ecoObsFactors,
          traffic_levels: trafficLevels,
          computed_adjustments: computedAdjustments,
          actual_adjustments: actualAdjustments
        },
        updated_at: new Date().toISOString()
      };
      
      // Check if record exists
      const { data: existing } = await supabase
        .from('market_land_valuation')
        .select('id')
        .eq('job_id', jobData.id)
        .single();
      
      if (existing) {
        await supabase
          .from('market_land_valuation')
          .update(analysisData)
          .eq('job_id', jobData.id);
      } else {
        await supabase
          .from('market_land_valuation')
          .insert(analysisData);
      }
      
      setLastSaved(new Date());
      
      // Notify parent component
      if (onAnalysisUpdate) {
        onAnalysisUpdate(analysisData);
      }
    } catch (error) {
      console.error('Error saving:', error);
      alert('Failed to save analysis. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const exportToExcel = (type) => {
    let csv = '';
    const timestamp = new Date().toISOString().split('T')[0];
    const municipality = jobData?.municipality || 'export';
    const filename = `${type}_${municipality}_${timestamp}.csv`;

    if (type === 'land-rates') {
      csv = exportLandRates();
    } else if (type === 'allocation') {
      csv = exportAllocation();
    } else if (type === 'vcs-sheet') {
      csv = exportVCSSheet();
    } else if (type === 'eco-obs') {
      csv = exportEconomicObsolescence();
    } else if (type === 'complete') {
      csv = exportCompleteAnalysis();
    }

    // Create and download file
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const exportLandRates = () => {
    let csv = 'LAND RATES ANALYSIS\n';
    csv += `Municipality: ${jobData?.municipality || ''}\n`;
    csv += `Analysis Period: ${dateRange.start.toLocaleDateString()} to ${dateRange.end.toLocaleDateString()}\n\n`;
    
    // Summary by Region
    csv += 'SUMMARY BY SPECIAL REGION\n';
    csv += 'Region,Count,Average $/Acre,Median $/Acre,Min $/Acre,Max $/Acre\n';
    
    getUniqueRegions().forEach(region => {
      const rates = calculateRates(region);
      csv += `"${region}",${rates.count},${rates.average},${rates.median},${rates.min},${rates.max}\n`;
    });
    
    // Cascade Configuration
    csv += '\n\nCASCADE RATE CONFIGURATION\n';
    csv += `Prime (0-1 acre):,$${cascadeConfig.prime || 0}\n`;
    csv += `Secondary (1-5 acres):,$${cascadeConfig.secondary || 0}\n`;
    csv += `Excess (5-10 acres):,$${cascadeConfig.excess || 0}\n`;
    csv += `Residual (10+ acres):,$${cascadeConfig.residual || 0}\n`;
    
    // Individual Sales
    csv += '\n\nVACANT LAND SALES DETAIL\n';
    csv += 'Block,Lot,Address,VCS,Special Region,Category,Sale Date,Sale Price,Acres,$/Acre,Package,Included,Notes\n';
    
    vacantSales.forEach(sale => {
      const category = saleCategories[sale.id] || 'Uncategorized';
      const region = specialRegions[sale.id] || 'Normal';
      const isPackage = sale.packageData ? `Y (${sale.packageData.package_count})` : 'N';
      const included = includedSales.has(sale.id) ? 'Y' : 'N';
      const notes = landNotes[sale.id] || '';
      
      csv += `"${sale.property_block}","${sale.property_lot}","${sale.property_location}","${sale.new_vcs || ''}","${region}","${category}","${sale.sales_date}",${sale.sales_price},${sale.totalAcres?.toFixed(2)},${sale.pricePerAcre},"${isPackage}","${included}","${notes}"\n`;
    });
    
    // VCS Bracket Analysis
    csv += '\n\nVCS LOT SIZE BRACKET ANALYSIS\n';
    csv += 'VCS,Total Sales,<1 Acre,1-5 Acres,5-10 Acres,>10 Acres,Implied $/Acre\n';
    
    Object.entries(bracketAnalysis).sort(([a], [b]) => a.localeCompare(b)).forEach(([vcs, data]) => {
      const impliedRate = data.impliedRate !== null ? data.impliedRate : 'NULL';
      csv += `"${vcs}",${data.totalSales},${data.brackets.small.count},${data.brackets.medium.count},${data.brackets.large.count},${data.brackets.xlarge.count},${impliedRate}\n`;
    });
    
    return csv;
  };

  const exportAllocation = () => {
    let csv = 'ALLOCATION STUDY\n';
    csv += `Municipality: ${jobData?.municipality || ''}\n`;
    csv += `Date: ${new Date().toLocaleDateString()}\n\n`;
    
    // Stats by Region
    const regions = getUniqueRegions();
    if (regions.length > 1) {
      csv += 'ALLOCATION STATISTICS BY REGION\n';
      csv += 'Region,Avg Allocation %,% In Target Range (25-40%),Sample Size\n';
      
      regions.forEach(region => {
        const stats = calculateAllocationStats(region);
        if (stats) {
          csv += `"${region}",${stats.averageAllocation},${stats.percentInTargetRange},${stats.totalSales}\n`;
        }
      });
      csv += '\n';
    }
    
    // Vacant Land Test
    csv += 'VACANT LAND TEST\n';
    csv += 'Block,Lot,VCS,Special Region,Category,Year,Acres,Sale Price,Prime,Secondary,Excess,Residual,Raw Land,Site Value,Total Land,Ratio,Status\n';
    
    vacantTestSales.forEach(sale => {
      csv += `"${sale.property_block}","${sale.property_lot}","${sale.new_vcs || ''}","${sale.specialRegion}","${sale.category}",${sale.saleYear},${sale.acres.toFixed(2)},${sale.sales_price},${sale.primeAcres.toFixed(2)},${sale.secondaryAcres.toFixed(2)},${sale.excessAcres.toFixed(2)},${sale.residualAcres.toFixed(2)},${sale.rawLandValue.toFixed(0)},${sale.calculatedSiteValue.toFixed(0)},${sale.totalLandValue.toFixed(0)},${sale.ratio.toFixed(3)},"${sale.ratioStatus}"\n`;
    });
    
    // VCS Site Values Summary
    csv += '\n\nVCS SITE VALUES\n';
    csv += 'VCS,Count,Average Site Value,Median Site Value\n';
    
    Object.entries(vcsSiteValues).sort(([a], [b]) => a.localeCompare(b)).forEach(([vcs, data]) => {
      csv += `"${vcs}",${data.count},${Math.round(data.avgSiteValue)},${Math.round(data.medianSiteValue)}\n`;
    });
    
    // Improved Sales Test
    csv += '\n\nIMPROVED SALES ALLOCATION TEST\n';
    csv += 'Block,Lot,VCS,Year,Acres,Sale Price,Raw Land,Site Value,Total Land,Current %,Recommended %,Actual %,Delta\n';
    
    improvedTestSales.slice(0, 500).forEach(sale => {
      const actualAlloc = actualAllocations[sale.id] || '';
      csv += `"${sale.property_block}","${sale.property_lot}","${sale.new_vcs || ''}",${sale.saleYear},${sale.acres.toFixed(2)},${sale.adjustedSalePrice},${sale.rawLandValue.toFixed(0)},${sale.siteValue.toFixed(0)},${sale.calculatedLandValue.toFixed(0)},${(sale.currentAllocation * 100).toFixed(1)},${(sale.recommendedAllocation * 100).toFixed(1)},${actualAlloc},${(sale.allocationDelta * 100).toFixed(1)}\n`;
    });
    
    return csv;
  };

  const exportCompleteAnalysis = () => {
    let csv = 'COMPLETE LAND VALUATION ANALYSIS\n';
    csv += `Municipality: ${jobData?.municipality || ''}\n`;
    csv += `County: ${jobData?.county || ''}\n`;
    csv += `Generated: ${new Date().toLocaleString()}\n`;
    csv += '=' .repeat(80) + '\n\n';
    
    csv += exportLandRates();
    csv += '\n' + '=' .repeat(80) + '\n\n';
    csv += exportAllocation();
    csv += '\n' + '=' .repeat(80) + '\n\n';
    csv += exportVCSSheet();
    csv += '\n' + '=' .repeat(80) + '\n\n';
    csv += exportEconomicObsolescence();
    
    return csv;
  };
  // ========== RENDER LAND RATES TAB ==========
  const renderLandRatesTab = () => (
    <div style={{ padding: '20px' }}>
      {/* Header Controls */}
      <div style={{ marginBottom: '20px', backgroundColor: '#F9FAFB', padding: '15px', borderRadius: '8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: '15px', alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
              Start Date
            </label>
            <input
              type="date"
              value={dateRange.start.toISOString().split('T')[0]}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: new Date(e.target.value) }))}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #D1D5DB',
                borderRadius: '4px'
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
              End Date
            </label>
            <input
              type="date"
              value={dateRange.end.toISOString().split('T')[0]}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: new Date(e.target.value) }))}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #D1D5DB',
                borderRadius: '4px'
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setShowAddModal(true)}
              style={{
                backgroundColor: '#3B82F6',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Plus size={16} /> Add Property
            </button>
            <button
              onClick={() => exportToExcel('land-rates')}
              style={{
                backgroundColor: '#10B981',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Download size={16} /> Export
            </button>
          </div>
        </div>

        {/* Summary Statistics */}
        <div style={{ marginTop: '15px', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '15px' }}>
          {(() => {
            const rates = calculateRates();
            return (
              <>
                <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Total Sales</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold' }}>{vacantSales.length}</div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Included</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#10B981' }}>{includedSales.size}</div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Avg $/Acre</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold' }}>
                    ${rates.average?.toLocaleString() || '0'}
                  </div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Median $/Acre</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold' }}>
                    ${rates.median?.toLocaleString() || '0'}
                  </div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Range</div>
                  <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                    ${rates.min?.toLocaleString() || '0'} - ${rates.max?.toLocaleString() || '0'}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Cascade Rate Configuration */}
      <div style={{ marginBottom: '20px', backgroundColor: '#FEF3C7', padding: '15px', borderRadius: '8px' }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 'bold' }}>
          Cascade Rate Configuration (Per Acre)
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px' }}>
          <div>
            <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
              Prime (0-1 acre)
            </label>
            <input
              type="number"
              value={cascadeConfig.prime || ''}
              onChange={(e) => setCascadeConfig(prev => ({ ...prev, prime: e.target.value ? parseInt(e.target.value) : null }))}
              placeholder="Enter rate"
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #D1D5DB',
                borderRadius: '4px'
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
              Secondary (1-5 acres)
            </label>
            <input
              type="number"
              value={cascadeConfig.secondary || ''}
              onChange={(e) => setCascadeConfig(prev => ({ ...prev, secondary: e.target.value ? parseInt(e.target.value) : null }))}
              placeholder="Enter rate"
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #D1D5DB',
                borderRadius: '4px'
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
              Excess (5-10 acres)
            </label>
            <input
              type="number"
              value={cascadeConfig.excess || ''}
              onChange={(e) => setCascadeConfig(prev => ({ ...prev, excess: e.target.value ? parseInt(e.target.value) : null }))}
              placeholder="Enter rate"
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #D1D5DB',
                borderRadius: '4px'
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
              Residual (10+ acres)
            </label>
            <input
              type="number"
              value={cascadeConfig.residual || ''}
              onChange={(e) => setCascadeConfig(prev => ({ ...prev, residual: e.target.value ? parseInt(e.target.value) : null }))}
              placeholder="Enter rate"
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #D1D5DB',
                borderRadius: '4px'
              }}
            />
          </div>
        </div>
      </div>

      {/* Vacant Sales Table */}
      <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
        <div style={{ padding: '15px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>Vacant Land Sales</h3>
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '14px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Include</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Block/Lot</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Address</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>VCS</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Special Region</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Category</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Sale Date</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Sale Price</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Acres</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>$/Acre</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Package</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Notes</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {vacantSales.map((sale, index) => (
                <tr key={sale.id} style={{ backgroundColor: index % 2 === 0 ? 'white' : '#F9FAFB' }}>
                  <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                    <input
                      type="checkbox"
                      checked={includedSales.has(sale.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setIncludedSales(prev => new Set([...prev, sale.id]));
                        } else {
                          setIncludedSales(prev => {
                            const newSet = new Set(prev);
                            newSet.delete(sale.id);
                            return newSet;
                          });
                        }
                      }}
                    />
                  </td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                    {sale.property_block}/{sale.property_lot}
                  </td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                    {sale.property_location}
                  </td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                    {sale.new_vcs || '-'}
                  </td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                    <select
                      value={specialRegions[sale.id] || 'Normal'}
                      onChange={(e) => setSpecialRegions(prev => ({ ...prev, [sale.id]: e.target.value }))}
                      style={{
                        padding: '4px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px',
                        fontSize: '12px'
                      }}
                    >
                      {SPECIAL_REGIONS.map(region => (
                        <option key={region} value={region}>{region}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                    <select
                      value={saleCategories[sale.id] || 'uncategorized'}
                      onChange={(e) => setSaleCategories(prev => ({ ...prev, [sale.id]: e.target.value }))}
                      style={{
                        padding: '4px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px',
                        fontSize: '12px'
                      }}
                    >
                      <option value="uncategorized">Uncategorized</option>
                      <option value="raw_land">Raw Land</option>
                      <option value="wetlands">Wetlands</option>
                      <option value="landlocked">Landlocked</option>
                      <option value="conservation">Conservation</option>
                      <option value="teardown">Teardown</option>
                      <option value="package">Package Sale</option>
                    </select>
                  </td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                    {sale.sales_date}
                  </td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right' }}>
                    ${sale.sales_price?.toLocaleString()}
                  </td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right' }}>
                    {sale.totalAcres?.toFixed(2)}
                  </td>
                  <td style={{ 
                    padding: '8px', 
                    borderBottom: '1px solid #E5E7EB', 
                    textAlign: 'right',
                    fontWeight: 'bold',
                    color: sale.pricePerAcre > 100000 ? '#EF4444' : '#10B981'
                  }}>
                    ${sale.pricePerAcre?.toLocaleString()}
                  </td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'center' }}>
                    {sale.packageData && (
                      <span style={{
                        backgroundColor: '#FEE2E2',
                        color: '#DC2626',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px'
                      }}>
                        {sale.packageData.package_count}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                    <input
                      type="text"
                      value={landNotes[sale.id] || ''}
                      onChange={(e) => setLandNotes(prev => ({ ...prev, [sale.id]: e.target.value }))}
                      placeholder="Add notes..."
                      style={{
                        width: '200px',
                        padding: '4px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px',
                        fontSize: '12px'
                      }}
                    />
                  </td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                      <button
                        onClick={() => handlePropertyResearch(sale)}
                        title="Research with AI"
                        style={{
                          padding: '4px',
                          backgroundColor: '#8B5CF6',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        <Search size={14} />
                      </button>
                      <button
                        onClick={() => removeSale(sale.id)}
                        title="Remove"
                        style={{
                          padding: '4px',
                          backgroundColor: '#EF4444',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* VCS Bracket Analysis */}
      <div style={{ marginTop: '20px', backgroundColor: 'white', borderRadius: '8px', padding: '15px', border: '1px solid #E5E7EB' }}>
        <h3 style={{ margin: '0 0 15px 0', fontSize: '16px', fontWeight: 'bold' }}>
          VCS Lot Size Analysis (Method 2)
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '14px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ padding: '8px', textAlign: 'left' }}>VCS</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>Total Sales</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>&lt;1 Acre</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>1-5 Acres</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>5-10 Acres</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>&gt;10 Acres</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Implied $/Acre</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(bracketAnalysis)
                .filter(([vcs]) => !vcsFilter || vcs.includes(vcsFilter))
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([vcs, data], index) => (
                  <tr key={vcs} style={{ backgroundColor: index % 2 === 0 ? 'white' : '#F9FAFB' }}>
                    <td style={{ padding: '8px', fontWeight: 'bold' }}>{vcs}</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>{data.totalSales}</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>{data.brackets.small.count}</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>{data.brackets.medium.count}</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>{data.brackets.large.count}</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>{data.brackets.xlarge.count}</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>
                      {data.impliedRate !== null ? `$${data.impliedRate.toLocaleString()}` : 'NULL'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Property Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            width: '90%',
            maxWidth: '1200px',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ 
              padding: '20px', 
              borderBottom: '1px solid #E5E7EB',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>Add Properties to Analysis</h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setSearchResults([]);
                  setSelectedToAdd(new Set());
                }}
                style={{
                  padding: '4px',
                  backgroundColor: '#EF4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                <X size={20} />
              </button>
            </div>
            
            <div style={{ padding: '20px' }}>
              {/* Search Filters */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px', marginBottom: '20px' }}>
                <select
                  value={searchFilters.class}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, class: e.target.value }))}
                  style={{
                    padding: '8px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '4px'
                  }}
                >
                  <option value="">All Classes</option>
                  <option value="1">Class 1 - Vacant</option>
                  <option value="2">Class 2 - Residential</option>
                  <option value="3B">Class 3B - Farmland</option>
                </select>
                
                <input
                  type="text"
                  placeholder="Block"
                  value={searchFilters.block}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, block: e.target.value }))}
                  style={{
                    padding: '8px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '4px'
                  }}
                />
                
                <input
                  type="text"
                  placeholder="Lot"
                  value={searchFilters.lot}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, lot: e.target.value }))}
                  style={{
                    padding: '8px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '4px'
                  }}
                />
                
                <input
                  type="number"
                  placeholder="Min Price"
                  value={searchFilters.priceMin}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, priceMin: e.target.value }))}
                  style={{
                    padding: '8px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '4px'
                  }}
                />
                
                <input
                  type="number"
                  placeholder="Max Price"
                  value={searchFilters.priceMax}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, priceMax: e.target.value }))}
                  style={{
                    padding: '8px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '4px'
                  }}
                />
                
                <button
                  onClick={searchProperties}
                  style={{
                    backgroundColor: '#3B82F6',
                    color: 'white',
                    padding: '8px',
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px'
                  }}
                >
                  <Search size={16} /> Search
                </button>
              </div>
              
              {/* Search Results */}
              <div style={{ height: '400px', overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: '4px' }}>
                <table style={{ width: '100%', fontSize: '14px' }}>
                  <thead style={{ position: 'sticky', top: 0, backgroundColor: '#F9FAFB' }}>
                    <tr>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Select</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Block/Lot</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Address</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Class</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Sale Date</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Sale Price</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Acres</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map(prop => (
                      <tr key={prop.id}>
                        <td style={{ padding: '8px' }}>
                          <input
                            type="checkbox"
                            checked={selectedToAdd.has(prop.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedToAdd(prev => new Set([...prev, prop.id]));
                              } else {
                                setSelectedToAdd(prev => {
                                  const newSet = new Set(prev);
                                  newSet.delete(prop.id);
                                  return newSet;
                                });
                              }
                            }}
                          />
                        </td>
                        <td style={{ padding: '8px' }}>{prop.property_block}/{prop.property_lot}</td>
                        <td style={{ padding: '8px' }}>{prop.property_location}</td>
                        <td style={{ padding: '8px' }}>{prop.property_m4_class}</td>
                        <td style={{ padding: '8px' }}>{prop.sales_date}</td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>${prop.sales_price?.toLocaleString()}</td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>{calculateAcreage(prop)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#6B7280' }}>
                  {selectedToAdd.size} properties selected
                </span>
                <button
                  onClick={addSelectedProperties}
                  disabled={selectedToAdd.size === 0}
                  style={{
                    backgroundColor: selectedToAdd.size > 0 ? '#10B981' : '#D1D5DB',
                    color: 'white',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    border: 'none',
                    cursor: selectedToAdd.size > 0 ? 'pointer' : 'not-allowed'
                  }}
                >
                  Add Selected Properties
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
  // ========== RENDER ALLOCATION STUDY TAB ==========
  const renderAllocationStudyTab = () => (
    <div style={{ padding: '20px' }}>
      {/* Header Stats */}
      <div style={{ marginBottom: '20px', backgroundColor: '#F9FAFB', padding: '15px', borderRadius: '8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px' }}>
          {(() => {
            const stats = calculateAllocationStats();
            const regions = getUniqueRegions();
            return (
              <>
                <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Vacant Test Sales</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold' }}>{vacantTestSales.length}</div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Improved Test Sales</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold' }}>{improvedTestSales.length}</div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Avg Allocation</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold' }}>
                    {stats?.averageAllocation || '0'}%
                  </div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>In Target Range (25-40%)</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#10B981' }}>
                    {stats?.percentInTargetRange || '0'}%
                  </div>
                </div>
              </>
            );
          })()}
        </div>

        {/* Filters */}
        <div style={{ marginTop: '15px', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            style={{
              padding: '8px',
              border: '1px solid #D1D5DB',
              borderRadius: '4px'
            }}
          >
            <option value="all">All Regions</option>
            {getUniqueRegions().map(region => (
              <option key={region} value={region}>{region}</option>
            ))}
          </select>

          <select
            value={allocationVcsFilter}
            onChange={(e) => setAllocationVcsFilter(e.target.value)}
            style={{
              padding: '8px',
              border: '1px solid #D1D5DB',
              borderRadius: '4px'
            }}
          >
            <option value="all">All VCS</option>
            {getUniqueVCS().map(vcs => (
              <option key={vcs} value={vcs}>{vcs}</option>
            ))}
          </select>

          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            style={{
              padding: '8px',
              border: '1px solid #D1D5DB',
              borderRadius: '4px'
            }}
          >
            <option value="all">All Years</option>
            {getUniqueYears().map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>

          <button
            onClick={() => exportToExcel('allocation')}
            style={{
              marginLeft: 'auto',
              backgroundColor: '#10B981',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Download size={16} /> Export
          </button>
        </div>
      </div>

      {/* Stats by Special Region */}
      {getUniqueRegions().length > 1 && (
        <div style={{ marginBottom: '20px', backgroundColor: 'white', borderRadius: '8px', padding: '15px', border: '1px solid #E5E7EB' }}>
          <h3 style={{ margin: '0 0 15px 0', fontSize: '16px', fontWeight: 'bold' }}>
            Allocation Statistics by Special Region
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
            {getUniqueRegions().map(region => {
              const stats = calculateAllocationStats(region);
              if (!stats) return null;
              return (
                <div key={region} style={{ 
                  padding: '10px', 
                  backgroundColor: region === 'Normal' ? '#F0F9FF' : '#FEF3C7',
                  borderRadius: '4px',
                  border: `1px solid ${region === 'Normal' ? '#BFDBFE' : '#FDE68A'}`
                }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>{region}</div>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>
                    Avg: {stats.averageAllocation}% | In Range: {stats.percentInTargetRange}%
                  </div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                    Sample: {stats.totalSales} sales
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Vacant Land Test Table */}
      <div style={{ marginBottom: '20px', backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
        <div style={{ padding: '15px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>Vacant Land Test</h3>
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Block/Lot</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>VCS</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Region</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Category</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Year</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Acres</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Sale Price</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Raw Land</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Site Value</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Total Land</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Ratio</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {vacantTestSales
                .filter(sale => {
                  if (regionFilter !== 'all' && sale.specialRegion !== regionFilter) return false;
                  if (allocationVcsFilter !== 'all' && sale.new_vcs !== allocationVcsFilter) return false;
                  if (yearFilter !== 'all' && sale.saleYear.toString() !== yearFilter) return false;
                  return true;
                })
                .map((sale, index) => (
                  <tr key={sale.id} style={{ backgroundColor: index % 2 === 0 ? 'white' : '#F9FAFB' }}>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      {sale.property_block}/{sale.property_lot}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      {sale.new_vcs || '-'}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      <span style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        backgroundColor: sale.specialRegion === 'Normal' ? '#E0E7FF' : '#FEF3C7'
                      }}>
                        {sale.specialRegion}
                      </span>
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      {sale.category}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'center' }}>
                      {sale.saleYear}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right' }}>
                      {sale.acres.toFixed(2)}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right' }}>
                      ${sale.sales_price.toLocaleString()}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right' }}>
                      ${sale.rawLandValue.toLocaleString()}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right' }}>
                      ${sale.calculatedSiteValue.toLocaleString()}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right', fontWeight: 'bold' }}>
                      ${sale.totalLandValue.toLocaleString()}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'center' }}>
                      {sale.ratio.toFixed(3)}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'center' }}>
                      <span style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        backgroundColor: sale.ratioStatus === 'good' ? '#D1FAE5' : 
                                       sale.ratioStatus === 'warning' ? '#FEF3C7' : '#FEE2E2',
                        color: sale.ratioStatus === 'good' ? '#065F46' : 
                               sale.ratioStatus === 'warning' ? '#92400E' : '#991B1B'
                      }}>
                        {sale.ratioStatus === 'good' ? '✓' : sale.ratioStatus === 'warning' ? '!' : '✗'}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* VCS Site Values Summary */}
      <div style={{ marginBottom: '20px', backgroundColor: 'white', borderRadius: '8px', padding: '15px', border: '1px solid #E5E7EB' }}>
        <h3 style={{ margin: '0 0 15px 0', fontSize: '16px', fontWeight: 'bold' }}>
          VCS Site Values
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' }}>
          {Object.entries(vcsSiteValues)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([vcs, data]) => (
              <div key={vcs} style={{ 
                padding: '10px', 
                backgroundColor: '#F0F9FF',
                borderRadius: '4px',
                border: '1px solid #BFDBFE'
              }}>
                <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{vcs}</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#1E40AF' }}>
                  ${Math.round(data.avgSiteValue).toLocaleString()}
                </div>
                <div style={{ fontSize: '11px', color: '#6B7280' }}>
                  {data.count} sales
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Improved Sales Allocation Test */}
      <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
        <div style={{ padding: '15px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>
            Improved Sales Allocation Test
          </h3>
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Block/Lot</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Address</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>VCS</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Year</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Acres</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Sale Price</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Raw Land</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Site Value</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Total Land</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Current %</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Rec %</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Actual %</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Delta</th>
              </tr>
            </thead>
            <tbody>
              {improvedTestSales
                .filter(sale => {
                  if (regionFilter !== 'all' && sale.specialRegion !== regionFilter) return false;
                  if (allocationVcsFilter !== 'all' && sale.new_vcs !== allocationVcsFilter) return false;
                  if (yearFilter !== 'all' && sale.saleYear.toString() !== yearFilter) return false;
                  return true;
                })
                .slice(0, 100) // Limit for performance
                .map((sale, index) => (
                  <tr key={sale.id} style={{ backgroundColor: index % 2 === 0 ? 'white' : '#F9FAFB' }}>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      {sale.property_block}/{sale.property_lot}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', fontSize: '12px' }}>
                      {sale.property_location}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      {sale.new_vcs || '-'}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'center' }}>
                      {sale.saleYear}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right' }}>
                      {sale.acres.toFixed(2)}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right' }}>
                      ${sale.adjustedSalePrice.toLocaleString()}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right' }}>
                      ${sale.rawLandValue.toLocaleString()}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right' }}>
                      ${Math.round(sale.siteValue).toLocaleString()}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right', fontWeight: 'bold' }}>
                      ${sale.calculatedLandValue.toLocaleString()}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'center' }}>
                      {(sale.currentAllocation * 100).toFixed(1)}
                    </td>
                    <td style={{ 
                      padding: '8px', 
                      borderBottom: '1px solid #E5E7EB', 
                      textAlign: 'center',
                      fontWeight: 'bold',
                      backgroundColor: sale.allocationStatus === 'good' ? '#D1FAE5' : 
                                     sale.allocationStatus === 'warning' ? '#FEF3C7' : '#FEE2E2'
                    }}>
                      {(sale.recommendedAllocation * 100).toFixed(1)}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'center' }}>
                      <input
                        type="number"
                        value={actualAllocations[sale.id] || ''}
                        onChange={(e) => setActualAllocations(prev => ({ 
                          ...prev, 
                          [sale.id]: e.target.value 
                        }))}
                        placeholder="-"
                        style={{
                          width: '60px',
                          padding: '4px',
                          border: '1px solid #D1D5DB',
                          borderRadius: '4px',
                          fontSize: '12px',
                          textAlign: 'center'
                        }}
                      />
                    </td>
                    <td style={{ 
                      padding: '8px', 
                      borderBottom: '1px solid #E5E7EB', 
                      textAlign: 'center',
                      color: sale.allocationDelta > 0 ? '#10B981' : '#EF4444'
                    }}>
                      {sale.allocationDelta > 0 ? '+' : ''}{(sale.allocationDelta * 100).toFixed(1)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
  // ========== RENDER VCS SHEET TAB ==========
  const renderVCSSheetTab = () => (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>VCS Valuation Sheet</h3>
        <button
          onClick={() => exportToExcel('vcs-sheet')}
          style={{
            backgroundColor: '#10B981',
            color: 'white',
            padding: '8px 16px',
            borderRadius: '4px',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <Download size={16} /> Export Sheet
        </button>
      </div>

      <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#1E40AF', color: 'white' }}>
                <th style={{ padding: '10px', textAlign: 'left' }}>VCS</th>
                <th style={{ padding: '10px', textAlign: 'left' }}>Description</th>
                <th style={{ padding: '10px', textAlign: 'center' }}>Count</th>
                <th style={{ padding: '10px', textAlign: 'center' }}>Res</th>
                <th style={{ padding: '10px', textAlign: 'center' }}>Com</th>
                <th style={{ padding: '10px', textAlign: 'center' }}>Vacant</th>
                <th style={{ padding: '10px', textAlign: 'center' }}>Condo</th>
                <th style={{ padding: '10px', textAlign: 'left' }}>Zoning</th>
                <th style={{ padding: '10px', textAlign: 'left' }}>Map Pages</th>
                <th style={{ padding: '10px', textAlign: 'left' }}>Key Pages</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Site (Computed)</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Site (Recommended)</th>
                <th style={{ padding: '10px', textAlign: 'center' }}>Complete</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(vcsSheetData)
                .sort()
                .map((vcs, index) => {
                  const data = vcsSheetData[vcs];
                  const siteValues = calculateVCSSiteValue(vcs);
                  const completeness = getVCSCompleteness(vcs);
                  const description = vcsDescriptions[vcs] || getVCSDescription(vcs);
                  
                  return (
                    <tr key={vcs} style={{ backgroundColor: index % 2 === 0 ? 'white' : '#F9FAFB' }}>
                      <td style={{ padding: '10px', fontWeight: 'bold', borderBottom: '1px solid #E5E7EB' }}>
                        {vcs}
                      </td>
                      <td style={{ padding: '10px', borderBottom: '1px solid #E5E7EB' }}>
                        <input
                          type="text"
                          value={description}
                          onChange={(e) => updateVCSDescription(vcs, e.target.value)}
                          placeholder="Enter description..."
                          style={{
                            width: '100%',
                            padding: '4px',
                            border: '1px solid #D1D5DB',
                            borderRadius: '4px',
                            fontSize: '12px'
                          }}
                        />
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #E5E7EB', fontWeight: 'bold' }}>
                        {data.counts?.total || 0}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>
                        {data.counts?.residential || 0}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>
                        {data.counts?.commercial || 0}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>
                        {data.counts?.vacant || 0}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>
                        {data.counts?.condo || 0}
                      </td>
                      <td style={{ padding: '10px', borderBottom: '1px solid #E5E7EB', fontSize: '12px' }}>
                        {data.zoning || '-'}
                      </td>
                      <td style={{ padding: '10px', borderBottom: '1px solid #E5E7EB', fontSize: '12px' }}>
                        {data.mapPages || '-'}
                      </td>
                      <td style={{ padding: '10px', borderBottom: '1px solid #E5E7EB', fontSize: '12px' }}>
                        {data.keyPages || '-'}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>
                        ${siteValues.computed.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>
                        <input
                          type="number"
                          value={vcsManualSiteValues[vcs] || siteValues.recommended}
                          onChange={(e) => updateManualSiteValue(vcs, e.target.value)}
                          style={{
                            width: '100px',
                            padding: '4px',
                            border: '1px solid #D1D5DB',
                            borderRadius: '4px',
                            fontSize: '12px',
                            textAlign: 'right',
                            fontWeight: 'bold'
                          }}
                        />
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>
                        <div style={{
                          width: '60px',
                          height: '8px',
                          backgroundColor: '#E5E7EB',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          margin: '0 auto'
                        }}>
                          <div style={{
                            width: `${completeness.percentage}%`,
                            height: '100%',
                            backgroundColor: completeness.percentage === 100 ? '#10B981' : 
                                           completeness.percentage >= 75 ? '#F59E0B' : '#EF4444'
                          }} />
                        </div>
                        <span style={{ fontSize: '10px', color: '#6B7280' }}>
                          {completeness.percentage}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Front Foot Rate Conversion (if zoning data available) */}
      {Object.keys(vcsZoningData).some(vcs => vcsZoningData[vcs]) && (
        <div style={{ marginTop: '20px', backgroundColor: '#FEF3C7', padding: '15px', borderRadius: '8px' }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 'bold' }}>
            Front Foot Rate Conversion
          </h3>
          <div style={{ fontSize: '12px', color: '#92400E', marginBottom: '10px' }}>
            Note: Front foot rates are only calculated where zoning data is available
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
            {Object.keys(vcsSheetData)
              .filter(vcs => vcsZoningData[vcs])
              .map(vcs => {
                const ffRates = calculateFrontFootRate(vcs);
                if (!ffRates) return null;
                
                return (
                  <div key={vcs} style={{ 
                    padding: '10px', 
                    backgroundColor: 'white',
                    borderRadius: '4px',
                    border: '1px solid #FDE68A'
                  }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>{vcs}</div>
                    <div style={{ fontSize: '12px' }}>
                      Prime FF: ${ffRates.prime.toLocaleString()}
                    </div>
                    <div style={{ fontSize: '12px' }}>
                      Excess FF: ${ffRates.excess.toLocaleString()}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );

  // ========== RENDER ECONOMIC OBSOLESCENCE TAB ==========
  const renderEconomicObsolescenceTab = () => (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>Economic Obsolescence Analysis</h3>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            placeholder="Filter VCS..."
            value={ecoObsFilter}
            onChange={(e) => setEcoObsFilter(e.target.value)}
            style={{
              padding: '8px',
              border: '1px solid #D1D5DB',
              borderRadius: '4px',
              width: '200px'
            }}
          />
          <button
            onClick={() => exportToExcel('eco-obs')}
            style={{
              backgroundColor: '#10B981',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Download size={16} /> Export
          </button>
        </div>
      </div>

      {/* Standard Adjustments Reference */}
      <div style={{ marginBottom: '20px', backgroundColor: '#F9FAFB', padding: '15px', borderRadius: '8px' }}>
        <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold' }}>
          Standard Adjustment Ranges
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px', fontSize: '12px' }}>
          {Object.entries(getStandardAdjustments()).map(([factor, values]) => (
            <div key={factor} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{factor}:</span>
              <span style={{ 
                fontWeight: 'bold',
                color: values.typical < 0 ? '#DC2626' : '#10B981'
              }}>
                {values.typical > 0 ? '+' : ''}{values.typical}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Traffic Level Summary */}
      <div style={{ marginBottom: '20px', backgroundColor: 'white', borderRadius: '8px', padding: '15px', border: '1px solid #E5E7EB' }}>
        <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold' }}>
          Traffic Level Distribution
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          {(() => {
            const counts = { light: 0, medium: 0, heavy: 0 };
            Object.values(trafficLevels).forEach(level => counts[level]++);
            const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
            
            return (
              <>
                <div style={{ 
                  padding: '10px', 
                  backgroundColor: '#D1FAE5',
                  borderRadius: '4px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '12px', color: '#065F46' }}>Light Traffic</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{counts.light}</div>
                  <div style={{ fontSize: '11px', color: '#6B7280' }}>
                    {total > 0 ? ((counts.light / total) * 100).toFixed(1) : 0}%
                  </div>
                </div>
                <div style={{ 
                  padding: '10px', 
                  backgroundColor: '#FEF3C7',
                  borderRadius: '4px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '12px', color: '#92400E' }}>Medium Traffic</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{counts.medium}</div>
                  <div style={{ fontSize: '11px', color: '#6B7280' }}>
                    {total > 0 ? ((counts.medium / total) * 100).toFixed(1) : 0}%
                  </div>
                </div>
                <div style={{ 
                  padding: '10px', 
                  backgroundColor: '#FEE2E2',
                  borderRadius: '4px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '12px', color: '#991B1B' }}>Heavy Traffic</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{counts.heavy}</div>
                  <div style={{ fontSize: '11px', color: '#6B7280' }}>
                    {total > 0 ? ((counts.heavy / total) * 100).toFixed(1) : 0}%
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Location Factor Analysis by VCS */}
      <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
        <div style={{ padding: '15px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' }}>
          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold' }}>
            Location Factor Impact Analysis
          </h4>
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>VCS</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Location Factor</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Sample Size</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Avg Price (With)</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Avg Price (Without)</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Computed Impact</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Actual Adjustment</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(computedAdjustments)
                .filter(vcs => !ecoObsFilter || vcs.includes(ecoObsFilter))
                .sort()
                .map(vcs => {
                  const factors = getLocationFactorsByVCS(vcs);
                  if (factors.length === 0) return null;
                  
                  return factors.map((factor, index) => (
                    <tr key={`${vcs}-${factor.location}`} style={{ 
                      backgroundColor: index % 2 === 0 ? 'white' : '#F9FAFB' 
                    }}>
                      <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', fontWeight: 'bold' }}>
                        {index === 0 ? vcs : ''}
                      </td>
                      <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                        {factor.location}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>
                        {factor.sampleSize}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>
                        ${factor.avgPriceWith.toLocaleString()}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>
                        ${factor.avgPriceWithout.toLocaleString()}
                      </td>
                      <td style={{ 
                        padding: '8px', 
                        textAlign: 'center', 
                        borderBottom: '1px solid #E5E7EB',
                        fontWeight: 'bold',
                        color: factor.computed < 0 ? '#DC2626' : factor.computed > 0 ? '#10B981' : '#6B7280'
                      }}>
                        {factor.computed !== null ? `${factor.computed > 0 ? '+' : ''}${factor.computed}%` : 'N/A'}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>
                        <input
                          type="number"
                          value={factor.actual || ''}
                          onChange={(e) => updateActualAdjustment(vcs, factor.location, e.target.value)}
                          placeholder="-"
                          style={{
                            width: '60px',
                            padding: '4px',
                            border: '1px solid #D1D5DB',
                            borderRadius: '4px',
                            fontSize: '12px',
                            textAlign: 'center'
                          }}
                        />
                      </td>
                    </tr>
                  ));
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ========== MAIN RENDER ==========
  if (isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        padding: '40px',
        color: '#6B7280'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '10px' }}>Loading saved analysis...</div>
          <div style={{ fontSize: '12px' }}>This may take a moment for large datasets</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* Tab Navigation */}
      <div style={{ 
        display: 'flex', 
        gap: '10px', 
        borderBottom: '2px solid #E5E7EB', 
        marginBottom: '20px' 
      }}>
        {[
          { id: 'land-rates', label: 'Land Rates', icon: <TrendingUp size={16} /> },
          { id: 'allocation', label: 'Allocation Study', icon: <Calculator size={16} />, disabled: !cascadeConfig.prime },
          { id: 'vcs-sheet', label: 'VCS Sheet', icon: <Home size={16} />, disabled: !vcsSiteValues || Object.keys(vcsSiteValues).length === 0 },
          { id: 'eco-obs', label: 'Economic Obsolescence', icon: <MapPin size={16} /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => !tab.disabled && setActiveSubTab(tab.id)}
            disabled={tab.disabled}
            style={{
              padding: '10px 20px',
              backgroundColor: activeSubTab === tab.id ? '#3B82F6' : 'white',
              color: activeSubTab === tab.id ? 'white' : tab.disabled ? '#9CA3AF' : '#6B7280',
              border: 'none',
              borderRadius: '4px 4px 0 0',
              cursor: tab.disabled ? 'not-allowed' : 'pointer',
              fontWeight: '500',
              opacity: tab.disabled ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => exportToExcel('complete')}
            style={{
              backgroundColor: '#8B5CF6',
              color: 'white',
              padding: '8px 12px',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '14px'
            }}
          >
            <FileDown size={16} /> Export All
          </button>
          <button
            onClick={() => saveAnalysis()}
            disabled={isSaving}
            style={{
              backgroundColor: '#10B981',
              color: 'white',
              padding: '8px 12px',
              borderRadius: '4px',
              border: 'none',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '14px',
              opacity: isSaving ? 0.5 : 1
            }}
          >
            <Save size={16} /> {isSaving ? 'Saving...' : 'Save'}
          </button>
          {lastSaved && (
            <span style={{ fontSize: '12px', color: '#6B7280' }}>
              Last saved: {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Tab Content */}
      {activeSubTab === 'land-rates' && renderLandRatesTab()}
      {activeSubTab === 'allocation' && renderAllocationStudyTab()}
      {activeSubTab === 'vcs-sheet' && renderVCSSheetTab()}
      {activeSubTab === 'eco-obs' && renderEconomicObsolescenceTab()}
    </div>
  );
};

export default LandValuationTab;

  


