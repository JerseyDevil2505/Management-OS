# Local Photo Source — Feature Reference

Branch context: this doc captures the v1 scaffolding for the "connect a local
photo folder per Town" feature, intended to replace the BRT PowerComp
round-trip for attaching appeal photos. Written so the next branch can pick
up exactly where this one stops.

---

## Goal (what we're ultimately building)

Replace the PowerComp PDF rip flow with a direct read of the photos already
sitting on the user's machine in `C:\Powerpad\Pictures\<CCDD>` or
`C:\PowerCama\pictures\<CCDD>`.

End-state user flow:

1. User opens a Job. The Job remembers its photo folder on this machine
   (one-click "Allow again?" prompt from Chrome).
2. In the Appeal Log / CME, every parcel shows a thumbnail strip of available
   photos pulled from disk.
3. User clicks the photo they want for the report (default = most-recent).
4. That single chosen photo is uploaded to Supabase storage and recorded in a
   small `appeal_photos` table. NOT all 27 photos — just the one.
5. PDF generator reads from Supabase storage at print time. No PowerComp,
   no Refresh Pictures dance, no phantom comps.

---

## What's in this branch (v1)

### Files added

- `src/lib/localPhotoSource.js`
  - IndexedDB plumbing (DB `lojik-photo-sources`, stores `sources` and `job_sources`).
  - Filename parser (`parsePhotoName`) that handles both vendor formats:
    - Microsystems: `CCDD-B-L-Q--N.ext` (decimals via `_`, no Q = double dash)
    - BRT:          `CCDD_B_L_Q__N.ext` (decimals via `-`, no Q = double underscore)
  - `parcelKey(block, lot, qualifier)` for canonical map keys.
  - Per-Job APIs:
    - `getJobSource(jobId)` — read saved handle, re-grant permission silently if granted.
    - `pickJobSource(jobId, ccdd, opts)` — open the persistent picker, validate against CCDD, persist.
    - `clearJobSource(jobId)`
    - `indexJobSource(jobId)` — walk the CCDD subfolder, return `{ totals, index: Map<parcelKey, [photo,...]> }`
    - `validateSourceForCcdd(handle, ccdd)` — checks if handle IS the CCDD or contains it as a child.
  - Browser support detection:
    - `isSupported()` — File System Access API present.
    - `canUsePersistentPicker()` — also checks we're NOT inside a cross-origin iframe.

- `src/components/job-modules/JobPhotoSourcePanel.jsx`
  - Compact widget that renders right under the version banner inside any Job.
  - States: not-connected / connected (with file + parcel counts) / mismatch warning.
  - Buttons: "Connect Photo Folder for CCDD <X>", "Re-Index", "Disconnect", "Use Anyway" (mismatch escape hatch).
  - Iframe handling: inline amber explainer + "Open in New Tab ↗" button when blocked.

### Files modified

- `src/components/job-modules/JobContainer.jsx`
  - Imports `JobPhotoSourcePanel` and mounts it after the version banner with `jobId={selectedJob?.id}` and `ccdd={jobData?.ccdd_code || ...}`.

- `src/App.js`
  - Earlier in this branch a global `📷 Photos` header button + `PhotoSourcesModal` was added; **removed** in favor of the per-Job panel. (The deleted `src/components/PhotoSourcesModal.jsx` was the old global UI — gone.)

### Verified

- Filename parser smoke-tested against:
  - `1705-1-1--1.jpg` → micro, block 1, lot 1, no Q, photo 1 ✅
  - `1705-1-3_02-QFARM-1.jpg` → micro, lot 3.02, Q QFARM, photo 1 ✅
  - `1705_1_1__1.jpg` → BRT, block 1, lot 1, no Q, photo 1 ✅
  - `1705_1_3-02_QFARM_1.jpg` → BRT, lot 3.02, Q QFARM, photo 1 ✅
  - `1705-1-1-QFARM-12.jpeg` → micro, photo 12 ✅
  - `random.jpg` / `1705_1_1.jpg` → null ✅
- Indexer dry-run against Bethlehem (CCDD 1002) returned the expected
  parcel-key buckets with multiple photos each (the screenshot user
  validated showed parcels with 13–27 photos, confirming the per-parcel
  multi-photo case that motivates the "pick one" UI).

---

## Why testing requires opening the dev URL in its own tab

Chrome's File System Access API (`window.showDirectoryPicker`) is blocked in
cross-origin iframes by spec. The Builder editor wraps our preview in such an
iframe, so the persistent picker can never run from inside the editor — even
if the JS is identical to what runs on the production URL.

To test, copy the dev URL (or click "Open Preview" in the editor) so the page
becomes the top-level document. Once a folder is connected on a real top-level
URL, IndexedDB persists the FileSystemDirectoryHandle per origin per machine,
so subsequent reloads show a one-click "Allow again?" prompt.

This same code will work fine on Netlify (or any production deploy) without
changes.

---

## What still needs to be built (v2 punch list)

In rough dependency order:

1. **`appeal_photos` table + `appeal-photos` storage bucket in Supabase.**
   - Suggested columns: `id`, `appeal_id`, `parcel_role` (`'subject' | 'comp_1' | 'comp_2' | ...`), `parcel_key` (`block-lot-qual`), `storage_path`, `source` (`'powerpad' | 'powercama' | 'user-upload'`), `picked_by`, `picked_at`, `caption nullable`.
   - RLS: scope by `job_id` via `appeal_id` join.

2. **Per-parcel photo-strip component.**
   - Rendered inside `AppealLogTab` (around the existing badge area at line ~3929 of `AppealLogTab.jsx`) and inside the CME Detailed view (`DetailedAppraisalGrid.jsx` per-comp cell).
   - Reads from the `JobPhotoSourcePanel`'s indexed map for the current CCDD.
   - Shows thumbnails sorted by photo number (default selection = highest = most recent, matching PowerComp's "Use most recent picture" checkbox).
   - On click: read the JPG bytes via `fileHandle.getFile()`, upload to Supabase storage, write the `appeal_photos` row.

3. **User-added photos (drag-drop / paste-from-clipboard).**
   - Same upload path → `source: 'user-upload'`.
   - Captures clipboard images for streetview snips.
   - Optional caption field.

4. **Photo badge rollup in Appeal Log.**
   - Today: BRT PDF photo badge only.
   - New: gray (no photos found anywhere), yellow (photos found, none picked), green-with-count (curated). Hover/click for source breakdown.

5. **PDF generator integration.**
   - `DetailedAppraisalGrid.jsx → generatePDF` (line 1794–3077) and `AppealLogTab.jsx → buildPrintablePdfForAppeal` (line 2226–2354) both currently merge from the BRT-bucket. Swap to read from `appeal_photos` for picked photos, fallback to existing bucket for legacy appeals.

6. **Deprecate the PowerComp round-trip path.**
   - Once the new flow is in for a sprint, the "Import Batch PwrComp PDF" button can become a fallback or be removed entirely.

7. **Multi-source / global folder option (nice-to-have).**
   - Today: per-Job. Future: a manager who has every Town's photos under one root could connect once and we'd auto-resolve the CCDD subfolder per Job.
   - The v1 IndexedDB `STORE_SOURCES` store was kept around for this; the per-Job store (`STORE_JOB_SOURCES`) is what's actually wired up.

---

## Storage architecture clarifications (lessons learned this branch)

- **Picking a folder uploads NOTHING.** The "Are you sure you want to upload N files?" dialog is a Chromium safety prompt for the `<input webkitdirectory>` legacy path; the `showDirectoryPicker` API does NOT show it. Either way, no bytes leave the machine from the act of picking.
- **Index ≠ copies.** We persist FileSystemDirectoryHandles in IndexedDB (a few hundred KB total even for huge Towns), not photo bytes.
- **Supabase storage only ever holds the user-chosen photo per parcel per appeal.** Worst case ~4 photos × N appeals per Town. For Jackson (167K disk photos, ~hundreds of appeals): low single-digit MB in Supabase, not GB.
- **Refresh Pictures (PowerCama → Cama) is still the prerequisite** for getting a Town's photos onto disk in the first place. That's a one-time-per-Town hit on the BRT side and stays as-is.

---

## Known gotchas to watch in v2

- IndexedDB clears when the user clears site data — they would need to re-pick the folder. Surface this in the panel ("Folder no longer accessible — reconnect" if the saved handle errors on permission re-request).
- Filename parser is strict about extensions (`jpg`, `jpeg`, `png`, `gif`, `bmp`, `tiff`). If a Town has `.JPG` or other casings — handled (case-insensitive). Anything weirder will be caught in the `unmatched` count and we should look at sample names.
- Qualifier handling: parser accepts any non-empty string as a qualifier. Real qualifiers are typically alphanumeric (`QFARM`, `C0001`, etc.). If a qualifier contains the decimal separator character (rare), the regex split would break — defer until we see a real example.
- "Tie" between dash and underscore counts: parser prefers dash if dashCount >= undCount AND dashCount >= 4. This makes Microsystems the default vendor in ambiguous filenames; revisit if BRT files end up misclassified.

---

## Quick test recipe (after push, on a real top-level URL)

1. Open a Job (Bethlehem CCDD 1002 is a known-good test target — it has 2,093 photos).
2. Look for the panel under the version banner: **📷 No photo folder connected for this Town. [+ Connect Photo Folder for CCDD 1002]**
3. Click the button. A native folder picker should open.
4. Pick `C:\Powerpad\Pictures\1002` (or `C:\PowerCama\pictures\1002`). Click Allow.
5. The panel should collapse to: **📷 Photos: 1002 (~2,093 files · ~1,979 parcels with photos)**
6. Reload the page. The panel should auto-restore — Chrome may show a one-click "Allow again?" prompt.
7. Pick a CCDD that doesn't match the folder you select to verify the mismatch warning + "Use Anyway" escape hatch.
