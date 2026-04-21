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
// Looks like a real street address: starts with a number, then a space,
// then at least one alpha character (e.g. "16 FOURTH AVE", "108 S DOLBOW LN").
// This filters out lone lot numbers like "279".
const ADDRESS_RE = /^\d+\s+[A-Z]/i;

function joinAddressTokens(tokens) {
  return tokens
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function extractPhotoSubjectAddress(items) {
  const idx = items.findIndex((t) => t === 'Subject');
  if (idx <= 0) return null;
  // Walk backwards looking for a real address. If the address landed in a
  // single text item we return it; if it was split across consecutive items
  // we glue them back together (BRT sometimes splits "16 FOURTH AVE" into
  // "16" / "FOURTH AVE" depending on the source font run).
  for (let j = idx - 1; j >= 0 && j >= idx - 8; j--) {
    const t = items[j];
    if (!t) continue;
    if (t === 'Subject' || /^Comp\s*#?\s*\d+$/i.test(t)) continue;
    if (ADDRESS_RE.test(t) && t.length <= 80) {
      return t.trim().toUpperCase();
    }
    // Try gluing this token with the one immediately after it.
    if (/^\d+$/.test(t) && items[j + 1] && /[A-Z]/i.test(items[j + 1])) {
      return joinAddressTokens([t, items[j + 1]]);
    }
  }
  return null;
}

/**
 * Pull per-comp addresses from a photo page. BRT lays comp captions out as
 * "<ADDRESS>" then "Comp #N" on consecutive text items, so for each Comp
 * label we walk backwards a few tokens to find the address line.
 *
 * Returns an object keyed by comp number: { 1: '8 MAPLEWOOD AVE', 2: ... }
 */
function extractPhotoCompAddresses(items) {
  const out = {};
  for (let i = 1; i < items.length; i++) {
    const m = /^Comp\s*#?\s*(\d+)$/i.exec(items[i] || '');
    if (!m) continue;
    const compNum = parseInt(m[1], 10);
    // Walk backwards looking for a real address (digit + space + letter).
    // Stop if we hit another comp/subject label before finding one.
    for (let j = i - 1; j >= 0 && j >= i - 8; j--) {
      const t = items[j];
      if (!t) continue;
      if (/^Comp\s*#?\s*\d+$/i.test(t) || t === 'Subject') break;
      if (ADDRESS_RE.test(t) && t.length <= 80) {
        out[compNum] = t.trim().toUpperCase();
        break;
      }
      // Address split across two tokens (e.g. "8" + "MAPLEWOOD AVE").
      if (/^\d+$/.test(t) && items[j + 1] && /[A-Z]/i.test(items[j + 1])) {
        out[compNum] = joinAddressTokens([t, items[j + 1]]);
        break;
      }
    }
  }
  return out;
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
    const compAddresses = kind === 'photo' ? extractPhotoCompAddresses(items) : null;
    pages.push({ index: i, kind, subject, photoAddress, compAddresses });
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
          // Per-comp addresses indexed by comp number (1..5), populated as
          // we walk this packet's photo pages.
          compAddresses: {},
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
        // Merge any comp addresses we found into the current packet.
        if (p.compAddresses) {
          for (const [n, addr] of Object.entries(p.compAddresses)) {
            if (addr && !current.compAddresses[n]) {
              current.compAddresses[n] = addr;
            }
          }
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
// BRT's photo page is LANDSCAPE (792 x 612 pt). Each photo box has a
// hard outline that we can crop against; the address + label text live
// OUTSIDE that outline, to the right of each box, so we drop the label
// area entirely and only keep the photo rectangle.
//   - Subject occupies the LEFT half (large near-square box).
//   - Three comps stack down the RIGHT side as smaller near-square boxes.
// Coordinates are fractions of the rendered canvas (0,0 = top-left).
const BRT_SLOT_RECTS = {
  subject: { x: 0.030, y: 0.085, w: 0.485, h: 0.810 },
  comp1:   { x: 0.595, y: 0.075, w: 0.240, h: 0.275 },
  comp2:   { x: 0.595, y: 0.370, w: 0.240, h: 0.275 },
  comp3:   { x: 0.595, y: 0.655, w: 0.240, h: 0.275 },
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
async function renderPageToCanvas(pdfjsPage, scale = 4) {
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
 * Walk a page's content stream and return the bounding box of every image
 * actually drawn on the page, in *page-canvas* pixel coordinates (top-left
 * origin) relative to a canvas rendered at the given viewport.
 *
 * This is the "lock in the coordinates" path — instead of guessing photo
 * positions with normalized fractions, we ask pdfjs exactly where each
 * image was placed by the source PDF. Each image draw operator is preceded
 * by `transform` calls that build a current transformation matrix (CTM);
 * the image is drawn in the unit square (0..1, 0..1) and projected onto
 * the page through that CTM. We mirror pdfjs's matrix stack to recover
 * those rectangles deterministically.
 */
async function extractImageRectsFromPage(pdfjsPage, viewport) {
  const ops = await pdfjsPage.getOperatorList();
  const OPS = pdfjsLib.OPS;

  // Standard 6-element affine matrix multiply: result = a * b.
  const mul = (a, b) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const apply = (m, x, y) => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ];

  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const rects = [];

  // Image-paint opcodes we care about. Different pdf.js builds expose
  // different subsets, so we guard each lookup.
  const IMG_OPS = new Set(
    [
      OPS.paintImageXObject,
      OPS.paintJpegXObject,
      OPS.paintInlineImageXObject,
      OPS.paintImageMaskXObject,
    ].filter((v) => v != null),
  );

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) {
      stack.push(ctm.slice());
    } else if (fn === OPS.restore) {
      ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    } else if (fn === OPS.transform) {
      ctm = mul(ctm, args);
    } else if (IMG_OPS.has(fn)) {
      // Project the unit square (0,0)-(1,1) through the CTM to get the
      // page-space bounding box of this image.
      const corners = [
        apply(ctm, 0, 0),
        apply(ctm, 1, 0),
        apply(ctm, 0, 1),
        apply(ctm, 1, 1),
      ];
      const xs = corners.map((p) => p[0]);
      const ys = corners.map((p) => p[1]);
      const xMin = Math.min(...xs);
      const xMax = Math.max(...xs);
      const yMin = Math.min(...ys);
      const yMax = Math.max(...ys);
      const wPdf = xMax - xMin;
      const hPdf = yMax - yMin;
      // Skip degenerate rectangles (1D lines, etc.).
      if (wPdf < 1 || hPdf < 1) continue;
      // Convert PDF user-space -> rendered canvas (top-left origin).
      // viewport.height is in canvas pixels; pdfjs's viewport already
      // bakes in the page rotation + scale, but for the typical
      // unrotated landscape pages BRT ships, this projection is direct.
      const scale = viewport.scale;
      const pageHpt = viewport.height / scale;
      rects.push({
        xPx: xMin * scale,
        yPx: (pageHpt - yMax) * scale,
        wPx: wPdf * scale,
        hPx: hPdf * scale,
        areaPdf: wPdf * hPdf,
      });
    }
  }
  return rects;
}

/**
 * Given the image rectangles from a BRT photo page, classify them into
 * the fixed slot order BRT uses: largest = subject; remaining sorted top
 * to bottom = comp1, comp2, comp3.
 */
function classifyPhotoRects(rects, slotsForPage) {
  if (!rects.length) return {};
  // Sort by area desc; biggest is the subject box on BRT pages.
  const sortedByArea = [...rects].sort((a, b) => b.areaPdf - a.areaPdf);
  const out = {};
  const remaining = [];
  if (slotsForPage.includes('subject')) {
    out.subject = sortedByArea[0];
    remaining.push(...sortedByArea.slice(1));
  } else {
    remaining.push(...sortedByArea);
  }
  // Sort remaining top->bottom by yPx (smaller y = higher on canvas).
  remaining.sort((a, b) => a.yPx - b.yPx);
  const compSlots = slotsForPage.filter((s) => s !== 'subject');
  for (let i = 0; i < compSlots.length && i < remaining.length; i++) {
    out[compSlots[i]] = remaining[i];
  }
  return out;
}

/**
 * Walk the photo pages of a packet and pull out per-slot photo data URLs.
 * Strategy:
 *   1. Render the page to a canvas (high scale for resolution).
 *   2. Read the actual image-draw rectangles from the PDF content stream.
 *   3. Classify those rectangles into subject/comp slots by size + Y.
 *   4. Crop the canvas at those exact positions.
 *   5. If the operator-list path returns no rects (rare malformed page),
 *      fall back to the eyeballed BRT_SLOT_RECTS fractions.
 */
async function extractPhotosFromPacket(originalPdfBytes, packet) {
  // Independent copy so neither pdfjs nor pdf-lib detaches the master bytes.
  const scanCopy = new Uint8Array(originalPdfBytes.byteLength);
  scanCopy.set(originalPdfBytes);
  const pdf = await pdfjsLib.getDocument({ data: scanCopy }).promise;

  const bySlot = {};
  for (let i = 0; i < packet.photoPageIndices.length; i++) {
    const pageIdx = packet.photoPageIndices[i];
    const slotsForPage = PHOTO_PAGE_SLOTS[i] || [];
    if (!slotsForPage.length) break; // Safety: stop after page 2.
    const pdfjsPage = await pdf.getPage(pageIdx + 1);
    const scale = 4;
    const viewport = pdfjsPage.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    await pdfjsPage.render({ canvasContext: ctx, viewport }).promise;

    // ---- Option A: real image positions from the content stream --------
    let imageRects = [];
    try {
      imageRects = await extractImageRectsFromPage(pdfjsPage, viewport);
    } catch (e) {
      console.warn('operator-list image scan failed; falling back to fixed rects', e);
    }

    if (imageRects.length) {
      const classified = classifyPhotoRects(imageRects, slotsForPage);
      for (const slot of slotsForPage) {
        const r = classified[slot];
        if (!r) {
          bySlot[slot] = null;
          continue;
        }
        // Tiny inset so we don't catch the box border.
        const inset = 1;
        const x = r.xPx + inset;
        const y = r.yPx + inset;
        const w = r.wPx - inset * 2;
        const h = r.hPx - inset * 2;
        if (isMostlyWhite(canvas, x, y, w, h)) {
          bySlot[slot] = null;
          continue;
        }
        bySlot[slot] = cropToDataUrl(canvas, x, y, w, h);
      }
    } else {
      // ---- Fallback: legacy fractional rects (eyeballed) ---------------
      for (const slot of slotsForPage) {
        const rect = rectForSlot(slot);
        if (!rect) continue;
        const px = rect.x * canvas.width;
        const py = rect.y * canvas.height;
        const pw = rect.w * canvas.width;
        const ph = rect.h * canvas.height;
        if (isMostlyWhite(canvas, px, py, pw, ph)) {
          bySlot[slot] = null;
          continue;
        }
        bySlot[slot] = cropToDataUrl(canvas, px, py, pw, ph);
      }
    }

    try { await pdfjsPage.cleanup?.(); } catch (_) {}
  }
  try { await pdf.destroy(); } catch (_) {}
  return bySlot;
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

  const bySlot = await extractPhotosFromPacket(originalPdfBytes, packet);
  // Bail only if we got literally nothing back from any slot.
  const anyPhoto = Object.values(bySlot).some((v) => !!v);
  if (!anyPhoto) return null;

  const { jsPDF } = await import('jspdf');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();   // 792
  const pageH = doc.internal.pageSize.getHeight();  // 612
  const margin = 36;
  const headerH = 56; // room for the LOJIK logo (35pt tall + breathing room)
  const footerH = 22;
  const lojikBlue = [0, 102, 204];

  const subjectAddr = packet.address || '';
  const compAddrs = packet.compAddresses || {};
  const blqLabel =
    `${packet.block}/${packet.lot}` +
    (packet.qualifier ? `/${packet.qualifier}` : '');
  const appealNumber = opts.appealNumber || '';

  // Optionally load the LOJIK logo so the header matches the rest of the
  // appeal report (logo top-left, Appeal # + Block/Lot top-right). Falls
  // back to a "LOJIK" wordmark if the image can't be fetched.
  let logoDataUrl = null;
  try {
    const resp = await fetch('/lojik-logo.PNG');
    if (resp.ok) {
      const blob = await resp.blob();
      logoDataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    }
  } catch (_) { /* fallback to text */ }

  const drawHeader = () => {
    // Logo top-left
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, 'PNG', margin, margin - 5, 80, 35);
      } catch (_) {
        doc.setTextColor(...lojikBlue);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('LOJIK', margin, margin + 14);
      }
    } else {
      doc.setTextColor(...lojikBlue);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('LOJIK', margin, margin + 14);
    }

    // Appeal # + Block/Lot top-right (matches the rest of the appeal report)
    let headerY = margin + 10;
    if (appealNumber) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      doc.text(`Appeal #: ${appealNumber}`, pageW - margin, headerY, { align: 'right' });
      headerY += 14;
    }
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(blqLabel, pageW - margin, headerY + 10, { align: 'right' });
  };

  const drawFooter = () => {
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.setFont('helvetica', 'italic');
    doc.text('Subject and comparable photographs.', margin, pageH - margin + 8);
    doc.setFont('helvetica', 'normal');
    doc.text(blqLabel, pageW - margin, pageH - margin + 8, { align: 'right' });
  };

  // ---- Sizing strategy ----------------------------------------------------
  // Subject sits on top, comps 1-3 sit side-by-side on the bottom. Cells
  // have FIXED borders so the layout looks the same whether or not BRT
  // shipped a photo for a given slot. Inside each cell the actual photo is
  // letterboxed (aspect ratio preserved, centered) — this absorbs minor
  // resolution / aspect variance from BRT's source crops without distorting
  // the picture. We also keep cells modest in size relative to the source
  // raster (~166x157 native for comps, ~364x480 native for subject) so we
  // never upscale a tiny crop into a huge cell.
  const captionGap = 4;
  const captionH   = 12;
  const cellPad    = 2;

  const contentTop    = margin + headerH;
  const contentBottom = pageH - margin - footerH;
  const contentH      = contentBottom - contentTop;
  const contentW      = pageW - margin * 2;

  // Subject cell: a touch smaller than top-half so it doesn't dominate.
  // Comp cells: split the bottom row into 3 equal cells, intentionally a
  // little taller than they used to be so they read clearly.
  const rowGap     = 14;
  const subjRowH   = Math.floor((contentH - rowGap) * 0.46);
  const compRowH   = contentH - rowGap - subjRowH;
  const subjPhotoH = subjRowH - captionGap - captionH - cellPad * 2;
  const compPhotoH = compRowH - captionGap - captionH - cellPad * 2;

  // Subject is centered horizontally with a fixed width that keeps the
  // photo proportionate (roughly the same aspect as BRT's box ≈ 0.76).
  const subjPhotoW = Math.min(
    contentW * 0.55,
    subjPhotoH / 0.76,
  );
  const subjCellW  = subjPhotoW + cellPad * 2;
  const subjCellH  = subjPhotoH + cellPad * 2;
  const subjX      = margin + (contentW - subjCellW) / 2;
  const subjY      = contentTop;

  const colGap     = 14;
  const compPhotoW = (contentW - colGap * 2) / 3 - cellPad * 2;
  const compCellW  = compPhotoW + cellPad * 2;
  const compCellH  = compPhotoH + cellPad * 2;
  const compsY     = contentTop + subjRowH + rowGap;

  // Cell + image renderer. Letterboxes the image inside the photo area so
  // any minor aspect-ratio change keeps the picture undistorted.
  const drawSlot = (x, y, photoW, photoH, label, dataUrl, opts2 = {}) => {
    const cellW = photoW + cellPad * 2;
    const cellH = photoH + cellPad * 2;
    doc.setDrawColor(150, 150, 150);
    doc.setFillColor(252, 252, 252);
    doc.setLineWidth(0.7);
    doc.rect(x, y, cellW, cellH, 'FD');
    if (dataUrl) {
      try {
        const props = doc.getImageProperties(dataUrl);
        const ratio = props.width / props.height;
        let drawW = photoW;
        let drawH = photoW / ratio;
        if (drawH > photoH) {
          drawH = photoH;
          drawW = photoH * ratio;
        }
        const dx = x + cellPad + (photoW - drawW) / 2;
        const dy = y + cellPad + (photoH - drawH) / 2;
        doc.addImage(dataUrl, 'JPEG', dx, dy, drawW, drawH);
      } catch (e) {
        console.warn('addImage failed for', label, e);
      }
    } else {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(170, 170, 170);
      doc.text(
        'No photo provided',
        x + cellW / 2,
        y + cellH / 2 + 3,
        { align: 'center' },
      );
    }
    doc.setFontSize(opts2.subject ? 11 : 10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(opts2.subject ? [185, 28, 28] : lojikBlue));
    doc.text(label, x, y + cellH + captionGap + captionH);
  };

  drawHeader();

  const compLabel = (n) =>
    compAddrs[n] ? `Comp #${n}  —  ${compAddrs[n]}` : `Comp #${n}`;

  // Subject — top row, centered.
  drawSlot(
    subjX,
    subjY,
    subjPhotoW,
    subjPhotoH,
    subjectAddr ? `Subject  —  ${subjectAddr}` : 'Subject',
    bySlot.subject || null,
    { subject: true },
  );

  // Comps 1-3 — bottom row, three equal cells side-by-side.
  ['comp1', 'comp2', 'comp3'].forEach((slot, i) => {
    drawSlot(
      margin + i * (compCellW + colGap),
      compsY,
      compPhotoW,
      compPhotoH,
      compLabel(i + 1),
      bySlot[slot] || null,
    );
  });

  drawFooter();

  // ---- Page 2 (only if comp4 or comp5 actually came in): subject on
  // top again for context, comps 4 + 5 centered on the bottom row.
  const hasOverflow = !!(bySlot.comp4 || bySlot.comp5);
  if (hasOverflow) {
    doc.addPage();
    drawHeader();
    drawSlot(
      subjX,
      subjY,
      subjPhotoW,
      subjPhotoH,
      subjectAddr ? `Subject  —  ${subjectAddr}` : 'Subject',
      bySlot.subject || null,
      { subject: true },
    );
    const overflowCellW = compCellW;
    const overflowTotalW = overflowCellW * 2 + colGap;
    const overflowX = margin + (contentW - overflowTotalW) / 2;
    ['comp4', 'comp5'].forEach((slot, i) => {
      drawSlot(
        overflowX + i * (overflowCellW + colGap),
        compsY,
        compPhotoW,
        compPhotoH,
        compLabel(i + 4),
        bySlot[slot] || null,
      );
    });
    drawFooter();
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
