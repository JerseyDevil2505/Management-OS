# IP Protection Plan — Lojik / Property Assessment Copilot

> Quick reference. Not legal advice — run anything serious by an IP attorney
> (ideally one who has done software/SaaS for vertical-market apps).

---

## TL;DR

The *code* is easily copied. What's hard to copy is the **accumulated domain
knowledge encoded in it**, the **vendor-specific integrations**, and the
**brand + customer data**. Realistic protection stack:

**Copyright (automatic) + Trade Secret + Trademark + Contracts.**
**Not** patents.

---

## What is NOT really worth pursuing

### Patents (utility)
- Almost nothing here clears the modern software-patent bar (Alice/Mayo).
- NJ tax-assessment workflows, comparable-sale math, bracket adjustments,
  depreciation formulas — abstract methods + business logic.
- Even the clever bits (CME bracket-aware adjustments, sales-pool window math,
  Lojik year offset) are too tied to existing industry practice to survive a
  §101 challenge.
- Prosecution: ~$15-40K with low odds of success. **Skip.**

### The general application idea
- "SaaS for property revaluation firms" is not protectable.
- Vital, Microsystems, BRT, Patriot Properties, etc. already exist.

### Standard CRUD + reporting
- Job management, billing, payroll, employee management — commodity.

---

## What IS worth protecting

### 1. Copyright (automatic — but register it)

You already own copyright on every line you've written, from the moment of
commit. Registration is what unlocks **statutory damages + attorney's fees**
in litigation — without it, you can only chase actual damages (hard to prove
for SaaS).

**Action:**
- File a US Copyright Office registration for the codebase. ~$65 via
  <https://www.copyright.gov>. DIY is fine.
- Re-register at major versions, OR use the "group registration for
  unpublished works" pathway if you keep source closed.
- Add a `LICENSE` file + copyright header to source files.
- Add a `CONFIDENTIAL` banner to the repo README.

### 2. Trade Secret (your strongest lever)

A lot of this codebase qualifies as trade-secret material **if you treat it
as secret**. The protectable pieces:

- `src/lib/powercompPdfParser.js` — keying off textual landmarks tolerant to
  BRT layout drift. Hard-won reverse engineering.
- BRT vs Microsystems vendor abstraction — EFA-as-year storage trick,
  field mapping tables in `brt-processor.js` / `microsystems-processor.js`.
  Months of debugging encoded as data.
- CME bracket → adjustment grid model with VCS / type-use mapping
  (`job_cme_bracket_mappings`).
- Lojik year-adjustment convention baked into 5+ window functions
  (CSP, sales pool, coordinate cleanup queue, AppellantEvidence, Detailed).
- PowerCama filename parser (`localPhotoSource.js`) — T-stamp handling,
  `.BAK` tombstones, dash-vs-underscore field-separator detection.
- Census recovery strategy — ZIP-sweep, ties-only, ordinal-variant pipeline,
  `__<zipIdx>` synthetic suffix + `stripVariantSuffix()` collapse.
- Mother-lot inheritance rule for condo children.

**To actually keep trade-secret protection, ACT like it's a secret:**
- NDAs with anyone who sees the code.
- No public GitHub repo. (Public publication = trade secret evaporates.)
- "Confidential" markings in source headers.
- Access logging on the repo + DB.
- Departing-employee/contractor exit interviews + access revocation.

### 3. Trademark (cheapest, highest ROI — do this first)

- **Lojik** — file federal trademark registration (USPTO, ~$250-350 per class).
- **Property Assessment Copilot** — same.
- **Logo** (`public/lojik-logo.PNG`) — register as a design mark.

This stops competitors from naming their thing similar and is essential
before you scale outside NJ.

### 4. Contractual moats (often more powerful than IP law)

**Customer agreements (MSA / EULA):**
- Non-reverse-engineering.
- Non-redistribution / no sublicensing.
- "No benchmarking against competitors."
- Confidentiality.
- Data ownership / data-use rights.

**Data as a moat:**
- Customers' assessment data, the `appeal_log` corpus, `nu_code_dictionary`,
  `county_hpi_data`, and the `parsed_code_definitions` per municipality —
  the **aggregated dataset** is a real moat.
- Anyone cloning the UI still has zero towns onboarded.

**Vendor relationships:**
- The fact that you've informally figured out BRT + Microsystems formats and
  that customers trust you to handle their re-uploads is sticky.

### 5. The integration surface itself

Even if a competitor copies the UI, they'd have to independently:

- Rebuild the BRT + Microsystems parsers (months).
- Reverse-engineer the PowerComp PDF format (weeks).
- Build the PowerCama folder integration (weeks).
- Onboard an actual NJ municipality and learn the assessor workflow
  (months — and politically gated).
- Earn trust in a small, relationship-driven industry.

That last one is the real moat. NJ tax assessment is a small world.

---

## Action Checklist (in order)

- [ ] **Trademark** "Lojik" + "Property Assessment Copilot" + logo.
      Call a trademark attorney this month. (~$1-2K total — biggest ROI.)
- [ ] **Copyright registration** of the codebase. DIY at copyright.gov, ~$65.
- [ ] Add `LICENSE` + copyright headers to the repo.
- [ ] Add `CONFIDENTIAL` banner to README.
- [ ] **Lock down the repo** — confirm nothing is public on GitHub, audit
      who has read access.
- [ ] **NDA + IP-assignment language** in any contractor / employee
      agreement going forward (and retroactively where possible).
- [ ] **Customer MSA** with non-reverse-engineering + confidentiality
      clauses.
- [ ] **Skip patents** unless an attorney sees something specific.

---

## The honest bottom line

> Could someone copy it? Yes — they could copy the surface in 6 months and
> still take 3 years to match what you've actually built, because most of the
> value is the encoded knowledge of *how NJ revals actually work* and the
> trust relationships.
>
> Protect the brand and the data, treat the parsers as trade secrets, and
> the rest is execution speed.
