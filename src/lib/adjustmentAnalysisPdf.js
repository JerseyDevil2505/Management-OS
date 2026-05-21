// src/lib/adjustmentAnalysisPdf.js
//
// PDF export for the Adjustment Analysis tool. Branded LOJIK, US Letter
// portrait, filable single-purpose document. Matches the jsPDF +
// jspdf-autotable pattern used by AppealsSummary / DetailedAppraisalGrid.

import { buildAnalysisExportData } from './adjustmentAnalysis';

const LOJIK_BLUE = [0, 102, 204];
const GRAY_900   = [17, 24, 39];
const GRAY_700   = [55, 65, 81];
const GRAY_600   = [75, 85, 99];
const GRAY_400   = [156, 163, 175];
const GRAY_200   = [229, 231, 235];

async function loadLogoDataUrl() {
  try {
    const response = await fetch('/lojik-logo.PNG');
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function logoToJpegDataUrl(dataUrl) {
  if (!dataUrl) return null;
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 360;
    canvas.height = img.naturalHeight || 160;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.95);
  } catch {
    return null;
  }
}

function safeFilenamePart(s) {
  return String(s || 'job').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'job';
}

// ---------------------------------------------------------------------------
// Page footer — page number + copyright, drawn on every page after layout.
// ---------------------------------------------------------------------------
function drawFooters(doc, margin) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GRAY_600);
    doc.text('© LOJIK', margin, pageH - margin / 2);
    doc.text(`Page ${i} of ${pageCount}`, pageW / 2, pageH - margin / 2, { align: 'center' });
  }
}

// ---------------------------------------------------------------------------
// Main export — generates and triggers download.
// ---------------------------------------------------------------------------
export async function exportAdjustmentAnalysisPdf(analysis, jobMeta = {}) {
  const data = buildAnalysisExportData(analysis, {
    jobName: jobMeta.jobName || '',
    county: jobMeta.county || '',
    jobId: jobMeta.jobId || '',
    analysisDate: new Date(),
  });
  if (!data) throw new Error('Cannot generate PDF — analysis is empty.');

  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  doc.setProperties({
    title: 'Adjustment Grid Performance Analysis',
    subject: 'LOJIK Adjustment Analysis Report',
    author: 'LOJIK',
    creator: 'LOJIK',
    producer: 'LOJIK',
    keywords: 'assessment, adjustment, analysis, report',
  });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 54; // 0.75" @ 72dpi

  // Header text first (so logo-state leaks can't dim it)
  // Title block (right of where the logo will sit)
  const titleX = margin + 110; // logo is ~90pt wide + gutter
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...GRAY_900);
  doc.text(data.title, titleX, margin + 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...GRAY_700);
  let metaY = margin + 32;
  if (data.jobName) { doc.text(`Job: ${data.jobName}`, titleX, metaY); metaY += 13; }
  if (data.county)  { doc.text(`County: ${data.county}`, titleX, metaY); metaY += 13; }
  doc.text(`Analysis date: ${data.dateLabel}`, titleX, metaY); metaY += 13;
  doc.setTextColor(...GRAY_600);
  doc.setFontSize(9);
  doc.text(`Run ID: ${data.runId}`, titleX, metaY);

  // Horizontal rule below the header
  const ruleY = Math.max(margin + 90, metaY + 12);
  doc.setDrawColor(...LOJIK_BLUE);
  doc.setLineWidth(1);
  doc.line(margin, ruleY, pageW - margin, ruleY);

  // Logo last (PNG-with-alpha → JPEG to avoid GState leak into next text)
  const rawLogo = await loadLogoDataUrl();
  const logoJpeg = await logoToJpegDataUrl(rawLogo);
  if (logoJpeg) {
    try { doc.addImage(logoJpeg, 'JPEG', margin, margin, 90, 40); }
    catch {
      doc.setTextColor(...LOJIK_BLUE);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('LOJIK', margin, margin + 26);
    }
  } else {
    doc.setTextColor(...LOJIK_BLUE);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('LOJIK', margin, margin + 26);
  }

  // Reset text state for body
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY_900);

  let cursorY = ruleY + 22;

  // -----------------------------------------------------------------------
  // Section 1 — Summary
  // -----------------------------------------------------------------------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...GRAY_900);
  doc.text('Summary', margin, cursorY);
  cursorY += 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...GRAY_700);
  const wrappedSummary = doc.splitTextToSize(data.summaryParagraph, pageW - 2 * margin);
  doc.text(wrappedSummary, margin, cursorY);
  cursorY += wrappedSummary.length * 13 + 14;

  // -----------------------------------------------------------------------
  // Section 2 — Per-Bracket Results (table)
  // -----------------------------------------------------------------------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...GRAY_900);
  doc.text('Per-Bracket Results', margin, cursorY);
  cursorY += 6;

  const bracketHead = [['Bracket', 'Qualified Sales', 'Verdict', 'Hit Rate', 'Typical Miss']];
  const bracketBody = data.bracketRows.map((r) => ([
    r.bracketLabel,
    r.n.toLocaleString(),
    r.verdict,
    r.hitRateText,
    r.typicalMiss,
  ]));

  autoTable(doc, {
    head: bracketHead,
    body: bracketBody,
    startY: cursorY + 4,
    margin: { left: margin, right: margin },
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 5,
      textColor: GRAY_900,
      lineColor: GRAY_200,
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: GRAY_700,
      fontStyle: 'bold',
      halign: 'left',
    },
    columnStyles: {
      0: { cellWidth: 165 },
      1: { halign: 'right',  cellWidth: 80 },
      2: { halign: 'left',   cellWidth: 80 },
      3: { halign: 'right',  cellWidth: 70 },
      4: { halign: 'right',  cellWidth: 100 },
    },
    didParseCell: (hookData) => {
      if (hookData.section !== 'body') return;
      const row = data.bracketRows[hookData.row.index];
      if (!row) return;
      if (row.isAnchor) {
        hookData.cell.styles.fontStyle = 'bold';
      }
      if (row.verdictBand === 'cant_verify') {
        hookData.cell.styles.textColor = GRAY_400;
      }
    },
  });
  cursorY = doc.lastAutoTable.finalY + 18;

  // -----------------------------------------------------------------------
  // Section 3 — Per-Attribute Observations
  // -----------------------------------------------------------------------
  // Wrap to next page if we're getting tight.
  const pageH = doc.internal.pageSize.getHeight();
  if (cursorY > pageH - margin - 150) {
    doc.addPage();
    cursorY = margin;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...GRAY_900);
  doc.text('Per-Attribute Observations', margin, cursorY);
  cursorY += 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...GRAY_700);
  for (const line of data.attributeBlock) {
    const wrapped = doc.splitTextToSize(line, pageW - 2 * margin);
    if (cursorY + wrapped.length * 13 > pageH - margin - 80) {
      doc.addPage();
      cursorY = margin;
    }
    doc.text(wrapped, margin, cursorY);
    cursorY += wrapped.length * 13 + 4;
  }
  cursorY += 10;

  // -----------------------------------------------------------------------
  // Section 4 — Methodology
  // -----------------------------------------------------------------------
  if (cursorY > pageH - margin - 100) {
    doc.addPage();
    cursorY = margin;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...GRAY_900);
  doc.text('Methodology', margin, cursorY);
  cursorY += 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...GRAY_700);
  const methodPara = data.methodology.join(' ');
  const methodWrapped = doc.splitTextToSize(methodPara, pageW - 2 * margin);
  doc.text(methodWrapped, margin, cursorY);

  // Footers on every page
  drawFooters(doc, margin);

  // Save
  const today = new Date();
  const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const fname = `LOJIK_Adjustment_Analysis_${safeFilenamePart(jobMeta.jobName)}_${stamp}.pdf`;
  doc.save(fname);
  return fname;
}
