import React, { useState, useEffect } from 'react';
import { Calculator, Download, Upload, AlertCircle } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';

const RatableComparisonTab = ({ jobData, properties, onUpdateJobCache }) => {
  const [rosterImportDate, setRosterImportDate] = useState(null);
  const [isImporting, setIsImporting] = useState(false);

  // Load roster import timestamp
  useEffect(() => {
    if (jobData?.id) {
      loadRosterImportDate();
    }
  }, [jobData?.id]);

  const loadRosterImportDate = async () => {
    try {
      const { data, error } = await supabase
        .from('job_metadata')
        .select('roster_import_date')
        .eq('job_id', jobData.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      setRosterImportDate(data?.roster_import_date);
    } catch (error) {
      console.error('Error loading roster import date:', error);
    }
  };

  const handleImportRoster = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsImporting(true);
    try {
      // TODO: Implement Excel import logic
      // This will read the Excel file and update the final_valuation_data table
      
      // Update import timestamp
      const importDate = new Date().toISOString();
      const { error } = await supabase
        .from('job_metadata')
        .upsert({
          job_id: jobData.id,
          roster_import_date: importDate
        }, {
          onConflict: 'job_id'
        });

      if (error) throw error;
      
      setRosterImportDate(importDate);
      if (onUpdateJobCache) onUpdateJobCache();
      
      alert('Roster imported successfully!');
    } catch (error) {
      console.error('Error importing roster:', error);
      alert('Error importing roster: ' + error.message);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Ratable Comparison & Rate Calculator</h2>
          <p className="text-sm text-gray-600 mt-1">
            Import final roster from Excel and apply tax rates
          </p>
        </div>
      </div>

      {/* Import Status */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-semibold text-blue-900">Roster Import Status</h4>
            {rosterImportDate ? (
              <p className="text-sm text-blue-800 mt-1">
                Last imported: {new Date(rosterImportDate).toLocaleString()}
              </p>
            ) : (
              <p className="text-sm text-blue-800 mt-1">
                No roster imported yet. Build and edit roster in Market Data tab, then import here.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4">
        <label className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 cursor-pointer">
          <Upload className="w-4 h-4" />
          {isImporting ? 'Importing...' : 'Import Final Roster'}
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleImportRoster}
            className="hidden"
            disabled={isImporting}
          />
        </label>

        <button
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          disabled={!rosterImportDate}
        >
          <Calculator className="w-4 h-4" />
          Apply Tax Rates
        </button>
      </div>

      {/* Placeholder for future content */}
      <div className="bg-white rounded-lg border border-gray-200 p-8">
        <div className="text-center text-gray-500">
          <Calculator className="w-16 h-16 mx-auto mb-4 text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">Rate Calculator Coming Soon</h3>
          <p className="text-sm">
            This tab will display ratable comparisons and allow you to calculate and apply tax rates.
          </p>
        </div>
      </div>
    </div>
  );
};

export default RatableComparisonTab;
