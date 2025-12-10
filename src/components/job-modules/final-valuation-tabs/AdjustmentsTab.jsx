import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { Save, Plus, Trash2, Settings } from 'lucide-react';

const AdjustmentsTab = ({ jobData = {} }) => {
  const [activeSubTab, setActiveSubTab] = useState('adjustments');
  const [adjustments, setAdjustments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [garageConfig, setGarageConfig] = useState({
    garageTypeCode: null,
    garageDetachedCode: null
  });

  // CME Price Brackets (matching OverallAnalysisTab)
  const CME_BRACKETS = [
    { min: 0, max: 99999, label: 'up to $99,999', shortLabel: '$0-$99,999', color: '#FF9999', textColor: 'black' },
    { min: 100000, max: 199999, label: '$100,000-$199,999', shortLabel: '$100K-$199K', color: '#FFB366', textColor: 'black' },
    { min: 200000, max: 299999, label: '$200,000-$299,999', shortLabel: '$200K-$299K', color: '#FFCC99', textColor: 'black' },
    { min: 300000, max: 399999, label: '$300,000-$399,999', shortLabel: '$300K-$399K', color: '#FFFF99', textColor: 'black' },
    { min: 400000, max: 499999, label: '$400,000-$499,999', shortLabel: '$400K-$499K', color: '#CCFF99', textColor: 'black' },
    { min: 500000, max: 749999, label: '$500,000-$749,999', shortLabel: '$500K-$749K', color: '#99FF99', textColor: 'black' },
    { min: 750000, max: 999999, label: '$750,000-$999,999', shortLabel: '$750K-$999K', color: '#99CCFF', textColor: 'black' },
    { min: 1000000, max: 1499999, label: '$1,000,000-$1,499,999', shortLabel: '$1M-$1.5M', color: '#9999FF', textColor: 'black' },
    { min: 1500000, max: 1999999, label: '$1,500,000-$1,999,999', shortLabel: '$1.5M-$2M', color: '#CC99FF', textColor: 'black' },
    { min: 2000000, max: 99999999, label: 'Over $2,000,000', shortLabel: 'Over $2M', color: '#FF99FF', textColor: 'black' }
  ];

  // Default adjustment attributes
  const DEFAULT_ADJUSTMENTS = [
    { id: 'area_sqft', name: 'Area or Sq Ft', type: 'flat', isDefault: true, category: 'physical' },
    { id: 'living_area', name: 'Living Area (Sq Ft)', type: 'per_sqft', isDefault: true, category: 'physical' },
    { id: 'basement', name: 'Basement', type: 'flat', isDefault: true, category: 'physical' },
    { id: 'finished_basement', name: 'Finished Basement', type: 'flat', isDefault: true, category: 'physical' },
    { id: 'bathrooms', name: 'Bathrooms', type: 'flat', isDefault: true, category: 'physical' },
    { id: 'bedrooms', name: 'Bedrooms', type: 'flat', isDefault: true, category: 'physical' },
    { id: 'garage', name: 'Garage', type: 'flat', isDefault: true, category: 'physical' },
    { id: 'fireplaces', name: 'Fireplaces', type: 'flat', isDefault: true, category: 'physical' },
    { id: 'deck', name: 'Deck', type: 'flat', isDefault: true, category: 'amenity' },
    { id: 'deck_sqft', name: 'Deck sq. ft.', type: 'flat', isDefault: true, category: 'amenity' },
    { id: 'open_porch', name: 'Open Porch', type: 'flat', isDefault: true, category: 'amenity' },
    { id: 'patio', name: 'Patio', type: 'flat', isDefault: true, category: 'amenity' },
    { id: 'enclosed_porch', name: 'Enclosed Porch', type: 'flat', isDefault: true, category: 'amenity' },
    { id: 'condition', name: 'Condition', type: 'flat_or_percent', isDefault: true, category: 'quality' },
    { id: 'location', name: 'Location', type: 'flat', isDefault: true, category: 'location' },
    { id: 'miscellaneous', name: 'Miscellaneous', type: 'flat', isDefault: true, category: 'other' }
  ];

  // Load adjustments from database
  useEffect(() => {
    if (!jobData?.id) return;
    loadAdjustments();
    loadGarageConfig();
  }, [jobData?.id]);

  const loadAdjustments = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('job_adjustment_grid')
        .select('*')
        .eq('job_id', jobData.id)
        .order('sort_order');

      if (error) throw error;

      if (data && data.length > 0) {
        setAdjustments(data);
      } else {
        // Initialize with defaults
        const defaultData = DEFAULT_ADJUSTMENTS.map((adj, idx) => ({
          job_id: jobData.id,
          adjustment_id: adj.id,
          adjustment_name: adj.name,
          adjustment_type: adj.type,
          category: adj.category,
          is_default: adj.isDefault,
          sort_order: idx,
          bracket_0: 0,
          bracket_1: 0,
          bracket_2: 0,
          bracket_3: 0,
          bracket_4: 0,
          bracket_5: 0,
          bracket_6: 0,
          bracket_7: 0,
          bracket_8: 0,
          bracket_9: 0
        }));
        setAdjustments(defaultData);
      }
    } catch (error) {
      console.error('Error loading adjustments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadGarageConfig = async () => {
    try {
      const { data, error } = await supabase
        .from('job_settings')
        .select('setting_key, setting_value')
        .eq('job_id', jobData.id)
        .in('setting_key', ['garage_type_code', 'garage_detached_code'])
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setGarageConfig({
          garageTypeCode: data.find(s => s.setting_key === 'garage_type_code')?.setting_value,
          garageDetachedCode: data.find(s => s.setting_key === 'garage_detached_code')?.setting_value
        });
      }
    } catch (error) {
      console.error('Error loading garage config:', error);
    }
  };

  const handleAdjustmentChange = (adjustmentId, bracketIndex, value) => {
    setAdjustments(prev => prev.map(adj => {
      if (adj.adjustment_id === adjustmentId) {
        return {
          ...adj,
          [`bracket_${bracketIndex}`]: parseFloat(value) || 0
        };
      }
      return adj;
    }));
  };

  const handleSaveAdjustments = async () => {
    try {
      setIsSaving(true);

      const { error } = await supabase
        .from('job_adjustment_grid')
        .upsert(adjustments, {
          onConflict: 'job_id,adjustment_id'
        });

      if (error) throw error;

      alert('Adjustments saved successfully!');
    } catch (error) {
      console.error('Error saving adjustments:', error);
      alert(`Failed to save: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddCustomAdjustment = () => {
    const customName = prompt('Enter custom adjustment name:');
    if (!customName) return;

    const newAdj = {
      job_id: jobData.id,
      adjustment_id: `custom_${Date.now()}`,
      adjustment_name: customName,
      adjustment_type: 'flat',
      category: 'custom',
      is_default: false,
      sort_order: adjustments.length,
      bracket_0: 0,
      bracket_1: 0,
      bracket_2: 0,
      bracket_3: 0,
      bracket_4: 0,
      bracket_5: 0,
      bracket_6: 0,
      bracket_7: 0,
      bracket_8: 0,
      bracket_9: 0
    };

    setAdjustments(prev => [...prev, newAdj]);
  };

  const handleDeleteAdjustment = async (adjustmentId) => {
    if (!window.confirm('Delete this adjustment?')) return;

    try {
      const { error } = await supabase
        .from('job_adjustment_grid')
        .delete()
        .eq('job_id', jobData.id)
        .eq('adjustment_id', adjustmentId);

      if (error) throw error;

      setAdjustments(prev => prev.filter(adj => adj.adjustment_id !== adjustmentId));
    } catch (error) {
      console.error('Error deleting adjustment:', error);
      alert(`Failed to delete: ${error.message}`);
    }
  };

  const handleTypeChange = (adjustmentId, newType) => {
    setAdjustments(prev => prev.map(adj => {
      if (adj.adjustment_id === adjustmentId) {
        return { ...adj, adjustment_type: newType };
      }
      return adj;
    }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading adjustments...</div>
      </div>
    );
  }

  return (
    <div className="adjustments-tab">
      {/* Sub-tab Navigation */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveSubTab('adjustments')}
            className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${
              activeSubTab === 'adjustments'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Adjustment Grid
          </button>
          <button
            onClick={() => setActiveSubTab('config')}
            className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm inline-flex items-center gap-2 ${
              activeSubTab === 'config'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Settings className="w-4 h-4" />
            Configuration
          </button>
        </nav>
      </div>

      {/* Adjustment Grid Tab */}
      {activeSubTab === 'adjustments' && (
        <div>
          {/* Header Actions */}
          <div className="mb-6 flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Sales Adjustment Grid</h3>
              <p className="text-sm text-gray-600 mt-1">
                Define adjustments by price bracket for comparable sales analysis
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddCustomAdjustment}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 border border-gray-300"
              >
                <Plus className="w-4 h-4" />
                Add Custom
              </button>
              <button
                onClick={handleSaveAdjustments}
                disabled={isSaving}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'Saving...' : 'Save Adjustments'}
              </button>
            </div>
          </div>

          {/* Adjustment Grid Table */}
          <div className="overflow-x-auto border rounded-lg">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200">
                    Attribute
                  </th>
                  {CME_BRACKETS.map((bracket, idx) => (
                    <th
                      key={idx}
                      className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider"
                      style={{ backgroundColor: bracket.color, color: bracket.textColor }}
                    >
                      {bracket.shortLabel}
                    </th>
                  ))}
                  <th className="sticky right-0 z-10 bg-gray-50 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider border-l border-gray-200">
                    Type
                  </th>
                  <th className="bg-gray-50 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {adjustments.map((adj) => (
                  <tr key={adj.adjustment_id} className="hover:bg-gray-50">
                    <td className="sticky left-0 z-10 bg-white px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 border-r border-gray-200">
                      {adj.adjustment_name}
                    </td>
                    {CME_BRACKETS.map((bracket, bIdx) => (
                      <td
                        key={bIdx}
                        className="px-2 py-2 text-center"
                        style={{ backgroundColor: `${bracket.color}33` }}
                      >
                        <input
                          type="number"
                          value={adj[`bracket_${bIdx}`] || 0}
                          onChange={(e) => handleAdjustmentChange(adj.adjustment_id, bIdx, e.target.value)}
                          className="w-20 px-2 py-1 text-sm text-center border rounded focus:ring-2 focus:ring-blue-500"
                          step={adj.adjustment_type === 'per_sqft' ? '0.01' : '100'}
                        />
                      </td>
                    ))}
                    <td className="sticky right-20 z-10 bg-white px-2 py-2 text-center border-l border-gray-200">
                      <select
                        value={adj.adjustment_type}
                        onChange={(e) => handleTypeChange(adj.adjustment_id, e.target.value)}
                        className="text-xs border rounded px-2 py-1"
                        disabled={adj.is_default && adj.adjustment_type !== 'flat_or_percent'}
                      >
                        <option value="flat">Flat ($)</option>
                        <option value="per_sqft">Per SF ($/SF)</option>
                        {adj.adjustment_type === 'flat_or_percent' && (
                          <option value="percent">Percent (%)</option>
                        )}
                      </select>
                    </td>
                    <td className="sticky right-0 z-10 bg-white px-4 py-2 text-center">
                      {!adj.is_default && (
                        <button
                          onClick={() => handleDeleteAdjustment(adj.adjustment_id)}
                          className="text-red-600 hover:text-red-800"
                          title="Delete adjustment"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="mt-6 p-4 bg-gray-50 rounded border border-gray-200">
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Adjustment Types:</h4>
            <ul className="text-sm text-gray-700 space-y-1">
              <li><strong>Flat ($)</strong> - Fixed dollar amount adjustment</li>
              <li><strong>Per SF ($/SF)</strong> - Adjustment per square foot (e.g., Living Area)</li>
              <li><strong>Percent (%)</strong> - Percentage-based adjustment (available for Condition)</li>
            </ul>
          </div>
        </div>
      )}

      {/* Configuration Tab */}
      {activeSubTab === 'config' && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Garage Configuration</h3>
          <p className="text-sm text-gray-600 mb-6">
            Configure which property attributes identify garages for adjustment calculations
          </p>

          <div className="max-w-2xl space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Garage Type Code
              </label>
              <input
                type="text"
                value={garageConfig.garageTypeCode || ''}
                onChange={(e) => setGarageConfig(prev => ({ ...prev, garageTypeCode: e.target.value }))}
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., G1, GAR"
              />
              <p className="text-xs text-gray-500 mt-1">
                Enter the code(s) that identify attached garages in your data
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Detached Garage Code
              </label>
              <input
                type="text"
                value={garageConfig.garageDetachedCode || ''}
                onChange={(e) => setGarageConfig(prev => ({ ...prev, garageDetachedCode: e.target.value }))}
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., G2, DGAR"
              />
              <p className="text-xs text-gray-500 mt-1">
                Enter the code(s) that identify detached garages in your data
              </p>
            </div>

            <button
              onClick={async () => {
                try {
                  await supabase.from('job_settings').upsert([
                    { job_id: jobData.id, setting_key: 'garage_type_code', setting_value: garageConfig.garageTypeCode },
                    { job_id: jobData.id, setting_key: 'garage_detached_code', setting_value: garageConfig.garageDetachedCode }
                  ]);
                  alert('Garage configuration saved!');
                } catch (error) {
                  alert(`Failed to save: ${error.message}`);
                }
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Save Configuration
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdjustmentsTab;
