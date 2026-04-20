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

/**
 * Build a small sub-PDF (Uint8Array) containing only the photo pages for one
 * packet, with a credit footer stamped on each page.
 *
 * Caller passes in the original PDF bytes and a single packet from parsePowerCompPdf.
 */
export async function buildPhotoPacketPdf(originalPdfBytes, packet, opts = {}) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const src = await PDFDocument.load(originalPdfBytes);
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);

  const credit =
    opts.credit || 'Photos Courtesy of BRT Technologies PowerComp';

  if (!packet.photoPageIndices.length) return null;
  const pages = await out.copyPages(src, packet.photoPageIndices);
  for (const p of pages) {
    out.addPage(p);
    const { width } = p.getSize();
    p.drawText(credit, {
      x: 24,
      y: 14,
      size: 8,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    p.drawText(
      `${packet.block}-${packet.lot}${packet.qualifier ? '-' + packet.qualifier : ''}` +
        (packet.address ? `  ·  ${packet.address}` : ''),
      {
        x: width - 220,
        y: 14,
        size: 8,
        font,
        color: rgb(0.35, 0.35, 0.35),
      },
    );
  }
  return await out.save();
}
