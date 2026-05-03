# Local Photo Source — Feature Reference

Branch context: this doc covers the per-Town local-photo-folder feature that
**replaces** the BRT PowerComp PDF rip as the source of appeal-report photos.

- **v1 (PR #189)** — folder picker + IndexedDB persistence + filename parser
  scaffolding only. No upload, no UI in Detailed.
- **Branch after #189 (parser hardening + phase 2)** — T-stamp/`.BAK` parser
  fix, full per-parcel pick UI inside DetailedAppraisalGrid, `appeal_photos`
  storage + table, PDF generator emits a real Photos page from the picks,
  AppealLog batch print prefers the new page over the legacy PowerComp packet.

---

## Quick test recipe (after push, on a real top-level URL)

The folder picker is blocked inside the editor preview iframe by Chromium
spec, and "Open in New Tab" still serves the editor host with the same
restriction. **You must push to a real deploy to test the full flow.**

1. Open a Job (Bethlehem CCDD 1002, Glen Gardner CCDD 1012, or Point
   Pleasant Beach CCDD 1526 are known-good test targets — they're PPA
   archived jobs with photos on disk).
2. Look for the panel under the version banner: **📷 No photo folder
   connected for this Town. [+ Connect Photo Folder for CCDD <X>]**
3. Click the button. A native folder picker should open.
4. Pick `C:\Powerpad\Pictures\<CCDD>` or `C:\PowerCama\pictures\<CCDD>`.
5. Panel collapses to show file count + parcel count.
6. **Validate the parser fix** — Glen Gardner used to show "0 parcels with
   photos" because every file is T-stamped (`1012_3_1__T20241106144506-01.jpg`).
   With the new parser it should now show a real number. Point Pleasant Beach
   should also show a higher count than before because its T-stamped files
   are now matched too.
7. Reload the page. The panel auto-restores via IndexedDB; Chrome may show a
   one-click "Allow again?" prompt.
8. Navigate to **Final Valuation → Sales Comparison (CME) → Detailed**.
9. Run a comp search and pick a subject so the comp grid populates.
10. Scroll below the comp grid → see the new **📷 Parcel Photos** strip.
    One column per parcel (Subject + each non-manual Comp), aligned with
    the columns above.
11. For each cell:
    - `←` / `→` arrow keys cycle through that parcel's photos
    - `+` button opens a file picker for that parcel
    - `Ctrl+V` while the cell has focus pastes a clipboard image
    - **`⭐ Use`** uploads the focused photo to the `appeal-photos` bucket
      and registers it in `appeal_photos`. The label flips to **`✓ Front`**.
12. Click **Export PDF**. Modal opens with:
    - Adjustments grid (existing)
    - Map preview — now collapsed by default (click header to expand)
    - **NEW: 📷 Photos in PDF** thumbnail row — read-only summary of picked
      photos
    - Appellant Evidence (existing)
    - Director's Ratio (existing)
    - **NEW: 📷 Include Photos** toggle in the modal header
13. Click **Download PDF**. Open the PDF — there should be a new
    "Subject & Comps Photos" page after the Map page (or wherever the
    static order falls), 3×2 grid with role labels under each photo.
14. Click **Send to Appeal Log**. Open the appeal in Appeal Log and click
    Print/Download — `buildPrintablePdfForAppeal` re-emits in canonical
    order with the new Photos page in the right slot. Legacy PowerComp
    packet path still works as a fallback for appeals that don't have any
    `appeal_photos` rows.

---

## What's in this branch (after PR #189)

### Parser fix (`src/lib/localPhotoSource.js`)

`parsePhotoName()` now accepts two new things:

1. **`.BAK` files are tombstones, not photos.** Skipped entirely (don't even
   count toward `totalFiles` / `unmatched`). PowerCama renames a deleted
   photo `<name>.jpg.BAK` instead of removing the bytes.
2. **PowerCama capture timestamps in the photo-number slot.** Pattern
   `T\d{14}` or `T\d{14}-\d+` (e.g. `T20241106144506` or
   `T20241106144506-01`). The 14-digit timestamp is `YYYYMMDDHHMMSS` and is
   parsed into `captureTs` + `captureSeq`, then combined into a single
   sortable `photoNum` so the existing "highest = most recent" sort still
   works correctly. T-stamped photos always rank above legacy numeric
   photos (`Number(captureTs) * 100 + captureSeq`), and within T-stamps
   they sort chronologically.

Backward compatible: old-style numeric filenames (`1526_1-01_1__01.jpg`)
parse exactly as before.

### Shared photo index — `src/contexts/JobPhotoSourceContext.jsx` (new)

Lifts the indexed photo map out of `JobPhotoSourcePanel` so the strip can
read it without re-walking the disk. Provider mounted in `JobContainer`,
keyed off `selectedJob.id` + `jobData.ccdd_code`. Exposes:

- `connected`, `loaded`, `source`, `indexResult`, `busy`, `error`, `warning`
- `connect(allowMismatch)`, `disconnect()`, `reindex()`, `refresh()`
- `getPhotosFor(block, lot, qualifier)` — returns the `[photo, ...]` array
  for a parcel key, or `[]` if not indexed

`useJobPhotoSource()` returns a safe no-op shape when used outside a
provider, so the panel/strip don't crash if mounted without one.

### `JobPhotoSourcePanel` (refactored)

Pure presentation now. All state lives in the context.

### `ParcelPhotoStrip` — `src/components/job-modules/ParcelPhotoStrip.jsx` (new)

Compact horizontal strip mounted at the bottom of `DetailedAppraisalGrid`.
One column per parcel (Subject + non-manual Comps; appellant comps are
intentionally NOT included — those get their own pick when the appellant
parcel is searched as its own subject). Layout mirrors the comp grid above
(left "Photo" gutter ≈ 110px, then equal-width `flex-1` cells), so the
columns line up vertically with the grid. Square photo thumbnails
(`aspect-square`).

Per-cell controls:

- Role chip header (`SUBJECT`, `COMP 1`, …)
- Square preview (or click-to-add placeholder when empty)
- `◀ N/M ▶` counter + chevrons; arrow keys cycle when the cell has focus
- `Ctrl+V` while the cell has focus pastes a clipboard image
- `+` button opens a file picker (no drag-drop — replaced because of
  vertical-space concerns and the simpler click-to-add pattern)
- `⭐ Use` / `✓ Front` button — uploads the focused photo and upserts the
  `appeal_photos` row. Re-picking deletes the prior blob to keep the
  bucket tidy.
- Green check overlay on the thumbnail when it matches the saved front
  photo

Also exports `<ExportPhotosPreview />` — a read-only thumbnail row used
inside the Export PDF modal to show the currently-picked photos. No upload
happens there; picks always happen in the main Detailed strip.

### `appeal_photos` table + `appeal-photos` storage bucket

Migration: `create_appeal_photos_table_and_bucket`.

```sql
create table public.appeal_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  property_composite_key text not null,
  appeal_id uuid references appeal_log(id) on delete set null,
  storage_path text not null,
  source text check (source in ('powercama','powerpad','user_upload','clipboard')),
  original_filename text,
  capture_ts text,           -- T<14 digits> when present
  picked_by uuid references auth.users(id),
  picked_at timestamptz default now(),
  caption text,
  unique (job_id, property_composite_key)  -- one front photo per parcel per job
);
```

Bucket `appeal-photos` (private). Storage path convention:
`<jobId>/<safe_composite_key>/front_<timestamp>.<ext>`.

**Per-parcel, not per-role.** A parcel that's a Subject in one appeal and
a Comp in another shares the same picked photo. Re-picking replaces.

### `DetailedAppraisalGrid` (modified)

- New `photoStripParcels` memo — Subject + non-manual Comps with composite
  keys, deduped.
- `<ParcelPhotoStrip jobId={jobData.id} parcels={photoStripParcels} />`
  rendered at the bottom of the wrapper.
- Export modal:
  - New "📷 Include Photos" toggle in the header (persisted to
    localStorage as `detailedExport_includePhotos`).
  - Map preview is now collapsible (default collapsed, persisted as
    `detailedExport_mapExpanded`). When collapsed the capture div stays
    mounted offscreen at `position: absolute; left: -99999` so
    `html2canvas` can still grab it for the PDF — no behavior change to
    the embedded map page.
  - New `<ExportPhotosPreview />` row beneath the map preview.
- `generatePDF`:
  - After the Map page (or where it would've been), emits a new
    "Subject & Comps Photos" page when `includePhotos` is on. Pulls
    `appeal_photos` rows for every parcel, downloads bytes from the
    `appeal-photos` bucket, lays them out in a 3×2 grid with role-label
    captions only (addresses intentionally omitted — they're already on
    the comp grid). Page is silently skipped if no parcels have a picked
    photo.

### `AppealLogTab.buildPrintablePdfForAppeal` (modified)

- New `buckets.photos` — recognizes pages whose text contains
  `subject & comps photos`.
- Canonical order is now: static grid → dynamic adjustments →
  **direct-from-folder photos page** → legacy PowerComp packet (only if no
  direct photos page exists) → map → appellant evidence → Chapter 123 →
  unclassified other.
- The PowerComp `appeal_powercomp_photos` path is preserved as a
  **fallback** for legacy reports that pre-date this branch.

---

## What still needs to be built (post-test punch list)

In rough dependency order — these are for the **next** branch, not this one:

1. **Appellant photo picks driven from `AppellantEvidencePanel`.** This
   branch deliberately keeps appellant comps out of the Detailed strip per
   user request; instead they should pick photos from the appellant
   evidence panel where those comps already live. Same `appeal_photos`
   table, same flow — just a second mount point.
2. **Photo badge rollup in Appeal Log list.** Today the Appeal Log shows
   only the legacy BRT PDF photo badge. Add a tri-state badge: gray (no
   `appeal_photos` rows for any parcel on this appeal), yellow (some
   parcels picked, some missing), green-with-count (all parcels have a
   front photo). Hover/click for the per-parcel breakdown.
3. **Caption editing.** `appeal_photos.caption` exists but no UI for it.
   Surface it on the strip cell (small text input below the thumbnail) so
   the photographer's note ("front of dwelling, taken from street") can
   ride along into the PDF.
4. **Bulk pick / "use most recent for all" shortcut.** For Towns that just
   need the freshest photo per parcel, a single button that picks the
   latest folder photo for every cell at once.
5. **Deprecate the PowerComp PDF import path.** Once direct picks have
   shipped for a sprint, the "Import Batch PwrComp PDF" button in Appeal
   Log can be removed. The classifier's PowerComp fallback can stay
   indefinitely (it costs nothing if no `powercomp-photos` blob exists).
6. **Multi-source / global folder option.** Today the connection is
   per-Job. A manager who has every Town's Pictures under one root could
   connect once and we'd auto-resolve the CCDD subfolder per Job. The v1
   IndexedDB `STORE_SOURCES` store was kept around for exactly this; the
   per-Job store (`STORE_JOB_SOURCES`) is what's actually wired up today.

---

## Why testing requires opening the dev URL in its own tab (still true)

Chrome's File System Access API (`window.showDirectoryPicker`) is blocked
in cross-origin iframes by spec. The Builder editor wraps our preview in
such an iframe, so the persistent picker can never run from inside the
editor — even the "Open in New Tab" button serves the editor host, which
hits the same restriction. **You have to push to a real deploy (Netlify,
the staging URL, etc.) to test the full flow.**

---

## Storage architecture clarifications (lessons learned this branch)

- **Picking a folder uploads NOTHING.** No bytes leave the machine until
  you click `⭐ Use` on a specific photo.
- **`appeal_photos` only ever holds the user-chosen photo per parcel per
  job.** Worst case ~6 photos × N appeals per Town. For Jackson (167K
  disk photos, hundreds of appeals): low single-digit MB in Supabase, not
  GB.
- **Re-picking deletes the prior blob.** `handlePick()` calls
  `storage.remove([savedPhoto.storage_path])` before the new upload to
  keep the bucket from accumulating orphans.
- **Refresh Pictures (PowerCama → Cama) is still the prerequisite** for
  getting a Town's photos onto disk in the first place.

---

## Known gotchas to watch in v2

- IndexedDB clears when the user clears site data — they would need to
  re-pick the folder. Surface this in the panel ("Folder no longer
  accessible — reconnect" if the saved handle errors on permission
  re-request).
- The strip reads from the parent's `comps` prop. If a comp has
  `is_manual_comp = true` it's excluded (manual comps don't have a
  `property_composite_key`).
- Filename parser is strict about extensions
  (`jpg`, `jpeg`, `png`, `gif`, `bmp`, `tiff`). `.JPG`, `.JPEG`, etc. are
  fine (case-insensitive). `.heic` and `.webp` are not yet supported —
  add when we see one in the wild.
- "Tie" between dash and underscore counts: parser prefers dash if
  `dashCount >= undCount && dashCount >= 4`. This makes Microsystems the
  default vendor in ambiguous filenames; revisit if BRT files end up
  misclassified.
- T-stamp regex is `^T(\d{14})(?:-(\d+))?$` — strict. If PowerCama ever
  emits `T<13 digits>` or some other variant we'll need to relax it.

---

## File map (this branch)

| File | What changed |
|------|--------------|
| `src/lib/localPhotoSource.js` | Parser accepts T-stamps; `.BAK` files skipped entirely. New `isTombstoneFile()` helper. All three indexers updated. |
| `src/contexts/JobPhotoSourceContext.jsx` | **NEW** — provider/context for the per-Job indexed photo map. |
| `src/components/job-modules/JobContainer.jsx` | Wraps render tree in `JobPhotoSourceProvider` keyed off jobId + ccdd. |
| `src/components/job-modules/JobPhotoSourcePanel.jsx` | Refactored to consume the context (pure presentation). |
| `src/components/job-modules/ParcelPhotoStrip.jsx` | **NEW** — compact horizontal photo strip. Default export = `ParcelPhotoStrip`; named export = `ExportPhotosPreview` for the Export modal. |
| `src/components/job-modules/final-valuation-tabs/DetailedAppraisalGrid.jsx` | Mounts the strip; new "Include Photos" toggle; map preview collapsible; new Photos page in `generatePDF`. |
| `src/components/job-modules/final-valuation-tabs/AppealLogTab.jsx` | `buildPrintablePdfForAppeal` recognizes the new "Subject & Comps Photos" page; prefers it over the legacy PowerComp packet. |
| `supabase migration` | `create_appeal_photos_table_and_bucket` — table + private bucket. |
