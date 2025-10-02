### JSONB Field Structures

Many tables use JSONB fields to store complex, flexible data structures. Below are the documented schemas for key JSONB fields:

#### **jobs.workflow_stats**
**Used by:** ProductionTracker, AdminJobManagement

```javascript
workflow_stats: {
  totalRecords: number,              // Total property records
  validInspections: number,          // Properties with valid inspection data
  jobEntryRate: number,              // Percentage with job entry
  jobRefusalRate: number,            // Percentage refused/no entry
  commercialCompletePercent: number, // Commercial pricing completion
  pricingCompletePercent: number,    // Overall pricing completion
  lastProcessed: timestamp,          // Last analytics run
  isProcessed: boolean               // Analytics have been run
}
```

#### **jobs.parsed_code_definitions**
**Used by:** MarketAnalysis tabs, interpretCodes utility

```javascript
parsed_code_definitions: {
  // BRT Format
  "Residential": {
    "23": { /* Design codes */ },
    "20": { /* Building class codes */ },
    "21": { /* Type use codes */ }
    // ... more sections
  },
  "VCS": {
    "41": { "9": { "DATA": { "VALUE": "NORTH SIDE (EAST OF WASH)" } } }
    // ... more VCS codes
  },
  
  // Microsystems Format
  "520CLON9999": "COLONIAL",
  "500SNGL9999": "SINGLE FAMILY",
  "210BCLR9999": "BIDDLE CREEK LOW RES"
  // ... flat key-value pairs with prefix codes
}
```

#### **jobs.vendor_detection**
**Used by:** FileUploadButton, data processors

```javascript
vendor_detection: {
  detectedVendor: "BRT" | "Microsystems",
  confidence: number,              // 0-100
  indicators: {
    hasCAMAFields: boolean,
    hasBRTStructure: boolean,
    hasMicrosystemsPrefix: boolean,
    fieldCount: number
  },
  detectedAt: timestamp
}
```

#### **jobs.infoby_category_config**
**Used by:** ProductionTracker for inspector categorization

```javascript
infoby_category_config: {
  categories: {
    "FIELD": ["F", "FLD", "FIELD"],           // Field inspector codes
    "APPT": ["A", "APT", "APPT"],             // Appointment codes
    "OFFICE": ["O", "OFC", "OFFICE"],         // Office review codes
    "CLIENT": ["C", "CLT", "CLIENT"],         // Client-provided codes
    "EXTERNAL": ["EXT", "EXTERNAL", "VENDOR"] // External inspector codes
  },
  customCodes: {
    "JIM": "FIELD",      // Manager overrides
    "SARAH": "APPT"
  },
  lastModified: timestamp
}
```

#### **market_land_valuation.eco_obs_code_config**
**Used by:** LandValuationTab Economic Obsolescence section

```javascript
eco_obs_code_config: {
  defaultCodes: [
    { code: "BS", name: "Busy Street", adjustment: -8, isNegative: true },
    { code: "RR", name: "Railroad", adjustment: -5, isNegative: true },
    { code: "HW", name: "Highway", adjustment: -10, isNegative: true },
    { code: "WF", name: "Waterfront", adjustment: +15, isNegative: false },
    { code: "PK", name: "Park", adjustment: +5, isNegative: false }
    // ... more codes
  ],
  customCodes: [
    { code: "NZ", name: "Noise Zone", adjustment: -7, isNegative: true }
    // User-defined codes
  ],
  trafficLevels: {
    "BS": {
      "5000": -3,    // ADT (Average Daily Traffic)
      "10000": -5,
      "25000": -8,
      "50000": -12
    }
  },
  compoundRules: {
    "BS/RR": { method: "additive", cap: -15 },
    "WF/PK": { method: "multiplicative", boost: 1.25 }
  }
}
```

#### **market_land_valuation.eco_obs_applied_adjustments**
**Used by:** LandValuationTab to track actual property adjustments

```javascript
eco_obs_applied_adjustments: {
  "property_composite_key_1": {
    factors: ["BS", "RR"],
    adjustments: [-8, -5],
    totalAdjustment: -13,
    compoundOverride: false,
    appliedDate: timestamp
  },
  "property_composite_key_2": {
    factors: ["WF"],
    adjustments: [+15],
    totalAdjustment: +15,
    appliedDate: timestamp
  }
  // ... per-property adjustments
}
```

#### **market_land_valuation.worksheet_data**
**Used by:** LandValuationTab VCS Sheet configuration

```javascript
worksheet_data: {
  "A1": {  // VCS Code
    actSite: 45000,           // Manual override rate
    recSite: 42500,           // Calculated recommendation
    vcsType: "Residential",
    zoning: {
      minLotSize: 0.25,       // acres
      maxFAR: 0.35,
      setbacks: {
        front: 25,
        side: 10,
        rear: 30
      },
      specialRestrictions: "Historic district overlay"
    },
    specialRegion: "Historic",
    propertyCount: 1234
  }
  // ... more VCS codes
}
```

#### **market_land_valuation.cascade_rates**
**Used by:** LandValuationTab Rate Tables section

```javascript
cascade_rates: {
  "A1": {  // VCS Code
    mode: "acre",  // or "squarefoot" or "frontfoot"
    breakPoints: [
      { min: 0.00, max: 0.50, rate: 45000, degradation: 0 },
      { min: 0.51, max: 1.00, rate: 42000, degradation: -6.7 },
      { min: 1.01, max: 2.00, rate: 38000, degradation: -15.6 },
      { min: 2.01, max: 5.00, rate: 32000, degradation: -28.9 },
      { min: 5.01, max: 10.0, rate: 25000, degradation: -44.4 },
      { min: 10.01, max: null, rate: 18000, degradation: -60.0 }
    ],
    method: "automatic"  // or "manual"
  }
  // ... more VCS codes
}
```

#### **market_land_valuation.allocation_study**
**Used by:** LandValuationTab Allocation Study section

```javascript
allocation_study: {
  targetAllocation: 30,  // Target percentage
  results: {
    "A1": {  // VCS Code
      avgAllocation: 28.5,
      targetAllocation: 30,
      withinRange: true,
      outliers: [
        { propertyKey: "2024-123-45", allocation: 45.2, reason: "high land value" }
      ],
      propertyCount: 1234
    }
    // ... more VCS codes
  },
  calculatedAt: timestamp
}
```

#### **property_market_analysis.sales_history**
**Used by:** PreValuationTab, various market analysis tabs

```javascript
sales_history: {
  timeNormalized: {
    targetYear: 2012,
    hpiMultiplier: 1.15,
    normalizedPrice: 285000,
    originalPrice: 247826,
    appliedDate: timestamp
  },
  sizeNormalized: {
    method: "jim_50_percent",
    groupAvgSize: 1850,
    propertySize: 1920,
    adjustment: -5925,
    normalizedPrice: 319075,
    appliedDate: timestamp
  },
  outlierStatus: {
    isOutlier: false,
    ratio: 0.685,
    equalizationRatio: 0.70,
    threshold: 0.15,
    decision: "keep"  // or "reject" or "pending"
  }
}
```

#### **payroll_periods.processing_settings**
**Used by:** PayrollManagement for bonus calculations

```javascript
processing_settings: {
  bonusCalculation: {
    enabled: true,
    startDate: "2024-01-15",
    endDate: "2024-01-28",
    payPerProperty: 2.50,
    minimumProperties: 100
  },
  overtimeRules: {
    enabled: true,
    weeklyThreshold: 40,
    dailyThreshold: 8,
    overtimeMultiplier: 1.5
  },
  appointmentBonus: {
    enabled: true,
    appointmentRate: 5.00
  }
}
```

#### **comparison_reports.report_data**
**Used by:** FileUploadButton comparison engine

```javascript
report_data: {
  summary: {
    propertiesAdded: 45,
    propertiesModified: 234,
    propertiesRemoved: 12,
    totalProperties: 5234
  },
  fieldChanges: {
    "asset_building_class": { changed: 89, percentChanged: 1.7 },
    "asset_ext_cond": { changed: 156, percentChanged: 3.0 }
    // ... per-field statistics
  },
  significantChanges: [
    {
      propertyKey: "2024-123-45",
      field: "sale_price",
      oldValue: 250000,
      newValue: 285000,
      changePercent: 14.0
    }
    // ... flagged changes
  ]
}
```

