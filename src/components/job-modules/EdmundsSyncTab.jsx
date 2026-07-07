import React, { useState } from 'react';
import { Download, AlertCircle, CheckCircle, AlertTriangle, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabaseClient';

const EdmundsSyncTab = ({ jobData, properties = [] }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Fuzzy string matching
  const stringSimilarity = (str1, str2) => {
    if (!str1 || !str2) return 0;
    const s1 = String(str1).toUpperCase().trim();
    const s2 = String(str2).toUpperCase().trim();
    if (s1 === s2) return 1;

    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    if (longer.length === 0) return 1;

    const editDistance = getEditDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  };

  const getEditDistance = (s1, s2) => {
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
  };

  // Get primary card indicator based on vendor
  const getPrimaryCardIndicator = () => {
    if (jobData?.vendor_type === 'Microsystems') return 'M';
    return '1'; // BRT default
  };

  // Filter to primary cards only
  const getPrimaryProperties = () => {
    const primaryCard = getPrimaryCardIndicator();
    return properties.filter(p => {
      const card = (p.property_card || p.property_addl_card || '').toString().trim().toUpperCase();
      return card === primaryCard || !card; // Include records with no card indicator
    });
  };

  // Detect if lot is subdivided (e.g., lot "1" split into "1.01", "1.02")
  const checkSubdivision = (edmundsBlock, edmundsLot, copilotProps) => {
    const edmundsLotStr = String(edmundsLot).trim();
    const matches = copilotProps.filter(p => {
      const pBlock = String(p.property_block || '').trim();
      const pLot = String(p.property_lot || '').trim();
      return pBlock === edmundsBlock && pLot.startsWith(edmundsLotStr + '.');
    });
    return matches.length > 0 ? matches : null;
  };

  // Check if lot exists as additional card
  const checkAdditionalCard = (edmundsBlock, edmundsLot, edmundsQual) => {
    const allPropsForLot = properties.filter(p => {
      const pBlock = String(p.property_block || '').trim();
      const pLot = String(p.property_lot || '').trim();
      return pBlock === edmundsBlock && pLot === edmundsLot;
    });
    return allPropsForLot.length > 0 ? allPropsForLot : null;
  };

  // Categorize ghost records
  const categorizeGhost = (edmundsRecord, allProps, primaryProps) => {
    const { block, lot, qualifier } = edmundsRecord;
    const blockStr = String(block || '').trim();
    const lotStr = String(lot || '').trim();

    // Check for subdivisions
    const subdivisions = checkSubdivision(blockStr, lotStr, primaryProps);
    if (subdivisions) {
      return {
        category: 'Subdivided',
        details: `Lot became: ${subdivisions.map(p => `${p.property_lot}.${p.property_qualifier || ''}`).join(', ')}`
      };
    }

    // Check for additional cards
    const additionalCards = checkAdditionalCard(blockStr, lotStr, qualifier);
    if (additionalCards && additionalCards.length > 0) {
      const nonPrimary = additionalCards.filter(p => {
        const card = (p.property_card || p.property_addl_card || '').toString().trim();
        const primaryCard = getPrimaryCardIndicator();
        return card !== primaryCard && card;
      });
      if (nonPrimary.length > 0) {
        return {
          category: 'Additional Lot',
          details: `Exists as additional card(s): ${nonPrimary.map(p => `${p.property_block}/${p.property_lot}.${p.property_qualifier || ''}`).join(', ')}`
        };
      }
    }

    // Check if bad block/lot
    const similarLots = allProps.filter(p => {
      const pBlock = String(p.property_block || '').trim();
      const pLot = String(p.property_lot || '').trim();
      return stringSimilarity(pBlock, blockStr) > 0.7 || stringSimilarity(pLot, lotStr) > 0.7;
    });

    if (similarLots.length > 0) {
      return {
        category: 'Potential Match',
        details: `Similar lots exist: ${similarLots.slice(0, 2).map(p => `${p.property_block}/${p.property_lot}`).join(', ')}`
      };
    }

    return { category: 'Bad Block/Lot', details: 'No matching or similar records found' };
  };

  // Compare fields and find discrepancies
  const compareRecords = (edmundsRecord, copilotRecord) => {
    const discrepancies = [];
    const fieldMap = {
      owner: ['owner', 'owner_name'],
      address: ['property_location', 'owner_street'],
      city: ['owner_csz'],
      zip: ['owner_csz'],
      class: ['property_m4_class']
    };

    // Owner comparison
    const edmundsOwner = (edmundsRecord.owner || '').toString().trim();
    const copilotOwner = (copilotRecord.owner_name || '').toString().trim();
    const ownerSim = stringSimilarity(edmundsOwner, copilotOwner);
    if (ownerSim < 0.95 && edmundsOwner && copilotOwner) {
      discrepancies.push({
        field: 'owner',
        edmunds: edmundsOwner,
        copilot: copilotOwner,
        similarity: ownerSim,
        severity: ownerSim < 0.7 ? 'critical' : 'fuzzy'
      });
    }

    // Address comparison
    const edmundsAddr = (edmundsRecord.property_location || '').toString().trim();
    const copilotAddr = (copilotRecord.property_location || '').toString().trim();
    const addrSim = stringSimilarity(edmundsAddr, copilotAddr);
    if (addrSim < 0.95 && edmundsAddr && copilotAddr) {
      discrepancies.push({
        field: 'address',
        edmunds: edmundsAddr,
        copilot: copilotAddr,
        similarity: addrSim,
        severity: addrSim < 0.7 ? 'critical' : 'fuzzy'
      });
    }

    // Class comparison
    const edmundsClass = (edmundsRecord.property_m4_class || '').toString().trim();
    const copilotClass = (copilotRecord.property_m4_class || '').toString().trim();
    if (edmundsClass && copilotClass && edmundsClass !== copilotClass) {
      discrepancies.push({
        field: 'class',
        edmunds: edmundsClass,
        copilot: copilotClass,
        similarity: 0,
        severity: 'critical'
      });
    }

    return discrepancies;
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setScanResults(null);

    try {
      const workbook = XLSX.read(await file.arrayBuffer());
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);

      if (data.length === 0) {
        setError('No data found in Excel file');
        setIsUploading(false);
        return;
      }

      // Parse Edmunds records
      const edmundsRecords = data.map(row => ({
        block: row['Block'] || row['block'] || row['BLOCK'],
        lot: row['Lot'] || row['lot'] || row['LOT'],
        qualifier: row['Qualifier'] || row['qualifier'] || row['QUALIFIER'] || '',
        owner: row['Owner'] || row['owner'] || row['OWNER'],
        property_location: row['Property Location'] || row['property_location'] || row['Address'] || row['address'],
        owner_street: row['Owner Address'] || row['owner_address'] || row['owner street'],
        owner_city: row['Owner City'] || row['owner_city'] || row['City'],
        state: row['State'] || row['state'],
        zip: row['Zip'] || row['zip'],
        property_m4_class: row['Class'] || row['class'] || row['M4 Class']
      })).filter(r => r.block && r.lot);

      const primaryCopilot = getPrimaryProperties();
      const allCopilot = properties;

      // Build composite key map for Copilot
      const copilotMap = new Map();
      primaryCopilot.forEach(p => {
        const key = `${p.property_block}_${p.property_lot}_${p.property_qualifier || ''}`.trim();
        copilotMap.set(key, p);
      });

      // Match records
      const exactMatches = [];
      const fuzzyMatches = [];
      const ghostRecords = [];

      edmundsRecords.forEach(edmundsRec => {
        const blockStr = String(edmundsRec.block || '').trim();
        const lotStr = String(edmundsRec.lot || '').trim();
        const qualStr = String(edmundsRec.qualifier || '').trim();
        const key = `${blockStr}_${lotStr}_${qualStr}`;

        const copilotRec = copilotMap.get(key);

        if (copilotRec) {
          // Exact match exists
          const discrepancies = compareRecords(edmundsRec, copilotRec);
          if (discrepancies.length === 0) {
            exactMatches.push({
              type: 'exact',
              edmunds: edmundsRec,
              copilot: copilotRec,
              discrepancies: []
            });
          } else {
            const hasCritical = discrepancies.some(d => d.severity === 'critical');
            (hasCritical ? fuzzyMatches : fuzzyMatches).push({
              type: 'discrepancy',
              edmunds: edmundsRec,
              copilot: copilotRec,
              discrepancies,
              severity: hasCritical ? 'critical' : 'fuzzy'
            });
          }
        } else {
          // Ghost record
          const categorized = categorizeGhost(edmundsRec, allCopilot, primaryCopilot);
          ghostRecords.push({
            type: 'ghost',
            edmunds: edmundsRec,
            ...categorized
          });
        }
      });

      setScanResults({
        totalEdmunds: edmundsRecords.length,
        exactMatches: exactMatches.length,
        discrepancies: fuzzyMatches.length,
        ghosts: ghostRecords.length,
        detailedMatches: exactMatches,
        detailedDiscrepancies: fuzzyMatches,
        detailedGhosts: ghostRecords,
        timestamp: new Date().toISOString()
      });

      setSuccessMessage(`Scanned ${edmundsRecords.length} Edmunds records`);
    } catch (err) {
      console.error('Error parsing file:', err);
      setError(`Failed to parse file: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const exportReport = () => {
    if (!scanResults) return;

    const workbook = XLSX.utils.book_new();

    // Discrepancies sheet
    const discrepanciesData = scanResults.detailedDiscrepancies.map(match => ({
      'Block': match.edmunds.block,
      'Lot': match.edmunds.lot,
      'Qualifier': match.edmunds.qualifier,
      'Status': match.severity === 'critical' ? 'REVIEW' : 'FUZZY',
      'Issue': match.discrepancies.map(d => `${d.field}`).join('; '),
      'Your Value': match.discrepancies.map(d => `${d.field}: ${d.copilot}`).join(' | '),
      'Edmunds Value': match.discrepancies.map(d => `${d.field}: ${d.edmunds}`).join(' | ')
    }));

    const discSheet = XLSX.utils.json_to_sheet(discrepanciesData);
    XLSX.utils.book_append_sheet(workbook, discSheet, 'Discrepancies');

    // Phantom Properties sheet
    const phantomData = scanResults.detailedGhosts.map(ghost => ({
      'Block': ghost.edmunds.block,
      'Lot': ghost.edmunds.lot,
      'Qualifier': ghost.edmunds.qualifier,
      'Category': ghost.category,
      'Details': ghost.details,
      'Edmunds Owner': ghost.edmunds.owner,
      'Recommended Action': ghost.category === 'Subdivided' ? 'Update lot numbers' : ghost.category === 'Additional Lot' ? 'Already exists as additional card' : 'Review and delete if invalid'
    }));

    const phantomSheet = XLSX.utils.json_to_sheet(phantomData);
    XLSX.utils.book_append_sheet(workbook, phantomSheet, 'Phantom Properties');

    // Summary sheet
    const summaryData = [
      { Metric: 'Total Edmunds Records', Value: scanResults.totalEdmunds },
      { Metric: 'Exact Matches (No Issues)', Value: scanResults.exactMatches },
      { Metric: 'Discrepancies Found', Value: scanResults.discrepancies },
      { Metric: 'Ghost Records', Value: scanResults.ghosts },
      { Metric: 'Scan Date', Value: new Date(scanResults.timestamp).toLocaleString() }
    ];

    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary', 0);

    XLSX.writeFile(workbook, `Edmunds-Reconciliation-${jobData?.job_name || 'Job'}-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg border-2 border-blue-200 p-6">
        <div className="flex items-center mb-3">
          <AlertCircle className="w-8 h-8 mr-3 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-800">🔄 Edmunds Sync & Reconciliation</h2>
        </div>
        <p className="text-gray-600">Import Edmunds collector data and reconcile against your property records. Identify mismatches, ghost records, and data quality issues.</p>
      </div>

      {/* Error Messages */}
      {error && (
        <div className="bg-red-50 border border-red-300 rounded-lg p-4 flex items-start gap-3">
          <X className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-red-800">Error</h3>
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Success Messages */}
      {successMessage && (
        <div className="bg-green-50 border border-green-300 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-green-700 font-medium">{successMessage}</p>
          </div>
        </div>
      )}

      {/* Upload Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Step 1: Upload Edmunds Data</h3>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Upload the Edmunds Excel file with columns: Block, Lot, Qualifier, Owner, Property Location, Owner Address, City, State, Zip, Class
          </p>
          <div className="flex items-center gap-4">
            <input
              type="file"
              id="edmunds-file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              disabled={isUploading}
              className="block w-full text-sm text-gray-500
                file:mr-4 file:py-2 file:px-4
                file:rounded-lg file:border-0
                file:text-sm file:font-medium
                file:bg-blue-50 file:text-blue-700
                hover:file:bg-blue-100"
            />
            {isUploading && <span className="text-gray-600">Processing...</span>}
          </div>
        </div>
      </div>

      {/* Results Section */}
      {scanResults && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-3xl font-bold text-blue-600">{scanResults.totalEdmunds}</div>
              <div className="text-sm text-gray-600 mt-1">Total Edmunds Records</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-3xl font-bold text-green-600">{scanResults.exactMatches}</div>
              <div className="text-sm text-gray-600 mt-1">Exact Matches</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-3xl font-bold text-yellow-600">{scanResults.discrepancies}</div>
              <div className="text-sm text-gray-600 mt-1">Discrepancies</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-3xl font-bold text-red-600">{scanResults.ghosts}</div>
              <div className="text-sm text-gray-600 mt-1">Ghost Records</div>
            </div>
          </div>

          {/* Discrepancies */}
          {scanResults.discrepancies > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-600" />
                Discrepancies Found ({scanResults.discrepancies})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Block</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Lot</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Issues</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanResults.detailedDiscrepancies.slice(0, 10).map((match, idx) => (
                      <tr key={idx} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-2">{match.edmunds.block}</td>
                        <td className="px-4 py-2">{match.edmunds.lot}</td>
                        <td className="px-4 py-2 text-xs">
                          {match.discrepancies.map(d => d.field).join(', ')}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            match.severity === 'critical'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {match.severity === 'critical' ? '🔴 Review' : '🟡 Fuzzy'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Ghost Records */}
          {scanResults.ghosts > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-600" />
                Phantom Properties ({scanResults.ghosts})
              </h3>
              <div className="space-y-3">
                {scanResults.detailedGhosts.slice(0, 10).map((ghost, idx) => (
                  <div key={idx} className="bg-red-50 rounded-lg p-3 border border-red-200">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium text-gray-800">{ghost.edmunds.block}/{ghost.edmunds.lot}</div>
                        <div className="text-sm text-gray-600 mt-1">{ghost.edmunds.owner}</div>
                        <div className="text-xs text-gray-500 mt-1">{ghost.details}</div>
                      </div>
                      <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800">
                        {ghost.category}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Export Button */}
          <div className="flex justify-end">
            <button
              onClick={exportReport}
              className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium transition-all"
            >
              <Download className="w-4 h-4" />
              Export Report for Collector
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EdmundsSyncTab;
