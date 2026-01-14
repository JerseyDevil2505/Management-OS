import React, { useState, useMemo } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Filter, TrendingUp, PieChart as PieIcon, BarChart3, Download, Calendar } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';

const DataVisualizations = ({ jobData, properties }) => {
  const [filters, setFilters] = useState({
    type: 'all',
    use: 'all',
    vcs: 'all',
    designStyle: 'all',
    yearRange: 'all'
  });

  // Sales NU date range state - default to October 1st prior year to current date
  const [nuDateRange, setNuDateRange] = useState(() => {
    const now = new Date();
    const priorYear = now.getFullYear() - 1;
    const startDate = new Date(priorYear, 9, 1); // October 1st of prior year
    return {
      start: startDate.toISOString().split('T')[0],
      end: now.toISOString().split('T')[0]
    };
  });

  // Usable Sales date range state - default to October 1st prior year to current date
  const [usableDateRange, setUsableDateRange] = useState(() => {
    const now = new Date();
    const priorYear = now.getFullYear() - 1;
    const startDate = new Date(priorYear, 9, 1); // October 1st of prior year
    return {
      start: startDate.toISOString().split('T')[0],
      end: now.toISOString().split('T')[0]
    };
  });

  // Extract unique filter values
  const filterOptions = useMemo(() => {
    const types = new Set();
    const uses = new Set();
    const vcsValues = new Set();
    const designStyles = new Set();

    properties.forEach(prop => {
      if (prop.property_type) types.add(prop.property_type);
      if (prop.property_use) uses.add(prop.property_use);
      if (prop.property_vcs) vcsValues.add(prop.property_vcs);
      if (prop.property_design_style) designStyles.add(prop.property_design_style);
    });

    return {
      types: Array.from(types).sort(),
      uses: Array.from(uses).sort(),
      vcsValues: Array.from(vcsValues).sort(),
      designStyles: Array.from(designStyles).sort()
    };
  }, [properties]);

  // Apply filters to properties
  const filteredProperties = useMemo(() => {
    return properties.filter(prop => {
      if (filters.type !== 'all' && prop.property_type !== filters.type) return false;
      if (filters.use !== 'all' && prop.property_use !== filters.use) return false;
      if (filters.vcs !== 'all' && prop.property_vcs !== filters.vcs) return false;
      if (filters.designStyle !== 'all' && prop.property_design_style !== filters.designStyle) return false;
      
      if (filters.yearRange !== 'all' && prop.sales_date) {
        const saleYear = new Date(prop.sales_date).getFullYear();
        const endYear = parseInt(jobData.end_date?.substring(0, 4) || new Date().getFullYear());
        
        switch (filters.yearRange) {
          case 'hsp':
            if (saleYear < endYear - 3 || saleYear > endYear - 2) return false;
            break;
          case 'psp':
            if (saleYear < endYear - 2 || saleYear > endYear - 1) return false;
            break;
          case 'csp':
            if (saleYear < endYear - 1 || saleYear > endYear) return false;
            break;
          default:
            break;
        }
      }
      
      return true;
    });
  }, [properties, filters, jobData.end_date]);

  // Market History - Properties with values_norm_time
  const marketHistoryData = useMemo(() => {
    const salesByYear = {};

    // Filter for properties with values_norm_time (normalized/adjusted sales)
    const qualifiedProperties = filteredProperties.filter(prop => {
      return prop.values_norm_time && prop.values_norm_time > 0;
    });
    
    qualifiedProperties.forEach(prop => {
      if (prop.sales_date && prop.sales_price && prop.sales_price > 0) {
        const year = new Date(prop.sales_date).getFullYear();
        if (!salesByYear[year]) {
          salesByYear[year] = {
            year,
            totalSales: 0,
            count: 0,
            sales: []
          };
        }
        salesByYear[year].totalSales += prop.sales_price;
        salesByYear[year].count++;
        salesByYear[year].sales.push(prop.sales_price);
      }
    });

    return Object.values(salesByYear)
      .map(yearData => ({
        year: yearData.year,
        avgPrice: Math.round(yearData.totalSales / yearData.count),
        medianPrice: Math.round(
          yearData.sales.sort((a, b) => a - b)[Math.floor(yearData.sales.length / 2)]
        ),
        count: yearData.count,
        minPrice: Math.min(...yearData.sales),
        maxPrice: Math.max(...yearData.sales)
      }))
      .sort((a, b) => a.year - b.year);
  }, [filteredProperties]);

  // Sales NU Distribution - filtered by date range
  const salesNuData = useMemo(() => {
    const nuCounts = {
      'NU': 0,
      'U': 0,
      'Other': 0
    };

    const startDate = new Date(nuDateRange.start);
    const endDate = new Date(nuDateRange.end);

    filteredProperties.forEach(prop => {
      if (prop.sales_date) {
        const saleDate = new Date(prop.sales_date);
        if (saleDate >= startDate && saleDate <= endDate) {
          const nuCode = (prop.sales_nu || '').toUpperCase().trim();
          if (nuCode === 'NU' || nuCode === 'N') {
            nuCounts['NU']++;
          } else if (nuCode === 'U' || nuCode === '') {
            nuCounts['U']++;
          } else {
            nuCounts['Other']++;
          }
        }
      }
    });

    return Object.entries(nuCounts)
      .map(([name, value]) => ({ name, value }))
      .filter(item => item.value > 0);
  }, [filteredProperties, nuDateRange]);

  // Usable vs Non-Usable Sales - filtered by date range
  const usableSalesData = useMemo(() => {
    const usableCounts = {
      'Usable': 0,
      'Non-Usable': 0,
      'No Sale Data': 0
    };

    const startDate = new Date(usableDateRange.start);
    const endDate = new Date(usableDateRange.end);

    filteredProperties.forEach(prop => {
      if (!prop.sales_date || !prop.sales_price) {
        usableCounts['No Sale Data']++;
      } else {
        const saleDate = new Date(prop.sales_date);
        if (saleDate >= startDate && saleDate <= endDate) {
          if (prop.sales_nu === 'NU' || prop.sales_nu === 'N') {
            usableCounts['Non-Usable']++;
          } else {
            usableCounts['Usable']++;
          }
        }
      }
    });

    return Object.entries(usableCounts)
      .map(([name, value]) => ({ name, value }))
      .filter(item => item.value > 0);
  }, [filteredProperties, usableDateRange]);

  // Design & Style Breakdown
  const designStyleData = useMemo(() => {
    const styleCounts = {};
    
    filteredProperties.forEach(prop => {
      const style = prop.property_design_style || 'Unknown';
      styleCounts[style] = (styleCounts[style] || 0) + 1;
    });

    return Object.entries(styleCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10
  }, [filteredProperties]);

  // Type & Use Breakdown
  const typeUseData = useMemo(() => {
    const typeUseCounts = {};
    
    filteredProperties.forEach(prop => {
      const type = prop.property_type || 'Unknown';
      const use = prop.property_use || 'Unknown';
      const key = `${type} / ${use}`;
      
      typeUseCounts[key] = (typeUseCounts[key] || 0) + 1;
    });

    return Object.entries(typeUseCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12); // Top 12
  }, [filteredProperties]);

  // Building Class Breakdown
  const buildingClassData = useMemo(() => {
    const classCounts = {};
    
    filteredProperties.forEach(prop => {
      const buildingClass = prop.asset_building_class || 'Unknown';
      classCounts[buildingClass] = (classCounts[buildingClass] || 0) + 1;
    });

    return Object.entries(classCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredProperties]);

  // VCS Distribution by Value
  const vcsValueData = useMemo(() => {
    const vcsTotals = {};
    
    filteredProperties.forEach(prop => {
      const vcs = prop.property_vcs || 'Unknown';
      const value = prop.values_cama_total || 0;
      
      if (!vcsTotals[vcs]) {
        vcsTotals[vcs] = {
          vcs,
          totalValue: 0,
          count: 0
        };
      }
      vcsTotals[vcs].totalValue += value;
      vcsTotals[vcs].count++;
    });

    return Object.values(vcsTotals)
      .map(data => ({
        vcs: data.vcs,
        avgValue: Math.round(data.totalValue / data.count),
        totalValue: Math.round(data.totalValue),
        count: data.count
      }))
      .sort((a, b) => a.vcs.localeCompare(b.vcs));
  }, [filteredProperties]);

  // Color palettes
  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
  const PIE_COLORS = {
    'Usable': '#10b981',
    'Non-Usable': '#ef4444',
    'No Sale Data': '#94a3b8',
    'NU': '#ef4444',
    'U': '#10b981',
    'Other': '#f59e0b'
  };

  // Export all charts data
  const exportChartsData = () => {
    const workbook = XLSX.utils.book_new();

    // Market History Sheet
    if (marketHistoryData.length > 0) {
      const marketSheet = XLSX.utils.json_to_sheet(marketHistoryData);
      XLSX.utils.book_append_sheet(workbook, marketSheet, 'Market History');
    }

    // Sales NU Distribution
    if (salesNuData.length > 0) {
      const nuSheet = XLSX.utils.json_to_sheet(salesNuData);
      XLSX.utils.book_append_sheet(workbook, nuSheet, 'Sales NU Distribution');
    }

    // Usable Sales Sheet
    if (usableSalesData.length > 0) {
      const usableSheet = XLSX.utils.json_to_sheet(usableSalesData);
      XLSX.utils.book_append_sheet(workbook, usableSheet, 'Usable Sales');
    }

    // Design & Style Sheet
    if (designStyleData.length > 0) {
      const designSheet = XLSX.utils.json_to_sheet(designStyleData);
      XLSX.utils.book_append_sheet(workbook, designSheet, 'Design & Style');
    }

    // Type & Use Sheet
    if (typeUseData.length > 0) {
      const typeUseSheet = XLSX.utils.json_to_sheet(typeUseData);
      XLSX.utils.book_append_sheet(workbook, typeUseSheet, 'Type & Use');
    }

    // Building Class Sheet
    if (buildingClassData.length > 0) {
      const classSheet = XLSX.utils.json_to_sheet(buildingClassData);
      XLSX.utils.book_append_sheet(workbook, classSheet, 'Building Classes');
    }

    // VCS Value Sheet
    if (vcsValueData.length > 0) {
      const vcsSheet = XLSX.utils.json_to_sheet(vcsValueData);
      XLSX.utils.book_append_sheet(workbook, vcsSheet, 'VCS Analysis');
    }

    XLSX.writeFile(workbook, `Data_Visualization_${jobData.job_name}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Custom Tooltip Components
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-gray-300 rounded-lg shadow-lg">
          <p className="font-semibold text-gray-900">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {entry.name}: {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="data-visualization-container space-y-6">
        {/* Header */}
        <div className="header-section flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Data Visualizations</h2>
            <p className="text-sm text-gray-600 mt-1">
              Interactive charts and analytics • {filteredProperties.length.toLocaleString()} of {properties.length.toLocaleString()} properties shown
            </p>
          </div>
          <button
            onClick={exportChartsData}
            className="export-button flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export Data
          </button>
        </div>

        {/* Filters Section */}
        <div className="filters-panel bg-white rounded-lg border border-gray-200 p-4">
          <div className="filter-header flex items-center gap-2 mb-4">
            <Filter className="w-5 h-5 text-gray-700" />
            <h3 className="text-lg font-semibold text-gray-900">Filters</h3>
          </div>
          
          <div className="filter-grid grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {/* Property Type Filter */}
            <div className="filter-item">
              <label className="filter-label block text-sm font-medium text-gray-700 mb-1">
                Property Type
              </label>
              <select
                value={filters.type}
                onChange={(e) => setFilters({ ...filters, type: e.target.value })}
                className="filter-select w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Types</option>
                {filterOptions.types.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            {/* Property Use Filter */}
            <div className="filter-item">
              <label className="filter-label block text-sm font-medium text-gray-700 mb-1">
                Property Use
              </label>
              <select
                value={filters.use}
                onChange={(e) => setFilters({ ...filters, use: e.target.value })}
                className="filter-select w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Uses</option>
                {filterOptions.uses.map(use => (
                  <option key={use} value={use}>{use}</option>
                ))}
              </select>
            </div>

            {/* VCS Filter */}
            <div className="filter-item">
              <label className="filter-label block text-sm font-medium text-gray-700 mb-1">
                VCS Code
              </label>
              <select
                value={filters.vcs}
                onChange={(e) => setFilters({ ...filters, vcs: e.target.value })}
                className="filter-select w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All VCS</option>
                {filterOptions.vcsValues.map(vcs => (
                  <option key={vcs} value={vcs}>{vcs}</option>
                ))}
              </select>
            </div>

            {/* Design Style Filter */}
            <div className="filter-item">
              <label className="filter-label block text-sm font-medium text-gray-700 mb-1">
                Design Style
              </label>
              <select
                value={filters.designStyle}
                onChange={(e) => setFilters({ ...filters, designStyle: e.target.value })}
                className="filter-select w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Styles</option>
                {filterOptions.designStyles.map(style => (
                  <option key={style} value={style}>{style}</option>
                ))}
              </select>
            </div>

            {/* Year Range Filter */}
            <div className="filter-item">
              <label className="filter-label block text-sm font-medium text-gray-700 mb-1">
                Sales Period
              </label>
              <select
                value={filters.yearRange}
                onChange={(e) => setFilters({ ...filters, yearRange: e.target.value })}
                className="filter-select w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Periods</option>
                <option value="csp">CSP (Current)</option>
                <option value="psp">PSP (Prior)</option>
                <option value="hsp">HSP (Historic)</option>
              </select>
            </div>
          </div>

          {/* Active Filters Display */}
          {Object.values(filters).some(f => f !== 'all') && (
            <div className="active-filters mt-4 flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-gray-700">Active:</span>
              {Object.entries(filters).map(([key, value]) => 
                value !== 'all' && (
                  <span key={key} className="active-filter-tag px-3 py-1 bg-blue-100 text-blue-700 text-sm rounded-full">
                    {key}: {value}
                  </span>
                )
              )}
              <button
                onClick={() => setFilters({ type: 'all', use: 'all', vcs: 'all', designStyle: 'all', yearRange: 'all' })}
                className="clear-filters-button text-sm text-blue-600 hover:text-blue-800 underline ml-2"
              >
                Clear All
              </button>
            </div>
          )}
        </div>

        {/* Market History Chart - FULL WIDTH */}
        <div className="chart-card bg-white rounded-lg border border-gray-200 p-6">
          <div className="chart-header flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              <h3 className="chart-title text-lg font-semibold text-gray-900">Market History</h3>
              <span className="text-xs text-gray-500 ml-2">(Properties with Norm Time)</span>
            </div>
            <div className="text-xs text-gray-600">
              Using Sale Price • Normalized Sales Only
            </div>
          </div>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={marketHistoryData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="year" stroke="#6b7280" />
              <YAxis stroke="#6b7280" tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} formatter={(value) => formatCurrency(value)} />
              <Legend />
              <Line type="monotone" dataKey="avgPrice" name="Average Price" stroke="#3b82f6" strokeWidth={3} dot={{ r: 5 }} />
              <Line type="monotone" dataKey="medianPrice" name="Median Price" stroke="#10b981" strokeWidth={3} dot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
          <div className="chart-stats mt-4 grid grid-cols-4 gap-4 text-center">
            <div className="stat-item">
              <div className="stat-label text-xs text-gray-600">Sales Count</div>
              <div className="stat-value text-lg font-semibold text-gray-900">
                {marketHistoryData.reduce((sum, d) => sum + d.count, 0).toLocaleString()}
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-label text-xs text-gray-600">Year Range</div>
              <div className="stat-value text-lg font-semibold text-gray-900">
                {marketHistoryData.length > 0 ? `${marketHistoryData[0].year} - ${marketHistoryData[marketHistoryData.length - 1].year}` : 'N/A'}
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-label text-xs text-gray-600">Overall Avg</div>
              <div className="stat-value text-lg font-semibold text-gray-900">
                {marketHistoryData.length > 0 ? formatCurrency(
                  marketHistoryData.reduce((sum, d) => sum + d.avgPrice, 0) / marketHistoryData.length
                ) : 'N/A'}
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-label text-xs text-gray-600">Price Range</div>
              <div className="stat-value text-sm font-semibold text-gray-900">
                {marketHistoryData.length > 0 ? `${formatCurrency(Math.min(...marketHistoryData.map(d => d.minPrice)))} - ${formatCurrency(Math.max(...marketHistoryData.map(d => d.maxPrice)))}` : 'N/A'}
              </div>
            </div>
          </div>
        </div>

        {/* Pie Charts Row - Sales Usability and Sales NU Distribution */}
        <div className="charts-grid grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sales Usability Pie */}
          <div className="chart-card bg-white rounded-lg border border-gray-200 p-6">
            <div className="chart-header flex items-center gap-2 mb-4">
              <PieIcon className="w-5 h-5 text-amber-600" />
              <h3 className="chart-title text-lg font-semibold text-gray-900">Sales Usability</h3>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={usableSalesData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent, value }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {usableSalesData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[entry.name] || COLORS[index]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="chart-stats mt-4 grid grid-cols-3 gap-4 text-center">
              {usableSalesData.map(item => (
                <div key={item.name} className="stat-item">
                  <div className="stat-label text-xs text-gray-600">{item.name}</div>
                  <div className="stat-value text-lg font-semibold" style={{ color: PIE_COLORS[item.name] || '#374151' }}>
                    {item.value.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sales NU Distribution Pie with Date Range */}
          <div className="chart-card bg-white rounded-lg border border-gray-200 p-6">
            <div className="chart-header flex items-center gap-2 mb-4">
              <PieIcon className="w-5 h-5 text-green-600" />
              <h3 className="chart-title text-lg font-semibold text-gray-900">Sales NU Distribution</h3>
            </div>
            
            {/* Date Range Selector */}
            <div className="date-range-controls mb-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  <Calendar className="w-3 h-3 inline mr-1" />
                  Start Date
                </label>
                <input
                  type="date"
                  value={nuDateRange.start}
                  onChange={(e) => setNuDateRange({ ...nuDateRange, start: e.target.value })}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  <Calendar className="w-3 h-3 inline mr-1" />
                  End Date
                </label>
                <input
                  type="date"
                  value={nuDateRange.end}
                  onChange={(e) => setNuDateRange({ ...nuDateRange, end: e.target.value })}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={salesNuData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent, value }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                  outerRadius={90}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {salesNuData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[entry.name] || COLORS[index]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="chart-stats mt-4 flex justify-around text-center">
              {salesNuData.map(item => (
                <div key={item.name} className="stat-item">
                  <div className="stat-label text-xs text-gray-600">{item.name}</div>
                  <div className="stat-value text-lg font-semibold" style={{ color: PIE_COLORS[item.name] || '#374151' }}>
                    {item.value.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Design & Style and Type & Use Breakdowns */}
        <div className="charts-grid grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Design & Style Breakdown */}
          <div className="chart-card bg-white rounded-lg border border-gray-200 p-6">
            <div className="chart-header flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-purple-600" />
              <h3 className="chart-title text-lg font-semibold text-gray-900">Design & Style Breakdown</h3>
            </div>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={designStyleData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" stroke="#6b7280" />
                <YAxis dataKey="name" type="category" stroke="#6b7280" width={120} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar dataKey="count" name="Count" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
            <div className="chart-stats mt-4 text-center">
              <div className="stat-label text-xs text-gray-600">Total Styles</div>
              <div className="stat-value text-lg font-semibold text-gray-900">
                {designStyleData.reduce((sum, d) => sum + d.count, 0).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Type & Use Breakdown */}
          <div className="chart-card bg-white rounded-lg border border-gray-200 p-6">
            <div className="chart-header flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-red-600" />
              <h3 className="chart-title text-lg font-semibold text-gray-900">Type & Use Breakdown</h3>
            </div>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={typeUseData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" stroke="#6b7280" />
                <YAxis dataKey="name" type="category" stroke="#6b7280" width={150} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar dataKey="count" name="Count" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
            <div className="chart-stats mt-4 text-center">
              <div className="stat-label text-xs text-gray-600">Total Combinations</div>
              <div className="stat-value text-lg font-semibold text-gray-900">
                {typeUseData.reduce((sum, d) => sum + d.count, 0).toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Additional Charts - Building Class and VCS */}
        <div className="charts-grid grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Building Class Breakdown */}
          <div className="chart-card bg-white rounded-lg border border-gray-200 p-6">
            <div className="chart-header flex items-center gap-2 mb-4">
              <PieIcon className="w-5 h-5 text-teal-600" />
              <h3 className="chart-title text-lg font-semibold text-gray-900">Building Class Distribution</h3>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={buildingClassData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {buildingClassData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="chart-legend mt-4 grid grid-cols-2 gap-2 text-xs">
              {buildingClassData.slice(0, 8).map((item, index) => (
                <div key={item.name} className="legend-item flex items-center gap-2">
                  <div
                    className="legend-color w-3 h-3 rounded"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="legend-text text-gray-700">{item.name}: {item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* VCS Value Distribution */}
          <div className="chart-card bg-white rounded-lg border border-gray-200 p-6">
            <div className="chart-header flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
              <h3 className="chart-title text-lg font-semibold text-gray-900">VCS Average Values</h3>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={vcsValueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="vcs" stroke="#6b7280" />
                <YAxis stroke="#6b7280" tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} formatter={(value) => formatCurrency(value)} />
                <Legend />
                <Bar dataKey="avgValue" name="Average Value" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
            <div className="chart-stats mt-4 text-center">
              <div className="stat-label text-xs text-gray-600">Total Combined Value</div>
              <div className="stat-value text-lg font-semibold text-gray-900">
                {formatCurrency(vcsValueData.reduce((sum, d) => sum + d.totalValue, 0))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DataVisualizations;
