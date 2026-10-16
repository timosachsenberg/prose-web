# ProSE app: design

Date: 2026-10-16 · Status: draft for review · Mockups: [`2026-10-16-prose-app-mockups/`](2026-10-16-prose-app-mockups/)

## Intent

A browser application around ProSE, the OpenMS search engine compiled to WebAssembly. It is for life
scientists doing serious mass-spectrometry research. They bring one or many mzML files and a FASTA
database, run a peptide database search on their own computer, and then browse, check, filter and
export the identifications.

It replaces today's demo page at https://timosachsenberg.github.io/prose-web/ (vanilla JS,
`src/openms_wasm/examples/prose` of OpenMS PR #10575). That page proves the engine works. The new app
should be something a researcher wants to use: clear, calm, fast with large result sets, and complete
enough to replace a desktop search tool for identification work.

## Who it is for

Life scientists with mass-spectrometry experience: core-facility staff, PhD students and PIs. They know
PSMs, FDR, fractions and replicates, and they know what an annotated spectrum should look like. They
expect what Proteome Discoverer, MaxQuant, FragPipe or Scaffold offer for identification. They do not
want to read documentation before the first search.

## Goals

1. **Search one file or a whole experiment.** Several mzML files, described by an experimental design
   (below), searched together with one FDR and one protein inference across all files.
2. **Browse results at three levels** (proteins, peptides, PSMs) in sortable tables, by sequence, score,
   counts or any other column.
3. **Compare samples by identifications.** Each sample gets its own column of PSM counts, grouped by
   condition, plus "found in n of m".
4. **Inspect evidence.** For each PSM:
   - the annotated spectrum: ion types, charges and neutral losses switchable, mirrored against the
     PeptDeep prediction or the theoretical spectrum;
   - the fragment ladder;
   - the b/y ion table;
   - the fragment mass error plot;
   - all PSM features.
   For each protein: sequence coverage with modified sites, its peptides and its PSMs.
5. **Filter and export.** One filter row applies to the current level. CSV export writes exactly the
   filtered, sorted view.
6. **Stay local and work offline.** The data never leaves the computer. After the first visit the app
   works without a network.

## Non-goals

- **Quantification.** No intensities, no LFQ, no statistics. Samples are compared by identifications
  and counts.
- **Guessing the design from file names.** There are too many naming schemes; this was explicitly
  rejected.
- **Vendor raw formats.** Input is mzML only, as for the engine today.
- **Accounts and server-side processing.** Results are not shared through a server.

## Anti-goals

These would make the app a failure even if it works:

- Clutter: decoration, illustrations, embedded images, marketing tone. The look is sober and dense
  where data is dense (shadcn-svelte, neutral greys, thin lines). See the mockups.
- Ambiguous numbers. An FDR of "1" must never be readable as either 1 % or 100 %.
- A design table that punishes incomplete input.

## Constraints

- **Stack (decided by the user):** Svelte + Vite + shadcn-svelte. Use current versions: Svelte 5 with
  runes, Tailwind as shadcn-svelte requires.
- **Separate project (decided by the user).** Its own repository; my call is
  `timosachsenberg/prose-web`, which already hosts the website and the desktop packaging, so the app
  replaces the current page there. The OpenMS WebAssembly module is a dependency: the threaded package
  with ONNX Runtime from PR #10575, i.e. `openms.mjs`, `openms.wasm`, `models/`. It is copied in as a
  versioned artifact or npm package; the app does not build OpenMS.
- **Hosting.**
  - A static build served from a sub-path (`/prose-web/`) on GitHub Pages. Pages sends no COOP/COEP
    headers, so a service worker provides cross-origin isolation (threads) and caching. The current
    `examples/sw.js` (with the HTTP-cache fix of 80a3b501c4) is the reference.
  - The same build is packaged as a desktop app with Neutralino (`desktop/build.sh`, fixed port, chrome
    mode).
- **Engine limits.**
  - The module runs in a Web Worker and can address 4 GB. The UI thread never blocks on OpenMS.
  - One search runs at a time; cancelling terminates the worker.
- **Browsers.** Chrome/Edge first. Firefox and Safari should work but are not tested today. Safari's
  `hardwareConcurrency` is unverified.

## Experimental design (decided with the user)

A table with one row per file and four user-facing columns: **File · Condition · Replicate ·
Fraction**.

- **Sample = Condition + Replicate.** The fractions of a sample are combined into one sample column in
  the results.
- **Every field is optional, with defaults the app shows greyed out:**
  - No Fraction: the file is unfractionated (a complete measurement).
  - No Replicate within a condition: replicates are numbered in file order. If fraction numbers repeat
    within a condition, replicates are assigned by order of appearance.
  - No Condition: no condition summary; the sample is named after the file.
  - Nothing at all: each file is its own sample. A single file needs no table: the design section
    appears only from two files on.
- **Duplicates.** Two files with the same Condition + Replicate + Fraction are a technical replicate.
  This is a notice, not an error, with an option to change it. Technical replicates stay separate
  columns ("EGF 1 · TR").
- **Gaps are notices, never blockers:** fraction numbering gaps, and replicates with different
  fraction counts.
- **A summary line above the table** shows what the app understood, e.g.
  "6 files → 3 samples · 2 conditions · fractions 1–2".
- **Underneath sits the OpenMS experimental design** (`design.tsv`, one-table format:
  `Fraction_Group, Fraction, Spectra_Filepath, Label, Sample` plus `MSstats_Condition`,
  `MSstats_BioReplicate`). The app derives Fraction_Group and Sample. An "Advanced" view shows them,
  e.g. to mark technical replicates explicitly.
- **Input and output:**
  - load `design.tsv`;
  - load SDRF (data file, factor value, biological replicate, fraction identifier, technical
    replicate);
  - save `design.tsv`;
  - paste from a spreadsheet.

## Screens

The mockups are static HTML with invented data. Layout and behaviour are what count; the numbers are
not real.

1. **New search** (`1-new-search`, FDR detail in `1b-fdr-fields`). One page, in this order:
   - Spectra with the design table.
   - Protein database: FASTA, decoys, contaminants.
   - Search settings: a preset, the ten common parameters, and "All parameters", generated from
     ProSE's parameter definitions as today.
   - Rescoring: Percolator on, PeptDeep on or off, with the instrument choice.
   - A sticky footer with a one-line plan, a memory estimate and "Start search".
2. **Results: proteins** (`2-results-proteins`).
   - Key figures at the top; tabs Overview · Proteins · Peptides · PSMs · Samples · QC.
   - One filter row: search, FDR, minimum peptides, "found in ≥ n replicates of a condition",
     contaminants, plus a filter.
   - "Export CSV · n rows". A table with per-sample count columns grouped by condition, and "Found in".
3. **Protein drill-down** (`4-protein-drilldown`). Selecting a protein opens its page on the right:
   - A coverage strip with modified sites.
   - Tabs Coverage · Peptides · PSMs.
   - Peptides with per-sample counts; a peptide expands in place to its PSMs, and a PSM leads to the
     spectrum.
   - "Open in PSM table" carries the selection over as a filter chip ("Protein: ALB ✕"). Columns
     collapse while the panel is open.
4. **PSM** (`3-psm-spectrum`).
   - Breadcrumb Proteins › protein › Peptides › peptide › PSM.
   - The sequence with its fragment ladder.
   - The mirror spectrum with ion, charge and loss toggles, observed against the PeptDeep prediction
     or the theoretical spectrum.
   - The b/y ion table, the fragment mass error plot (m/z against ppm, tolerance band, dot size =
     intensity) and the PSM features.
   - Previous/next and SVG export.
5. **Peptides and PSMs tabs.** The same table pattern at their level, with the same filter row and
   export.

## Presentation rules (decided with the user)

- **FDR is always a percentage with the q-value beside it:** "1 %" with "q ≤ 0.01", quick choices
  0.1 / 1 / 5 %. Filters read "Protein FDR ≤ 1 % (q ≤ 0.01)".
- **Modifications are shown as a marked residue by default** (`5-modification-encoding`, option A):
  - one colour (aqua `#1baf7a`, validated against the b/y colours) means "modified";
  - a short label says which (Mᵒˣ, Sᵖʰ, ᵃᶜ for N-terminal);
  - hover shows the Unimod name and Δ mass.
- **A user setting switches to ProForma** (`AVM[Oxidation]DDFAAFVEK`; option B). Exports and copy
  always write ProForma. Fixed modifications such as carbamidomethyl-C are not marked; the legend says
  so.
- **Ion colours:** b blue `#2a78d6`, y orange `#eb6834`, unmatched grey. Peaks carry direct labels, so
  colour is never the only cue.

## Engine work (OpenMS, outside this repository)

The app needs more from the module than the single-file `ProSEAlgorithm.search()` binding of #10575
offers. Proposed split, following the user's earlier choice to move the ProSE tool's logic into
`ProSEAlgorithm`, as #10578 did for Percolator:

- **Library PR on develop.** The pooled multi-file evaluation of the ProSE tool's `-out_merged` moves
  into `ProSEAlgorithm`, and the tool calls it: protein inference and picked-protein FDR across files,
  Percolator per file. Native ProSE and the browser then run the same code.
- **Bindings PR stacked on #10575.** Everything below that is JavaScript-facing.

The pieces:

- **Multi-file search.**
  - Bind `ProSEAlgorithm::searchWithModificationAnalysis(files, db, …)`: one index, per-file results.
  - Pool all files for FDR and protein inference as the ProSE tool's `-out_merged` does
    (`BasicProteinInferenceAlgorithm`, picked-protein FDR on the pooled set).
  - Percolator per file, as the tool does today.
  - Per-file progress.
- **Per-PSM provenance:** which file, and through the design which sample, every PSM came from.
- **Reading the spectra to store.** The peaks of every spectrum with a PSM passing the FDR are read
  file by file during the search and handed to the app as typed arrays (see Persistence).
- **PeptDeep MS2 prediction on demand** for the mirror spectrum (see "Settled while reviewing").
- **Data transfer.** Results reach the UI as compact typed columns rather than one JS object per PSM,
  because there can be 100,000+ PSMs.
- **Memory.** All files of an experiment share the module's 4 GB. The memory estimate before the
  search must account for this. Searching file by file and keeping only the identifications is the
  expected approach; how exactly is open.

## Settled while reviewing the design (my calls)

- **FDR in the search vs. in the results.**
  - The FDR values of New search are the search's cutoffs. They define the evidence: the PSMs that go
    into protein inference and the protein FDR, as with the tool's `-out_merged`.
  - The results filters start at those values and can only tighten them. Their quick choices offer
    only values at or below the search's, and loosening needs a new search.
  - Decoys are kept so that q-values and the score distribution stay visible ("show decoys").
  - The Peptides tab has no peptide-level FDR. It filters on the best PSM q-value of each peptide,
    labelled as such.
- **The PeptDeep mirror spectrum is predicted on demand** for the displayed PSM, through a new binding
  (`PeptDeepMS2Inference` for one peptide, charge, NCE and instrument). It works whenever the module
  has ONNX Runtime, whether or not the search used PeptDeep rescoring. The NCE is the one the search
  calibrated, else the spectrum's recorded collision energy. Without ONNX Runtime the bottom half
  shows the theoretical spectrum. This joins the engine work.
- **"Found in" counts biological samples** (Condition + Replicate).
  - Technical replicates are merged into their sample: counts are summed, and the sample counts as
    found if any repeat found it.
  - "Show technical replicates separately" in the column settings splits them.
  - The mockups' "EGF 1 · TR" column is therefore off by default.
- **Export menu:**
  - CSV of the current view, at each level;
  - the design (`design.tsv`);
  - the spectrum as SVG;
  - the project file.
  - The merged idXML, for downstream OpenMS tools, only while the search is open in the session. It
    needs the OpenMS objects, which History does not keep.
- **Multiplexed designs (TMT, SILAC) are out of scope**, in keeping with "no quantification".
  - Labelled data can be searched (labels as fixed modifications).
  - A `design.tsv` or SDRF with several labels per file is loaded as one row per file, with a notice.
- **prose-web after the switch:**
  - The app takes over `/prose-web/`; the start page becomes the app's empty state, with the example
    data and the desktop downloads.
  - `/examples/prose/` redirects to the app, and `desktop/neutralino.config.json` opens the app.
  - `examples/browser/` (the general OpenMS demo) moves to `/prose-web/openms-demo/`.
  - `data/` stays: it is the "Try the example" data.
  - The single-file, no-server version is not part of v1, because the desktop app covers working
    without a server. The existing `prose-single-file.html` stays available unchanged.
- **Open search.**
  - A preset; its results add a delta-mass histogram and the mapped PTMs to Overview, as the current
    demo does.
  - A PSM's unassigned mass shift appears after the sequence as "Δ +15.995".
  - ProForma writes it as an unlocalized mass (`[+15.995]?PEPTIDE`).

## Persistence

- **History (my call).** Finished searches are kept in the browser (IndexedDB/OPFS): settings, design
  and results, but not the raw mzML.
- **Spectra are stored with the results (decided by the user).**
  - What is stored: the peaks of every spectrum that has a PSM passing the search's FDR, as compact
    typed arrays (float32 m/z and intensity are precise enough: 0.06 ppm at m/z 2,000).
  - So the spectrum view works for earlier searches and from a project file without the mzML.
  - Budget: about 100 MB per 100,000 PSMs.
  - Spectra of PSMs outside the FDR are not kept.
- **"Save project".** Writes one file (results plus design plus settings) that can be opened again,
  including in the desktop app.
- **Presets.** Built-in ones (e.g. Orbitrap HCD tryptic, timsTOF, open search) and user-saved ones.

## Success criteria (my proposal; criterion 3 adjusted by the user)

1. A fractionated two-condition experiment (6–12 mzML files) goes from files to a filtered CSV in the
   browser on GitHub Pages and in the desktop app, without console errors.
2. Every screen of the mockups works with real data: sorting, filtering, export, drill-down, spectrum,
   mass error, coverage, and the modification display switch.
3. **The numbers are close to native ProSE (decided by the user: similar, not identical).** The
   same files and settings give PSM, peptide and protein counts at 1 % FDR within 2 % of
   `ProSE -out_merged`; the 2 % is my call. Exact equality can't be expected: the automatic PeptDeep
   NCE can tip differently on different platforms.
4. **It stays responsive:** sorting or filtering 100,000 PSMs takes well under a second, and the UI
   never freezes during a search.
5. **It needs no instructions:** a scientist new to the app runs the bundled example search within
   two minutes.

## Left to the builder

- Component structure, state management, routing.
- How tables virtualize (e.g. TanStack Table plus a virtualizer).
- How charts are drawn: SVG or canvas, a library or hand-written.
- Test strategy.
- Exact column sets per level, the CSV column naming, short labels for less common modifications, and
  preset contents.
- The QC and Samples tabs: only their existence is decided.
