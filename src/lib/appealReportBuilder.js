// Appeal report builder
// -----------------------------------------------------------------------------
// Generates a per-subject Appeal Report PDF using jsPDF for the cover/summary
// page(s), then optionally appends the imported PowerComp photo packet
// (downloaded from Supabase storage) using pdf-lib.
//
// Used by AppealLogTab for:
//   - the per-row 📄 print icon
//   - the batch print zip workflow
//
// The output is intentionally lightweight — no html2canvas, no DOM scraping —
// so it works from a button click without rendering anything on screen first.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const fmtCurrency = (v) => {
  if (v == null || v === '' || isNaN(Number(v))) return '-';
  return Number(v).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
};

const fmtDate = (v) => {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-US');
};

const STATUS_LABELS = {
  D: 'Defendable',
  S: 'Stipulated',
  H: 'Heard',
  W: 'Withdrawn',
  Z: 'Settled',
  A: 'Assessor',
  X: 'Cross Petition',
  AP: 'Assessor / Petition',
  AWP: 'Assessor / Withdrawn',
  NA: 'Non-Appearance',
};

/**
 * Build a single appeal cover page (jsPDF) and return it as a Uint8Array.
 */
function buildCoverPdf(appeal, opts = {}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  let y = margin;

  // Header band
  doc.setFillColor(15, 118, 110); // teal-700
  doc.rect(0, 0, pageWidth, 56, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Appeal Report', margin, 36);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(opts.muniLabel || '', pageWidth - margin, 36, { align: 'right' });

  y = 90;
  doc.setTextColor(20);

  // Subject block
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  const blq =
    `${appeal.property_block || '-'}-${appeal.property_lot || '-'}` +
    (appeal.property_qualifier ? `-${appeal.property_qualifier}` : '');
  doc.text(blq, margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  y += 18;
  doc.text(appeal.property_location || '', margin, y);
  y += 14;
  doc.setFontSize(9);
  doc.setTextColor(90);
  if (appeal.appeal_number) {
    doc.text(`Appeal #: ${appeal.appeal_number}`, margin, y);
    y += 12;
  }
  doc.setTextColor(20);

  y += 10;

  // Identity table
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [243, 244, 246], textColor: 20 },
    head: [['Identity', '']],
    body: [
      ['Property Class', appeal.property_m4_class || '-'],
      ['VCS', appeal.new_vcs || '-'],
      ['Petitioner', appeal.petitioner_name || '-'],
      ['Attorney', appeal.attorney || '-'],
      [
        'Status',
        `${appeal.status || 'NA'}${
          STATUS_LABELS[appeal.status] ? ` — ${STATUS_LABELS[appeal.status]}` : ''
        }`,
      ],
      ['Hearing Date', fmtDate(appeal.hearing_date)],
      ['Tax Court Pending', appeal.tax_court_pending ? 'Yes' : 'No'],
    ],
    margin: { left: margin, right: margin },
  });
  y = doc.lastAutoTable.finalY + 12;

  // Valuation table
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [243, 244, 246], textColor: 20 },
    head: [['Valuation', '']],
    body: [
      ['Current Assessment', fmtCurrency(appeal.current_assessment)],
      ['CME Projected Value', fmtCurrency(appeal.cme_projected_value)],
      ['Judgment Value', fmtCurrency(appeal.judgment_value)],
      ['Loss', fmtCurrency(appeal.loss)],
    ],
    margin: { left: margin, right: margin },
  });
  y = doc.lastAutoTable.finalY + 12;

  // Comps table (optional)
  if (Array.isArray(opts.comps) && opts.comps.length) {
    autoTable(doc, {
      startY: y,
      theme: 'striped',
      styles: { fontSize: 8.5, cellPadding: 3 },
      headStyles: { fillColor: [15, 118, 110], textColor: 255 },
      head: [['#', 'Block', 'Lot', 'Qualifier', 'Address']],
      body: opts.comps.map((c, i) => [
        String(i + 1),
        c.block || c.property_block || '-',
        c.lot || c.property_lot || '-',
        c.qualifier || c.property_qualifier || '-',
        c.address || c.property_location || '',
      ]),
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 12;
  }

  // Notes (optional)
  const notes =
    appeal.notes || appeal.comments || appeal.appeal_notes || appeal.assessor_notes || '';
  if (notes) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Notes', margin, y);
    y += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const wrapped = doc.splitTextToSize(String(notes), pageWidth - margin * 2);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 11 + 6;
  }

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    `Generated ${new Date().toLocaleString('en-US')}`,
    margin,
    pageHeight - 24,
  );
  if (opts.hasPhotoPacket) {
    doc.text(
      'Photos Courtesy of BRT Technologies PowerComp',
      pageWidth - margin,
      pageHeight - 24,
      { align: 'right' },
    );
  }

  return new Uint8Array(doc.output('arraybuffer'));
}

/**
 * Build a complete appeal report (cover + optional photo packet) and return
 * Uint8Array PDF bytes.
 *
 * @param {object} args
 * @param {object} args.appeal             - Appeal log row
 * @param {Uint8Array|null} args.photoPacketBytes - Bytes of the per-subject
 *                                                  PowerComp photo packet PDF, or null
 * @param {string} [args.muniLabel]        - Header right-side label
 * @param {Array}  [args.comps]            - Optional comps list to include in cover
 * @returns {Promise<Uint8Array>}
 */
export async function buildAppealReportPdf({
  appeal,
  photoPacketBytes = null,
  muniLabel = '',
  comps = null,
}) {
  const cover = buildCoverPdf(appeal, {
    muniLabel,
    hasPhotoPacket: !!photoPacketBytes,
    comps,
  });

  if (!photoPacketBytes) return cover;

  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  const coverDoc = await PDFDocument.load(cover);
  const photosDoc = await PDFDocument.load(photoPacketBytes);

  const coverPages = await out.copyPages(coverDoc, coverDoc.getPageIndices());
  for (const p of coverPages) out.addPage(p);

  const photoPages = await out.copyPages(photosDoc, photosDoc.getPageIndices());
  for (const p of photoPages) out.addPage(p);

  return await out.save();
}

/**
 * Helper: trigger a browser download for a Uint8Array PDF.
 */
export function downloadPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Helper: build a zip of multiple Appeal Report PDFs (one per subject)
 * and trigger a download. JSZip is dynamically imported so it doesn't
 * inflate the initial bundle.
 */
export async function downloadAppealReportsZip(reports, zipFilename) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  for (const r of reports) {
    zip.file(r.filename, r.bytes);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Sanitize a filename — keep it filesystem safe across OSes.
 */
export function safeFilenamePart(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}
