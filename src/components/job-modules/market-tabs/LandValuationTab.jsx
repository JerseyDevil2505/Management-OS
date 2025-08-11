import React, { useState, useEffect } from 'react';
import { Check, X, Plus, Search, TrendingUp, AlertCircle, Calculator, Download, Trash2, RefreshCw, Filter } from 'lucide-react';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';

const LandValuationTab = ({ properties, jobData, vendorType }) => {
  // Main tab state
  const [activeSubTab, setActiveSubTab] = useState('land-rates');
  
  // ========== LAND RATES SUB-TAB STATE ==========
  const [valuationMethod, setValuationMethod] = useState(null);
  const [dateRange, setDateRange] = useState({ 
    start: new Date(new Date().getFullYear() - 5, 0, 1),
    end: new Date() 
  });
  
  // Vacant Sales State
  const [vacantSales, setVacantSales] = useState([]);
  const [includedSales, setIncludedSales] = useState(new Set());
  const [saleCategories, setSaleCategories] = useState({});
  const [landNotes, setLandNotes] = useState({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchFilters, setSearchFilters] = useState({
    class: '',
    block: '',
    lot: ''
  });
  const [searchResults, setSearchResults] = useState([]);
  const [selectedToAdd, setSelectedToAdd] = useState(new Set());
  
  // VCS Bracketing State
  const [showAllVCS, setShowAllVCS] = useState(false);
  const [vcsFilter, setVcsFilter] = useState('');
  const [bracketAnalysis, setBracketAnalysis] = useState({});
  
  // Front Foot Configuration
  const [frontFootConfig, setFrontFootConfig] = useState({
    primeFrontage: 100,
    depthTable: '100FT'
  });
  
  // Cascade Configuration
  const [cascadeConfig, setCascadeConfig] = useState({
    prime: null,
    secondary: null,
    excess: null,
    residual: null
  });
  
  // Test Calculator State
  const [testAcres, setTestAcres] = useState('');
  const [testFrontage, setTestFrontage] = useState('');
  
  // ========== ALLOCATION STUDY SUB-TAB STATE ==========
  const [vacantTestSales, setVacantTestSales] = useState([]);
  const [improvedTestSales, setImprovedTestSales] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [allocationVcsFilter, setAllocationVcsFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [actualAllocations, setActualAllocations] = useState({});
  const [vcsSiteValues, setVcsSiteValues] = useState({});
  
  // ========== SHARED STATE ==========
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Cascade breakpoints (shared)
  const cascadeBreaks = {
    primeMax: 1,
    secondaryMax: 5,
    excessMax: 10
  };

  // ========== LOAD SAVED DATA ==========
  useEffect(() => {
    const loadSavedAnalysis = async () => {
      if (!jobData?.id) return;
      
      try {
        const { data, error } = await supabase
          .from('market_land_valuation')
          .select('*')
          .eq('job_id', jobData.id)
          .single();
        
        if (data && !error) {
          // Restore valuation method
          if (data.valuation_method) {
            setValuationMethod(data.valuation_method);
          }
          
          // Restore configurations
          if (data.raw_land_config) {
            if (data.raw_land_config.date_range) {
              setDateRange({
                start: new Date(data.raw_land_config.date_range.start),
                end: new Date(data.raw_land_config.date_range.end)
              });
            }
            if (data.raw_land_config.cascade_config) {
              setCascadeConfig(data.raw_land_config.cascade_config);
            }
            if (data.raw_land_config.front_foot_config) {
              setFrontFootConfig(data.raw_land_config.front_foot_config);
            }
          }
          
          // Restore vacant sales analysis
          if (data.vacant_sales_analysis?.sales) {
            const savedCategories = {};
            const savedNotes = {};
            const savedIncluded = new Set();
            
            data.vacant_sales_analysis.sales.forEach(s => {
              if (s.category) savedCategories[s.id] = s.category;
              if (s.notes) savedNotes[s.id] = s.notes;
              if (s.included) savedIncluded.add(s.id);
            });
            
            setSaleCategories(savedCategories);
            setLandNotes(savedNotes);
            setIncludedSales(savedIncluded);
          }
          
          // Restore cascade rates if they exist
          if (data.cascade_rates) {
            setCascadeConfig(data.cascade_rates);
          }
          
          // Restore allocation study
          if (data.allocation_study) {
            if (data.allocation_study.actual_allocations) {
              setActualAllocations(data.allocation_study.actual_allocations);
            }
            if (data.allocation_study.vcs_site_values) {
              setVcsSiteValues(data.allocation_study.vcs_site_values);
            }
          }
          
          setLastSaved(data.updated_at ? new Date(data.updated_at) : null);
        }
      } catch (error) {
        console.error('Error loading saved analysis:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadSavedAnalysis();
  }, [jobData?.id]);

  // Load data when properties change or method selected
  useEffect(() => {
    if (properties && valuationMethod) {
      filterVacantSales();
      performBracketAnalysis();
    }
  }, [properties, valuationMethod, dateRange]);

  // Load allocation study data when switching to that tab
  useEffect(() => {
    if (activeSubTab === 'allocation' && properties && cascadeConfig.prime) {
      loadAllocationStudyData();
    }
  }, [activeSubTab, cascadeConfig]);

  // Auto-save every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (valuationMethod) {
        saveAnalysis();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [valuationMethod, cascadeConfig, landNotes, saleCategories, actualAllocations]);

  // ========== LAND RATES FUNCTIONS ==========
  const filterVacantSales = () => {
    if (!properties) return;
    
    const vacant = properties.filter(prop => {
      const isVacantClass = prop.property_m4_class === '1' || prop.property_m4_class === '3B';
      const hasValidSale = prop.sales_date && prop.sales_price && prop.sales_price > 0;
      const inDateRange = prop.sales_date >= dateRange.start.toISOString().split('T')[0] &&
                          prop.sales_date <= dateRange.end.toISOString().split('T')[0];
      
      const nu = prop.sales_nu || '';
      const validNu = !nu || nu === '' || nu === ' ' || nu === '00' || nu.trim() === '';
      
      return isVacantClass && hasValidSale && inDateRange && validNu;
    });
    
    const enriched = vacant.map(prop => {
      const packageData = interpretCodes.getPackageSaleData?.(properties, prop);
      
      let totalAcres = prop.asset_lot_acre || 0;
      let totalSf = prop.asset_lot_sf || 0;
      
      if (packageData && packageData.is_land_only) {
        totalAcres = packageData.combined_lot_acres;
        totalSf = packageData.combined_lot_sf;
      }
      
      const totalInAcres = totalAcres + (totalSf / 43560);
      
      return {
        ...prop,
        packageData,
        totalAcres: totalInAcres,
        pricePerAcre: totalInAcres > 0 ? (prop.sales_price / totalInAcres) : 0,
        included: true
      };
    });
    
    setVacantSales(enriched);
    
    const included = new Set(enriched.map(s => s.id));
    setIncludedSales(included);
  };

  const performBracketAnalysis = () => {
    if (!properties) return;
    
    const vcsSales = {};
    
    properties.forEach(prop => {
      if (!prop.new_vcs || !prop.sales_price || prop.sales_price <= 0) return;
      if (prop.property_m4_class !== '2' && prop.property_m4_class !== '3A') return;
      if (!prop.values_norm_size) return;
      
      const vcs = prop.new_vcs;
      if (!vcsSales[vcs]) {
        vcsSales[vcs] = [];
      }
      
      const acres = (prop.asset_lot_acre || 0) + ((prop.asset_lot_sf || 0) / 43560);
      
      vcsSales[vcs].push({
        acres,
        normalizedPrice: prop.values_norm_size,
        address: prop.property_location
      });
    });
    
    const analysis = {};
    
    Object.keys(vcsSales).forEach(vcs => {
      const sales = vcsSales[vcs];
      if (sales.length < 5) return;
      
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
      
      if (brackets.small.length > 0 && brackets.medium.length > 0) {
        const priceDiff = avgPrice(brackets.medium) - avgPrice(brackets.small);
        const acresDiff = avgAcres(brackets.medium) - avgAcres(brackets.small);
        if (acresDiff > 0) {
          impliedRate = priceDiff / acresDiff;
        }
      }
      
      analysis[vcs] = {
        totalSales: sales.length,
        brackets: {
          small: { count: brackets.small.length, avgAcres: avgAcres(brackets.small), avgPrice: avgPrice(brackets.small) },
          medium: { count: brackets.medium.length, avgAcres: avgAcres(brackets.medium), avgPrice: avgPrice(brackets.medium) },
          large: { count: brackets.large.length, avgAcres: avgAcres(brackets.large), avgPrice: avgPrice(brackets.large) },
          xlarge: { count: brackets.xlarge.length, avgAcres: avgAcres(brackets.xlarge), avgPrice: avgPrice(brackets.xlarge) }
        },
        impliedRate
      };
    });
    
    setBracketAnalysis(analysis);
  };

  const searchProperties = () => {
    if (!properties) return;
    
    let results = properties;
    
    if (searchFilters.class) {
      results = results.filter(p => p.property_m4_class === searchFilters.class);
    }
    if (searchFilters.block) {
      results = results.filter(p => p.property_block?.includes(searchFilters.block));
    }
    if (searchFilters.lot) {
      results = results.filter(p => p.property_lot?.includes(searchFilters.lot));
    }
    
    const existingIds = new Set(vacantSales.map(s => s.id));
    results = results.filter(p => {
      const inDateRange = p.sales_date >= dateRange.start.toISOString().split('T')[0] &&
                          p.sales_date <= dateRange.end.toISOString().split('T')[0];
      return inDateRange && !existingIds.has(p.id) && p.sales_price > 0;
    });
    
    setSearchResults(results.slice(0, 50));
  };

  const addSelectedProperties = () => {
    const toAdd = properties.filter(p => selectedToAdd.has(p.id));
    
    const enriched = toAdd.map(prop => {
      const totalAcres = (prop.asset_lot_acre || 0) + ((prop.asset_lot_sf || 0) / 43560);
      return {
        ...prop,
        totalAcres,
        pricePerAcre: totalAcres > 0 ? (prop.sales_price / totalAcres) : 0,
        included: true,
        manuallyAdded: true
      };
    });
    
    setVacantSales([...vacantSales, ...enriched]);
    setIncludedSales(new Set([...includedSales, ...toAdd.map(p => p.id)]));
    setSelectedToAdd(new Set());
    setShowAddModal(false);
    setSearchResults([]);
  };

  const calculateRates = () => {
    const included = vacantSales.filter(s => 
      includedSales.has(s.id) && 
      saleCategories[s.id] !== 'wetlands' && 
      saleCategories[s.id] !== 'landlocked'
    );
    
    if (included.length === 0) return { average: 0, median: 0, count: 0 };
    
    const rates = included.map(s => s.pricePerAcre).filter(r => r > 0);
    rates.sort((a, b) => a - b);
    
    const average = rates.reduce((sum, r) => sum + r, 0) / rates.length;
    const median = rates.length % 2 === 0 ?
      (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2 :
      rates[Math.floor(rates.length / 2)];
    
    return { average, median, count: included.length };
  };

  const generateRecommendation = () => {
    const vacantRates = calculateRates();
    const vcsWithGoodData = Object.keys(bracketAnalysis).filter(vcs => 
      bracketAnalysis[vcs].totalSales >= 10 && bracketAnalysis[vcs].impliedRate
    );
    
    const categoryCounts = {
      raw_land: vacantSales.filter(s => saleCategories[s.id] === 'raw_land').length,
      building_lot: vacantSales.filter(s => saleCategories[s.id] === 'building_lot').length,
      wetlands: vacantSales.filter(s => saleCategories[s.id] === 'wetlands').length,
      other: vacantSales.filter(s => !saleCategories[s.id] || saleCategories[s.id] === 'other').length
    };
    
    let confidence = 'LOW';
    let message = '';
    let recommendedPrime = 0;
    
    if (categoryCounts.raw_land >= 5) {
      confidence = 'HIGH';
      message = `Strong vacant land evidence with ${categoryCounts.raw_land} clean sales. Using vacant land average of $${vacantRates.average.toLocaleString()}/acre.`;
      recommendedPrime = vacantRates.average;
    } else if (vcsWithGoodData.length >= 3) {
      confidence = 'MEDIUM';
      const avgImplied = vcsWithGoodData.reduce((sum, vcs) => 
        sum + bracketAnalysis[vcs].impliedRate, 0) / vcsWithGoodData.length;
      message = `Limited vacant sales but strong bracketing data from ${vcsWithGoodData.length} VCS areas. Using implied rate of $${avgImplied.toLocaleString()}/acre.`;
      recommendedPrime = avgImplied;
    } else {
      confidence = 'LOW';
      message = `Insufficient data for confident recommendation. Only ${vacantRates.count} usable vacant sales and limited bracketing data. Manual review recommended.`;
      recommendedPrime = vacantRates.average || 50000;
    }
    
    const recommendedSecondary = recommendedPrime * 0.67;
    const recommendedExcess = recommendedPrime * 0.33;
    const recommendedResidual = recommendedPrime * 0.15;
    
    return {
      confidence,
      message,
      prime: recommendedPrime,
      secondary: recommendedSecondary,
      excess: recommendedExcess,
      residual: recommendedResidual
    };
  };

  const convertRates = (acreRate) => {
    if (!acreRate) return { acre: 0, sf: 0, ff: 0 };
    
    const sfRate = acreRate / 43560;
    const typicalFrontage = 100;
    const typicalAcres = 0.459;
    const ffRate = (acreRate * typicalAcres) / typicalFrontage;
    
    return {
      acre: acreRate,
      sf: sfRate,
      ff: ffRate
    };
  };

  const calculateTestValues = () => {
    if (!testAcres || !cascadeConfig.prime) return null;
    
    const acres = parseFloat(testAcres);
    const rates = convertRates(cascadeConfig.prime);
    
    let value = 0;
    
    if (acres <= 1) {
      value = acres * cascadeConfig.prime;
    } else if (acres <= 5) {
      value = cascadeConfig.prime + ((acres - 1) * (cascadeConfig.secondary || cascadeConfig.prime * 0.67));
    } else if (acres <= 10) {
      value = cascadeConfig.prime + (4 * (cascadeConfig.secondary || cascadeConfig.prime * 0.67)) + 
              ((acres - 5) * (cascadeConfig.excess || cascadeConfig.prime * 0.33));
    } else {
      value = cascadeConfig.prime + (4 * (cascadeConfig.secondary || cascadeConfig.prime * 0.67)) + 
              (5 * (cascadeConfig.excess || cascadeConfig.prime * 0.33)) +
              ((acres - 10) * (cascadeConfig.residual || cascadeConfig.prime * 0.15));
    }
    
    return {
      acreMethod: value,
      sfMethod: acres * 43560 * rates.sf,
      ffMethod: testFrontage ? parseFloat(testFrontage) * rates.ff : null
    };
  };

  // ========== ALLOCATION STUDY FUNCTIONS ==========
  const loadAllocationStudyData = async () => {
    if (!cascadeConfig.prime) return;
    
    // Get saved vacant sales with categories
    const savedSales = vacantSales.filter(s => includedSales.has(s.id));
    
    // Process vacant sales for allocation study
    const processedVacant = [];
    const siteValuesByVCS = {};
    
    savedSales.forEach(sale => {
      const processed = processVacantSaleForAllocation(sale);
      processedVacant.push(processed);
      
      if (sale.new_vcs && processed.calculatedSiteValue > 0) {
        if (!siteValuesByVCS[sale.new_vcs]) {
          siteValuesByVCS[sale.new_vcs] = {
            sales: [],
            avgSiteValue: 0
          };
        }
        siteValuesByVCS[sale.new_vcs].sales.push({
          siteValue: processed.calculatedSiteValue,
          year: new Date(sale.sales_date).getFullYear(),
          acres: processed.acres
        });
      }
    });
    
    // Calculate average site values per VCS
    Object.keys(siteValuesByVCS).forEach(vcs => {
      const sales = siteValuesByVCS[vcs].sales;
      const avgSite = sales.reduce((sum, s) => sum + s.siteValue, 0) / sales.length;
      siteValuesByVCS[vcs].avgSiteValue = avgSite;
    });
    
    setVacantTestSales(processedVacant);
    setVcsSiteValues(siteValuesByVCS);
    
    // Load improved sales
    loadImprovedSales(siteValuesByVCS);
  };

  const processVacantSaleForAllocation = (prop) => {
    const acres = prop.totalAcres || ((prop.asset_lot_acre || 0) + ((prop.asset_lot_sf || 0) / 43560));
    const category = saleCategories[prop.id] || 'uncategorized';
    
    let primeAcres = 0, secondaryAcres = 0, excessAcres = 0, residualAcres = 0;
    let remainingAcres = acres;
    
    primeAcres = Math.min(remainingAcres, cascadeBreaks.primeMax);
    remainingAcres -= primeAcres;
    
    if (remainingAcres > 0) {
      secondaryAcres = Math.min(remainingAcres, cascadeBreaks.secondaryMax - cascadeBreaks.primeMax);
      remainingAcres -= secondaryAcres;
    }
    
    if (remainingAcres > 0) {
      excessAcres = Math.min(remainingAcres, cascadeBreaks.excessMax - cascadeBreaks.secondaryMax);
      remainingAcres -= excessAcres;
    }
    
    residualAcres = remainingAcres;
    
    const primeValue = primeAcres * (cascadeConfig.prime || 0);
    const secondaryValue = secondaryAcres * (cascadeConfig.secondary || 0);
    const excessValue = excessAcres * (cascadeConfig.excess || 0);
    const residualValue = residualAcres * (cascadeConfig.residual || 0);
    const rawLandValue = primeValue + secondaryValue + excessValue + residualValue;
    
    const calculatedSiteValue = prop.sales_price - rawLandValue;
    const ratio = prop.sales_price > 0 ? (rawLandValue + calculatedSiteValue) / prop.sales_price : 0;
    
    return {
      ...prop,
      category,
      acres,
      primeAcres,
      secondaryAcres,
      excessAcres,
      residualAcres,
      primeValue,
      secondaryValue,
      excessValue,
      residualValue,
      rawLandValue,
      calculatedSiteValue,
      totalLandValue: rawLandValue + Math.max(0, calculatedSiteValue),
      ratio,
      ratioStatus: getRatioStatus(ratio),
      saleYear: new Date(prop.sales_date).getFullYear()
    };
  };

  const loadImprovedSales = (siteValues) => {
    if (!properties) return;
    
    const vcsWithSites = Object.keys(siteValues);
    if (vcsWithSites.length === 0) return;
    
    const yearsWithSales = [...new Set(vacantTestSales.map(s => 
      new Date(s.sales_date).getFullYear()
    ))];
    
    const improved = properties.filter(prop => {
      const isResidential = prop.property_m4_class === '2' || prop.property_m4_class === '3A';
      const hasValidSale = prop.sales_date && prop.sales_price && prop.sales_price > 0;
      const saleYear = prop.sales_date ? new Date(prop.sales_date).getFullYear() : 0;
      
      const inTargetVCS = vcsWithSites.includes(prop.new_vcs);
      const inTargetYear = yearsWithSales.includes(saleYear) || 
                          yearsWithSales.includes(saleYear - 1) ||
                          yearsWithSales.includes(saleYear + 1);
      
      const hasBuilding = prop.asset_building_class && 
                         parseInt(prop.asset_building_class) > 10 &&
                         prop.asset_design_style && 
                         prop.asset_type_use;
      
      const hasCurrentValues = prop.values_mod_land > 0 && prop.values_mod_total > 0;
      
      return isResidential && hasValidSale && inTargetVCS && inTargetYear && hasBuilding && hasCurrentValues;
    }).slice(0, 50);
    
    const processed = improved.map(prop => processImprovedSale(prop, siteValues));
    setImprovedTestSales(processed);
  };

  const processImprovedSale = (prop, siteValues) => {
    const acres = (prop.asset_lot_acre || 0) + ((prop.asset_lot_sf || 0) / 43560);
    const vcsData = siteValues[prop.new_vcs];
    const siteValue = vcsData?.avgSiteValue || 0;
    
    let primeAcres = 0, secondaryAcres = 0, excessAcres = 0, residualAcres = 0;
    let remainingAcres = acres;
    
    primeAcres = Math.min(remainingAcres, cascadeBreaks.primeMax);
    remainingAcres -= primeAcres;
    
    if (remainingAcres > 0) {
      secondaryAcres = Math.min(remainingAcres, cascadeBreaks.secondaryMax - cascadeBreaks.primeMax);
      remainingAcres -= secondaryAcres;
    }
    
    if (remainingAcres > 0) {
      excessAcres = Math.min(remainingAcres, cascadeBreaks.excessMax - cascadeBreaks.secondaryMax);
      remainingAcres -= excessAcres;
    }
    
    residualAcres = remainingAcres;
    
    const rawLandValue = (primeAcres * (cascadeConfig.prime || 0)) +
                        (secondaryAcres * (cascadeConfig.secondary || 0)) +
                        (excessAcres * (cascadeConfig.excess || 0)) +
                        (residualAcres * (cascadeConfig.residual || 0));
    
    const calculatedLandValue = rawLandValue + siteValue;
    
    const recommendedAllocation = prop.sales_price > 0 ? calculatedLandValue / prop.sales_price : 0;
    const currentAllocation = (prop.values_mod_land && prop.values_mod_total > 0) ? 
                             prop.values_mod_land / prop.values_mod_total : 0;
    
    const impliedBuildingValue = prop.sales_price - calculatedLandValue;
    
    return {
      ...prop,
      acres,
      rawLandValue,
      siteValue,
      calculatedLandValue,
      impliedBuildingValue,
      recommendedAllocation,
      currentAllocation,
      allocationDelta: recommendedAllocation - currentAllocation,
      allocationStatus: getAllocationStatus(recommendedAllocation),
      saleYear: new Date(prop.sales_date).getFullYear()
    };
  };

  const getRatioStatus = (ratio) => {
    if (ratio >= 0.9 && ratio <= 1.1) return 'good';
    if (ratio >= 0.8 && ratio <= 1.2) return 'warning';
    return 'error';
  };

  const getAllocationStatus = (allocation) => {
    if (allocation >= 0.25 && allocation <= 0.40) return 'good';
    if (allocation >= 0.20 && allocation <= 0.45) return 'warning';
    return 'error';
  };

  const recalculateAllocation = () => {
    const recalcVacant = [];
    const siteValuesByVCS = {};
    
    vacantTestSales.forEach(sale => {
      const processed = processVacantSaleForAllocation(sale);
      recalcVacant.push(processed);
      
      if (sale.new_vcs && processed.calculatedSiteValue > 0) {
        if (!siteValuesByVCS[sale.new_vcs]) {
          siteValuesByVCS[sale.new_vcs] = {
            sales: [],
            avgSiteValue: 0
          };
        }
        siteValuesByVCS[sale.new_vcs].sales.push({
          siteValue: processed.calculatedSiteValue,
          year: processed.saleYear,
          acres: processed.acres
        });
      }
    });
    
    Object.keys(siteValuesByVCS).forEach(vcs => {
      const sales = siteValuesByVCS[vcs].sales;
      const avgSite = sales.reduce((sum, s) => sum + s.siteValue, 0) / sales.length;
      siteValuesByVCS[vcs].avgSiteValue = avgSite;
    });
    
    setVacantTestSales(recalcVacant);
    setVcsSiteValues(siteValuesByVCS);
    
    const recalcImproved = improvedTestSales.map(sale => 
      processImprovedSale(sale, siteValuesByVCS)
    );
    setImprovedTestSales(recalcImproved);
  };

  const getFilteredVacantTestSales = () => {
    let filtered = vacantTestSales;
    
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(s => s.category === categoryFilter);
    }
    if (allocationVcsFilter !== 'all') {
      filtered = filtered.filter(s => s.new_vcs === allocationVcsFilter);
    }
    if (yearFilter !== 'all') {
      filtered = filtered.filter(s => s.saleYear === parseInt(yearFilter));
    }
    
    return filtered;
  };

  const getFilteredImprovedSales = () => {
    let filtered = improvedTestSales;
    
    if (allocationVcsFilter !== 'all') {
      filtered = filtered.filter(s => s.new_vcs === allocationVcsFilter);
    }
    if (yearFilter !== 'all') {
      filtered = filtered.filter(s => s.saleYear === parseInt(yearFilter));
    }
    
    return filtered;
  };

  const calculateAllocationStats = () => {
    const filteredVacant = getFilteredVacantTestSales();
    const filteredImproved = getFilteredImprovedSales();
    
    const vacantRatios = filteredVacant.map(s => s.ratio);
    const vacantGood = vacantRatios.filter(r => r >= 0.9 && r <= 1.1).length;
    const vacantWarning = vacantRatios.filter(r => (r >= 0.8 && r < 0.9) || (r > 1.1 && r <= 1.2)).length;
    
    const improvedAllocations = filteredImproved.map(s => s.recommendedAllocation);
    const improvedGood = improvedAllocations.filter(a => a >= 0.25 && a <= 0.40).length;
    const improvedWarning = improvedAllocations.filter(a => (a >= 0.20 && a < 0.25) || (a > 0.40 && a <= 0.45)).length;
    
    const withCurrentValues = filteredImproved.filter(s => s.currentAllocation > 0);
    const avgCurrentAllocation = withCurrentValues.length > 0 ?
      withCurrentValues.reduce((sum, s) => sum + s.currentAllocation, 0) / withCurrentValues.length : 0;
    
    return {
      vacant: {
        total: filteredVacant.length,
        good: vacantGood,
        warning: vacantWarning,
        error: filteredVacant.length - vacantGood - vacantWarning,
        avgRatio: vacantRatios.length > 0 ? 
                  vacantRatios.reduce((a, b) => a + b, 0) / vacantRatios.length : 0
      },
      improved: {
        total: filteredImproved.length,
        good: improvedGood,
        warning: improvedWarning,
        error: filteredImproved.length - improvedGood - improvedWarning,
        avgRecommendedAllocation: improvedAllocations.length > 0 ?
                                  improvedAllocations.reduce((a, b) => a + b, 0) / improvedAllocations.length : 0,
        avgCurrentAllocation: avgCurrentAllocation
      }
    };
  };

  // ========== SAVE FUNCTIONS ==========
  const saveAnalysis = async () => {
    if (!jobData?.id || !valuationMethod) return;
    
    setIsSaving(true);
    
    try {
      const { data: existing } = await supabase
        .from('market_land_valuation')
        .select('id')
        .eq('job_id', jobData.id)
        .single();
      
      const analysisData = {
        job_id: jobData.id,
        valuation_method: valuationMethod,
        raw_land_config: {
          date_range: dateRange,
          cascade_config: cascadeConfig,
          front_foot_config: frontFootConfig
        },
        vacant_sales_analysis: {
          sales: vacantSales.map(s => ({
            id: s.id,
            included: includedSales.has(s.id),
            category: saleCategories[s.id] || null,
            notes: landNotes[s.id] || null,
            manually_added: s.manuallyAdded || false
          })),
          rates: calculateRates()
        },
        bracket_analysis: bracketAnalysis,
        land_rate_recommendation: generateRecommendation(),
        cascade_rates: cascadeConfig,
        allocation_study: {
          vcs_site_values: vcsSiteValues,
          actual_allocations: actualAllocations,
          stats: activeSubTab === 'allocation' ? calculateAllocationStats() : null
        },
        updated_at: new Date().toISOString()
      };
      
      if (existing) {
        const { error } = await supabase
          .from('market_land_valuation')
          .update(analysisData)
          .eq('job_id', jobData.id);
        
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('market_land_valuation')
          .insert(analysisData);
        
        if (error) throw error;
      }
      
      setLastSaved(new Date());
    } catch (error) {
      console.error('Error saving analysis:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // ========== EXPORT FUNCTIONS ==========
  const exportLandRatesToExcel = () => {
    let vacantSalesCSV = 'Block/Lot,Category,Sale Date,Sale Price,Acres,$/Acre,Package,Notes\n';
    vacantSales.forEach(sale => {
      const category = saleCategories[sale.id] || 'Not Categorized';
      const isPackage = sale.packageData ? `Package (${sale.packageData.package_count})` : 'Single';
      const notes = landNotes[sale.id] || '';
      vacantSalesCSV += `"${sale.property_block}/${sale.property_lot}","${category}","${sale.sales_date}","${sale.sales_price}","${sale.totalAcres?.toFixed(2)}","${sale.pricePerAcre?.toFixed(0)}","${isPackage}","${notes}"\n`;
    });
    
    let vcsAnalysisCSV = 'VCS,Total Sales,<1 Acre Count,<1 Acre Avg Size,<1 Acre Avg Price,1-5 Acre Count,1-5 Acre Avg Size,1-5 Acre Avg Price,Delta Price,Delta Acres,Implied $/Acre,$/SF,5-10 Acre Count,5-10 Acre Avg Size,5-10 Acre Avg Price,>10 Acre Count\n';
    Object.entries(bracketAnalysis).forEach(([vcs, data]) => {
      const smallToMedDelta = data.brackets.medium.avgPrice && data.brackets.small.avgPrice ? 
        (data.brackets.medium.avgPrice - data.brackets.small.avgPrice) : 0;
      const smallToMedAcres = data.brackets.medium.avgAcres && data.brackets.small.avgAcres ? 
        (data.brackets.medium.avgAcres - data.brackets.small.avgAcres) : 0;
      
      vcsAnalysisCSV += `"${vcs}",${data.totalSales},`;
      vcsAnalysisCSV += `${data.brackets.small.count},"${data.brackets.small.avgAcres?.toFixed(2) || ''}","${data.brackets.small.avgPrice?.toFixed(0) || ''}",`;
      vcsAnalysisCSV += `${data.brackets.medium.count},"${data.brackets.medium.avgAcres?.toFixed(2) || ''}","${data.brackets.medium.avgPrice?.toFixed(0) || ''}",`;
      vcsAnalysisCSV += `"${smallToMedDelta.toFixed(0)}","${smallToMedAcres.toFixed(2)}","${data.impliedRate?.toFixed(0) || ''}","${data.impliedRate ? (data.impliedRate / 43560).toFixed(2) : ''}",`;
      vcsAnalysisCSV += `${data.brackets.large.count},"${data.brackets.large.avgAcres?.toFixed(2) || ''}","${data.brackets.large.avgPrice?.toFixed(0) || ''}",`;
      vcsAnalysisCSV += `${data.brackets.xlarge.count}\n`;
    });
    
    const fullExport = 
      '=== VACANT LAND SALES ===\n' + vacantSalesCSV + '\n\n' +
      '=== VCS LOT SIZE ANALYSIS ===\n' + vcsAnalysisCSV;
    
    const blob = new Blob([fullExport], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `land_valuation_analysis_${jobData?.municipality || 'export'}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const exportAllocationToExcel = () => {
    const filteredVacant = getFilteredVacantTestSales();
    const filteredImproved = getFilteredImprovedSales();
    
    let vacantCSV = 'Block,Lot,VCS,Category,Year,Lot Size,Sale Price,Raw Land,Site Value,Total Land,Ratio,Status\n';
    filteredVacant.forEach(sale => {
      vacantCSV += `"${sale.property_block}","${sale.property_lot}","${sale.new_vcs || ''}","${sale.category}",${sale.saleYear},`;
      vacantCSV += `${sale.acres.toFixed(2)},${sale.sales_price},`;
      vacantCSV += `${sale.rawLandValue.toFixed(0)},${sale.calculatedSiteValue.toFixed(0)},`;
      vacantCSV += `${sale.totalLandValue.toFixed(0)},${sale.ratio.toFixed(3)},"${sale.ratioStatus}"\n`;
    });
    
    let siteValuesCSV = 'VCS,Average Site Value,Number of Sales\n';
    Object.entries(vcsSiteValues).forEach(([vcs, data]) => {
      siteValuesCSV += `"${vcs}",${data.avgSiteValue.toFixed(0)},${data.sales.length}\n`;
    });
    
    let improvedCSV = 'Block,Lot,VCS,Year,Lot Size,Sale Price,Raw Land,Site Value,Total Land,Current Land,Current %,Recommended %,Actual %,Delta,Status\n';
    filteredImproved.forEach(sale => {
      const actualAlloc = actualAllocations[sale.id];
      improvedCSV += `"${sale.property_block}","${sale.property_lot}","${sale.new_vcs || ''}",${sale.saleYear},`;
      improvedCSV += `${sale.acres.toFixed(2)},${sale.sales_price},`;
      improvedCSV += `${sale.rawLandValue.toFixed(0)},${sale.siteValue.toFixed(0)},${sale.calculatedLandValue.toFixed(0)},`;
      improvedCSV += `${sale.values_mod_land || 0},${(sale.currentAllocation * 100).toFixed(1)}%,`;
      improvedCSV += `${(sale.recommendedAllocation * 100).toFixed(1)}%,${actualAlloc || ''}%,`;
      improvedCSV += `${(sale.allocationDelta * 100).toFixed(1)}%,"${sale.allocationStatus}"\n`;
    });
    
    const stats = calculateAllocationStats();
    const actualEntries = Object.entries(actualAllocations).filter(([id, val]) => val !== '');
    const avgActualAllocation = actualEntries.length > 0 ?
      actualEntries.reduce((sum, [id, val]) => sum + parseFloat(val), 0) / actualEntries.length / 100 : 0;
    
    let summaryCSV = 'Metric,Value\n';
    summaryCSV += `"Prime Rate","$${(cascadeConfig.prime || 0).toLocaleString()}"\n`;
    summaryCSV += `"Secondary Rate","$${(cascadeConfig.secondary || 0).toLocaleString()}"\n`;
    summaryCSV += `"Excess Rate","$${(cascadeConfig.excess || 0).toLocaleString()}"\n`;
    summaryCSV += `"Residual Rate","$${(cascadeConfig.residual || 0).toLocaleString()}"\n`;
    summaryCSV += `"Vacant Sales Tested",${stats.vacant.total}\n`;
    summaryCSV += `"Vacant Within Target (0.9-1.1)",${stats.vacant.good}\n`;
    summaryCSV += `"Average Vacant Ratio",${stats.vacant.avgRatio.toFixed(3)}\n`;
    summaryCSV += `"Improved Sales Tested",${stats.improved.total}\n`;
    summaryCSV += `"Improved Within Target (25-40%)",${stats.improved.good}\n`;
    summaryCSV += `"Average Current Allocation",${(stats.improved.avgCurrentAllocation * 100).toFixed(1)}%\n`;
    summaryCSV += `"Average Recommended Allocation",${(stats.improved.avgRecommendedAllocation * 100).toFixed(1)}%\n`;
    if (actualEntries.length > 0) {
      summaryCSV += `"Average Actual Allocation (User)",${(avgActualAllocation * 100).toFixed(1)}%\n`;
    }
    
    const fullExport = 
      '=== ALLOCATION STUDY SUMMARY ===\n' + summaryCSV + '\n\n' +
      '=== VCS SITE VALUES ===\n' + siteValuesCSV + '\n\n' +
      '=== VACANT LAND TEST ===\n' + vacantCSV + '\n\n' +
      '=== IMPROVED SALES ALLOCATION TEST ===\n' + improvedCSV;
    
    const blob = new Blob([fullExport], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `allocation_study_${jobData?.municipality || 'export'}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  // ========== RENDER FUNCTIONS ==========
  if (isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        padding: '40px',
        color: '#6B7280' 
      }}>
        Loading saved analysis...
      </div>
    );
  }

  if (!valuationMethod) {
    return (
      <div style={{ padding: '20px' }}>
        <div style={{ 
          background: '#EFF6FF', 
          border: '2px solid #3B82F6', 
          borderRadius: '8px', 
          padding: '20px',
          marginBottom: '20px' 
        }}>
          <h3>Select Valuation Method</h3>
          <p style={{ color: '#6B7280', marginBottom: '15px' }}>
            This choice determines how land values will be calculated throughout the analysis
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
            {[
              { value: 'acre', label: 'Per Acre', desc: 'Large lots, rural areas' },
              { value: 'sf', label: 'Per Square Foot', desc: 'Standard residential' },
              { value: 'ff', label: 'Front Foot', desc: 'Commercial, waterfront' },
              { value: 'site', label: 'Site Value', desc: 'Condos, no lot size' }
            ].map(method => (
              <button
                key={method.value}
                onClick={() => setValuationMethod(method.value)}
                style={{
                  padding: '15px',
                  border: '2px solid #E5E7EB',
                  borderRadius: '8px',
                  background: 'white',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <div style={{ fontWeight: 'bold' }}>{method.label}</div>
                <div style={{ fontSize: '12px', color: '#6B7280' }}>{method.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const recommendation = generateRecommendation();
  const allocationStats = activeSubTab === 'allocation' ? calculateAllocationStats() : null;

  return (
    <div style={{ padding: '20px' }}>
      {/* Sub-tab Navigation */}
      <div style={{ 
        display: 'flex', 
        gap: '10px', 
        borderBottom: '2px solid #E5E7EB',
        marginBottom: '20px' 
      }}>
        <button 
          onClick={() => setActiveSubTab('land-rates')}
          style={{
            padding: '8px 16px',
            backgroundColor: activeSubTab === 'land-rates' ? '#3B82F6' : 'white',
            color: activeSubTab === 'land-rates' ? 'white' : '#6B7280',
            border: 'none',
            borderRadius: '4px 4px 0 0',
            cursor: 'pointer',
            fontWeight: '500'
          }}
        >
          Land Rates
        </button>
        <button 
          onClick={() => setActiveSubTab('allocation')}
          disabled={!cascadeConfig.prime}
          style={{
            padding: '8px 16px',
            backgroundColor: activeSubTab === 'allocation' ? '#3B82F6' : 'white',
            color: activeSubTab === 'allocation' ? 'white' : '#6B7280',
            border: 'none',
            borderRadius: '4px 4px 0 0',
            cursor: cascadeConfig.prime ? 'pointer' : 'not-allowed',
            fontWeight: '500',
            opacity: cascadeConfig.prime ? 1 : 0.5
          }}
        >
          Allocation Study
        </button>
        <button 
          disabled
          style={{
            padding: '8px 16px',
            backgroundColor: 'white',
            color: '#6B7280',
            border: 'none',
            borderRadius: '4px 4px 0 0',
            cursor: 'not-allowed',
            fontWeight: '500',
            opacity: 0.5
          }}
        >
          VCS Sheet (Coming Soon)
        </button>
        <button 
          disabled
          style={{
            padding: '8px 16px',
            backgroundColor: 'white',
            color: '#6B7280',
            border: 'none',
            borderRadius: '4px 4px 0 0',
            cursor: 'not-allowed',
            fontWeight: '500',
            opacity: 0.5
          }}
        >
          Economic Obsolescence (Coming Soon)
        </button>
      </div>

      {/* LAND RATES SUB-TAB */}
      {activeSubTab === 'land-rates' && (
        <>
          {/* Save Status and Export */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '10px'
          }}>
            <button 
              onClick={exportLandRatesToExcel}
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
              <Download size={16} /> Export Analysis to Excel
            </button>
            
            {lastSaved && (
              <div style={{ 
                fontSize: '12px',
                color: '#6B7280'
              }}>
                {isSaving ? 'Saving...' : `Last saved: ${lastSaved.toLocaleTimeString()}`}
              </div>
            )}
          </div>

          {/* Front Foot Configuration */}
          {valuationMethod === 'ff' && (
            <div style={{ 
              background: '#FEF3C7', 
              padding: '15px', 
              borderRadius: '8px',
              marginBottom: '20px' 
            }}>
              <h4>Front Foot Configuration</h4>
              <div style={{ display: 'flex', gap: '20px' }}>
                <div>
                  <label>Prime Frontage Minimum:</label>
                  <select 
                    value={frontFootConfig.primeFrontage}
                    onChange={(e) => setFrontFootConfig({
                      ...frontFootConfig, 
                      primeFrontage: parseInt(e.target.value)
                    })}
                    style={{ marginLeft: '10px', padding: '4px' }}
                  >
                    <option value="50">50 feet</option>
                    <option value="75">75 feet</option>
                    <option value="100">100 feet</option>
                    <option value="125">125 feet</option>
                    <option value="150">150 feet</option>
                  </select>
                </div>
                
                <div>
                  <label>Depth Table:</label>
                  <input
                    type="text"
                    value={frontFootConfig.depthTable}
                    onChange={(e) => setFrontFootConfig({
                      ...frontFootConfig,
                      depthTable: e.target.value
                    })}
                    placeholder="e.g., 100FT"
                    style={{ marginLeft: '10px', padding: '4px', width: '100px' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Section 1: Vacant Land Sales */}
          <div style={{ marginBottom: '30px' }}>
            <h3>Method 1: Direct Vacant Land Sales</h3>
            
            {/* Date Range and Add Button */}
            <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
              <div>
                <label>Start Date:</label>
                <input 
                  type="date" 
                  value={dateRange.start.toISOString().split('T')[0]}
                  onChange={(e) => setDateRange({...dateRange, start: new Date(e.target.value)})}
                  style={{ marginLeft: '10px', padding: '4px' }}
                />
              </div>
              <div>
                <label>End Date:</label>
                <input 
                  type="date"
                  value={dateRange.end.toISOString().split('T')[0]}
                  onChange={(e) => setDateRange({...dateRange, end: new Date(e.target.value)})}
                  style={{ marginLeft: '10px', padding: '4px' }}
                />
              </div>
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
                <Plus size={16} /> Add Sale
              </button>
            </div>

            {/* Vacant Sales Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#F9FAFB' }}>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Include</th>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Block/Lot</th>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Category*</th>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Sale Date</th>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Sale Price</th>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Acres</th>
                  <th style={{ padding: '8px', textAlign: 'left' }}>$/Acre</th>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {vacantSales.map(sale => (
                  <tr key={sale.id} style={{ 
                    borderBottom: '1px solid #E5E7EB',
                    backgroundColor: sale.packageData ? '#FEF3C7' : 
                                   sale.manuallyAdded ? '#E0E7FF' : 'white'
                  }}>
                    <td style={{ padding: '8px' }}>
                      <input 
                        type="checkbox" 
                        checked={includedSales.has(sale.id)}
                        onChange={(e) => {
                          const newIncluded = new Set(includedSales);
                          if (e.target.checked) {
                            newIncluded.add(sale.id);
                          } else {
                            newIncluded.delete(sale.id);
                          }
                          setIncludedSales(newIncluded);
                        }}
                      />
                    </td>
                    <td style={{ padding: '8px' }}>
                      {sale.property_block}/{sale.property_lot}
                      {sale.packageData && (
                        <div style={{ fontSize: '11px', color: '#F59E0B' }}>
                          Package: {sale.packageData.package_count} properties
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '8px' }}>
                      <select 
                        value={saleCategories[sale.id] || ''}
                        onChange={(e) => setSaleCategories({...saleCategories, [sale.id]: e.target.value})}
                        style={{ 
                          border: !saleCategories[sale.id] ? '2px solid red' : '1px solid #E5E7EB',
                          padding: '4px',
                          width: '100%'
                        }}
                        required
                      >
                        <option value="">-- SELECT --</option>
                        <option value="raw_land">Raw Land (Clean)</option>
                        <option value="building_lot">Building Lot</option>
                        <option value="wetlands">Wetlands</option>
                        <option value="conservation">Conservation</option>
                        <option value="green_acres">Green Acres/Open</option>
                        <option value="landlocked">Landlocked</option>
                        <option value="other">Other/Challenged</option>
                      </select>
                    </td>
                    <td style={{ padding: '8px' }}>{sale.sales_date}</td>
                    <td style={{ padding: '8px' }}>${(sale.sales_price || 0).toLocaleString()}</td>
                    <td style={{ padding: '8px' }}>{sale.totalAcres?.toFixed(2)}</td>
                    <td style={{ padding: '8px', fontWeight: 'bold' }}>
                      ${sale.pricePerAcre?.toLocaleString()}
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input
                        type="text"
                        value={landNotes[sale.id] || ''}
                        onChange={(e) => setLandNotes({...landNotes, [sale.id]: e.target.value})}
                        placeholder="Add notes..."
                        style={{ width: '100%', padding: '4px' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {vacantSales.length < 5 && (
              <div style={{ color: '#F59E0B', marginTop: '10px' }}>
                <AlertCircle size={16} style={{ display: 'inline', marginRight: '4px' }} />
                Limited data: Only {vacantSales.length} vacant sales found
              </div>
            )}

            {/* Summary */}
            <div style={{ 
              marginTop: '20px', 
              padding: '15px', 
              background: '#EFF6FF',
              borderRadius: '8px' 
            }}>
              <h4>Vacant Sales Summary</h4>
              <div>
                Included Sales: {calculateRates().count}
                <br/>
                Average Price/Acre: ${calculateRates().average.toLocaleString()}
                <br/>
                Median Price/Acre: ${calculateRates().median.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Section 2: VCS Lot Size Bracketing */}
          <div style={{ marginBottom: '30px' }}>
            <h3>Method 2: Lot Size Bracketing Analysis</h3>
            
            <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
              <button 
                onClick={() => setShowAllVCS(!showAllVCS)}
                style={{ 
                  backgroundColor: showAllVCS ? '#3B82F6' : 'white',
                  color: showAllVCS ? 'white' : '#3B82F6',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  border: '1px solid #3B82F6',
                  cursor: 'pointer'
                }}
              >
                {showAllVCS ? 'Show Summary' : 'Show All VCS'}
              </button>
              
              {showAllVCS && (
                <input
                  type="text"
                  placeholder="Filter VCS..."
                  value={vcsFilter}
                  onChange={(e) => setVcsFilter(e.target.value)}
                  style={{ padding: '8px', border: '1px solid #E5E7EB' }}
                />
              )}
            </div>
            
            {!showAllVCS ? (
              /* Summary View */
              <div>
                {/* Summary Statistics */}
                <div style={{ display: 'grid', gap: '15px', marginBottom: '20px' }}>
                  <div style={{ background: '#D1FAE5', padding: '15px', borderRadius: '8px' }}>
                    <strong>Strong Evidence VCS</strong> (10+ sales per bracket):
                    <div>
                      {Object.entries(bracketAnalysis)
                        .filter(([vcs, data]) => data.totalSales >= 10)
                        .map(([vcs]) => vcs)
                        .join(', ') || 'None'}
                    </div>
                  </div>
                  
                  <div style={{ background: '#FEF3C7', padding: '15px', borderRadius: '8px' }}>
                    <strong>Moderate Evidence</strong> (5-10 sales):
                    <div>
                      {Object.entries(bracketAnalysis)
                        .filter(([vcs, data]) => data.totalSales >= 5 && data.totalSales < 10)
                        .map(([vcs]) => vcs)
                        .join(', ') || 'None'}
                    </div>
                  </div>
                  
                  <div style={{ background: '#FEE2E2', padding: '15px', borderRadius: '8px' }}>
                    <strong>Weak Evidence</strong> (&lt;5 sales):
                    <div>
                      {Object.entries(bracketAnalysis)
                        .filter(([vcs, data]) => data.totalSales < 5)
                        .map(([vcs]) => vcs)
                        .join(', ') || 'None'}
                    </div>
                  </div>
                </div>

                {/* Top VCS Lot Size Comparisons */}
                <h4>Lot Size Comparison Analysis (Top VCS)</h4>
                {Object.entries(bracketAnalysis)
                  .filter(([vcs, data]) => data.totalSales >= 10 && data.impliedRate)
                  .slice(0, 3)
                  .map(([vcs, data]) => (
                    <div key={vcs} style={{ 
                      background: 'white', 
                      border: '1px solid #E5E7EB', 
                      borderRadius: '8px', 
                      padding: '15px',
                      marginBottom: '15px'
                    }}>
                      <h5 style={{ marginBottom: '10px' }}>{vcs} ({data.totalSales} total sales)</h5>
                      <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                            <th style={{ padding: '8px', textAlign: 'left' }}>Lot Size</th>
                            <th style={{ padding: '8px', textAlign: 'right' }}>Avg Acres</th>
                            <th style={{ padding: '8px', textAlign: 'right' }}>Avg Price</th>
                            <th style={{ padding: '8px', textAlign: 'right' }}>Delta $</th>
                            <th style={{ padding: '8px', textAlign: 'right' }}>Delta Acres</th>
                            <th style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>$/Acre</th>
                            <th style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>$/SF</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td style={{ padding: '8px' }}>&lt;1.00</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              {data.brackets.small.avgAcres?.toFixed(2) || '-'}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              ${data.brackets.small.avgPrice?.toLocaleString() || '-'}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>-</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>-</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>-</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>-</td>
                          </tr>
                          <tr style={{ backgroundColor: '#F9FAFB' }}>
                            <td style={{ padding: '8px' }}>1.00-5.00</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              {data.brackets.medium.avgAcres?.toFixed(2) || '-'}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              ${data.brackets.medium.avgPrice?.toLocaleString() || '-'}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right', color: '#059669' }}>
                              {data.brackets.medium.avgPrice && data.brackets.small.avgPrice ? 
                                `${(data.brackets.medium.avgPrice - data.brackets.small.avgPrice).toLocaleString()}` : '-'}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              {data.brackets.medium.avgAcres && data.brackets.small.avgAcres ? 
                                (data.brackets.medium.avgAcres - data.brackets.small.avgAcres).toFixed(2) : '-'}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', color: '#3B82F6' }}>
                              {data.impliedRate ? `${data.impliedRate.toLocaleString()}` : '-'}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', color: '#3B82F6' }}>
                              {data.impliedRate ? `${(data.impliedRate / 43560).toFixed(2)}` : '-'}
                            </td>
                          </tr>
                          {data.brackets.large.count > 0 && (
                            <tr>
                              <td style={{ padding: '8px' }}>5.00-10.00</td>
                              <td style={{ padding: '8px', textAlign: 'right' }}>
                                {data.brackets.large.avgAcres?.toFixed(2) || '-'}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'right' }}>
                                ${data.brackets.large.avgPrice?.toLocaleString() || '-'}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'right', color: '#059669' }}>
                                {data.brackets.large.avgPrice && data.brackets.medium.avgPrice ? 
                                  `${(data.brackets.large.avgPrice - data.brackets.medium.avgPrice).toLocaleString()}` : '-'}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'right' }}>
                                {data.brackets.large.avgAcres && data.brackets.medium.avgAcres ? 
                                  (data.brackets.large.avgAcres - data.brackets.medium.avgAcres).toFixed(2) : '-'}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', color: '#3B82F6' }}>
                                {data.brackets.large.avgPrice && data.brackets.medium.avgPrice && 
                                 data.brackets.large.avgAcres && data.brackets.medium.avgAcres ? 
                                  `${((data.brackets.large.avgPrice - data.brackets.medium.avgPrice) / 
                                       (data.brackets.large.avgAcres - data.brackets.medium.avgAcres)).toLocaleString()}` : '-'}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', color: '#3B82F6' }}>
                                {data.brackets.large.avgPrice && data.brackets.medium.avgPrice && 
                                 data.brackets.large.avgAcres && data.brackets.medium.avgAcres ? 
                                  `${(((data.brackets.large.avgPrice - data.brackets.medium.avgPrice) / 
                                       (data.brackets.large.avgAcres - data.brackets.medium.avgAcres)) / 43560).toFixed(2)}` : '-'}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      <div style={{ marginTop: '10px', fontSize: '12px', color: '#6B7280' }}>
                        Implied land rate shows diminishing returns on larger lots
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              /* Detailed VCS Table */
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F9FAFB' }}>
                    <th style={{ padding: '8px', textAlign: 'left' }}>VCS</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>&lt;1 acre</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>1-5 acres</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>5-10 acres</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>&gt;10 acres</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Implied Rate</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Sample Size</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(bracketAnalysis)
                    .filter(([vcs]) => !vcsFilter || vcs.includes(vcsFilter.toUpperCase()))
                    .map(([vcs, data]) => (
                      <tr key={vcs} style={{ borderBottom: '1px solid #E5E7EB' }}>
                        <td style={{ padding: '8px' }}>{vcs}</td>
                        <td style={{ padding: '8px' }}>
                          {data.brackets.small.count > 0 ? 
                            `${data.brackets.small.count} sales` : 'N/A'}
                        </td>
                        <td style={{ padding: '8px' }}>
                          {data.brackets.medium.count > 0 ? 
                            `${data.brackets.medium.count} sales` : 'N/A'}
                        </td>
                        <td style={{ padding: '8px' }}>
                          {data.brackets.large.count > 0 ? 
                            `${data.brackets.large.count} sales` : 'N/A'}
                        </td>
                        <td style={{ padding: '8px' }}>
                          {data.brackets.xlarge.count > 0 ? 
                            `${data.brackets.xlarge.count} sales` : 'N/A'}
                        </td>
                        <td style={{ padding: '8px', fontWeight: 'bold' }}>
                          {data.impliedRate ? 
                            `${data.impliedRate.toLocaleString()}/ac` : 'N/A'}
                        </td>
                        <td style={{ padding: '8px' }}>
                          <span style={{ 
                            color: data.totalSales > 10 ? '#10B981' : 
                                   data.totalSales > 5 ? '#F59E0B' : '#EF4444' 
                          }}>
                            {data.totalSales} sales
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Section 3: Rate Analysis & Recommendation */}
          <div style={{ 
            background: 'linear-gradient(135deg, #667EEA 0%, #764BA2 100%)',
            color: 'white',
            padding: '20px',
            borderRadius: '12px',
            marginBottom: '30px'
          }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp size={24} /> Rate Analysis & Recommendation
            </h3>
            
            <div style={{ 
              background: 'rgba(255, 255, 255, 0.1)', 
              padding: '10px', 
              borderRadius: '8px',
              marginBottom: '15px'
            }}>
              <div style={{ 
                display: 'inline-block',
                padding: '4px 8px',
                background: recommendation.confidence === 'HIGH' ? '#10B981' :
                          recommendation.confidence === 'MEDIUM' ? '#F59E0B' : '#EF4444',
                borderRadius: '4px',
                marginBottom: '10px'
              }}>
                {recommendation.confidence} CONFIDENCE
              </div>
              <div>{recommendation.message}</div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px' }}>
              <div>
                <div style={{ fontSize: '12px', opacity: 0.9 }}>Prime Rate</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
                  ${recommendation.prime.toLocaleString()}/acre
                </div>
                <input
                  type="number"
                  value={cascadeConfig.prime || recommendation.prime}
                  onChange={(e) => setCascadeConfig({...cascadeConfig, prime: parseFloat(e.target.value)})}
                  style={{ 
                    width: '100%', 
                    padding: '4px', 
                    marginTop: '5px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.3)',
                    color: 'white'
                  }}
                  placeholder="Override..."
                />
              </div>
              <div>
                <div style={{ fontSize: '12px', opacity: 0.9 }}>Secondary Rate</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
                  ${recommendation.secondary.toLocaleString()}/acre
                </div>
                <input
                  type="number"
                  value={cascadeConfig.secondary || recommendation.secondary}
                  onChange={(e) => setCascadeConfig({...cascadeConfig, secondary: parseFloat(e.target.value)})}
                  style={{ 
                    width: '100%', 
                    padding: '4px', 
                    marginTop: '5px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.3)',
                    color: 'white'
                  }}
                  placeholder="Override..."
                />
              </div>
              <div>
                <div style={{ fontSize: '12px', opacity: 0.9 }}>Excess Rate</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
                  ${recommendation.excess.toLocaleString()}/acre
                </div>
                <input
                  type="number"
                  value={cascadeConfig.excess || recommendation.excess}
                  onChange={(e) => setCascadeConfig({...cascadeConfig, excess: parseFloat(e.target.value)})}
                  style={{ 
                    width: '100%', 
                    padding: '4px', 
                    marginTop: '5px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.3)',
                    color: 'white'
                  }}
                  placeholder="Override..."
                />
              </div>
              <div>
                <div style={{ fontSize: '12px', opacity: 0.9 }}>Residual Rate</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
                  ${recommendation.residual.toLocaleString()}/acre
                </div>
                <input
                  type="number"
                  value={cascadeConfig.residual || recommendation.residual}
                  onChange={(e) => setCascadeConfig({...cascadeConfig, residual: parseFloat(e.target.value)})}
                  style={{ 
                    width: '100%', 
                    padding: '4px', 
                    marginTop: '5px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.3)',
                    color: 'white'
                  }}
                  placeholder="Override..."
                />
              </div>
            </div>
            
            <button 
              onClick={saveAnalysis}
              style={{
                marginTop: '15px',
                padding: '10px 20px',
                background: 'white',
                color: '#764BA2',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Save Land Rates
            </button>
          </div>

          {/* Test Calculator */}
          <div style={{ 
            background: 'linear-gradient(135deg, #667EEA 0%, #764BA2 100%)',
            padding: '20px',
            borderRadius: '12px'
          }}>
            <h4 style={{ color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Calculator size={20} /> Test Your Rates
            </h4>
            
            <div style={{ display: 'flex', gap: '10px' }}>
              <input 
                type="number"
                placeholder="Lot size (acres)"
                value={testAcres}
                onChange={(e) => setTestAcres(e.target.value)}
                style={{ padding: '8px' }}
              />
              <input 
                type="number"
                placeholder="Frontage (ft)"
                value={testFrontage}
                onChange={(e) => setTestFrontage(e.target.value)}
                style={{ padding: '8px' }}
              />
            </div>
            
            {testAcres && calculateTestValues() && (
              <div style={{ marginTop: '15px', color: 'white' }}>
                <div>Acre Method: ${calculateTestValues().acreMethod.toLocaleString()}</div>
                <div>SF Method: ${calculateTestValues().sfMethod.toLocaleString()}</div>
                {testFrontage && calculateTestValues().ffMethod && (
                  <div>Front Foot: ${calculateTestValues().ffMethod.toLocaleString()}</div>
                )}
                <div style={{ marginTop: '10px', fontSize: '12px', opacity: 0.9 }}>
                  {Math.abs(calculateTestValues().acreMethod - calculateTestValues().sfMethod) < 1000 ? 
                    '✅ Methods align well!' : 
                    '⚠️ Methods showing variance - review rates'}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ALLOCATION STUDY SUB-TAB */}
      {activeSubTab === 'allocation' && (
        <>
          {/* Header with Export */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '20px'
          }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold' }}>Allocation Study</h2>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button 
                onClick={exportAllocationToExcel}
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
                <Download size={16} /> Export to Excel
              </button>
              {lastSaved && (
                <span style={{ fontSize: '12px', color: '#6B7280' }}>
                  {isSaving ? 'Saving...' : `Saved ${lastSaved.toLocaleTimeString()}`}
                </span>
              )}
            </div>
          </div>

          {/* Filters */}
          <div style={{ 
            background: '#F9FAFB', 
            padding: '15px', 
            borderRadius: '8px',
            marginBottom: '20px'
          }}>
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
              <Filter size={20} />
              <select 
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={{ padding: '6px' }}
              >
                <option value="all">All Categories</option>
                {[...new Set(vacantTestSales.map(s => s.category))].map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              
              <select 
                value={allocationVcsFilter}
                onChange={(e) => setAllocationVcsFilter(e.target.value)}
                style={{ padding: '6px' }}
              >
                <option value="all">All VCS</option>
                {[...new Set([...vacantTestSales.map(s => s.new_vcs), ...improvedTestSales.map(s => s.new_vcs)].filter(v => v))].map(vcs => (
                  <option key={vcs} value={vcs}>{vcs}</option>
                ))}
              </select>
              
              <select 
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                style={{ padding: '6px' }}
              >
                <option value="all">All Years</option>
                {[...new Set([...vacantTestSales.map(s => s.saleYear), ...improvedTestSales.map(s => s.saleYear)])].sort().map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Rate Configuration */}
          <div style={{ 
            background: '#EFF6FF', 
            padding: '15px', 
            borderRadius: '8px',
            marginBottom: '20px'
          }}>
            <h3 style={{ marginBottom: '10px' }}>Land Rate Configuration</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#6B7280' }}>Prime (0-1 ac)</label>
                <input
                  type="number"
                  value={cascadeConfig.prime || 0}
                  onChange={(e) => setCascadeConfig({...cascadeConfig, prime: parseFloat(e.target.value) || 0})}
                  style={{ width: '100%', padding: '6px', border: '1px solid #E5E7EB', borderRadius: '4px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#6B7280' }}>Secondary (1-5 ac)</label>
                <input
                  type="number"
                  value={cascadeConfig.secondary || 0}
                  onChange={(e) => setCascadeConfig({...cascadeConfig, secondary: parseFloat(e.target.value) || 0})}
                  style={{ width: '100%', padding: '6px', border: '1px solid #E5E7EB', borderRadius: '4px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#6B7280' }}>Excess (5-10 ac)</label>
                <input
                  type="number"
                  value={cascadeConfig.excess || 0}
                  onChange={(e) => setCascadeConfig({...cascadeConfig, excess: parseFloat(e.target.value) || 0})}
                  style={{ width: '100%', padding: '6px', border: '1px solid #E5E7EB', borderRadius: '4px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#6B7280' }}>Residual (>10 ac)</label>
                <input
                  type="number"
                  value={cascadeConfig.residual || 0}
                  onChange={(e) => setCascadeConfig({...cascadeConfig, residual: parseFloat(e.target.value) || 0})}
                  style={{ width: '100%', padding: '6px', border: '1px solid #E5E7EB', borderRadius: '4px' }}
                />
              </div>
            </div>
            <button 
              onClick={recalculateAllocation}
              style={{
                marginTop: '10px',
                backgroundColor: '#3B82F6',
                color: 'white',
                padding: '6px 12px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <RefreshCw size={16} /> Recalculate All
            </button>
          </div>

          {/* Summary Statistics */}
          {allocationStats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '20px' }}>
              <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '15px' }}>
                <h4 style={{ marginBottom: '10px' }}>Vacant Land Test</h4>
                <div style={{ fontSize: '14px' }}>
                  <div>Total Sales: {allocationStats.vacant.total}</div>
                  <div>Avg Ratio: {allocationStats.vacant.avgRatio.toFixed(2)}</div>
                  <div style={{ color: '#10B981' }}>Good (0.9-1.1): {allocationStats.vacant.good}</div>
                  <div style={{ color: '#F59E0B' }}>Warning: {allocationStats.vacant.warning}</div>
                  <div style={{ color: '#EF4444' }}>Error: {allocationStats.vacant.error}</div>
                </div>
              </div>
              
              <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '15px' }}>
                <h4 style={{ marginBottom: '10px' }}>Improved Sales Test</h4>
                <div style={{ fontSize: '14px' }}>
                  <div>Total Sales: {allocationStats.improved.total}</div>
                  <div>Current Avg: {(allocationStats.improved.avgCurrentAllocation * 100).toFixed(1)}%</div>
                  <div>Recommended Avg: {(allocationStats.improved.avgRecommendedAllocation * 100).toFixed(1)}%</div>
                  <div style={{ color: '#10B981' }}>Good (25-40%): {allocationStats.improved.good}</div>
                  <div style={{ color: '#F59E0B' }}>Warning: {allocationStats.improved.warning}</div>
                </div>
              </div>
              
              <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '15px' }}>
                <h4 style={{ marginBottom: '10px' }}>VCS Site Values</h4>
                <div style={{ fontSize: '14px', maxHeight: '100px', overflow: 'auto' }}>
                  {Object.entries(vcsSiteValues).map(([vcs, data]) => (
                    <div key={vcs}>
                      {vcs}: ${data.avgSiteValue.toLocaleString()}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Vacant Land Test Table */}
          <div style={{ marginBottom: '30px' }}>
            <h3>Vacant Land Test (Filtered: {getFilteredVacantTestSales().length} of {vacantTestSales.length})</h3>
            
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F9FAFB' }}>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>Block</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>Lot</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>VCS</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>Category</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB' }}>Year</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB' }}>Acres</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB' }}>Sale Price</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB' }}>Raw Land</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB', fontWeight: 'bold' }}>Site Value</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB', fontWeight: 'bold' }}>Total Land</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB', fontWeight: 'bold' }}>Ratio</th>
                  </tr>
                </thead>
                <tbody>
                  {getFilteredVacantTestSales().map(sale => (
                    <tr key={sale.id} style={{ 
                      borderBottom: '1px solid #E5E7EB',
                      backgroundColor: sale.ratioStatus === 'good' ? '#D1FAE5' :
                                     sale.ratioStatus === 'warning' ? '#FEF3C7' : '#FEE2E2'
                    }}>
                      <td style={{ padding: '8px' }}>{sale.property_block}</td>
                      <td style={{ padding: '8px' }}>{sale.property_lot}</td>
                      <td style={{ padding: '8px' }}>{sale.new_vcs || '-'}</td>
                      <td style={{ padding: '8px' }}>{sale.category}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{sale.saleYear}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{sale.acres.toFixed(2)}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>${sale.sales_price.toLocaleString()}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>${sale.rawLandValue.toLocaleString()}</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>
                        ${sale.calculatedSiteValue.toLocaleString()}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>
                        ${sale.totalLandValue.toLocaleString()}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>
                        {sale.ratio.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Improved Sales Allocation Table */}
          <div>
            <h3>Improved Sales Allocation Test (Filtered: {getFilteredImprovedSales().length} of {improvedTestSales.length})</h3>
            
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F9FAFB' }}>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>Block</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>Lot</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>VCS</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB' }}>Year</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB' }}>Acres</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB' }}>Sale Price</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB' }}>Raw Land</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB' }}>Site Value</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB' }}>Total Land</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB', fontWeight: 'bold' }}>Current %</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB', fontWeight: 'bold' }}>Recommended %</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB', fontWeight: 'bold', backgroundColor: '#DBEAFE' }}>Actual %</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '2px solid #E5E7EB' }}>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {getFilteredImprovedSales().map(sale => (
                    <tr key={sale.id} style={{ 
                      borderBottom: '1px solid #E5E7EB',
                      backgroundColor: sale.allocationStatus === 'good' ? '#D1FAE5' :
                                     sale.allocationStatus === 'warning' ? '#FEF3C7' : '#FEE2E2'
                    }}>
                      <td style={{ padding: '8px' }}>{sale.property_block}</td>
                      <td style={{ padding: '8px' }}>{sale.property_lot}</td>
                      <td style={{ padding: '8px' }}>{sale.new_vcs || '-'}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{sale.saleYear}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{sale.acres.toFixed(2)}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>${sale.sales_price.toLocaleString()}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>${sale.rawLandValue.toLocaleString()}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>${sale.siteValue.toLocaleString()}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>${sale.calculatedLandValue.toLocaleString()}</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>
                        {(sale.currentAllocation * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>
                        {(sale.recommendedAllocation * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', backgroundColor: '#DBEAFE' }}>
                        <input
                          type="number"
                          value={actualAllocations[sale.id] || ''}
                          onChange={(e) => setActualAllocations({
                            ...actualAllocations,
                            [sale.id]: parseFloat(e.target.value) || ''
                          })}
                          placeholder="Enter %"
                          style={{ 
                            width: '70px', 
                            padding: '4px', 
                            border: '1px solid #3B82F6',
                            borderRadius: '4px',
                            textAlign: 'right'
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {sale.allocationDelta > 0 ? '+' : ''}{(sale.allocationDelta * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Save Button and Load Sites */}
          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', gap: '20px' }}>
            <button 
              onClick={saveAnalysis}
              style={{
                backgroundColor: '#3B82F6',
                color: 'white',
                padding: '10px 24px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '500'
              }}
            >
              Save Allocation Study
            </button>
            
            <button 
              onClick={() => {
                saveAnalysis();
                // TODO: Implement VCS Sheet tab transition
                alert('VCS Sheet tab coming soon! Site values ready: ' + JSON.stringify(vcsSiteValues));
              }}
              style={{
                backgroundColor: '#10B981',
                color: 'white',
                padding: '10px 24px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '500',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              Load Sites → VCS Sheet
            </button>
          </div>
        </>
      )}

      {/* Add Property Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            padding: '20px',
            borderRadius: '8px',
            width: '600px',
            maxHeight: '80vh',
            overflow: 'auto'
          }}>
            <h3>Add Properties to Land Analysis</h3>
            
            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <select 
                value={searchFilters.class}
                onChange={(e) => setSearchFilters({...searchFilters, class: e.target.value})}
                style={{ padding: '8px' }}
              >
                <option value="">All Classes</option>
                <option value="1">1 - Vacant</option>
                <option value="2">2 - Residential</option>
                <option value="3A">3A - Farm Regular</option>
                <option value="3B">3B - Farm Qualified</option>
                <option value="4A">4A - Commercial</option>
                <option value="4B">4B - Industrial</option>
              </select>
              
              <input 
                placeholder="Block" 
                value={searchFilters.block}
                onChange={(e) => setSearchFilters({...searchFilters, block: e.target.value})}
                style={{ width: '80px', padding: '8px' }}
              />
              <input 
                placeholder="Lot" 
                value={searchFilters.lot}
                onChange={(e) => setSearchFilters({...searchFilters, lot: e.target.value})}
                style={{ width: '80px', padding: '8px' }}
              />
              
              <button 
                onClick={searchProperties}
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
                <Search size={16} /> Search
              </button>
            </div>

            <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '10px' }}>
              Showing sales from {dateRange.start.toLocaleDateString()} to {dateRange.end.toLocaleDateString()}
            </div>

            {searchResults.length > 0 ? (
              <div style={{ maxHeight: '400px', overflow: 'auto', border: '1px solid #E5E7EB', borderRadius: '4px' }}>
                {searchResults.map(prop => (
                  <div key={prop.id} style={{ 
                    padding: '10px', 
                    borderBottom: '1px solid #E5E7EB',
                    backgroundColor: selectedToAdd.has(prop.id) ? '#EFF6FF' : 'white',
                    cursor: 'pointer'
                  }}
                  onClick={() => {
                    const newSelected = new Set(selectedToAdd);
                    if (newSelected.has(prop.id)) {
                      newSelected.delete(prop.id);
                    } else {
                      newSelected.add(prop.id);
                    }
                    setSelectedToAdd(newSelected);
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <div>Block {prop.property_block} Lot {prop.property_lot}</div>
                        <div style={{ fontSize: '12px', color: '#6B7280' }}>{prop.property_location}</div>
                        <div style={{ fontSize: '12px' }}>
                          Class: {prop.property_m4_class} | Sale: ${prop.sales_price?.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        {selectedToAdd.has(prop.id) && <Check size={20} style={{ color: '#10B981' }} />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: '#6B7280' }}>
                {searchFilters.class || searchFilters.block || searchFilters.lot ? 
                  'No properties found matching criteria' : 
                  'Enter search criteria above'}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '15px' }}>
              <button 
                onClick={() => {
                  setShowAddModal(false);
                  setSearchResults([]);
                  setSelectedToAdd(new Set());
                }}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #E5E7EB',
                  borderRadius: '4px',
                  background: 'white',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button 
                onClick={addSelectedProperties}
                disabled={selectedToAdd.size === 0}
                style={{
                  padding: '8px 16px',
                  backgroundColor: selectedToAdd.size > 0 ? '#3B82F6' : '#E5E7EB',
                  color: 'white',
                  borderRadius: '4px',
                  border: 'none',
                  cursor: selectedToAdd.size > 0 ? 'pointer' : 'not-allowed'
                }}
              >
                Add {selectedToAdd.size} Selected
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandValuationTab;
