import React, { useState } from 'react';
import { interpretCodes } from '../lib/supabaseClient';

const MicrosystemsDiagnostic = ({ properties = [], jobData = {} }) => {
  const [diagnosticResults, setDiagnosticResults] = useState(null);
  const [isRunning, setIsRunning] = useState(false);

  const runDiagnostic = () => {
    setIsRunning(true);
    
    try {
      const vendorType = jobData?.vendor_type || 'Unknown';
      const codeDefinitions = jobData?.parsed_code_definitions || {};
      
      // Find properties with SLATE or COAL in asset_design_style
      const problematicProperties = properties.filter(p => {
        const designStyle = p.asset_design_style || '';
        return designStyle.toUpperCase().includes('SLATE') || designStyle.toUpperCase().includes('COAL');
      });
      
      console.log('🔍 Found properties with SLATE/COAL in asset_design_style:', problematicProperties.length);
      
      const results = {
        vendorType,
        totalProperties: properties.length,
        problematicProperties: problematicProperties.length,
        codeDefinitionsStructure: {
          hasDefinitions: !!codeDefinitions,
          hasFieldCodes: !!codeDefinitions.field_codes,
          hasFlatLookup: !!codeDefinitions.flat_lookup,
          fieldCodePrefixes: codeDefinitions.field_codes ? Object.keys(codeDefinitions.field_codes) : [],
          flatLookupKeys: codeDefinitions.flat_lookup ? Object.keys(codeDefinitions.flat_lookup).slice(0, 10) : []
        },
        sampleProblematicData: problematicProperties.slice(0, 5).map(p => ({
          composite_key: p.property_composite_key,
          asset_design_style: p.asset_design_style,
          interpreted_design: interpretCodes.getMicrosystemsValue?.(p, codeDefinitions, 'asset_design_style'),
          asset_type_use: p.asset_type_use,
          asset_building_class: p.asset_building_class
        })),
        prefixMappingTest: {
          design_style_prefix: interpretCodes.microsystemsPrefixMap?.asset_design_style,
          roof_type_prefix: interpretCodes.microsystemsPrefixMap?.roof_type,
          heat_source_prefix: interpretCodes.microsystemsPrefixMap?.heat_source
        }
      };
      
      // Test specific codes
      if (codeDefinitions.field_codes) {
        results.codeTests = {
          slate_in_540: codeDefinitions.field_codes['540'] ? Object.keys(codeDefinitions.field_codes['540']).filter(k => k.includes('SLATE')) : [],
          coal_in_565: codeDefinitions.field_codes['565'] ? Object.keys(codeDefinitions.field_codes['565']).filter(k => k.includes('COAL')) : [],
          slate_in_520: codeDefinitions.field_codes['520'] ? Object.keys(codeDefinitions.field_codes['520']).filter(k => k.includes('SLATE')) : [],
          coal_in_520: codeDefinitions.field_codes['520'] ? Object.keys(codeDefinitions.field_codes['520']).filter(k => k.includes('COAL')) : []
        };
      }
      
      setDiagnosticResults(results);
      
    } catch (error) {
      console.error('Diagnostic error:', error);
      setDiagnosticResults({ error: error.message });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">🔍 Microsystems Code Diagnostic</h2>
        <button
          onClick={runDiagnostic}
          disabled={isRunning}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {isRunning ? 'Running...' : 'Run Diagnostic'}
        </button>
      </div>
      
      {diagnosticResults && (
        <div className="space-y-4">
          {diagnosticResults.error ? (
            <div className="bg-red-50 border border-red-200 rounded p-4">
              <div className="text-red-800">Error: {diagnosticResults.error}</div>
            </div>
          ) : (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded p-4">
                <h3 className="font-medium mb-2">Basic Info</h3>
                <div className="text-sm space-y-1">
                  <div>Vendor Type: {diagnosticResults.vendorType}</div>
                  <div>Total Properties: {diagnosticResults.totalProperties}</div>
                  <div>Properties with SLATE/COAL in asset_design_style: {diagnosticResults.problematicProperties}</div>
                </div>
              </div>
              
              <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
                <h3 className="font-medium mb-2">Code Definitions Structure</h3>
                <div className="text-sm space-y-1">
                  <div>Has Definitions: {String(diagnosticResults.codeDefinitionsStructure.hasDefinitions)}</div>
                  <div>Has Field Codes: {String(diagnosticResults.codeDefinitionsStructure.hasFieldCodes)}</div>
                  <div>Has Flat Lookup: {String(diagnosticResults.codeDefinitionsStructure.hasFlatLookup)}</div>
                  <div>Field Code Prefixes: {diagnosticResults.codeDefinitionsStructure.fieldCodePrefixes.join(', ')}</div>
                  <div>Sample Flat Lookup Keys: {diagnosticResults.codeDefinitionsStructure.flatLookupKeys.join(', ')}</div>
                </div>
              </div>
              
              {diagnosticResults.codeTests && (
                <div className="bg-green-50 border border-green-200 rounded p-4">
                  <h3 className="font-medium mb-2">Code Location Tests</h3>
                  <div className="text-sm space-y-1">
                    <div>SLATE in roof_type (540): {diagnosticResults.codeTests.slate_in_540.join(', ') || 'None'}</div>
                    <div>COAL in heat_source (565): {diagnosticResults.codeTests.coal_in_565.join(', ') || 'None'}</div>
                    <div>SLATE in design_style (520): {diagnosticResults.codeTests.slate_in_520.join(', ') || 'None'}</div>
                    <div>COAL in design_style (520): {diagnosticResults.codeTests.coal_in_520.join(', ') || 'None'}</div>
                  </div>
                </div>
              )}
              
              <div className="bg-purple-50 border border-purple-200 rounded p-4">
                <h3 className="font-medium mb-2">Prefix Mapping Test</h3>
                <div className="text-sm space-y-1">
                  <div>asset_design_style maps to prefix: {diagnosticResults.prefixMappingTest.design_style_prefix}</div>
                  <div>roof_type maps to prefix: {diagnosticResults.prefixMappingTest.roof_type_prefix}</div>
                  <div>heat_source maps to prefix: {diagnosticResults.prefixMappingTest.heat_source_prefix}</div>
                </div>
              </div>
              
              {diagnosticResults.sampleProblematicData.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded p-4">
                  <h3 className="font-medium mb-2">Sample Problematic Properties</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2">Composite Key</th>
                          <th className="text-left p-2">Raw Design Style</th>
                          <th className="text-left p-2">Interpreted Design</th>
                          <th className="text-left p-2">Type Use</th>
                          <th className="text-left p-2">Building Class</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diagnosticResults.sampleProblematicData.map((prop, idx) => (
                          <tr key={idx} className="border-b">
                            <td className="p-2">{prop.composite_key}</td>
                            <td className="p-2 font-mono">{prop.asset_design_style}</td>
                            <td className="p-2">{prop.interpreted_design}</td>
                            <td className="p-2">{prop.asset_type_use}</td>
                            <td className="p-2">{prop.asset_building_class}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default MicrosystemsDiagnostic;
