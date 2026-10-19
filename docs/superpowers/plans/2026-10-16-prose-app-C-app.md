# ProSE app, part C: the Svelte app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The ProSE app of the spec: multi-file searches with an experimental design; results at
protein, peptide and PSM level with per-sample columns, filters and CSV export; protein and PSM detail
views; History and project files. It runs in the browser on GitHub Pages and in the Neutralino desktop
app.

**Architecture:**
- A single-page Svelte 5 app (runes) built by Vite.
- OpenMS runs in one module Web Worker (`engine/worker.ts`) behind a typed message client. Its results
  arrive once as typed columns (part B's `ResultTables` / `StoredSpectra`).
- All filtering, sorting and aggregation happen in plain TS modules over those columns, unit-tested
  without a browser.
- Views are shadcn-svelte components; the tables are virtualized.

**Tech Stack:**
- Svelte 5.57, Vite 8.3, @sveltejs/vite-plugin-svelte 7.3, TypeScript.
- Tailwind CSS 4.3 (`@tailwindcss/vite`), shadcn-svelte 1.7 (bits-ui 2), @tanstack/table-core,
  @tanstack/svelte-virtual 3.
- fflate 0.8, idb-keyval 6.3, vitest 5, @playwright/test 1.56.1 (the browsers of the Playwright SIF).

**Spec:** `docs/superpowers/specs/2026-10-16-prose-app-design.md`; mockups in `docs/superpowers/specs/2026-10-16-prose-app-mockups/`.

## Global Constraints

- **Repository:** `/scratch/sachsenb/prose-pages` (timosachsenberg/prose-web). The app lives in `app/`.
  Use Node from `/scratch/sachsenb/emsdk/node/24.19.0_64bit/bin`.
- **Order:** Tasks 1–3 and 5 do not need part B and can run while parts A and B are built; Task 4 and
  everything after need part B's package in `app/public/openms/`.
- **E2E tests** run in `singularity exec --bind /scratch/sachsenb,/tmp /scratch/sachsenb/pr10564_review/playwright.sif`
  with `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`.
- **The OpenMS module is part B's package** in `app/public/openms/` (`openms.mjs`, `openms.wasm`,
  `openms.d.ts`, `package.json`, `models/`). Its TS types (`ResultTables`, `StoredSpectra`,
  `ProSEMultiSummary`, `PeakAnnotationResult`, `PredictedIon`, `ProSEFilesOptions`) come from that
  `openms.d.ts`.
- **Base path** `/prose-web/` (`vite.config.ts` `base`). The desktop build uses `base: "./"`
  (`VITE_BASE=./`).
- **Look:**
  - The shadcn-svelte zinc theme, light first, as in the mockups; no images, illustrations or decoration.
  - b ions `#2a78d6`, y ions `#eb6834`, unmatched `#a1a1aa`, modified residue `#1baf7a` (background
    `#d7f5ea`, text `#065f46`).
- **Wording and display rules:**
  - FDR is always shown as a percentage with the q-value beside it ("1 %" · "q ≤ 0.01"; filters
    "Protein FDR ≤ 1 % (q ≤ 0.01)"), with quick choices 0.1 / 1 / 5 %.
  - Modifications: a marked residue (short label: Oxidation→ox, Phospho→ph, Acetyl→ac,
    Deamidated→de, Methyl→me, Dimethyl→dm, GlyGly→gg, Carbamyl→cm, Gln->pyro-Glu→pg,
    Glu->pyro-Glu→pe, TMT6plex→tmt, otherwise the first three letters lower-cased). A user switch shows
    ProForma; exports and copy always write ProForma. Fixed modifications are not marked.
- **Search FDR vs. result filters.** The New-search FDR values are the search's cutoffs. Result filters
  can only tighten them; their quick choices exclude values above the search's.
- **Samples and contaminants.**
  - Samples = Condition + Replicate; technical replicates are merged into their sample unless
    "Show technical replicates separately" is on.
  - Contaminants: the bundled cRAP FASTA (`public/fasta/crap.fasta`, from https://ftp.thegpm.org/fasta/cRAP/crap.fasta),
    accessions prefixed `CON__`; contaminant = accession starts with `CON__`.
- **Data stays local:** no network calls except to the app's own origin.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **A large result** (150,000 PSMs, 20,000 peptides, 4,000 proteins).
  - Expect: filtering and sorting in under 300 ms, and smooth scrolling.
  - Test: Task 5 `filters and sorts 150k PSMs in under 300 ms`; Task 7 e2e
    `scrolls a 150k-row PSM table` (synthetic result through the `?debug=large` hook).
- **A page that is not cross-origin isolated** (service worker blocked, server without COOP/COEP).
  - Expect: the app runs single-threaded, with a notice; it never hangs.
  - Test: Task 12 e2e `runs single-threaded without isolation`.
- **The worker traps** (out of memory) in the middle of a multi-file search.
  - Expect: an error with guidance (`database:chunk_size`) and a restarted engine. Nothing goes to History.
  - Test: Task 4 `client restarts after a trap and rejects the search`; Task 11 `only completed searches are saved`.
- **Opening a project or History entry of another schema version.**
  - Expect: a clear message, never a crash.
  - Test: Task 11 `readProject rejects an unknown schema version with a message`.
- **Two input files with the same name** (from different folders).
  - Expect: both rows stay distinct, are searched separately and stay apart in the results.
  - Test: Task 2 `keeps two files of the same name apart`; Task 4 `writes inputs to distinct paths`.

---

### Task 1: Scaffold

**Files:**
- Create: `app/package.json`, `app/vite.config.ts`, `app/tsconfig.json`, `app/svelte.config.js`,
  `app/index.html`, `app/src/main.ts`, `app/src/App.svelte`, `app/src/app.css`, `app/components.json`,
  `app/src/lib/components/ui/*` (shadcn-svelte), `app/vitest.config.ts`, `app/playwright.config.ts`,
  `app/e2e/smoke.spec.ts`, `app/public/fasta/crap.fasta`, `app/public/example/*`
- Modify: `.gitignore` (`app/node_modules`, `app/dist`, `app/test-results`)

**Interfaces:**
- Produces:
  - `npm run dev`, `npm run build` (to `app/dist`), `npm test` (vitest), `npm run e2e` (Playwright).
  - The dev and preview servers send COOP `same-origin` and COEP `require-corp`.
  - `public/example/` holds `DatabaseSuitability_in_spec.mzML` and `DatabaseSuitability_database.fasta`
    (copied from `/scratch/sachsenb/prose-pages/data/`).

- [ ] **Step 1: Scaffold** with `npm create vite@latest app -- --template svelte-ts`.
  - Add Tailwind 4 (`@tailwindcss/vite`).
  - `npx shadcn-svelte@1.7.0 init` (base color zinc), then add `button card input select tabs table badge
    switch dialog tooltip dropdown-menu checkbox sonner separator scroll-area`.
- [ ] **Step 2: Write the smoke e2e test** `the app shell renders`: the page title is "ProSE", the nav
  shows "New search", "Results", "History", and the status chip shows "OpenMS".
- [ ] **Step 3: Run** `npm run build && npm run e2e -- smoke`. Expected: FAIL until the shell exists, then PASS.
- [ ] **Step 4: Build the shell.** In `App.svelte`: a top bar (mockup 1) with view state
  `"search" | "results" | "history"` held in a rune, and the URL hash mirroring it (`#/search`, `#/results/<id>`, `#/history`).
- [ ] **Step 5: Run the smoke test.** Expected: PASS.
- [ ] **Step 6: Commit** `app: scaffold (Svelte 5, Vite, Tailwind 4, shadcn-svelte)`.

### Task 2: Experimental design model

**Files:**
- Create: `app/src/lib/design/model.ts`, `app/src/lib/design/design-tsv.ts`, `app/src/lib/design/sdrf.ts`
- Test: `app/src/lib/design/*.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type DesignInput = { id: string; fileName: string; fileSize: number; condition?: string; replicate?: number;
                       fraction?: number; techReplicate?: number };
  type ResolvedRow = DesignInput & { condition: string | null; replicate: number; fraction: number;
                       techReplicate: number; sample: number; fractionGroup: number;
                       assumed: { replicate: boolean; fraction: boolean } };
  type Sample = { index: number; condition: string | null; replicate: number; label: string /* "EGF 1" or file stem */ };
  type Notice = { kind: "techReplicate" | "fractionGap" | "unevenFractions" | "multiplexed" | "unknownColumn";
                  message: string; rows: string[] };
  type DesignResolution = { rows: ResolvedRow[]; samples: Sample[]; conditions: string[]; notices: Notice[];
                            summary: string /* "6 files → 3 samples · 2 conditions · fractions 1–2" */ };
  function resolveDesign(inputs: DesignInput[]): DesignResolution;
  function parseDesignTsv(text: string): { inputs: Partial<DesignInput>[]; notices: Notice[] };
  function writeDesignTsv(r: DesignResolution): string;   // one-table OpenMS format
  function parseSdrf(text: string): { inputs: Partial<DesignInput>[]; notices: Notice[] };
  ```

- [ ] **Step 1: Write the failing tests** (`model.test.ts`):
  - `empty fields mean unfractionated, replicates in file order`: three files of condition A without
    replicate or fraction → replicates 1, 2, 3, fraction 1 assumed, three samples
    `"A 1"`, `"A 2"`, `"A 3"`.
  - `repeated fraction numbers assign replicates by order`: A with F1, F2, F1, F2 and no replicate →
    replicates 1, 1, 2, 2.
  - `nothing entered: each file is its own sample`: samples labelled with the file stems; `conditions` empty.
  - `same condition, replicate and fraction twice is a technical replicate`: one `techReplicate` notice,
    `techReplicate` 1 and 2, and the same `sample`.
  - `fraction gaps and uneven fractions are notices`: fractions 1, 2, 4 and replicates with 2 vs 3
    fractions → one `fractionGap` and one `unevenFractions` notice.
  - `summary line`: the mockup design (ctrl a/b × F1/F2, EGF + reinject) →
    `"6 files → 3 samples · 2 conditions · fractions 1–2"`.
  - `keeps two files of the same name apart`: two rows `run.mzML` with different ids → two rows, two samples.
- [ ] **Step 2: Write the failing I/O tests** (`design-tsv.test.ts`, `sdrf.test.ts`):
  - **design.tsv:**
    - `writes the one-table OpenMS format`: header `Fraction_Group\tFraction\tSpectra_Filepath\tLabel\tSample\tMSstats_Condition\tMSstats_BioReplicate`,
      the rows of OpenMS ExperimentalDesign example 1, Label 1.
    - `round-trips the mockup design`: `parseDesignTsv(writeDesignTsv(r))` gives the same conditions,
      replicates and fractions.
  - **SDRF:**
    - `reads the data file, factor value, biological replicate, fraction`: columns
      `comment[data file]`, `factor value[treatment]`, `characteristics[biological replicate]`,
      `comment[fraction identifier]`, `comment[technical replicate]`.
    - `loads multiplexed SDRF as one row per file with a notice`: two `comment[label]` values per file →
      one row and a `multiplexed` notice.
- [ ] **Step 3: Run** `npm test -- design`. Expected: FAIL.
- [ ] **Step 4: Implement the three modules.**
- [ ] **Step 5: Run the tests.** Expected: PASS.
- [ ] **Step 6: Commit** `app: experimental design model, design.tsv and SDRF`.

### Task 3: Display formats: peptides, modifications, FDR

**Files:**
- Create: `app/src/lib/format/peptide.ts`, `app/src/lib/format/fdr.ts`, `app/src/lib/format/settings.svelte.ts`
- Create: `app/src/lib/components/PeptideSequence.svelte`, `app/src/lib/components/FdrInput.svelte`
- Test: `app/src/lib/format/*.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Segment = { residue: string; mod?: { label: string; name: string; unimod: number; mass: number } };
  type PeptideView = { nTerm?: Segment["mod"]; residues: Segment[]; cTerm?: Segment["mod"]; proforma: string };
  function peptideView(t: ResultTables["peptides"], k: number, fixedMods: string[]): PeptideView;  // fixed mods unmarked
  function shortModLabel(name: string): string;
  function parsePercent(input: string): number | null;   // "1" | "1 %" | "1%" -> 0.01; "0.01" -> 0.0001; > 100 or junk -> null
  function formatPercent(q: number): string;            // 0.01 -> "1 %", 0.001 -> "0.1 %"
  function formatQ(q: number): string;                  // 0.01 -> "q ≤ 0.01", 4e-6 -> "q ≤ 4.0e-6"
  const displaySettings: { modMode: "marked" | "proforma" };  // rune state persisted in localStorage "prose.modMode"
  ```

- [ ] **Step 1: Write the failing tests.**
  - `shortModLabel uses the fixed table and falls back to three letters`: `Oxidation`→`ox`,
    `Phospho`→`ph`, `Gln->pyro-Glu`→`pg`, `Hex`→`hex`.
  - `peptideView marks variable, not fixed, modifications`: for `AVM(Oxidation)DDFAAFVEK` with fixed
    `Carbamidomethyl (C)`, residue 3 has label `ox`, and `proforma === "AVM[Oxidation]DDFAAFVEK"`.
  - `N-terminal acetylation`: `nTerm.label === "ac"` and ProForma `"[Acetyl]-DAHKSEVAHR"`.
  - `parsePercent is explicit about percent`: `"1"`→0.01, `"1 %"`→0.01, `"0.01"`→0.0001, `"150"`→null.
- [ ] **Step 2: Run** `npm test -- format`. Expected: FAIL.
- [ ] **Step 3: Implement the modules and the two components.**
  - `PeptideSequence.svelte` renders `PeptideView` per `displaySettings.modMode`, with the hover title
    "Oxidation (Unimod:35) +15.9949".
  - `FdrInput.svelte`: the input with a "%" suffix, "q ≤ …" on the right, and quick-choice chips. A
    `max` prop disables chips above it.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `app: peptide/modification and FDR display`.

### Task 4: Engine worker and client

**Files:**
- Create: `app/src/lib/engine/protocol.ts`, `app/src/lib/engine/core.ts`, `app/src/lib/engine/worker.ts`, `app/src/lib/engine/client.ts`
- Test: `app/src/lib/engine/core.test.ts` (Node, real module), `app/src/lib/engine/client.test.ts` (fake worker)

**Interfaces:**
- Consumes: part B (`ProSEAlgorithm.searchFiles`, `ProSEResultSet`, `annotatePeaks`, `predictMS2`,
  `hasONNXRuntime`, `getThreadingInfo`, `getMemoryInfo`, `getDefaults().getEntries()`).
- Produces:
  ```ts
  type ParamEntry = { name: string; type: string; value: unknown; description: string; tags: string[]; validStrings?: string[] };
  type EngineInfo = { version: string; threads: number; threaded: boolean; isolated: boolean; onnx: boolean; parameters: ParamEntry[] };
  type SearchRequest = { files: { id: string; file: File }[]; database: File; contaminants: boolean;
                         parameters: Record<string, unknown>; rescore: boolean; peptdeep: boolean };
  type SearchProgress = { label: string; file: number; fraction: number /* 0–1 overall */ };
  type SearchOutcome = { summary: ProSEMultiSummary; tables: ResultTables; spectra: StoredSpectra; seconds: number };
  class EngineClient {
    init(threads: number): Promise<EngineInfo>;
    search(req: SearchRequest, onProgress: (p: SearchProgress) => void): Promise<SearchOutcome>;
    annotate(mz: Float32Array, intensity: Float32Array, peptide: string, charge: number, opts: AnnotationOptions): Promise<PeakAnnotationResult>;
    predict(peptide: string, charge: number, nce: number, instrument: string): Promise<PredictedIon[]>;
    idXML(): Promise<Uint8Array>;      // the open search only
    cancel(): void;                    // terminates and restarts the worker
  }
  // core.ts (pure, used by worker.ts and the Node test):
  function runSearch(OpenMS: any, req: CoreSearchRequest, onProgress): CoreSearchOutcome;  // CoreSearchRequest uses Uint8Array file contents
  ```
  - **Paths:** inputs are written to `/input/<index>/<fileName>`. With `contaminants`, the database is
    the user FASTA plus `public/fasta/crap.fasta` with `>CON__` accessions.
  - **PeptDeep:** the models are fetched once from `openms/models/` into `/models`, and
    `peptdeep:ms2_model`/`rt_model` point there.
  - **Transfer:** the typed arrays are transferred, not copied (`postMessage(…, transferList)`).

- [ ] **Step 1: Write the failing tests.**
  - `core.test.ts` (vitest, node; imports `public/openms/openms.mjs`):
    - `searches two files and returns typed columns`: the example mzML twice → `summary.files.length === 2`,
      `tables.psms.count > 1000`, and `spectra.psmSpectrum` mostly ≥ 0.
    - `writes inputs to distinct paths`: two inputs named `run.mzML` → both searched.
  - `client.test.ts` (fake Worker):
    - `client restarts after a trap and rejects the search`: the fake worker emits `error` → `search()`
      rejects with `/out of memory|trap/` and the message mentions `database:chunk_size`; a new worker
      was created.
    - `progress is forwarded with the file index`.
- [ ] **Step 2: Run** `npm test -- engine`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - `core.ts` and `worker.ts` follow today's `examples/prose/worker.mjs` patterns (WasmFS writes, model
    loading, `setLogEnabled("info", false)`).
  - `client.ts` follows the trap handling of today's `app.mjs`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `app: OpenMS engine worker and client`.

### Task 5: Results model, filters, sorting, CSV

**Files:**
- Create: `app/src/lib/results/model.ts`, `app/src/lib/results/filters.ts`, `app/src/lib/results/csv.ts`,
  `app/src/lib/results/synthetic.ts` (test and debug data)
- Test: `app/src/lib/results/*.test.ts`

**Interfaces:**
- Consumes: Task 2 `DesignResolution`; Task 3 `peptideView`; part B `ResultTables`.
- Produces:
  ```ts
  type Level = "proteins" | "peptides" | "psms";
  type ResultModel = {
    tables: ResultTables; design: DesignResolution; samples: Sample[]; showTechReplicates: boolean;
    psmSample: Uint16Array;                                // per PSM row
    peptide: { bestQ: Float64Array; psms: Uint32Array; perSample: Uint32Array /* count × nSamples */; proteins: Uint32Array[] };
    protein: { coverage: Float64Array /* 0–1 */; peptides: Uint32Array; psms: Uint32Array; perSample: Uint32Array;
               contaminant: Uint8Array; foundIn: Uint16Array /* samples with ≥1 PSM */ };
  };
  function buildModel(t: ResultTables, d: DesignResolution, opts: { showTechReplicates: boolean }): ResultModel;
  type FilterState = { text: string; maxQ: number /* ≤ search FDR */; minPeptides: number; minReplicatesInCondition: number;
                       hideContaminants: boolean; showDecoys: boolean; proteinFilter?: number; peptideFilter?: number };
  function applyFilters(m: ResultModel, level: Level, f: FilterState): Uint32Array;
  function sortRows(m: ResultModel, level: Level, rows: Uint32Array, key: string, dir: "asc" | "desc"): Uint32Array;
  function toCsv(m: ResultModel, level: Level, rows: Uint32Array, columns: string[]): string;   // ProForma, one column per sample
  ```
  - "Found in" counts samples; `minReplicatesInCondition` keeps a protein if, in at least one condition,
    at least that many samples of that condition found it.

- [ ] **Step 1: Write the failing tests.**
  - `coverage and per-sample counts`: a synthetic two-protein fixture with known peptides → coverage
    0.5 and 0.25; per-sample PSM counts as built.
  - `technical replicates merge into their sample unless shown separately`.
  - `found in ≥ n replicates of a condition`.
  - `protein and peptide filters restrict the lower levels`: `proteinFilter` keeps only that protein's
    peptides and PSMs.
  - `maxQ only tightens`: `applyFilters` with `maxQ` 0.05 on a 0.01 search equals 0.01.
  - `CSV writes ProForma and one column per sample`: header and the first row exactly as expected, with
    the comma escaped in a description.
  - `filters and sorts 150k PSMs in under 300 ms`: `synthetic.ts` `makeLargeTables(150000, 20000, 4000)`;
    `applyFilters` plus `sortRows` by `qValue` in < 300 ms.
- [ ] **Step 2: Run** `npm test -- results`. Expected: FAIL.
- [ ] **Step 3: Implement it** with typed-array index permutations, no per-row objects.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `app: results model, filters, sorting and CSV export`.

### Task 6: New search page

**Files:**
- Create: `app/src/views/NewSearch.svelte`, `app/src/lib/components/search/DesignTable.svelte`,
  `DatabaseCard.svelte`, `SettingsCard.svelte`, `AllParametersDialog.svelte`, `RescoringCard.svelte`,
  `SearchFooter.svelte`
- Create: `app/src/lib/settings/presets.ts`, `app/src/lib/settings/memory.ts`
- Test: `app/src/lib/settings/*.test.ts`, `app/e2e/search.spec.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 4.
- Produces:
  ```ts
  type Preset = { id: string; name: string; parameters: Record<string, unknown>; builtin: boolean };
  const BUILTIN_PRESETS: Preset[];   // "orbitrap-hcd-tryptic", "timstof-tryptic", "open-search"
  function loadPresets(): Preset[];  // built-in + user presets (localStorage "prose.presets")
  function savePreset(name: string, parameters: Record<string, unknown>): Preset;  // "Save as preset"
  function estimateMemory(i: { largestMzmlBytes: number; proteins: number; specificity: "full" | "semi" | "none";
                               variableMods: number; peptdeep: boolean }): { bytes: number; level: "ok" | "warn" | "over" };
  ```
  - `estimateMemory`:
    - bytes = 0.25 GB + 0.08 GB per 1,000 proteins × (1 full, 6 semi, 30 none) × 1.5^max(0, variableMods − 1)
      + 2 × largestMzmlBytes + (peptdeep ? 0.6 GB : 0).
    - level: `warn` above 3 GB, `over` above 4 GB. The footer then suggests `database:chunk_size`.
  - Common parameters, in mockup order: enzyme, missed cleavages, precursor tolerance, fragment
    tolerance, fixed, variable, PSM FDR, protein FDR, charges, peptide length. "All N parameters" opens
    the dialog generated from `ParamEntry[]`.

- [ ] **Step 1: Write the failing tests.**
  - `estimateMemory matches the measured searches`:
    - Erwinia (4,499 proteins, tryptic, 1 variable mod, 78 MB mzML) → 0.7–1.0 GB, `ok`.
    - human (20,652, tryptic) → 1.8–2.4 GB.
    - human semi → `over`.
  - `presets set only their parameters`.
  - e2e `example search end to end`:
    - Click "Try the example" (loads `public/example` twice as two replicates of condition "example")
      → the summary line reads "2 files → 2 samples · 1 condition".
    - Start search → the Results view shows a PSM count > 1000 within 120 s.
- [ ] **Step 2: Run** `npm test -- settings && npm run e2e -- search`. Expected: FAIL.
- [ ] **Step 3: Implement the page** as in mockup 1 (and `1b-fdr-fields`).
  - Design-table cells show assumed values greyed (`ResolvedRow.assumed`), with notices below and the
    summary above.
  - "Paste from spreadsheet" (tab-separated clipboard text), "Load design (SDRF, design.tsv)", "Save design.tsv".
  - Drag-and-drop or "Add files" for mzML.
  - The design section is hidden for a single file.
  - An "Advanced" switch shows the derived Fraction_Group and Sample columns, plus an editable
    "Tech. replicate" column for marking technical replicates explicitly.
  - The empty state (no files yet) replaces today's start page: "Try the example", the desktop downloads
    (links to `releases/latest/download/prose-desktop-<platform>.zip`), and a one-line privacy note
    ("Spectra and database stay on this computer").
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `app: New search page`.

### Task 7: Results view and tables

**Files:**
- Create: `app/src/views/Results.svelte`, `app/src/lib/components/results/KeyFigures.svelte`,
  `FilterBar.svelte`, `DataTable.svelte` (virtualized), `ProteinsTable.svelte`, `PeptidesTable.svelte`,
  `PsmsTable.svelte`, `ColumnsMenu.svelte`
- Test: `app/e2e/results.spec.ts`

**Interfaces:**
- Consumes: Task 5 (`buildModel`, `applyFilters`, `sortRows`, `toCsv`), Task 3 (`PeptideSequence`, `FdrInput` with `max` = search FDR).
- Produces:
  - `DataTable.svelte` props: `rows: Uint32Array`, `columns: Column[]`, `sort`, `onSort`, `onRowClick`,
    `selected?: number`; header groups for per-sample columns grouped by condition.
  - `Column = { id; header; group?; width; align; cell: (row) => string | Snippet; sortKey? }`.

- [ ] **Step 1: Write the failing e2e tests** (with a stored synthetic result: `?debug=large` loads `makeLargeTables`):
  - `scrolls a 150k-row PSM table`: scroll to the bottom; the last row index is visible and the frame
    time stays < 50 ms.
  - `sorts and filters proteins`: sort by PSMs desc → the first row has the highest PSM count. Typing
    the first accession in the filter → 1 row.
  - `exports the filtered view as CSV`: "Export CSV · n rows" downloads a file with n + 1 lines and the
    per-sample headers.
  - `switches modifications to ProForma`: the setting toggles `Mᵒˣ` → `M[Oxidation]` in the peptides table.
- [ ] **Step 2: Run** `npm run e2e -- results`. Expected: FAIL.
- [ ] **Step 3: Implement it** as in mockup 2: key figures, tabs Overview · Proteins · Peptides · PSMs ·
  Samples · QC, one filter row, a virtualized table, per-sample columns grouped by condition, and "Found in".
  - On the Peptides tab the q-value filter is labelled "Best PSM q-value".
  - The header's Export menu offers:
    - "CSV (current view)";
    - "Design (design.tsv)";
    - "Project (.prose)";
    - "idXML (merged)". This one is enabled only while the search's engine result is still open, and
      otherwise carries the tooltip "Run the search again to export idXML".
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `app: results view with virtualized tables, filters and CSV export`.

### Task 8: Protein panel

**Files:**
- Create: `app/src/lib/components/protein/ProteinPanel.svelte`, `CoverageStrip.svelte`, `CoverageMap.svelte`, `ProteinPeptides.svelte`
- Test: `app/e2e/protein.spec.ts`

**Interfaces:**
- Consumes: Task 5 model (`protein.coverage`, peptide refs with `start`/`end`), Task 7 `DataTable`.
- Produces: an `openPsm(row)` event to Task 9, and `filterBy({ protein })` to the PSMs tab ("Open in PSM table").

- [ ] **Step 1: Write the failing e2e tests.**
  - `a protein opens its coverage, peptides and PSMs`: click the first protein → the panel shows its
    accession and coverage % (equal to the table's).
    - The Peptides tab lists `protein.peptides[row]` peptides; expanding the first lists its PSMs; a
      PSM click opens the PSM view.
  - `open in PSM table carries the filter`: the PSMs tab shows a chip "Protein: <accession> ✕" and only
    that protein's PSMs.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it** as in mockup 4.
  - The strip shows peptides along the sequence with modified sites (dots, `#1baf7a`).
  - The coverage map uses blocks of 10 residues, 40 per row.
  - While the panel is open, the table hides Description.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `app: protein panel with coverage, peptides and PSMs`.

### Task 9: PSM view

**Files:**
- Create: `app/src/lib/components/psm/PsmView.svelte`, `FragmentLadder.svelte`, `SpectrumMirror.svelte`,
  `IonTable.svelte`, `MassErrorPlot.svelte`, `PsmFeatures.svelte`, `app/src/lib/psm/svg-export.ts`
- Test: `app/src/lib/psm/*.test.ts`, `app/e2e/psm.spec.ts`

**Interfaces:**
- Consumes: Task 4 `annotate`, `predict`; part B `StoredSpectra`; `summary.files[f].peptdeepNce`.
- Produces: `exportSpectrumSvg(svg: SVGSVGElement): string`, a standalone SVG with inline styles.
- Behaviour:
  - The bottom half is the PeptDeep prediction when `info.onnx`. NCE = `peptdeepNce` of the PSM's file,
    else the spectrum's `collisionEnergy`, else 30.
  - Otherwise, or when "Theoretical" is chosen, it is the theoretical spectrum (`annotate(...).theoretical`,
    uniform height).
  - The cosine and spectral angle shown are the PSM's `ms2_cosine` and `ms2_spectral_angle` features
    when present.

- [ ] **Step 1: Write the failing tests.**
  - `svg-export.test.ts`: `exportSpectrumSvg inlines styles and has no external references`.
  - e2e `PSM view shows the annotated spectrum, ion table and mass errors`: open a PSM from the PSMs tab.
    - The ladder has the peptide's residues; the spectrum has ≥ 1 `b` and ≥ 1 `y` label.
    - The ion table highlights the matched cells; the mass error plot has one dot per match, all within
      the tolerance band.
    - "Next ›" moves to the next row of the current sort.
  - e2e `ion toggles change the annotation`: turning on `a` adds `a` labels.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it** as in mockup 3: breadcrumb, ladder with modified-residue labels, mirror
  spectrum, ion/charge/loss toggles, ion table, mass error plot (m/z vs ppm, tolerance band, dot size =
  intensity), features, Prev/Next, "Export spectrum (SVG)".
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `app: PSM view with mirror spectrum, ion table and fragment mass errors`.

### Task 10: Overview, Samples, QC, open search

**Files:**
- Create: `app/src/lib/components/results/OverviewTab.svelte`, `SamplesTab.svelte`, `QcTab.svelte`, `DeltaMassPanel.svelte`
- Test: `app/e2e/overview.spec.ts`

**Interfaces:**
- Consumes: Task 5 model; `summary` (per file, `modificationAnalysis` for open search).
- **Content:**
  - **Overview:** key figures and a per-file table (spectra, PSMs, Percolator applied or skipped, seconds).
    With `summary.openSearch`, also a delta-mass histogram and the mapped-PTM table (as today's demo).
  - **Samples:** a table of samples × (PSMs, peptides, proteins), grouped by condition.
  - **QC:** score distribution of targets vs decoys, the precursor-error histogram, PSMs per file.
  - Open-search PSMs show "Δ +15.995" after the sequence; their ProForma is `[+15.995]?SEQUENCE`.

- [ ] **Step 1: Write the failing e2e tests.**
  - `overview lists every file`.
  - `samples tab groups by condition`.
  - `open search shows delta masses` (preset "open-search" on the example data): the histogram is visible
    and the PTM table has ≥ 1 row.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.** The charts are hand-written SVG with the colours of the global constraints;
  each has a direct label or legend.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `app: overview, samples, QC and open-search panels`.

### Task 11: History and project files

**Files:**
- Create: `app/src/lib/persist/record.ts`, `app/src/lib/persist/history.ts`, `app/src/lib/persist/project.ts`, `app/src/views/History.svelte`
- Test: `app/src/lib/persist/*.test.ts`, `app/e2e/history.spec.ts`

**Interfaces:**
- Consumes: Task 4 `SearchOutcome`, Task 2 `DesignResolution`, Task 6 settings.
- Produces:
  ```ts
  const SCHEMA_VERSION = 1;
  type SearchRecord = { schema: 1; id: string; name: string; createdAt: string; appVersion: string; moduleVersion: string;
                        design: DesignResolution; settings: { parameters: Record<string, unknown>; rescore: boolean;
                        peptdeep: boolean; contaminants: boolean; presetId?: string };
                        summary: ProSEMultiSummary; tables: ResultTables; spectra: StoredSpectra };
  function saveSearch(r: SearchRecord): Promise<void>;          // metadata in IndexedDB (idb-keyval), arrays in OPFS
  function listSearches(): Promise<Pick<SearchRecord, "id" | "name" | "createdAt" | "summary">[]>;
  function loadSearch(id: string): Promise<SearchRecord>;
  function deleteSearch(id: string): Promise<void>;
  function writeProject(r: SearchRecord): Uint8Array;           // zip (fflate): manifest.json + one .bin per typed array
  function readProject(bytes: Uint8Array): SearchRecord;        // throws ProjectVersionError("This project was saved by a newer version of ProSE (schema 2) …")
  ```

- [ ] **Step 1: Write the failing tests.**
  - `writeProject/readProject round-trips every typed array` (synthetic record: byte-equal arrays).
  - `readProject rejects an unknown schema version with a message`.
  - `only completed searches are saved`: a rejected search leaves `listSearches()` unchanged.
  - e2e `a search reopens from History with spectra`: run the example, reload the page, open it from
    History; the PSM view shows the spectrum without the mzML.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - Save automatically after each completed search.
  - The History view: name, date, files, PSMs; open, rename, delete.
  - "Save project" downloads `<name>.prose`; "Open project" accepts `.prose`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `app: History and project files`.

### Task 12: Service worker, deployment, desktop

**Files:**
- Create: `app/public/sw.js` (from `examples/sw.js` of #10575 with the `no-cache` fix; module files under
  `openms/`; stores named after `__BUILD_ID__`, replaced at build), `app/src/lib/sw-client.ts`
- Create: `.github/workflows/pages.yml`
- Modify: `index.html` → redirect to `app/` content (see below), `desktop/build.sh`, `desktop/neutralino.config.json`
- Test: `app/e2e/deploy.spec.ts` (against `vite preview` without COOP/COEP)

**Interfaces:**
- **Site layout after deployment** (built by the workflow into `_site/`):
  - the app at `/prose-web/`;
  - `/prose-web/examples/prose/` → a redirect page to `../../`;
  - `/prose-web/openms-demo/`, the old `examples/browser/` with its module;
  - `data/`, `prose-single-file.html` and `README.md` unchanged.
- **Pages:** the source switches from "branch main /" to "GitHub Actions"
  (`gh api -X PUT repos/timosachsenberg/prose-web/pages -f build_type=workflow`).
- **Desktop:** `desktop/build.sh` copies `app/dist` (built with `VITE_BASE=./`) as the resources;
  `neutralino.config.json` `url` becomes `/`.

- [ ] **Step 1: Write the failing e2e tests.**
  - `the service worker isolates the page and caches the module`: the first load reloads once; then
    `crossOriginIsolated === true` and the cache `openms-module-<BUILD_ID>` holds `openms.wasm`.
  - `works offline after the first visit`: the context goes offline and reloads; the app shell and
    "Try the example" still work.
  - `runs single-threaded without isolation`: block the service worker; the status chip says "1 thread"
    with the notice "not cross-origin isolated"; a search still finishes.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement the service worker, client and workflow; update the desktop build.**
- [ ] **Step 4: Run the tests.**
  - Run the e2e tests and `desktop/build.sh`.
  - Then run the Linux desktop check
    (`/scratch/sachsenb/prose-bench/browser/desktop-check2.mjs` pattern, adapted to the new selectors).
  - Expected: all pass.
- [ ] **Step 5: Commit** `app: service worker, Pages deployment and desktop packaging`.
- [ ] **Step 6: Deploy, after the user has approved screenshots of the built app** (rendered headlessly
  from `vite preview`, as for the mockups).
  - Order: first switch Pages to GitHub Actions (`gh api -X PUT repos/timosachsenberg/prose-web/pages -f build_type=workflow`), then push `main`. The switch keeps the site deployed before live until the workflow deploys; the push runs the workflow, which deploys the app. In the other order, Pages in branch mode would publish `main`'s root (the pointer `index.html` and the repository's files, no app) until the switch.
  - Then check https://timosachsenberg.github.io/prose-web/ with the e2e suite against the live URL.
  - Publish desktop `0.3.0` with `gh release create`.
