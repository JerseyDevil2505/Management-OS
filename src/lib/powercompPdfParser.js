// PowerComp PDF parser
// -----------------------------------------------------------------------------
// Reads a BRT PowerComp "Batch Taxpayer Report" PDF, identifies each subject's
// BLQ (Block / Lot / Qualifier) on its data pages, classifies each page as
// either a data page or a photo page, and groups consecutive pages into
// per-subject "packets" we can store and reattach to our own appeal PDFs.
//
// Output shape (from parsePowerCompPdf):
//   {
//     totalPages: number,
//     packets: [
//       {
//         block: '601',
//         lot: '18',
//         qualifier: '',
//         address: '306 THIRD ST',
//         dataPageIndices:  [0, 2],     // 0-based, in source PDF
//         photoPageIndices: [1, 3],
//         allPageIndices:   [0, 1, 2, 3],
//       },
//       ...
//     ],
//   }
//
// The parser is layout-tolerant: it relies on textual landmarks
// ("Block Lot Qualifier Card", "Sales Date", "Subject") rather than coordinates.

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
// Use a CDN worker so we don't need bundler config gymnastics in CRA.
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// Keywords that only appear on the *data* (grid) pages.
const DATA_PAGE_KEYWORDS = [
  'Sales Date',
  'Sales Price',
  'SFLA',
  'Per Sq Ft Value',
  'Year of Sale',
  'Land Description',
];

/** Pull all text items from a single page, in reading order. */
async function getPageText(pdf, pageIndex) {
  const page = await pdf.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  const items = content.items.map((it) => (it.str || '').trim()).filter(Boolean);
  return {
    items,
    joined: items.join(' '),
  };
}

/**
 * Try to read the SUBJECT's Block / Lot / Qualifier from a data page.
 * Layout (per the BRT samples) is:
 *   "Subject"
 *   "Block" "Lot" "Qualifier" "Card"
 *   "<block>" "<lot>" "<qual?>" "<card>"
 *   "<address line>"
 * The qualifier cell is often blank, so we tolerate 3- or 4-cell rows.
 */
function extractSubjectBLQ(items) {
  // Find the first "Block" that's followed by "Lot" "Qualifier" "Card"
  for (let i = 0; i < items.length - 4; i++) {
    if (
      items[i] === 'Block' &&
      items[i + 1] === 'Lot' &&
      items[i + 2] === 'Qualifier' &&
      items[i + 3] === 'Card'
    ) {
      // Next 3 or 4 tokens are the data row, then the address line.
      // We grab up to the next 5 tokens and parse pragmatically.
      const tail = items.slice(i + 4, i + 4 + 6);
      // The card value is almost always 2 digits ("01"); the qualifier may be
      // blank (so the row collapses to 3 tokens) or a short alphanumeric.
      let block = '', lot = '', qualifier = '', card = '', address = '';
      if (tail.length >= 4 && /^\d/.test(tail[3]) === false && /^\d/.test(tail[2])) {
        // 4 tokens: block, lot, qual, card
        [block, lot, qualifier, card] = tail.slice(0, 4);
        address = tail[4] || '';
      } else if (tail.length >= 3) {
        // 3 tokens: block, lot, card (qualifier blank)
        [block, lot, card] = tail.slice(0, 3);
        qualifier = '';
        address = tail[3] || '';
      }
      return {
        block: String(block || '').trim(),
        lot: String(lot || '').trim(),
        qualifier: String(qualifier || '').trim(),
        card: String(card || '').trim(),
        address: String(address || '').trim().toUpperCase(),
      };
    }
  }
  return null;
}

/**
 * Detect whether a page is a "data" page (has the attribute grid) or a
 * "photo" page (has subject/comp captions but no grid).
 */
function classifyPage(joined) {
  const hits = DATA_PAGE_KEYWORDS.reduce(
    (n, kw) => (joined.includes(kw) ? n + 1 : n),
    0,
  );
  return hits >= 3 ? 'data' : 'photo';
}

/**
 * Try to read the subject ADDRESS from a photo page.
 * Photo pages caption the big left photo with "<ADDRESS>\nSubject".
 */
function extractPhotoSubjectAddress(items) {
  const idx = items.findIndex((t) => t === 'Subject');
  if (idx <= 0) return null;
  // Walk backwards to find the most recent address-looking token.
  for (let j = idx - 1; j >= 0 && j >= idx - 6; j--) {
    const t = items[j];
    if (t && /^\d+\s/.test(t) && t.length <= 60) {
      return t.trim().toUpperCase();
    }
    // Some captions split address across tokens, so also accept the
    // immediately previous non-empty token as a fallback.
    if (j === idx - 1 && t && t.length <= 60 && t !== 'Subject') {
      return t.trim().toUpperCase();
    }
  }
  return null;
}

/**
 * Main entry: parse a PowerComp PDF (File / Blob / ArrayBuffer / Uint8Array)
 * and return per-subject packets.
 */
export async function parsePowerCompPdf(input) {
  let data;
  if (input instanceof ArrayBuffer) {
    data = new Uint8Array(input);
  } else if (input instanceof Uint8Array) {
    data = input;
  } else if (input && typeof input.arrayBuffer === 'function') {
    data = new Uint8Array(await input.arrayBuffer());
  } else {
    throw new Error('parsePowerCompPdf: unsupported input type');
  }

  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const total = pdf.numPages;

  // First pass: per-page classification + extracted subject info.
  const pages = [];
  for (let i = 0; i < total; i++) {
    const { items, joined } = await getPageText(pdf, i);
    const kind = classifyPage(joined);
    const subject = kind === 'data' ? extractSubjectBLQ(items) : null;
    const photoAddress = kind === 'photo' ? extractPhotoSubjectAddress(items) : null;
    pages.push({ index: i, kind, subject, photoAddress });
  }

  // Second pass: group pages into packets keyed by subject BLQ.
  const packets = [];
  let current = null;

  const subjectKey = (s) =>
    `${s.block}|${s.lot}|${s.qualifier}|${s.card}`.toUpperCase();

  for (const p of pages) {
    if (p.kind === 'data' && p.subject) {
      const key = subjectKey(p.subject);
      if (!current || current._key !== key) {
        current = {
          _key: key,
          block: p.subject.block,
          lot: p.subject.lot,
          qualifier: p.subject.qualifier,
          card: p.subject.card,
          address: p.subject.address,
          dataPageIndices: [],
          photoPageIndices: [],
          allPageIndices: [],
        };
        packets.push(current);
      }
      current.dataPageIndices.push(p.index);
      current.allPageIndices.push(p.index);
    } else if (p.kind === 'photo') {
      // Attach to the most recent packet whose address matches (or just the
      // most recent packet if we can't read an address from the photo page).
      if (current) {
        if (
          !p.photoAddress ||
          !current.address ||
          p.photoAddress.startsWith(current.address) ||
          current.address.startsWith(p.photoAddress)
        ) {
          current.photoPageIndices.push(p.index);
          current.allPageIndices.push(p.index);
        } else {
          // Address mismatch — still attach to current; mismatches are usually
          // OCR-ish noise from address cell variants. Flag for the UI.
          current.photoPageIndices.push(p.index);
          current.allPageIndices.push(p.index);
          current.addressMismatch = true;
        }
      }
    }
  }

  // Strip private key field
  for (const pkt of packets) delete pkt._key;

  return {
    totalPages: total,
    packets,
  };
}

// =============================================================================
// PHOTO EXTRACTION + LOJIK-BRANDED PHOTO PACKET
// =============================================================================
// Instead of copying BRT's photo pages verbatim (which carries their layout
// chrome and the BRT copyright footer), we now render each BRT photo page to
// a canvas via pdfjs, crop the photo regions out of known slot rectangles,
// and re-lay them out on our own landscape grid. End result:
//   - Same property photos
//   - Lojik header, equal-sized photo cells, our captions
//   - No BRT layout / wordmark / "Copyright (c) BRT Technologies" footer
//
// BRT's photo page is consistent across vendors (BRT + Microsystems): one
// large subject box on the left, three stacked comp boxes on the right.
// When a subject has more than 3 comps, BRT spills onto a 2nd photo page
// repeating the subject + the next batch of comps. We treat the subject from
// the first page as authoritative and just walk the comp slots in order
// across pages.
//
// All slot coordinates are expressed as fractions of the rendered page so
// they survive page-size differences.

// Slot rectangles (x, y, w, h) are relative to the *rendered canvas* size,
// where (0,0) is top-left. Tuned against the BRT samples we have on file —
// adjust here if BRT changes their template. Each rect is intentionally a
// little smaller than the visible box outline so we don't capture the
// border stroke.
const BRT_SLOT_RECTS = {
  subject: { x: 0.030, y: 0.105, w: 0.460, h: 0.690 },
  comp1:   { x: 0.620, y: 0.105, w: 0.295, h: 0.205 },
  comp2:   { x: 0.620, y: 0.370, w: 0.295, h: 0.205 },
  comp3:   { x: 0.620, y: 0.635, w: 0.295, h: 0.205 },
};
// Per-page slot order. Page 0: subject + comps 1-3. Page 1+: comps 4, 5
// (BRT reuses the subject box on subsequent pages but we already captured
// it from page 0 so we skip it here).
const PHOTO_PAGE_SLOTS = [
  ['subject', 'comp1', 'comp2', 'comp3'],
  ['comp4', 'comp5'],
];

// "No Picture" placeholder detection: sample 9 points across the cropped
// region; if every sample is near-white the slot is empty.
function isMostlyWhite(canvas, x, y, w, h) {
  const ctx = canvas.getContext('2d');
  let whiteHits = 0;
  let total = 0;
  for (let ry = 0; ry < 3; ry++) {
    for (let rx = 0; rx < 3; rx++) {
      const sx = Math.floor(x + (w * (rx + 0.5)) / 3);
      const sy = Math.floor(y + (h * (ry + 0.5)) / 3);
      try {
        const data = ctx.getImageData(sx, sy, 1, 1).data;
        if (data[0] > 240 && data[1] > 240 && data[2] > 240) whiteHits++;
        total++;
      } catch (_) { /* getImageData can throw on tainted canvases */ }
    }
  }
  return total > 0 && whiteHits / total >= 0.85;
}

// Helper: returns the comp-2 slot rect (used for comp4/comp5 on page 2).
// Page 2 layout repeats the same right-column geometry as page 1.
function rectForSlot(slotName) {
  if (slotName === 'comp4') return BRT_SLOT_RECTS.comp1;
  if (slotName === 'comp5') return BRT_SLOT_RECTS.comp2;
  return BRT_SLOT_RECTS[slotName];
}

/**
 * Render a PDF page to a canvas via pdfjs and return the canvas.
 * Caller is responsible for not detaching the underlying buffer.
 */
async function renderPageToCanvas(pdfjsPage, scale = 2) {
  const viewport = pdfjsPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  await pdfjsPage.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/**
 * Crop a region from a source canvas to a fresh canvas, returning a
 * data URL (PNG).
 */
function cropToDataUrl(srcCanvas, x, y, w, h) {
  const dst = document.createElement('canvas');
  dst.width = Math.max(1, Math.floor(w));
  dst.height = Math.max(1, Math.floor(h));
  const dctx = dst.getContext('2d');
  dctx.drawImage(srcCanvas, x, y, w, h, 0, 0, dst.width, dst.height);
  return dst.toDataURL('image/jpeg', 0.85);
}

/**
 * Walk the photo pages of a packet and pull out per-slot photo data URLs.
 * Returns an array of { slot, label, dataUrl } in display order. Slots
 * detected as "No Picture" placeholders are dropped silently.
 */
async function extractPhotosFromPacket(originalPdfBytes, packet) {
  // Independent copy so neither pdfjs nor pdf-lib detaches the master bytes.
  const scanCopy = new Uint8Array(originalPdfBytes.byteLength);
  scanCopy.set(originalPdfBytes);
  const pdf = await pdfjsLib.getDocument({ data: scanCopy }).promise;

  const photos = [];
  for (let i = 0; i < packet.photoPageIndices.length; i++) {
    const pageIdx = packet.photoPageIndices[i];
    const slotsForPage = PHOTO_PAGE_SLOTS[i] || [];
    if (!slotsForPage.length) break; // Safety: stop after page 2.
    const pdfjsPage = await pdf.getPage(pageIdx + 1);
    const canvas = await renderPageToCanvas(pdfjsPage, 2);
    for (const slot of slotsForPage) {
      const rect = rectForSlot(slot);
      if (!rect) continue;
      const px = rect.x * canvas.width;
      const py = rect.y * canvas.height;
      const pw = rect.w * canvas.width;
      const ph = rect.h * canvas.height;
      if (isMostlyWhite(canvas, px, py, pw, ph)) continue;
      photos.push({
        slot,
        label:
          slot === 'subject'
            ? 'Subject'
            : `Comp #${slot.replace('comp', '')}`,
        dataUrl: cropToDataUrl(canvas, px, py, pw, ph),
      });
    }
    try { await pdfjsPage.cleanup?.(); } catch (_) {}
  }
  try { await pdf.destroy(); } catch (_) {}
  return photos;
}

/**
 * Build a Lojik-branded landscape photo packet PDF from a parsed packet.
 *
 * No BRT chrome (header, footer, copyright wordmark) is preserved — only
 * the underlying photographs are reused. Subject + comp photos are laid
 * out in a uniform 3x2 grid so the subject is no longer disproportionately
 * larger than the comps.
 *
 * Returns Uint8Array of the new PDF, or null if no photos were found.
 */
export async function buildPhotoPacketPdf(originalPdfBytes, packet, opts = {}) {
  if (!packet.photoPageIndices?.length) return null;

  const photos = await extractPhotosFromPacket(originalPdfBytes, packet);
  if (!photos.length) return null;

  // Lazy-load jsPDF here so the import sits beside the work that needs it.
  const { jsPDF } = await import('jspdf');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();   // 792
  const pageH = doc.internal.pageSize.getHeight();  // 612
  const margin = 36;
  const headerH = 50;
  const footerH = 22;
  const lojikBlue = [0, 102, 204];

  // 3-column x 2-row grid. Subject + up to 5 comps = 6 cells; perfect fit.
  const cols = 3;
  const rows = 2;
  const cellGapX = 14;
  const cellGapY = 22; // extra vertical room for caption
  const captionH = 28;

  const gridLeft = margin;
  const gridTop = margin + headerH;
  const gridW = pageW - margin * 2;
  const gridH = pageH - margin * 2 - headerH - footerH;
  const cellW = (gridW - cellGapX * (cols - 1)) / cols;
  const cellH = (gridH - cellGapY * (rows - 1)) / rows;
  const photoH = cellH - captionH;

  const subjectAddr = packet.address || '';
  const blqLabel =
    `${packet.block}-${packet.lot}` +
    (packet.qualifier ? `-${packet.qualifier}` : '');

  const drawHeader = () => {
    // Left: title
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...lojikBlue);
    doc.text('Photo Packet', margin, margin + 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(60, 60, 60);
    doc.text(
      `Block ${packet.block} Lot ${packet.lot}` +
        (packet.qualifier ? ` Qual ${packet.qualifier}` : '') +
        (subjectAddr ? `  \u00b7  ${subjectAddr}` : ''),
      margin,
      margin + 30,
    );
    // Right: appeal context line is filled in later by the merge step
    // (which already prints subject info atop each report page). Here we
    // just stamp the slot count so the user can sanity-check.
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `${photos.length} photo${photos.length === 1 ? '' : 's'}`,
      pageW - margin,
      margin + 14,
      { align: 'right' },
    );
    // Thin underline
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.5);
    doc.line(margin, margin + headerH - 6, pageW - margin, margin + headerH - 6);
  };

  const drawFooter = () => {
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.setFont('helvetica', 'italic');
    doc.text('Subject and comparable photographs.', margin, pageH - margin + 8);
    doc.setFont('helvetica', 'normal');
    doc.text(blqLabel, pageW - margin, pageH - margin + 8, { align: 'right' });
  };

  // Cell drawer. Returns true if the cell was rendered.
  const drawCell = (photo, col, row) => {
    const x = gridLeft + col * (cellW + cellGapX);
    const y = gridTop + row * (cellH + cellGapY);
    // Photo box (with subtle border and white fill)
    doc.setDrawColor(200, 200, 200);
    doc.setFillColor(255, 255, 255);
    doc.setLineWidth(0.5);
    doc.rect(x, y, cellW, photoH, 'FD');
    // Inset the actual image a hair so we don't clip the border
    try {
      doc.addImage(photo.dataUrl, 'JPEG', x + 1, y + 1, cellW - 2, photoH - 2);
    } catch (e) {
      console.warn('addImage failed for slot', photo.slot, e);
    }
    // Subject gets a colored badge + bold caption to distinguish it.
    const isSubject = photo.slot === 'subject';
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(isSubject ? [185, 28, 28] : lojikBlue));
    doc.text(photo.label, x + 6, y + photoH + 14);
    if (isSubject && subjectAddr) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      doc.text(subjectAddr, x + 6, y + photoH + 26);
    }
  };

  // Render in pages of 6 cells. With max 5 comps + 1 subject this fits on
  // a single page, but we keep the loop generic in case BRT ever ships
  // packets with more comps.
  const cellsPerPage = cols * rows;
  for (let pageStart = 0; pageStart < photos.length; pageStart += cellsPerPage) {
    if (pageStart > 0) doc.addPage();
    drawHeader();
    const slice = photos.slice(pageStart, pageStart + cellsPerPage);
    slice.forEach((photo, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      drawCell(photo, col, row);
    });
    drawFooter();
  }

  // Optional caller override (kept for future use; currently unused since the
  // rebuilt layout doesn't require BRT attribution).
  void opts;

  return new Uint8Array(doc.output('arraybuffer'));
}
