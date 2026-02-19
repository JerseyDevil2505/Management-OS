const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

async function generatePamphlet() {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  const W = 612; // Letter width
  const H = 792; // Letter height
  const darkBlue = rgb(0.196, 0.255, 0.353); // #324159
  const lojikBlue = rgb(0, 0.4, 0.8);
  const white = rgb(1, 1, 1);
  const lightGray = rgb(0.7, 0.7, 0.7);
  const textGray = rgb(0.35, 0.35, 0.35);
  const accentBlue = rgb(0.2, 0.6, 0.9);

  // Try to load logo
  let logoImage = null;
  try {
    const logoPath = path.join(__dirname, '..', 'public', 'lojik-logo.PNG');
    const logoBytes = fs.readFileSync(logoPath);
    logoImage = await doc.embedPng(logoBytes);
  } catch (e) {
    console.warn('Could not load logo:', e.message);
  }

  // ==================== PAGE 1: COVER ====================
  const p1 = doc.addPage([W, H]);
  p1.drawRectangle({ x: 0, y: 0, width: W, height: H, color: darkBlue });

  if (logoImage) {
    p1.drawImage(logoImage, { x: W / 2 - 60, y: H - 240, width: 120, height: 53 });
  } else {
    p1.drawText('LOJIK', { x: W / 2 - 60, y: H - 230, size: 42, font: helveticaBold, color: white });
  }

  p1.drawText('Property Assessment Copilot', { x: W / 2 - 130, y: H - 290, size: 20, font: helvetica, color: white });

  // Blue divider line
  p1.drawRectangle({ x: W / 2 - 80, y: H - 310, width: 160, height: 2, color: accentBlue });

  p1.drawText('Your revaluation workflow. Organized.', { x: W / 2 - 130, y: H - 350, size: 14, font: helvetica, color: rgb(0.8, 0.85, 0.9) });
  p1.drawText('Your expertise. Amplified.', { x: W / 2 - 85, y: H - 372, size: 14, font: helvetica, color: rgb(0.8, 0.85, 0.9) });

  const bullets1 = [
    'Works with BRT and Microsystems CAMA Software',
    'Guides your workflow — doesn\'t replace your judgment',
    'From data quality to land valuation to final values',
    'One platform for your entire revaluation/reassessment lifecycle'
  ];
  bullets1.forEach((b, i) => {
    p1.drawText(b, { x: W / 2 - 180, y: H - 450 - i * 28, size: 11, font: helvetica, color: lightGray });
  });

  p1.drawText('management-os-production.vercel.app', { x: W / 2 - 100, y: 80, size: 9, font: helvetica, color: rgb(0.5, 0.5, 0.55) });

  // ==================== PAGE 2: SEE YOUR DATA CLEARLY ====================
  const p2 = doc.addPage([W, H]);
  p2.drawText('See Your Data Clearly', { x: 50, y: H - 60, size: 28, font: helveticaBold, color: textGray });
  p2.drawText('Upload your file — charts and analytics are ready instantly', { x: 50, y: H - 90, size: 12, font: helvetica, color: lightGray });

  // Simulated content area
  p2.drawRectangle({ x: 50, y: H - 400, width: W - 100, height: 280, color: rgb(0.95, 0.96, 0.98), borderColor: rgb(0.85, 0.87, 0.9), borderWidth: 1 });
  p2.drawText('Data Visualizations', { x: 70, y: H - 160, size: 14, font: helveticaBold, color: textGray });
  const vizFeatures = [
    '• Market History charts — average and median price trends',
    '• VCS Average Sale Prices with date range filtering',
    '• Design & Style Breakdown — visual property mix',
    '• Type & Use Distribution across your dataset',
    '• Usable vs Non-Usable Sales analysis',
    '• Sales NU Distribution breakdown',
    '• Building Class and Property Class distribution charts',
    '• Interactive filters: Property Type, Use, VCS, Design, Period'
  ];
  vizFeatures.forEach((f, i) => {
    p2.drawText(f, { x: 70, y: H - 190 - i * 22, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });
  });

  p2.drawText('LOJIK Property Assessment Copilot  |  management-os-production.vercel.app', { x: 50, y: 30, size: 8, font: helvetica, color: lightGray });
  p2.drawText('2', { x: W - 50, y: 30, size: 8, font: helvetica, color: lightGray });

  // ==================== PAGE 3: KNOW WHERE YOU STAND ====================
  const p3 = doc.addPage([W, H]);
  p3.drawText('Know Where You Stand', { x: 50, y: H - 60, size: 28, font: helveticaBold, color: textGray });
  p3.drawText('Inspection progress at a glance — totals, class breakdowns, and inspector performance', { x: 50, y: H - 90, size: 11, font: helvetica, color: lightGray });

  p3.drawRectangle({ x: 50, y: H - 130, width: W - 100, height: 2, color: lojikBlue });

  p3.drawText('Inspection Tracking', { x: 50, y: H - 160, size: 18, font: helveticaBold, color: textGray });
  const inspFeatures = [
    'Total properties, inspected count, entry rate — updated with every data load',
    'Breakdown by property class with inspection rates',
    'Inspector breakdown showing who inspected what percentage',
    'No more spreadsheet pivot tables — it\'s all here automatically'
  ];
  inspFeatures.forEach((f, i) => {
    p3.drawText('•  ' + f, { x: 70, y: H - 200 - i * 28, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });
  });

  p3.drawRectangle({ x: 50, y: H - 550, width: W - 100, height: 200, color: rgb(0.95, 0.96, 0.98), borderColor: rgb(0.85, 0.87, 0.9), borderWidth: 1 });
  p3.drawText('[Screenshot: Inspection Info dashboard with totals, class breakdown, inspector stats]', { x: 80, y: H - 460, size: 9, font: helveticaOblique, color: rgb(0.6, 0.6, 0.65) });

  p3.drawText('LOJIK Property Assessment Copilot  |  management-os-production.vercel.app', { x: 50, y: 30, size: 8, font: helvetica, color: lightGray });
  p3.drawText('3', { x: W - 50, y: 30, size: 8, font: helvetica, color: lightGray });

  // ==================== PAGE 4: CATCH PROBLEMS EARLY ====================
  const p4 = doc.addPage([W, H]);
  p4.drawText('Catch Problems Early', { x: 50, y: H - 60, size: 28, font: helveticaBold, color: textGray });
  p4.drawText('Automated data quality checks — standard and custom — before errors become appeals', { x: 50, y: H - 90, size: 11, font: helvetica, color: lightGray });

  p4.drawRectangle({ x: 50, y: H - 130, width: W - 100, height: 2, color: lojikBlue });

  p4.drawText('Data Quality / Error Checking', { x: 50, y: H - 160, size: 18, font: helveticaBold, color: textGray });
  const dqFeatures = [
    'Critical, warning, and info severity levels',
    'Standard checks for characteristics, special codes, and more',
    'Build your own custom checks',
    'Ignore known issues — track run history — export results',
    'Zero lot sizes, invalid building classes, commercial with residential design — flagged automatically'
  ];
  dqFeatures.forEach((f, i) => {
    p4.drawText('•  ' + f, { x: 70, y: H - 200 - i * 28, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });
  });

  p4.drawText('LOJIK Property Assessment Copilot  |  management-os-production.vercel.app', { x: 50, y: 30, size: 8, font: helvetica, color: lightGray });
  p4.drawText('4', { x: W - 50, y: 30, size: 8, font: helvetica, color: lightGray });

  // ==================== PAGE 5: MARKET ANALYSIS ====================
  const p5 = doc.addPage([W, H]);
  p5.drawText('Market Analysis That Works for You', { x: 50, y: H - 60, size: 26, font: helveticaBold, color: textGray });
  p5.drawText('Time normalization, outlier detection, and market overview — built in', { x: 50, y: H - 90, size: 11, font: helvetica, color: lightGray });

  p5.drawRectangle({ x: 50, y: H - 130, width: W - 100, height: 2, color: lojikBlue });

  p5.drawText('Pre-Valuation: Time & Size Normalization', { x: 50, y: H - 160, size: 16, font: helveticaBold, color: textGray });
  const mktFeatures1 = [
    'HPI-based normalization with configurable equalization ratios',
    'Outlier thresholds and individual sales review',
    'Time normalization statistics with flagged outliers count'
  ];
  mktFeatures1.forEach((f, i) => {
    p5.drawText('•  ' + f, { x: 70, y: H - 195 - i * 24, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });
  });

  p5.drawText('Overall Market Analysis: Type & Use Breakdown', { x: 50, y: H - 310, size: 16, font: helveticaBold, color: textGray });
  const mktFeatures2 = [
    'Baseline comparisons, delta analysis, and CME bracket mapping',
    'Design & style analysis across all property types',
    'Automatic market statistics by type and use code'
  ];
  mktFeatures2.forEach((f, i) => {
    p5.drawText('•  ' + f, { x: 70, y: H - 345 - i * 24, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });
  });

  p5.drawText('LOJIK Property Assessment Copilot  |  management-os-production.vercel.app', { x: 50, y: 30, size: 8, font: helvetica, color: lightGray });
  p5.drawText('5', { x: W - 50, y: 30, size: 8, font: helvetica, color: lightGray });

  // ==================== PAGE 6: LAND VALUATION ====================
  const p6 = doc.addPage([W, H]);
  p6.drawText('Land Valuation Toolkit', { x: 50, y: H - 60, size: 28, font: helveticaBold, color: textGray });
  p6.drawText('Vacant sales, allocation studies, and VCS management in one place', { x: 50, y: H - 90, size: 11, font: helvetica, color: lightGray });

  p6.drawRectangle({ x: 50, y: H - 130, width: W - 100, height: 2, color: lojikBlue });

  p6.drawText('Vacant Land Sales Analysis', { x: 50, y: H - 160, size: 16, font: helveticaBold, color: textGray });
  p6.drawText('•  Front foot, square foot, or acre — categorize sales, define special regions, calculate rates', { x: 70, y: H - 190, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });

  p6.drawText('Allocation Study', { x: 50, y: H - 240, size: 16, font: helveticaBold, color: textGray });
  p6.drawText('•  Match vacant sales to improved neighborhoods — current vs. recommended allocation ratios', { x: 70, y: H - 270, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });

  p6.drawText('Also includes:', { x: 50, y: H - 330, size: 12, font: helveticaBold, color: textGray });
  const landExtras = ['VCS Valuation Sheet', 'Depth Tables', 'Cascade Rates', 'Economic Obsolescence Study'];
  landExtras.forEach((f, i) => {
    p6.drawText('•  ' + f, { x: 70, y: H - 358 - i * 22, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });
  });

  p6.drawText('LOJIK Property Assessment Copilot  |  management-os-production.vercel.app', { x: 50, y: 30, size: 8, font: helvetica, color: lightGray });
  p6.drawText('6', { x: W - 50, y: 30, size: 8, font: helvetica, color: lightGray });

  // ==================== PAGE 7: VCS & COST ====================
  const p7 = doc.addPage([W, H]);
  p7.drawText('VCS & Cost Analysis', { x: 50, y: H - 60, size: 28, font: helveticaBold, color: textGray });
  p7.drawText('The traditional workflow you know — just streamlined', { x: 50, y: H - 90, size: 11, font: helvetica, color: lightGray });

  p7.drawRectangle({ x: 50, y: H - 130, width: W - 100, height: 2, color: lojikBlue });

  p7.drawText('VCS Valuation Sheet', { x: 50, y: H - 160, size: 16, font: helveticaBold, color: textGray });
  p7.drawText('•  Type, method, lot dimensions, depth tables, site values, average prices', { x: 70, y: H - 190, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });
  p7.drawText('•  Editable and exportable to Excel', { x: 70, y: H - 212, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });

  p7.drawText('Cost Conversion Factor Analysis', { x: 50, y: H - 262, size: 16, font: helveticaBold, color: textGray });
  p7.drawText('•  Recommended CCF from new construction sales', { x: 70, y: H - 292, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });
  p7.drawText('•  Base cost, replacement, depreciation, and adjusted ratios', { x: 70, y: H - 314, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });

  p7.drawText('LOJIK Property Assessment Copilot  |  management-os-production.vercel.app', { x: 50, y: 30, size: 8, font: helvetica, color: lightGray });
  p7.drawText('7', { x: W - 50, y: 30, size: 8, font: helvetica, color: lightGray });

  // ==================== PAGE 8: FINAL VALUATION ====================
  const p8 = doc.addPage([W, H]);
  p8.drawText('Final Valuation & Comparison', { x: 50, y: H - 60, size: 26, font: helveticaBold, color: textGray });
  p8.drawText('Sales comparison engine and ratable base projections — when you need them', { x: 50, y: H - 90, size: 11, font: helvetica, color: lightGray });

  p8.drawRectangle({ x: 50, y: H - 130, width: W - 100, height: 2, color: lojikBlue });

  p8.drawText('Sales Comparison (CME) — Adjustment Grid', { x: 50, y: H - 160, size: 16, font: helveticaBold, color: textGray });
  p8.drawText('•  10 price brackets, configurable attributes', { x: 70, y: H - 190, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });
  p8.drawText('•  Evaluate properties with ranked comparables and projected assessments', { x: 70, y: H - 212, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });

  p8.drawText('Ratable Comparison & Rate Calculator', { x: 50, y: H - 262, size: 16, font: helveticaBold, color: textGray });
  p8.drawText('•  Current vs. projected ratable base by class', { x: 70, y: H - 292, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });
  p8.drawText('•  See the bottom line before you certify', { x: 70, y: H - 314, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.45) });

  p8.drawText('LOJIK Property Assessment Copilot  |  management-os-production.vercel.app', { x: 50, y: 30, size: 8, font: helvetica, color: lightGray });
  p8.drawText('8', { x: W - 50, y: 30, size: 8, font: helvetica, color: lightGray });

  // ==================== PAGE 9: CLOSING ====================
  const p9 = doc.addPage([W, H]);
  p9.drawRectangle({ x: 0, y: 0, width: W, height: H, color: darkBlue });

  p9.drawText('The Right Tool for the Job', { x: W / 2 - 140, y: H - 150, size: 26, font: helveticaBold, color: white });
  p9.drawText('LOJIK doesn\'t tell you how to appraise.', { x: W / 2 - 130, y: H - 195, size: 12, font: helvetica, color: rgb(0.8, 0.85, 0.9) });
  p9.drawText('It makes sure nothing falls through the cracks while you do.', { x: W / 2 - 175, y: H - 215, size: 12, font: helvetica, color: rgb(0.8, 0.85, 0.9) });

  const checkmarks = [
    'Works with BRT and Microsystems — upload your file, start working',
    'Data quality checks catch errors before they become problems',
    'Land valuation: vacant sales, allocation, depth tables, VCS sheets',
    'Cost conversion analysis with new construction comparables',
    'Market normalization with HPI data and outlier detection',
    'Sales comparison engine available when you need it',
    'Ratable comparison shows the bottom line before certification',
    'Page-by-page worksheet for property-level review',
    'Export to Excel at every step — your data stays yours'
  ];
  checkmarks.forEach((c, i) => {
    p9.drawText('>', { x: 80, y: H - 280 - i * 26, size: 12, font: helveticaBold, color: accentBlue });
    p9.drawText(c, { x: 100, y: H - 280 - i * 26, size: 10, font: helvetica, color: rgb(0.75, 0.8, 0.85) });
  });

  // Divider
  p9.drawRectangle({ x: W / 2 - 100, y: H - 550, width: 200, height: 2, color: accentBlue });

  p9.drawText('See It in Action', { x: W / 2 - 60, y: H - 585, size: 18, font: helveticaBold, color: white });
  p9.drawText('We\'d love to walk you through a live demo with your own data.', { x: W / 2 - 170, y: H - 612, size: 11, font: helvetica, color: rgb(0.7, 0.7, 0.75) });

  p9.drawText('Contact Jim Duda', { x: W / 2 - 58, y: H - 660, size: 13, font: helveticaBold, color: white });
  p9.drawText('dudj23@comcast.net', { x: W / 2 - 55, y: H - 680, size: 10, font: helvetica, color: rgb(0.6, 0.65, 0.7) });
  p9.drawText('management-os-production.vercel.app', { x: W / 2 - 100, y: H - 700, size: 9, font: helvetica, color: rgb(0.5, 0.5, 0.55) });

  // Save
  const pdfBytes = await doc.save();
  const outputPath = path.join(__dirname, '..', 'public', 'lojik-pamphlet.pdf');
  fs.writeFileSync(outputPath, pdfBytes);
  console.log(`Pamphlet PDF saved to ${outputPath} (${pdfBytes.length} bytes, ${doc.getPageCount()} pages)`);
}

generatePamphlet().catch(console.error);
