import * as XLSX from 'xlsx-js-style';

// Exports the rows the Method 2 sales modal is currently showing for one VCS,
// in the order they appear on screen, carrying the include/exclude state so the
// spreadsheet matches what the analysis actually used.
export function exportMethod2SalesToExcel({
  vcs,
  sales,
  excludedIds,
  getLotSize,
  bracketUnit,
  bracketUnitLabel,
  municipality,
  timestamp
}) {
  const isSf = bracketUnit === 'sf';

  const rows = [[
    'Include',
    'Block',
    'Lot',
    'Address',
    'Sale Date',
    '$ Sale Price',
    '$ Norm Time',
    `Lot Size (${bracketUnitLabel})`,
    'SFLA',
    'Year Built',
    'Type/Use',
    'Pre-Construction'
  ]];

  (sales || []).forEach((prop) => {
    const saleYear = prop.sales_date ? new Date(prop.sales_date).getFullYear() : null;
    const yearBuilt = prop.asset_year_built ? parseInt(prop.asset_year_built, 10) : null;
    const isPreConstruction = Boolean(saleYear && yearBuilt && saleYear < yearBuilt);
    const lotSize = Number(getLotSize(prop)) || 0;

    rows.push([
      excludedIds && excludedIds.has(prop.id) ? 'N' : 'Y',
      prop.property_block || '',
      prop.property_lot || '',
      prop.property_location || '',
      prop.sales_date || '',
      prop.sales_price != null ? Math.round(prop.sales_price) : '',
      prop.normalizedTime != null ? Math.round(prop.normalizedTime) : '',
      isSf ? Math.round(lotSize) : Number(lotSize.toFixed(2)),
      prop.asset_sfla || '',
      prop.asset_year_built || '',
      prop.asset_type_use || '',
      isPreConstruction ? 'Y' : ''
    ]);
  });

  const worksheet = XLSX.utils.aoa_to_sheet(rows);

  for (let c = 0; c < rows[0].length; c += 1) {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    if (worksheet[ref]) {
      worksheet[ref].s = { font: { bold: true }, alignment: { horizontal: 'center' } };
    }
  }

  for (let r = 1; r < rows.length; r += 1) {
    const priceRef = XLSX.utils.encode_cell({ r, c: 5 });
    if (worksheet[priceRef]) worksheet[priceRef].z = '"$"#,##0';
    const normRef = XLSX.utils.encode_cell({ r, c: 6 });
    if (worksheet[normRef]) worksheet[normRef].z = '"$"#,##0';
    const sizeRef = XLSX.utils.encode_cell({ r, c: 7 });
    if (worksheet[sizeRef]) worksheet[sizeRef].z = isSf ? '#,##0' : '#,##0.00';
  }

  worksheet['!cols'] = [
    { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 30 }, { wch: 12 }, { wch: 14 },
    { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 14 }
  ];

  const safeVcs = String(vcs || 'VCS').replace(/[^A-Za-z0-9 _-]/g, '_').substring(0, 25) || 'VCS';
  const safeMunicipality = String(municipality || 'export').replace(/[^A-Za-z0-9]/g, '_');

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, safeVcs);
  XLSX.writeFile(workbook, `method2_sales_${safeVcs}_${safeMunicipality}_${timestamp}.xlsx`);
}
