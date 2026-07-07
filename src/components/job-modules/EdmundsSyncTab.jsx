import React, { useState } from 'react';
import { Download, AlertCircle, CheckCircle, AlertTriangle, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabaseClient';

const EdmundsSyncTab = ({ jobData, properties = [] }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [activeResultTab, setActiveResultTab] = useState('matches'); // matches, discrepancies, ghosts

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

  // Build composite key - match on block/lot/qualifier/card only (address is compared separately)
  const buildCompositeKey = (block, lot, qualifier = '', card = '') => {
    const blockStr = String(block || '').trim();
    const lotStr = String(lot || '').trim();
    const qualStr = String(qualifier || '').trim();
    const cardStr = String(card || '').trim();
    return `${blockStr}_${lotStr}_${qualStr}_${cardStr}`.toUpperCase();
  };

  // Detect if lot is subdivided (e.g., lot "1" split into "1.01", "1.02")
  const checkSubdivision = (edmundsBlock, edmundsLot, copilotProps) => {
    const edmundsLotStr = String(edmundsLot).trim();
    const blockStr = String(edmundsBlock).trim();
    const matches = copilotProps.filter(p => {
      const pBlock = String(p.property_block || '').trim();
      const pLot = String(p.property_lot || '').trim();
      return pBlock === blockStr && pLot.startsWith(edmundsLotStr + '.');
    });
    return matches.length > 0 ? matches : null;
  };

  // Check if lot exists as additional card (different card numbers for same block/lot)
  const checkAdditionalCard = (edmundsBlock, edmundsLot, edmundsQual) => {
    const blockStr = String(edmundsBlock || '').trim();
    const lotStr = String(edmundsLot || '').trim();
    const allPropsForLot = properties.filter(p => {
      const pBlock = String(p.property_block || '').trim();
      const pLot = String(p.property_lot || '').trim();
      return pBlock === blockStr && pLot === lotStr;
    });
    return allPropsForLot.length > 0 ? allPropsForLot : null;
  };

  // Categorize ghost records
  const categorizeGhost = (edmundsRecord, allProps, primaryProps) => {
    const { block, lot, qualifier } = edmundsRecord;
    const blockStr = String(block || '').trim();
    const lotStr = String(lot || '').trim();

    // Check for subdivisions first (lot 1 became 1.01, 1.02)
    const subdivisions = checkSubdivision(blockStr, lotStr, primaryProps);
    if (subdivisions) {
      return {
        category: 'Subdivided',
        details: `Lot became: ${subdivisions.map(p => `${p.property_lot}.${p.property_qualifier || ''}`).join(', ')}`
      };
    }

    // Check if exists as additional card (multiple cards for same lot)
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

    return { category: 'Orphaned', details: 'No matching record in current system' };
  };

  // Parse owner_csz field (format: "City, ST ZIP" but can vary)
  const parseCsz = (csz) => {
    if (!csz) return { city: '', state: '', zip: '' };
    const str = String(csz).trim();
    const parts = str.split(',').map(p => p.trim());
    let city = parts[0] || '';
    let stateZip = parts[1] || '';

    // Parse state and zip from "ST ZIP" or "ST  ZIP" (with extra spaces)
    const stateZipMatch = stateZip.match(/([A-Z]{2})\s+(\d{5})/i);
    let state = '';
    let zip = '';
    if (stateZipMatch) {
      state = stateZipMatch[1].toUpperCase();
      zip = stateZipMatch[2];
    }

    return { city, state, zip };
  };

  // Compare fields and find discrepancies — FLAG ANYTHING THAT ISN'T EXACT
  // Fuzzy = minor differences (space, abbrev, typo) | Review/Critical = unrelated values
  const compareRecords = (edmundsRecord, copilotRecord) => {
    const discrepancies = [];

    // Helper: compare text fields with fuzzy detection
    const compareTextField = (field, edmunds, copilot) => {
      if (edmunds === copilot) return null; // Exact match, no discrepancy

      const sim = stringSimilarity(edmunds, copilot);
      const severity = sim >= 0.90 ? 'fuzzy' : 'critical'; // 90%+ = fuzzy, <90% = review needed

      return {
        field,
        edmunds: edmunds || '(empty)',
        copilot: copilot || '(empty)',
        similarity: sim,
        severity
      };
    };

    // Owner
    const edmundsOwner = (edmundsRecord.owner || '').toString().trim();
    const copilotOwner = (copilotRecord.owner_name || '').toString().trim();
    const ownerDisc = compareTextField('owner', edmundsOwner, copilotOwner);
    if (ownerDisc) discrepancies.push(ownerDisc);

    // Property Location
    const edmundsAddr = (edmundsRecord.property_location || '').toString().trim();
    const copilotAddr = (copilotRecord.property_location || '').toString().trim();
    const addrDisc = compareTextField('property_location', edmundsAddr, copilotAddr);
    if (addrDisc) discrepancies.push(addrDisc);

    // Owner Address
    const edmundsOwnerAddr = (edmundsRecord.owner_street || '').toString().trim();
    const copilotOwnerAddr = (copilotRecord.owner_street || '').toString().trim();
    const ownerAddrDisc = compareTextField('owner_address', edmundsOwnerAddr, copilotOwnerAddr);
    if (ownerAddrDisc) discrepancies.push(ownerAddrDisc);

    // Parse Copilot owner_csz field
    const parsedCopilot = parseCsz(copilotRecord.owner_csz);

    // Owner City
    const edmundsCity = (edmundsRecord.owner_city || '').toString().trim();
    const copilotCity = parsedCopilot.city;
    const cityDisc = compareTextField('owner_city', edmundsCity, copilotCity);
    if (cityDisc) discrepancies.push(cityDisc);

    // State — normalize spaces then compare exactly (N J → NJ)
    const edmundsState = (edmundsRecord.state || '').toString().trim().toUpperCase().replace(/\s+/g, '');
    const copilotState = parsedCopilot.state;
    if (edmundsState !== copilotState) {
      discrepancies.push({
        field: 'state',
        edmunds: edmundsState || '(empty)',
        copilot: copilotState || '(empty)',
        similarity: 0,
        severity: 'critical'
      });
    }

    // ZIP — exact match only
    const edmundsZip = (edmundsRecord.zip || '').toString().trim();
    const copilotZip = parsedCopilot.zip;
    if (edmundsZip !== copilotZip) {
      discrepancies.push({
        field: 'zip',
        edmunds: edmundsZip || '(empty)',
        copilot: copilotZip || '(empty)',
        similarity: 0,
        severity: 'critical'
      });
    }

    // Property Class — exact match only
    const edmundsClass = (edmundsRecord.property_m4_class || '').toString().trim();
    const copilotClass = (copilotRecord.property_m4_class || '').toString().trim();
    if (edmundsClass !== copilotClass) {
      discrepancies.push({
        field: 'property_class',
        edmunds: edmundsClass || '(empty)',
        copilot: copilotClass || '(empty)',
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

      // Helper: fuzzy column matching (find columns by partial name match)
      const findColumn = (row, searchTerms) => {
        const columnNames = Object.keys(row);
        for (const search of (Array.isArray(searchTerms) ? searchTerms : [searchTerms])) {
          const match = columnNames.find(col =>
            col.toLowerCase().includes(search.toLowerCase())
          );
          if (match) return row[match];
        }
        return '';
      };

      // Parse Edmunds records with flexible column matching
      const edmundsRecords = data.map(row => ({
        block: findColumn(row, ['block']),
        lot: findColumn(row, ['lot']),
        qualifier: findColumn(row, ['qualifier']) || '',
        owner: findColumn(row, ['owner']),
        property_location: findColumn(row, ['property location', 'address']),
        owner_street: findColumn(row, ['owner address', 'owner street']),
        owner_city: findColumn(row, ['owner city', 'city']),
        state: findColumn(row, ['state']),
        zip: findColumn(row, ['zip']),
        property_m4_class: findColumn(row, ['class', 'm4 class'])
      })).filter(r => r.block && r.lot);

      const primaryCopilot = getPrimaryProperties();
      const allCopilot = properties;

      // Build composite key map for Copilot using: block_lot_qualifier_card only
      const copilotMap = new Map();
      primaryCopilot.forEach(p => {
        const card = getPrimaryCardIndicator(); // Primary card only
        const key = buildCompositeKey(p.property_block, p.property_lot, p.property_qualifier, card);
        copilotMap.set(key, p);
      });

      // Match records
      const exactMatches = [];
      const fuzzyMatches = [];
      const ghostRecords = [];

      edmundsRecords.forEach(edmundsRec => {
        const key = buildCompositeKey(edmundsRec.block, edmundsRec.lot, edmundsRec.qualifier, getPrimaryCardIndicator());

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
      'Edmunds Address': ghost.edmunds.property_location,
      'Recommended Action':
        ghost.category === 'Subdivided'
          ? 'Update lot numbers to reflect subdivision'
          : ghost.category === 'Additional Lot'
          ? 'Already exists as additional card - no action needed'
          : 'Review and delete if invalid'
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

          {/* Results Tabs */}
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="border-b border-gray-200 flex">
              <button
                onClick={() => setActiveResultTab('matches')}
                className={`px-6 py-3 font-medium text-sm border-b-2 ${
                  activeResultTab === 'matches'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                ✓ Exact Matches ({scanResults.exactMatches})
              </button>
              <button
                onClick={() => setActiveResultTab('discrepancies')}
                className={`px-6 py-3 font-medium text-sm border-b-2 ${
                  activeResultTab === 'discrepancies'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                ⚠️ Discrepancies ({scanResults.discrepancies})
              </button>
              <button
                onClick={() => setActiveResultTab('ghosts')}
                className={`px-6 py-3 font-medium text-sm border-b-2 ${
                  activeResultTab === 'ghosts'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                👻 Phantom Properties ({scanResults.ghosts})
              </button>
            </div>

            <div className="p-6">
              {activeResultTab === 'matches' && (
                <div>
                  <p className="text-sm text-gray-600 mb-4">Showing {scanResults.exactMatches} records with matching block/lot/qualifier and no field discrepancies</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Block/Lot</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Owner (Edmunds)</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Owner (Copilot)</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Address (Edmunds)</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Address (Copilot)</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Class</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scanResults.detailedMatches.slice(0, 50).map((match, idx) => (
                          <tr key={idx} className="border-t hover:bg-green-50">
                            <td className="px-4 py-2 font-medium">{match.edmunds.block}/{match.edmunds.lot}</td>
                            <td className="px-4 py-2 text-xs">{match.edmunds.owner || '—'}</td>
                            <td className="px-4 py-2 text-xs">{match.copilot.owner_name || '—'}</td>
                            <td className="px-4 py-2 text-xs">{match.edmunds.property_location || '—'}</td>
                            <td className="px-4 py-2 text-xs">{match.copilot.property_location || '—'}</td>
                            <td className="px-4 py-2 text-xs">{match.edmunds.property_m4_class || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {scanResults.detailedMatches.length > 50 && (
                      <div className="text-center text-sm text-gray-500 py-4">
                        Showing first 50 of {scanResults.detailedMatches.length} exact matches
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeResultTab === 'discrepancies' && (
                <div>
                  <p className="text-sm text-gray-600 mb-4">Records with matching block/lot/qualifier but field differences (owner, address, class, etc.)</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Block/Lot</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Field</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Edmunds Value</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Copilot Value</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Match %</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Severity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scanResults.detailedDiscrepancies.map((match, idx) =>
                          match.discrepancies.map((d, didx) => (
                            <tr key={`${idx}-${didx}`} className="border-t hover:bg-yellow-50">
                              {didx === 0 && (
                                <>
                                  <td className="px-4 py-2 font-medium" rowSpan={match.discrepancies.length}>{match.edmunds.block}/{match.edmunds.lot}</td>
                                </>
                              )}
                              <td className="px-4 py-2 text-xs font-medium">{d.field}</td>
                              <td className="px-4 py-2 text-xs">{d.edmunds}</td>
                              <td className="px-4 py-2 text-xs">{d.copilot}</td>
                              <td className="px-4 py-2 text-xs">{(d.similarity * 100).toFixed(0)}%</td>
                              {didx === 0 && (
                                <td className="px-4 py-2" rowSpan={match.discrepancies.length}>
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                                    match.severity === 'critical'
                                      ? 'bg-red-100 text-red-800'
                                      : 'bg-yellow-100 text-yellow-800'
                                  }`}>
                                    {match.severity === 'critical' ? '🔴 Review' : '🟡 Fuzzy'}
                                  </span>
                                </td>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeResultTab === 'ghosts' && (
                <div>
                  <p className="text-sm text-gray-600 mb-4">Edmunds records with no match in Copilot system</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Block/Lot</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Category</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Owner (Edmunds)</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Class</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Address</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">City, State ZIP</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scanResults.detailedGhosts.map((ghost, idx) => (
                          <tr key={idx} className="border-t hover:bg-red-50">
                            <td className="px-4 py-2 font-medium">{ghost.edmunds.block}/{ghost.edmunds.lot}</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                ghost.category === 'Subdivided'
                                  ? 'bg-blue-100 text-blue-800'
                                  : ghost.category === 'Additional Lot'
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {ghost.category}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-xs">{ghost.edmunds.owner || '—'}</td>
                            <td className="px-4 py-2 text-xs">{ghost.edmunds.property_m4_class || '—'}</td>
                            <td className="px-4 py-2 text-xs">{ghost.edmunds.property_location || '—'}</td>
                            <td className="px-4 py-2 text-xs">
                              {ghost.edmunds.owner_city && `${ghost.edmunds.owner_city}, ${ghost.edmunds.state} ${ghost.edmunds.zip}`}
                              {!ghost.edmunds.owner_city && '—'}
                            </td>
                            <td className="px-4 py-2 text-xs text-gray-600">{ghost.details}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

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
