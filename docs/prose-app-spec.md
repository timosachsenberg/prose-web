# ProSE app: as-built specification (snapshot)

Snapshot of 2026-10-19, taken while the work is still going on; the 64-bit engine (wasm64, OpenMS PR
#10659) added on 2026-10-20 (§5.9, decisions §4.9). It records what exists, why it is the
way it is, and how to build it again. Read it together with:

- the design: [`superpowers/specs/2026-10-16-prose-app-design.md`](superpowers/specs/2026-10-16-prose-app-design.md)
  and its mockups in [`superpowers/specs/2026-10-16-prose-app-mockups/`](superpowers/specs/2026-10-16-prose-app-mockups/);
- the plans: [`superpowers/plans/2026-10-16-prose-app-A-library.md`](superpowers/plans/2026-10-16-prose-app-A-library.md),
  [`…-B-bindings.md`](superpowers/plans/2026-10-16-prose-app-B-bindings.md),
  [`…-C-app.md`](superpowers/plans/2026-10-16-prose-app-C-app.md);
- the decision log, a companion file of this one: [`prose-app-spec/decisions.md`](prose-app-spec/decisions.md).
  It holds every ruling of the three task ledgers (`.superpowers/sdd/…/progress.md`). Those ledgers are
  git-ignored and will be deleted; the decision log replaces them.

Where the design, the plans and the code disagree, this document follows the latest ruling or the
code, and says so.

**Status labels** used throughout:

| Label | Meaning |
|---|---|
| **done** | implemented, reviewed, review clean, committed |
| **in review** | implemented and committed; its review or a fix round is open |
| **in progress (task id)** | being implemented; uncommitted or partly committed; may still change |
| **planned (task id)** | specified in a plan or a ruling, not started |

Rulings are cited as **A-R*n***, **B-R*n***, **C-R*n*** (ruling *n* of the A, B or C ledger). The
controller numbered some rulings across ledgers: Ruling 30 is recorded in the C ledger but continues
the B numbering; the B ledger has no Ruling 30.

---

## 1. Purpose, users, success criteria

### 1.1 Purpose

A browser application around ProSE, the OpenMS database search engine compiled to WebAssembly. A
scientist brings one or many mzML files and a FASTA database, runs a peptide search on their own
computer, and then browses, checks, filters and exports the identifications. The data never leaves the
computer; after the first visit the app is meant to work offline (service worker, C12).

It replaces the demo page at https://timosachsenberg.github.io/prose-web/ (vanilla JS,
`src/openms_wasm/examples/prose` of OpenMS PR #10575). The same build is to be shipped as a
Neutralino desktop app.

### 1.2 Users

Life scientists with mass-spectrometry experience: core-facility staff, PhD students, PIs. They know
PSMs, FDR, fractions and replicates and what an annotated spectrum looks like; they expect what
Proteome Discoverer, MaxQuant, FragPipe or Scaffold offer for identification, and do not want to read
documentation before their first search.

### 1.3 Goals and non-goals

Goals (design spec): search one file or a whole experiment with one FDR and one protein inference
across all files; browse proteins, peptides and PSMs in sortable tables; compare samples by
identification counts with "found in n of m"; inspect evidence (annotated spectrum mirrored against
PeptDeep or the theoretical spectrum, fragment ladder, b/y ion table, fragment mass error plot, all
PSM features; protein coverage); one filter row per level; CSV export of exactly the filtered, sorted
view; local and offline.

Non-goals: quantification (no intensities, no LFQ, no statistics; samples are compared by
identifications only); guessing the design from file names (explicitly rejected by the user); vendor
raw formats (mzML only); accounts or server-side processing. Multiplexed designs (TMT, SILAC) are out
of scope: labelled data can be searched with the labels as fixed modifications, and a design.tsv or
SDRF with several labels per file is loaded as one row per file with a notice.

Anti-goals, which would make the app a failure even if it works:

- **Clutter**: decoration, illustrations, embedded images, marketing tone. The look is sober and dense
  (shadcn-svelte, neutral greys, thin lines), as in the mockups.
- **Ambiguous numbers**: an FDR of "1" must never be readable as 1 % and as 100 %.
- **A design table that punishes incomplete input.**

### 1.4 Success criteria (design spec; criterion 3 set by the user)

1. A fractionated two-condition experiment of **6–12 mzML files** (about **1 GB each**, B-R27) goes
   from files to a filtered CSV in the browser on GitHub Pages and in the desktop app, without console
   errors.
2. Every screen of the mockups works with real data: sorting, filtering, export, drill-down, spectrum,
   mass error, coverage, the modification display switch.
3. **The numbers are close to native ProSE: "similar, not identical" (the user's words).** Same files
   and settings give PSM, peptide and protein counts at 1 % FDR within 2 % of `ProSE -out_merged` (the
   2 % is the designer's call). Exact equality cannot be expected: the automatic PeptDeep NCE can tip
   differently on different platforms (README: 26 natively, 36 in WebAssembly, median cosines 0.55504
   vs 0.55503).
4. It stays responsive: sorting or filtering 100,000 PSMs well under a second; the UI never freezes
   during a search.
5. It needs no instructions: a scientist new to the app runs the bundled example within two minutes.

State against the criteria at this snapshot: criterion 1 is blocked by the inputs living inside the
4 GB heap (B9, in progress); criterion 3 is met on the test data (the pooled counts equal the
`ProSE_13` reference exactly, §3.4); criterion 4 is met for tables (150k PSMs filter + sort ≈ 100 ms,
scroll frames 16.7 ms, §5.5); criterion 2 needs C8–C10.

---

## 2. Architecture overview

### 2.1 The three parts

```
            ┌────────────────────────────────────────────────────────────┐
  part C    │  ProSE app (Svelte 5, Vite, shadcn-svelte)                 │  timosachsenberg/prose-web
            │  app/ on branch prose-app; GitHub Pages /prose-web/;       │  branch prose-app
            │  Neutralino desktop                                        │
            └───────────────▲────────────────────────────────────────────┘
                            │ the npm package of the threaded ONNX build,
                            │ copied into app/public/openms/ (versioned)
            ┌───────────────┴────────────────────────────────────────────┐
  part B    │  WebAssembly bindings for the app (Embind)                 │  OpenMS/OpenMS
            │  searchFiles, ProSEResultSet, tables, spectra,             │  claude/wasm-prose-app-bindings
            │  annotatePeaks, predictMS2; WasmFS fixes; PeptDeep memory  │  PR #10604 → #10575 → #10564
            └───────────────▲────────────────────────────────────────────┘
                            │ merged in (31d9598ee8)
            ┌───────────────┴────────────────────────────────────────────┐
  part A    │  OpenMS library: ProSEAlgorithm::mergeFileResults(),       │  OpenMS/OpenMS
            │  per-file progress, PeptDeepRescoring::NCE_META_VALUE      │  claude/prose-merged-in-library
            │  (the ProSE tool's -out_merged moved into the library)     │  PR #10602 → #10578 → develop
            └────────────────────────────────────────────────────────────┘
```

Part A follows the user's earlier choice (made for #10578, Percolator) to move the ProSE tool's logic
into `ProSEAlgorithm`, so native ProSE and the browser run the same pooling code. Part B is everything
JavaScript-facing. Part C never builds OpenMS: it consumes the module as a versioned artifact.

### 2.2 Repositories, branches and pull requests

Facts from `gh pr view` on 2026-10-19:

| PR | Title | Base ← head | State | Head commit on GitHub |
|---|---|---|---|---|
| [#10564](https://github.com/OpenMS/OpenMS/pull/10564) | [EXPERIMENT] WebAssembly build of OpenMS with JavaScript bindings (single- and multi-threaded) | `develop` ← `claude/emscripten-openms-library-1mutfn` | open, draft | 04ab4f96cf |
| [#10575](https://github.com/OpenMS/OpenMS/pull/10575) | [EXPERIMENT] WebAssembly: ProSE search engine bindings and a ProSE web application | `claude/emscripten-openms-library-1mutfn` ← `claude/wasm-prose-webapp` | open, draft | 80a3b501c4 |
| [#10578](https://github.com/OpenMS/OpenMS/pull/10578) | [API,PARAM,TEST] ProSE: Percolator rescoring in ProSEAlgorithm, on by default | `develop` ← `claude/prose-percolator-in-library` | open | 8bd10f7c62 |
| [#10602](https://github.com/OpenMS/OpenMS/pull/10602) | [API] ProSE: merged multi-file evaluation in ProSEAlgorithm (part A) | `claude/prose-percolator-in-library` ← `claude/prose-merged-in-library` | open (no longer draft; the A ledger still says draft) | 8c2347422b |
| [#10604](https://github.com/OpenMS/OpenMS/pull/10604) | [EXPERIMENT] WebAssembly: ProSE bindings for the ProSE app (part B) | `claude/wasm-prose-webapp` ← `claude/wasm-prose-app-bindings` | open, draft | be22770d6a |

- **#10602 is stacked on #10578**: after #10578 merges it must be retargeted to `develop` (rebased if
  #10578 is squash-merged). Only cppcheck has run on it; the CI matrix (macOS/Windows) has not
  (`gh pr checks 10602`).
- **#10604's local branch is ahead of GitHub**: B8 (`217d1e3b59..006a261fb3`) is committed locally in
  `/scratch/sachsenb/openms-pr10564` but not pushed; B9 is uncommitted work in that tree.
- **prose-web** (`timosachsenberg/prose-web`, local clone `/scratch/sachsenb/prose-pages`): `main`
  deploys GitHub Pages (the old demo site); all app work is on `prose-app` (never on `main`). GitHub's
  `origin/prose-app` is at 639779d; the local branch is ahead.

Local trees used for the work:

| Path | Branch | Purpose |
|---|---|---|
| `/scratch/sachsenb/openms-merged` | `claude/prose-merged-in-library` | part A worktree, native build `OpenMS-build` (A-R1) |
| `/scratch/sachsenb/openms-pr10564` | `claude/wasm-prose-app-bindings` | part B, wasm builds in `build/` |
| `/scratch/sachsenb/openms-develop-prose` | (#10578's checkout) | provides the vcpkg checkout and `vcpkg_installed` for the native build; never touched |
| `/scratch/sachsenb/prose-pages` | `prose-app` | part C (`app/`), the site, these docs |

### 2.3 Runtime picture

```
 page (main thread, Svelte)                       never blocks on OpenMS
   │  EngineClient (lib/engine/client.ts), one per app (lib/engine/app-engine.svelte.ts)
   │
   ├── search worker (module Worker, lib/engine/worker.ts)   ── a FRESH worker per search ──
   │     OpenMS module (openms.mjs + openms.wasm, threaded, ONNX Runtime): public/openms/ (wasm32,
   │       4 GB), or public/openms64/ (wasm64, Memory64, 16 GB) for a search above 3 GB (§5.9)
   │       numThreads = min(hardwareConcurrency, 16) if crossOriginIsolated, else 1
   │       WasmFS memory backend: /input/<i>/<name>, /input/db/<name>, /models, /output
   │       ProSEAlgorithm.searchFiles() → ProSEResultSet (kept until the worker is replaced:
   │       serves idXML export)
   │       results: tables() + spectra() as typed arrays, TRANSFERRED to the page once
   │
   └── viewer worker (lazy, 2 threads, long-lived)
         its own OpenMS module (always wasm32); serves annotatePeaks() and predictMS2() only, so they
         never wait behind a search and do not take the search module's heap
```

- **Isolation and threads.** The threaded module needs a cross-origin isolated page
  (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`). The
  module's own pthread Workers are started from a Blob and inherit isolation. In the threaded build,
  `openms.mjs` is also the worker script; there is no separate worker file and no `openms.data`
  (share data embedded, `OPENMS_WASM_SHARE=EMBED`).
- **ONNX Runtime** runs in the threaded module on one global pool as large as the OpenMP team
  (`threads.js` reserves its Workers). The PeptDeep models (`peptdeep_ms2_dynamic.onnx` 16.2 MB,
  `peptdeep_rt_dynamic.onnx` 2.8 MB) are fetched from `openms/models/` into `/models` once per worker.
- **Memory.** One module can address 4 GB (wasm32) or 16 GB (wasm64). Memory grows in 20 % steps and
  never shrinks; the allocator is OpenMS' build of mimalloc (`OPENMS_WASM_MALLOC=openms-mimalloc`,
  since the packages 3.7.0-pre.fd807dc89a of PR #10659, now 76607e6451; Emscripten's `-sMALLOC=mimalloc` before). Hence
  the fresh worker per search (B-R9, C-R13). The inputs go in file by file (B9, C4b): only the file
  being searched is in the heap.
- **Data transfer.** Results reach the page as compact typed columns, never one object per PSM. The
  arrays are plain `ArrayBuffer`s and are transferred, not copied (checked with `structuredClone`).

### 2.4 Service worker and isolation

GitHub Pages sends no COOP/COEP headers. Today's site (branch `main`, also `prose-app`) registers
`examples/sw.js` through `examples/sw-client.mjs` (note: the service worker is in `examples/`, not the
repository root). It:

- adds `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` to
  the page and to worker scripts, so threads work; the first visit reloads once;
- stores the module files (`openms.wasm|mjs|data`, `index.mjs`, `models/*.onnx`) cache-first in
  `openms-module-<version>` and the app files network-first in `openms-app-<version>`, the version
  read from `../package.json` (`cache: "no-store"`); a meta store `openms-meta` remembers it and the
  stores of other versions are dropped;
- fetches from the server with `cache: "no-cache"` (the HTTP-cache fix of OpenMS 80a3b501c4: GitHub
  Pages' `max-age=600` otherwise filled the stores with stale files);
- Shift+Reload bypasses it.

The app's own service worker (**C12, deployed 2026-10-20**, fix rounds 1–3 reviewed;
the user approved deploying once it passes): `app/public/sw.js`, derived from `examples/sw.js` with the same lessons, registered by
`app/src/lib/sw-client.ts` with the app's directory as scope (`/prose-web/`; `/` in the desktop app).

- **Isolation**: COOP/COEP on every response it gives except `openms.wasm`, and on every navigation and
  worker script in its scope (also the site's other pages). The engine worker's script comes through it
  with the headers; the module's pthread workers are Blob workers (`threads.js`,
  `mainScriptUrlOrBlob`) and inherit the engine worker's isolation (their re-import of `openms.mjs`
  does not reach the network: checked with the HTTP cache cleared).
- **Only its own bytes (fix round 2).** The build writes a **manifest** into `sw.js` (path → size,
  SHA-256 of every file but `sw.js`; `app/sw-stamp.ts`). The worker stores a response only if its
  bytes match (verified on a copy, before `put`); otherwise it stores nothing.
- **Module** (`openms/`): every file is requested with `?v=<MODULE_ID>` (SHA-256 of `public/openms/`,
  `__OPENMS_ID__`): `openms.mjs`, `openms.wasm` (through `locateFile`) and the PeptDeep models. The
  64-bit module (`openms64/`, §5.9) likewise with `?v=<MODULE64_ID>` (`__OPENMS64_ID__`), in a store of
  its own, `openms64-module-<MODULE64_ID>`; it has no models (it uses `openms/models/` with the wasm32
  id). Files of its own versions: cache-first from `openms-module-<MODULE_ID>` (`openms64-module-…`); on the first request fetched, verified,
  stored and answered from the store (the stored response itself, so Chrome's code cache applies:
  1.34 MB of compiled code beside the 44.8 MB wasm, engine start ≈ 1 s from the second visit, also for
  a wasm stored by an update's installation); `openms.wasm` is never re-wrapped. If the server has
  other bytes under such a URL (a newer version was deployed), the answer is **409**, never the other
  bytes: an old tab's lazily loaded model fails cleanly ("…of this version of ProSE is no longer on the
  server: a newer version was deployed. Reload the page."). Files of another version (another `?v=`)
  come from a kept store that has exactly that URL; else from the network, unstored, verified against
  that version's manifest where its generation is stored (each generation's marker carries its
  manifest), else as the server has it.
- **App files** (`index.html`, `assets/`, `example/`, `fasta/`): network-first; stored only if they are
  this build's (another build's page or chunks pass through unstored, so the worker's store never gets
  a page it cannot run); offline, or when the server answers not-OK (an old tab's hashed chunk after a
  deployment), from this generation's store, else by exact URL from the kept previous one. Installation
  stores the **shell** (`index.html` + `assets/`), all of it verified or the installation fails (a
  deployment landing mid-installation fails the `index.html` check). The example and `fasta/`
  (**DATA**) are stored when the app asks (`STORE_DATA`, once OpenMS has loaded); offline without them
  "Try the example" says "The example is not stored on this computer, and there is no connection…".
- **The 64-bit module (W64).** In the manifest (size, SHA-256), but neither in the shell nor in an
  update's installation: stored only when a search first uses it (then offline too). Without room it
  is answered from the network, unstored, and STATUS says `module64Full` (not `storageFull`: the app
  still works offline), also after the worker restarts (kept in the generation marker, W64 r1). An
  update's installation without room for its module drops the 64-bit stores that no open page uses
  (W64 r2: a tab of the previous build keeps its own), if that makes room (a check first, no credit
  after it: Chrome frees deleted entries at once), entry by entry (the worker checks them by their keys
  and never holds their responses), and tries again (W64 r1). STATUS reports `module64Stored`; "works offline" stays wasm32's shell and module.
- **Updates (fix rounds 1–2).** A new version's worker installs **completely before it waits**: the
  shell and, because a previous version is active, the module (`openms.mjs`, `openms.wasm`), verified;
  DATA and the models the previous generation stored are carried over where the bytes are the new
  build's. A first visit installs the shell only (the isolating reload stays fast). The new worker
  then waits; the top bar shows "Update ready · Reload" (disabled during a search); Reload posts
  `SKIP_WAITING` and reloads on `controllerchange`. Closing every tab of the old version also lets it
  take over (with its complete stores: offline works the next day).
- **Generations (fix round 2).** A generation = `prose-app-<BUILD_ID>` + `openms-module-<MODULE_ID>`
  (+ `openms64-module-<MODULE64_ID>`, once used); a marker in the app store records build, module,
  module64, manifest, installation and activation times. The cleanup keeps the module stores of both
  kinds that this or the kept generation names, and drops the others. Only
  the active worker cleans (on activation and whenever a page says hello): it keeps the **previous**
  generation (the one activated before it) while its own is incomplete or a page of that build is open
  (it asks the pages for their build: `BUILD?`, answered by `sw-client`), and drops it otherwise; it
  drops every other generation, but never a newer one (installing or waiting). So an old tab keeps
  starting engine workers and loading its module after another tab took the update, and is told
  ("Update ready · Reload" also shows in a page of the kept previous build).
- **Storage full (fix round 3).** No store can fail a response (`store()` reports instead of
  throwing; a module file it cannot store comes from the network). Before storing the module the
  worker checks `navigator.storage.estimate()`. An update without room for its module drops what
  neither the active worker nor an open page needs, else installs shell-only and still arrives
  (online only); having taken over, it drops the previous generation once no page of it is open and
  then stores its module. The chip's title: "Not stored for offline use: the browser's storage for
  this site is full (… of … used)…".
- **Open pages** are the app's own windows only (the scope or `index.html`); the site's other pages
  and other project sites of the origin do not keep a previous generation (fix round 3).
- **"Works offline"** comes from the worker's **STATUS** report: this build's shell and module stored
  and verified. The chip's title adds the PeptDeep models and the example ("PeptDeep models not stored
  yet (stored when first used)") and, where the browser has Memory64, the 64-bit engine ("The 64-bit
  engine for large searches too." / "… not stored yet (stored when first used)." / "… not stored: the
  browser's storage for this site is full.").
- **Cleanup of the earlier site** on activation: in the demos' stores (`openms-(module|app)-<semver>`)
  the entries the earlier site left (the module and models in the scope's root, `examples/`); a store
  left empty goes, and `openms-meta` when no such store remains. The entries of `openms-demo/` stay.
  The app and the redirect pages unregister the earlier demos' workers (any scope within `examples/`:
  `examples/prose/`, `examples/browser/`, the desktop 0.2.0's `/examples/prose/`).
- The worker's own fetches use `cache: "no-cache"`; the build stamps `BUILD_ID`, `MODULE_ID`, `MODULE64_ID`, `SHELL`,
  `DATA`, `MANIFEST` and the page's build meta.
- **First visit**: `index.html` shows "Loading ProSE…"; `main.ts` mounts at once on an isolated page;
  otherwise it waits for the worker (shell only) and the page reloads once per tab (`sessionStorage`
  marker), at most 30 s, then runs on one thread. Where the session storage is blocked, the page does
  not reload and starts on one thread; `registerServiceWorker()` never rejects. Where the worker cannot
  help (blocked, unsupported, private window, Shift+Reload) the module runs on **one thread**: chip
  "OpenMS 3.7 · 1 thread · not cross-origin isolated" (amber, explanatory title) and a dismissible
  notice on New search.

`vite dev`/`vite preview` (their `server.headers`/`preview.headers`) and the desktop app (Neutralino
`serverHeaders`) send the headers themselves; the worker is not registered under `vite dev`.

---

## 3. Library (part A, PR #10602)

Branch `claude/prose-merged-in-library`, `8bd10f7c62..8c2347422b`. **Done** (CI matrix not run, §7).

### 3.1 API

`src/openms/include/OpenMS/ANALYSIS/ID/ProSEAlgorithm.h`:

```cpp
/// The pooled evaluation of a multi-file search (the ProSE tool's -out_merged).
struct MergedResult
{
  std::vector<ProteinIdentification> protein_ids; ///< one pooled run; empty if no file succeeded
  PeptideIdentificationList peptide_ids;          ///< PSMs of all files; meta value 'id_merge_index' = input position
                                                  ///< (for inputs with distinct paths)
  bool protein_fdr_applied = false;               ///< picked-protein FDR applied and its filter at FDR:protein
                                                  ///< (and, with remove_decoys, the decoys removed)
};

MergedResult mergeFileResults(MultiFileSearchResult& result, const StringList& in_spectra_files,
                              bool remove_decoys = true) const;

/// public since B3 (895c103ac0, in the bindings PR, B-R15): the enzyme name of the .pin features
static std::string pinEnzymeName(const std::string& enzyme);   // ProteaseDB name -> PercolatorInfile name
```

`src/openms/include/OpenMS/ANALYSIS/ID/PeptDeepRescoring.h`:

```cpp
static constexpr const char* NCE_META_VALUE = "peptdeep_nce";
```

### 3.2 `mergeFileResults()` semantics

In order:

1. `in_spectra_files.size() != result.per_file.size()` → `Exception::IllegalArgument` ("N input
   file(s) given for the result of a search of M file(s); pass the input files of the search, in its
   order."), before anything is moved.
2. Mixed rescoring: among files with `EXECUTION_OK`, if Percolator rescored some but not all
   (`percolator.applied`) → `Exception::InvalidValue` (the tool's former `rescored_only_some`).
   `result` is unchanged when IllegalArgument or InvalidValue is thrown.
3. No file searched → empty `MergedResult`.
4. Pooling: the search's pooled aggregate (fast path) if present, else `IDMergerAlgorithm` over the
   `EXECUTION_OK` files through `poolSearchedFiles_()`, which copies the per-file runs and moves the
   PSMs (the per-file `protein_ids`, with search parameters, `peptdeep_nce` and run paths, survive).
   `id_merge_index` is remapped to the **input position**, also after a failed file (A-R5).
5. `setPrimaryMSRunPath(in_spectra_files)`, `setDateTime(now)`, `BasicProteinInferenceAlgorithm::run`.
6. If `FDR:protein > 0` and decoy proteins were identified: `applyPickedProteinFDR` and
   `filterHitsByScore(FDR:protein)` → `protein_fdr_applied`. Else a warning "FDR:protein is set but the
   merged result has no decoy proteins…" and no protein FDR.
7. Finalization when the FDR was applied:
   - `remove_decoys == true` (the tool's path): `removeDecoyHits`, `removeEmptyIdentifications`,
     `removeUnreferencedProteins`, both `updateProteinGroups`, `removeDanglingProteinReferences`;
   - `remove_decoys == false` (the app's path, A-R8): the picked-protein FDR runs with
     `add_decoy_proteins = true` (otherwise `applyPickedProteinFDR` itself drops every decoy protein),
     so decoy proteins that pass keep their q-values; decoy PSMs stay; only `updateProteinGroups` and
     `removeDanglingProteinReferences` run. Target q-values and the target set are identical to the
     default path. A decoy without its target pair gets the nearest picked q-value (documented
     `add_decoy_proteins` behaviour). A PSM whose proteins were all filtered out keeps its hit without
     evidences.

The tool (`src/topp/ProSE.cpp`) calls it with the default; a nested try maps `InvalidValue` from the
merge to `INCOMPATIBLE_INPUT_DATA` (message ends with `e.what()`), everything else (also from the
store) to `CANNOT_WRITE_OUTPUT_FILE`. The tool keeps the `-test` basename rewrite and the idXML store.
Its `-out_merged` output is unchanged except for the `id_merge_index` fix in runs where a file failed.

Known pre-existing failure (parked, follow-up for #10602): with no PSM in any file,
`BasicProteinInferenceAlgorithm` throws `MissingInformation: Graph empty. Build it first.`; the tool
failed the same way before the move. The binding returns an empty result instead.

### 3.3 Per-file progress label contract

The multi-file `searchWithModificationAnalysis` (non-chunked branch) wraps each file in
`startProgress(0, 1, "Searching <basename> (<i+1> of <n>)...")` with an `OnScopeExit` that calls
`endProgress()`. The contract (A-R6, as documented in the header):

- one such start per file, in input order, identified **by its label**;
- every start of a per-file step is balanced by its end, also when the file's search fails or throws;
  the steps nested inside are not exception-safe;
- the inner steps are one level deeper (depth 1) **only with one OpenMP thread**:
  `ProgressLogger::recursion_depth_` is an unsynchronized static shared with the background mzML
  reader, and drifts with threads;
- chunk-major searches (`database:chunk_size` > 0 with a larger database) emit **no** per-file step
  (A-R7): they search all files per chunk.

The early index build that overlaps reading the first file now runs inside the first file's step.

### 3.4 `peptdeep_nce`

`PeptDeepRescoring::annotate()` stores the NCE each run's predictions used (calibrated, or `nce` when
set) as a double run meta value `NCE_META_VALUE` on every annotated `ProteinIdentification`; runs
without PSMs get none. In the unmatched-identifier fallback (features on `protein_ids[0]`) the value is
written only if all runs agree. Consumers treat a missing value as "use the default NCE". Read it from
the per-file runs **before** `mergeFileResults()` moves the identifications out.

### 3.5 Tests

- TOPP (`src/tests/topp/CMakeLists.txt`, "Test 13", A-R3/A-R4):
  `TOPP_ProSE_13_merged_inputs` (copies `THIRDPARTY/DatabaseSuitability_in_spec.mzML` to
  `ProSE_13_a.mzML` / `ProSE_13_b.mzML` via `ProSE_13_prepare.cmake`), `TOPP_ProSE_13_merged`
  (`ProSE -test -ini ProSE_6_fdr.ini -Search:FDR:protein 0.05 -in a b -database
  DatabaseSuitability_database.fasta -out_merged …`, Percolator on), `_info` (FileInfo `-out_tsv`,
  `PASS_REGULAR_EXPRESSION "runs: +1[^0-9]"`), `_info_proteins` (`-absdiff 1`), `_info_psms`
  (`-absdiff 6`), `_structure` (`check_file_contains.cmake`: q-value protein scores, Percolator run,
  no `target_decoy` decoy, no `DECOY_` accession). Reference `ProSE_13_merged_info.tsv`: 1 run,
  47 proteins, 1790 PSMs, 895 distinct peptides. With decoys kept: 49 proteins (2 decoys), 1792 PSMs.
- The exact 6.7 MB golden idXML (`ProSE_13_merged_golden.idXML`) was kept only locally for the
  byte-for-byte refactor check (identical apart from the run date); it lives in the git-ignored A
  workspace and will be deleted with it.
- Class tests in `ProSEAlgorithm_test.cpp`: pooling with protein FDR; same basename in two
  directories; rescored-only-some; failed files (incl. `[ok, failed, ok]` → indices {0, 2}); no
  decoys; keeps decoys when asked; wrong input list; single file keeps its run; progress (one thread,
  default threads, failed search, throwing file; depths relative). `PeptDeepRescoring_test.cpp`:
  recorded NCE (fixed 30, auto, disjoint grids, fallback) and `NCE_META_VALUE == "peptdeep_nce"`.
- Final: `ctest -R "ProSE|PeptDeep"` 80/80 on Linux release (ProSEAlgorithm_test ≈ 91–95 s).

---

## 4. Engine API (part B, PR #10604)

Package in the app: `app/public/openms/`, version **`3.7.0-pre.d2a798a00d`** (`package.json`; the
module's own `getVersion()` says `3.7.0-pre-claude-wasm-prose-app-bindings-2026-10-17`). It was built
before B8; B8's fixes are not in the app's package yet (a new package copy follows B9). All shapes below
are verbatim from that package's `openms.d.ts` (identical to the build's apart from B9's additions,
§4.11). Embind names parameters `_0, _1, …`; `EmbindString` is a string.

### 4.1 Functions and classes

```ts
// module
hasONNXRuntime(): boolean;
getThreadingInfo(): ThreadingInfo;            // { threaded: boolean; available: boolean; numThreads: number }
getMemoryInfo(): MemoryInfo;                  // { heapSize: number; heapMax: number }
getVersion(): string; getRevision(): string;
setLogEnabled(_0: EmbindString, _1: boolean): void;   // the app: setLogEnabled("info", false)
mountHostDirectory(_0: EmbindString, _1: EmbindString): void;   // Node.js only
annotatePeaks(_0: ArrayLike<number>, _1: ArrayLike<number>, _2: EmbindString, _3: number, _4: AnnotationOptions): PeakAnnotationResult;
predictMS2(_0: EmbindString, _1: number, _2: number, _3: EmbindString): PredictedIon[];
predictMS2(_0: EmbindString, _1: number, _2: number, _3: EmbindString, _4: string | null | undefined): PredictedIon[];

export interface ProSEAlgorithm extends DefaultParamHandler {   // new OpenMS.ProSEAlgorithm()
  annotatePsmQValues(_0: PeptideIdentificationList): void;
  searchFiles(_0: string[], _1: EmbindString): ProSEResultSet;
  setProgressCallback(_0: ((progress: { event: 'start' | 'progress' | 'end'; label: string; depth: number; begin: number; end: number; value: number; /** position of the input file being searched (its step 'Searching <name> (<i> of <n>)...': i - 1), -1 outside a file */ file: number }) => void) | null | undefined): void;
  search(_0: EmbindString, _1: EmbindString, _2: ProteinIdentificationList, _3: PeptideIdentificationList): ProSESummary;
  search(_0: EmbindString, _1: EmbindString, _2: ProteinIdentificationList, _3: PeptideIdentificationList, _4: ProSEOptions): ProSESummary;
  searchFiles(_0: string[], _1: EmbindString, _2: ProSEFilesOptions): ProSEResultSet;
  // from DefaultParamHandler: getDefaults(): Param (getEntries(): ParamEntry[]), getParameterValues(), setParameterValues()
}

export interface ProSEResultSet extends ClassHandle {             // delete() from ClassHandle
  storeIdXML(_0: EmbindString): void;
  _debugSetNativeId(_0: number, _1: EmbindString): void;          // tests only (B-R2)
  summary(): ProSEMultiSummary;
  tables(): ResultTables;
  spectra(): StoredSpectra;
}
```

### 4.2 Types (verbatim)

```ts
export type ParamEntry = { name: string; value: ParamValue; type: 'string' | 'int' | 'double' | 'bool' | 'string[]' | 'int[]' | 'double[]' | 'empty'; description: string; tags: string[]; validStrings?: string[]; min?: number; max?: number };

export type ProSEOptions = { /** Percolator rescoring: sets the parameter 'rescore' for the call (default: the parameter, true) */ rescore?: boolean } | null | undefined;

export type ProSEFilesOptions = { /** Percolator rescoring of each file: sets the parameter 'rescore' for the call (default: the parameter, true) */ rescore?: boolean; /** keep the peaks of the identified spectra with the results (default true) */ keepSpectra?: boolean; /** with the protein FDR, remove the decoy PSMs and proteins from the pooled results, as the ProSE tool's -out_merged does (default false: keep those that pass) */ removeDecoys?: boolean } | null | undefined;

export type ProSEFileSummary = { path: string; status: 'EXECUTION_OK' | 'INPUT_FILE_EMPTY' | 'UNEXPECTED_RESULT' | 'ILLEGAL_PARAMETERS' | 'UNKNOWN_ERROR'; ms2Spectra: number; targetPSMs: number; decoyPSMs: number; percolator: { applied: boolean; skipped: string | null; warning: string | null } | null; peptdeepNce: number | null; secondsSearch: number };

export type ProSEMultiSummary = { files: ProSEFileSummary[]; proteinFdrApplied: boolean; psmFdr: number; proteinFdr: number; decoyString: string; openSearch: boolean; modificationAnalysis: ProSESummary['modificationAnalysis'] };

export type ResultTables = {
  files: string[];                                   // the input files, in the order of the search
  psms: { count: number; file: Uint16Array; nativeId: string[]; rt: Float64Array; mz: Float64Array; charge: Int8Array;
          peptide: Uint32Array; score: Float64Array; qValue: Float64Array; pep: Float64Array; precursorErrorPpm: Float64Array;
          isotopeError: Int8Array; deltaMass: Float64Array; decoy: Uint8Array; featureNames: string[]; features: Float64Array };
  peptides: { count: number; openms: string[]; proforma: string[]; sequence: string[]; decoy: Uint8Array;
              modOffsets: Uint32Array; modPosition: Int16Array; modName: string[]; modUnimod: Int32Array; modMass: Float64Array;
              proteinOffsets: Uint32Array; protein: Uint32Array; start: Uint32Array; end: Uint32Array };
  proteins: { count: number; accession: string[]; description: string[]; sequence: string[]; score: Float64Array;
              qValue: Float64Array; decoy: Uint8Array; group: Int32Array };
};   // (the d.ts carries the field doc comments summarized in 4.4–4.6; shape unchanged)

export type StoredSpectra = { psmSpectrum: Int32Array; offsets: Uint32Array; mz: Float32Array; intensity: Float32Array; precursorMz: Float64Array; collisionEnergy: Float32Array };

export type AnnotationOptions = { tolerance?: number; unit?: 'Da' | 'ppm'; maxCharge?: number; ions?: ('a' | 'b' | 'c' | 'x' | 'y' | 'z')[]; losses?: boolean; precursor?: boolean } | null | undefined;

export type PeakMatch = { peak: number; ion: string; type: string; ordinal: number; charge: number; loss: string; theoreticalMz: number; errorPpm: number };

export type PeakAnnotationResult = { matches: PeakMatch[]; theoretical: { ion: string; type: string; ordinal: number; charge: number; mz: number }[] };

export type PredictedIon = { ion: string; type: 'b' | 'y'; ordinal: number; charge: 1 | 2; mz: number; intensity: number };
```

`ProSESummary['modificationAnalysis']` is the existing shape of #10575:
`{ deltaMasses: { totalPSMs; modifiedPSMs; unmodifiedPSMs; meanDeltaMass; medianDeltaMass; entries: { deltaMass; count; uniquePeptides; chargeStates; percentage; modification; known }[] }; ptms: { totalModifiedPSMs; unknownModificationPSMs; uniqueModifications; entries: { name; theoreticalMass; observedMass; massDeviation; count; uniquePeptides; chargeStates; percentage; targetResidues; residueCounts }[] } } | null`
(all numbers except `modification`/`name`/`targetResidues` strings, `known` boolean, `residueCounts`
a `Record<string, number>`).

The plan's contract had `percolator.seconds`; it was dropped (B-R8: the library rescores inside the
search and does not time it) and `warning` added. `removeDecoys` was added by B-R7.

### 4.3 `searchFiles()` semantics

- Validates: `files` is a non-empty array of distinct paths (repeated path → `IllegalArgument …
  '<path>' is given twice`: PSMs name their file by path); options is an object.
- Loads the FASTA once (`FASTAFile`) and runs the multi-file
  `searchWithModificationAnalysis(files, fasta_entries, {}, "", false)` with
  `build_pooled_aggregate = false` (one copy of the PSMs: `mergeFileResults` pools by moving).
- `rescore` sets the ProSE parameter `rescore` for the call only (RAII `RescoreOverride`, restored also
  on a throw); without it the parameter decides (default true). `search()` uses the same helper
  (B1: the old binding rescored a second time).
- Per OK file: sets `SearchParameters::db`, reads `NCE_META_VALUE` from the file's own run, calls
  `updateFinalStats`. Collects the union of the runs' `extra_features`.
- Then `mergeFileResults(result, files, removeDecoys)` with `removeDecoys` default **false** (the app
  shows decoys; the tool and the reference test use true).
- Then, if `keepSpectra` (default true), reads the spectra of the PSM rows (§4.6).
- Modification analysis: the per-file one for one file, the aggregate for several (open search of two
  files: pooled `totalPSMs` = 2 × one file, tested).
- No PSM in any file → an empty result, no error: tables of count 0, `targetPSMs`/`decoyPSMs` 0
  (`ms2Spectra` still counts), `proteinFdrApplied` false, empty idXML.
- Percolator needs decoys and ≥ 100 PSMs per file. Rescored-only-some throws `InvalidParameter:
  Percolator rescored only some of the input files, … (not rescored: <path> (<reason>)). Search the
  files with { rescore: false }, …`. The app maps this message (§5.3.6).
- `JSProgressLogger` is reset at the start of every `search()`/`searchFiles()` (a registry from
  `ProgressLogger*` to its JS logger), so a search that threw inside a nested step does not shift the
  next search's steps (B2 fix round).

### 4.4 Progress

Reports of `setProgressCallback()` are `{ event, label, depth, begin, end, value, file }`.

- `JSProgressLogger` keeps its **own stack** of the owner thread's open steps (push on start, pop on
  end) and reports the innermost step's label, `begin`/`end` and its own `depth`; it never reads
  ProgressLogger's depth (B-R6 and the A note). Progress and end events carry the step's label. Steps
  started on other threads are ignored.
- `file` comes from the label `"Searching <name> (<i> of <n>)..."` (parsed from the end, so names with
  ` (` work): `i − 1`, kept until the next such label; −1 before the first, after the last file's step
  ends, and for top-level steps that do not match (B-R5).
- Order of depth-0 steps: one per file, then `"Reading the spectra of the PSMs..."` with `file` −1
  (only with `keepSpectra` and some wanted row), range 0..Σ `ms2Spectra` of the files with wanted rows,
  `setProgress` every 256 spectra, clamped (B-R18).
- Chunked searches: no per-file step, `file` −1 throughout.
- Percolator (≈ 10 s per file pass on the test data) sends no progress; the bar stands after
  "Post-processing PSMs...".
- OpenMS forwards `setProgress` at most once per second; short steps report only start and end.

### 4.5 `tables()` semantics

Copies in new JS typed arrays (`new T(n).set(typed_memory_view)`); string columns are joined with
`\n` and split in JS (per-string fallback if a string contains a line break). Not const-cached: each
call builds new copies. ≈ 20 ms steady for 896 PSMs (≈ 2 s per 100k PSMs extrapolated, not measured).

**Rows and indices.**
- `psms`: one row per PeptideIdentification with hits, its best hit, in pooled order (= the stored
  idXML's order). `file` = `id_merge_index` (index into `files`, the input order). `peptide` indexes
  `peptides`.
- `peptides`: unique by `openms` (`AASequence::toString()`), in order of first PSM. `modOffsets` and
  `proteinOffsets` have `count + 1` entries (CSR).
- `proteins`: every protein hit of the pooled run, in its order. `group`: index in
  `getIndistinguishableProteins()`, −1 if none.

**NaN / −1 / 0 conventions.**

| Column | Absent value |
|---|---|
| `psms.rt`, `psms.mz`, `precursorErrorPpm` | NaN |
| `psms.qValue` | NaN when there is no FDR (no decoys) |
| `psms.pep` | NaN without rescoring |
| `psms.deltaMass` | NaN in a closed search |
| `psms.isotopeError` | **0** (Int8 has no NaN); normalized to observed − theoretical |
| `features[i*F+j]` | NaN |
| `peptides.modUnimod` | −1 (no Unimod accession) |
| `proteins.score` | NaN without PSMs |
| `proteins.qValue` | NaN when protein FDR was not applied |
| `proteins.sequence` | `''` if unknown |
| `proteins.group` | −1 |
| `peptides.start/end` | 0, 0 if no position was recorded |

**Scores (B-R10).** `psms.score` = Percolator's SVM score (`percolator_score`/`MS:1001492`) when the
PSM was rescored, else ProSE's ln(hyperscore); higher is better. A hit of a rescored file that
Percolator could not rescore has −100 with q-value and PEP 1 (filtered at any FDR).
`proteins.score` = the best `psms.score` of the protein's PSMs (not the run's protein score, which is
the q-value after picked FDR). `qValue` is the main score if its type is q-value, else
`percolator_q_value`/`MS:1001491`/`q-value`.

**Features (B-R11).** `featureNames`: `ln(hyperscore)` first, then the standard .pin features
Percolator trains on (`CalcMass`, `mass`, `peplen`, `charge<N>` for the search's precursor charges
widened to the PSMs', `enzN`, `enzC`, `enzInt`, `dm`, `absdm`; computed by
`PercolatorInfile::stampPinFeaturesOnHits` on copies of the best hits, 4096 at a time, with
`ProSEAlgorithm::pinEnzymeName()`; also without rescoring), then the runs' `extra_features`, then
PeptDeep's (`ms2_cosine`, `ms2_spectral_angle`, `ms2_pearson`, `ms2_frac_pred_found`,
`rt_abs_error`); a name is kept only if some PSM has a numeric value. `features` is row-major
`count × featureNames.length`. The `isotope_error` feature is raw; the column is normalized.

**Modifications, ProForma, deltaMass (B-R12).**
- `modPosition`: −1 = N-terminus, `sequence.length` = C-terminus, else the 0-based residue. `modName`
  = `ResidueModification::getId()`, else `getFullName()` (mass-only `[+42.0106]`), else full id.
  `modMass` = `getDiffMonoMass()`.
- `proforma`: OpenMS `ProForma::fromAASequence()` with Unimod accessions replaced by Unimod names:
  `AVM[Oxidation]DDFAAFVEK`, `[Acetyl]-DAHKSEVAHR`, `PEPTIDER-[Amidated]`; others as mass deltas;
  **fixed modifications included**.
- **It never carries the unlocalized open-search shift**, which is per PSM. Consumers compose
  `[+Δ]?` + proforma from `psms.deltaMass`, signed, e.g. `[-57.0215]?PEPTIDEK`, only when
  `Number.isFinite(d) && Math.abs(d) > 0.05` (ProSE counts |Δ| ≤ 0.05 Da as unmodified,
  `DELTA_MASS_ZERO_THRESHOLD_` in `OpenSearchModificationAnalysis.h`, = `unmodifiedPSMs`); the shift
  of an unmodified open-search PSM is its precursor mass error (a few mDa).

**Protein references.** One per PeptideEvidence of the peptide's first PSM whose protein is a hit of
the run (a peptide occurring twice in a protein is listed twice). `start` 0-based, `end` exclusive into
`proteins.sequence`: the recorded position if the sequence has the peptide there, else its first
occurrence; if the sequence is unknown or lacks it, the recorded position (may exceed the length).

**Protein-less peptides (B-R28).** `proteinOffsets[k] === proteinOffsets[k+1]` means all proteins of
the peptide fell below the protein FDR (the PSMs stay; 19 of 967 peptides in the final review's test).
The app shows "below protein FDR" and counts them for no protein.

**Decoy sequences (B-R13).** `proteins.sequence` is the sequence as searched: FASTA decoys from the
FASTA; decoys ProSE generated are regenerated in the binding with ProSE's rule
(`DecoyGenerator::reversePeptides` with the search's enzyme, `reverseProtein` for
`peptide:enzyme_specificity none`, initial M kept with `peptide:clip_nterm_methionine`), a copy of the
private `ProSEAlgorithm::buildDecoyAugmentedDB_` marked "keep in sync". Tests slice every peptide,
decoys included.

### 4.6 `spectra()` semantics (B-R16, B-R17, B-R18)

- Collected eagerly at the end of `searchFiles` (the files are guaranteed present), one file at a time,
  MS level 2 only (`PeakFileOptions::setMSLevels({2})` plus a check), reader sorting off, peaks sorted
  by m/z in the consumer if needed; float32; stored in 1 Mi-value blocks (`BlockVector`).
- **Selection**: a PSM row keeps its spectrum if `qValue <= FDR:PSM` (decoys included), or `FDR:PSM`
  is 0 (no filter: all rows), or `qValue` is NaN. Rows with an out-of-range file index get none.
- **Dedupe** by (file, native ID): PSMs of one spectrum share its index. Spectra are numbered by file,
  then file order.
- **−1** where `keepSpectra` is false, the q-value is above `FDR:PSM`, the file has no MS2 spectrum
  with that native ID (or it is MS1), the file has several spectra with that native ID and not exactly
  one within 1e-6 s of the PSM's RT, or the file could not be read again (a warning; the result is not
  lost). Unreferenced spectra are then dropped and renumbered.
- `precursorMz`: m/z of the first precursor, NaN if none. `collisionEnergy`: the first precursor's
  activation energy, NaN if none or ≤ 0. **Known gap**: typical mzML stores MS:1000045 as the precursor
  meta value "collision energy", not as activation energy, so it is NaN there (final fix wave,
  planned).
- `keepSpectra` false: `offsets = [0]`, empty arrays, `psmSpectrum` all −1.
- `spectra()` throws `Postcondition` if the row count disagrees (unreachable from JS).
- Measured: 214 B/PSM at 24 peaks per spectrum (DatabaseSuitability); typical Orbitrap HCD spectra
  (100–500 centroids) would be 0.8–4 KB/PSM against the design's budget of ~1 KB/PSM. Re-reading costs
  ≈ 47 ms/MB threaded, 21 ms/MB single-threaded (≈ 9 s/GB in the final review's measurement).

### 4.7 `annotatePeaks()` semantics (B-R19, B-R20)

`annotatePeaks(mz, intensity, peptide /* peptides.openms */, charge, options)`; `ArrayLike<number>`
(Float32Array, `subarray` of the stored arrays, or plain arrays). `options` is required by the
declaration but not checked at runtime (built without assertions); pass `null` for the defaults:
tolerance 0.02 Da, `maxCharge` = precursor charge − 1 (at least 1), ions `['b','y']`, no losses, no
precursor peaks. Shares `alignFragments()`/`theoreticalFragments()` with `annotateSpectrum` (no code
copy; `annotateSpectrum` unchanged).

- `peak` = index into the arrays **as passed** (the sorted copy is mapped back).
- `ion`: `b3`, `y5++` (one `+` per charge, none at charge 1), `y7-H2O++`; precursor `[M+2H]++`,
  `[M+H-NH3]`. `type` `a`..`z` or `precursor` (ordinal 0). `loss` `''` or a formula: `H2O`, `NH3`,
  `H3PO4`, `HPO3`, others as TSG's empirical formula without counts of 1 (`CH4OS`).
- `errorPpm = (observed − theoretical) / theoretical × 1e6`, always ppm whatever the tolerance unit.
- `theoretical`: every generated ion (charges 1..maxCharge) by ascending m/z, matched or not.
- **Matching per unit**: in **ppm** each ion takes its closest peak within tolerance, so several ions
  can share one peak (e.g. `z1++` and `y1-NH3++`), and of equal-m/z peaks the first in the arrays wins;
  in **Da** the alignment is one to one in m/z order (of two ions of one m/z one is left out unless
  there are two peaks), and which of equal-m/z peaks is taken is unspecified. Consumers group labels
  by peak and never key a map by `peak` alone.
- Precursor peaks only at `maxCharge` (inherited). For the mirror plot the app passes `maxCharge` 2
  (B-R29), matching predictMS2's 1+/2+ fragments.
- Errors: `charge < 1` → `InvalidValue`; empty peptide → `InvalidValue`; syntax error → `ParseError`
  ("Parse Error: Cannot convert string to amino acid sequence…"); unknown residue → `InvalidValue`;
  arrays of different length → `IllegalArgument`; non-finite m/z → `InvalidValue`.

### 4.8 `predictMS2()` semantics (B-R22, B-R23)

ONNX builds only; without ONNX Runtime both overloads throw `IllegalArgument` "predictMS2: this OpenMS
module was built without ONNX Runtime".

- Inputs: peptide (OpenMS string, parsed with `fromString`, passed as `toString()`), precursor charge,
  NCE raw as `peptdeep:nce` takes it (e.g. 30; not /100), instrument via `ML::instrumentIndex`
  (case-insensitive; `QE`, `Lumos`, `timsTOF`, `SciexTOF`, `ThermoTOF`; anything else, also `''`, is
  peptdeep's catch-all slot). `modelPath` default `/models/peptdeep_ms2_dynamic.onnx`;
  `undefined`/`null` select the default; a non-string throws `InvalidValue`; `''` is a path.
- Output: only `b`/`y` without modloss. **Orientation**: cleavage `pos` (0-based, N→C) carries
  `b(pos+1)` and `y(len−1−pos)`, 8 channels per cleavage
  `[b_z1, b_z2, y_z1, y_z2, b_modloss_z1, b_modloss_z2, y_modloss_z1, y_modloss_z2]`, strict check
  `flat.size() == 8 × (len − 1)` (`Postcondition`). Pinned by a proline-effect test (strongest y1+ at
  the proline: AGLQFPVGR → y4, VEADIPGHGQEVLIR → y10, ELPEHTVK → y6).
- Charge-2 fragments only for precursors of charge ≥ 2.
- **Scaling**: the returned candidates are divided by their maximum (exactly 1.0), then ions ≤ 0.01
  are dropped; `[]` if nothing positive. Intensities are relative to the most intense **returned**
  b/y ion (for a 1+ precursor the model's own maximum may lie in a dropped channel).
- `mz` from TheoreticalSpectrumGenerator with the peptide's modifications; result sorted by ascending
  m/z. A one-residue peptide gives `[]` (after the model loads).
- Session cache: function-local static map per model path under a mutex; never evicted (tens of MB per
  path; a re-mounted path keeps answering from the first file); a failed load is not cached.
- Timing (Node, 128 threads): first call ≈ 0.5 s (starts ORT's global pool, loads the model), next few
  tens of ms (up to ~0.1 s for a new peptide length), later ≈ 3 ms. Call it early to hide the start.
- Errors: missing model `FileNotFound`; charge < 1 or non-finite NCE `InvalidValue`; peptide errors as
  in 4.7. Charge/NCE range checks are planned (B-R29: model range, else charge 1–6, NCE 10–60).

Example (AVM(Oxidation)DDFAAFVEK, 2+, NCE 30, QE): 13 ions; by m/z the first is `y1` (147.1128,
0.628), then `b2` (171.1128, 0.889); the base peak is `y9` (1041.4888).

### 4.9 Errors

- OpenMS exceptions become JS `Error`s whose message names the exception (`ParseError: …`,
  `InvalidValue: …`; `ParseError` prints as "Parse Error: …"). `OutOfMemory` is an OpenMS exception
  and the module lives on.
- WebAssembly traps (`RuntimeError: unreachable`, `memory access out of bounds`, `Aborted(OOM)`) end
  the module; the app restarts the worker (§5.2).
- `_debugSetNativeId(row, …)` out of range → `IndexUnderflow`/`IndexOverflow`.

### 4.10 Memory behaviour

| Topic | Fact |
|---|---|
| Address space | wasm32, `-sMAXIMUM_MEMORY=4GB`, `-sINITIAL_MEMORY=64MB`, `-sALLOW_MEMORY_GROWTH=1` (hence `ABORTING_MALLOC=0`), geometric 20 % growth steps, memory never shrinks; `-sMALLOC=mimalloc` (mimalloc 3.5.1 in Emscripten 6.0.12); 8 MB stack (`OPENMS_WASM_STACK_SIZE`), also per pthread |
| Inputs | WasmFS memory backend = inside the heap, for the whole `searchFiles` (spectra re-read at the end): 2 × 733 MB → 3173 MB heap; a third does not fit (B final review, Critical 1). B9 (in progress) changes this |
| Result set | holds pooled identifications, FASTA entries and the float32 peaks until `delete()` |
| Heap growth per search | pre-existing, mimalloc, not fixed: ≈ 30 MB per file and search at 4 threads (B2: `search()` 346 → 844 MB over 20 rounds), +116…212 MB per search at 8 threads without PeptDeep (B8); flat at 1 thread. The app starts a **fresh worker per search** (B-R9, C-R13), so it matters only within one multi-file search |
| PeptDeep (B8, done) | root cause: ONNX Runtime has no CPU arena on 32-bit (`DoesCpuAllocatorSupportArenaUsage()`), its memory pattern allocates a per-shape block (up to 24 MB) on every Run, and mimalloc never reuses freed >4 MiB blocks (needs fully free chunks; arenas never released, reserves double every 8 arenas). Fix: `[FIX] ONNXPredictorBase` `DisableMemPattern()` (all platforms; bit-identical, natively lower peak), `[FIX] PeptDeepRescoring` NCE selection predicts each distinct (sequence, charge) of its sample once, `[FIX] ProSEAlgorithm` `peptdeep:batch_size` default **128** under `__EMSCRIPTEN__` (native stays 500; visible in `getDefaults()`). Results: 3 × erwinia `search()` 1414 → 2345 → 4096 MB before, 979 → 1175 → 1387 after; `searchFiles` erwinia × 3 4032 → 1447 MB; big733 completes at 2311 MB; PeptDeep steps grow 0 after the first; one-off ≈ 110–230 MB for ORT's pool threads; features bit-identical; PeptDeep time 11.4 → 11.15 s (erwinia), 24.6 → 7 s (big733) |
| Rejected mitigation | mimalloc `arena_max_object_size` 4 MiB: fixed the heap but aborts at 128 threads (OS fallback over-aligns to 16 MiB, each 8 MB stack costs ~24 MB) |
| WasmFS (emscripten#27825) | Emscripten 6.0.12's `_wasmfs_node_open` returned a failed open's errno (ENOENT = 44) as a positive number, taken as a file descriptor; WasmFS then read and closed descriptor 44 of the Node process (a pthread Worker's epoll/io_uring fd) → `uv__io_poll: Assertion 'errno == EINTR'` abort at exit in ~1 of 4–5 threaded test runs. Fix `src/openms_wasm/wasmfs_node.js` (`--js-library`, `SHELL:` link option, `#if ENVIRONMENT_MAY_BE_NODE`, `#warning` unless `EMSCRIPTEN_VERSION == "6.0.12"`) returns the negative errno for open and close (B-R25). Rates 7/25 → 0/25, CI-like 4/20 → 0/20, repro 10/10 → 0/10. Stricter now: `FS.writeFile` of a read-only host file traps instead of writing to stderr |
| idXML | `storeIdXML` writes through C++ streams into a doubling memory file (up to ~3× its size briefly); the app reads it back in 16 MB pieces (`FS.read` is fast), not `FS.readFile` (thread_local full-size buffer) |
| JS ↔ heap staging | `FS.write` copies byte by byte (≈ 21 MB/s Node, ≈ 25 MB/s Chromium); `FS.writeFile`/`FS.write` do not check `_malloc` (OOM writes from address 0). B9 (in progress) adds guards and fast chunk bindings |
| Node stacks | Node defaults to all logical cores (128 here): 8 MB per pthread for OpenMP and as many for ORT's pool, ~2 GB of stacks; tight but passing |

### 4.11 In progress (B9): search inputs that do not fit in the heap

Base 006a261fb3, uncommitted in `/scratch/sachsenb/openms-pr10564`; may still change.

- **Spike (Chromium 141 in the SIF, 4 threads, closed search, no PeptDeep)** chose per-file streaming
  **S** by the brief's decision rule (O must be ≤ 1.3 × M search time and ≤ one-file heap + 300 MB for
  two files):

  | Candidate | Input | Staging (s) | Search (s) | Heap after (MB) |
  |---|---|---|---|---|
  | M (memory) | erwinia_tmt 78 MB | 3.95 | 3.22 | 899 |
  | O1 (OPFS, Blob reads) | erwinia_tmt | 0.23 | 78.9 | 803 |
  | O2 (OPFS, sync access handles) | erwinia_tmt | 0.26 | 4.54 | 803 |
  | M | big733 × 1 | 38.5 | 13.7 | 2569 |
  | M | big733 × 2 | 99.5 | 23.6 | 3969 |
  | O2 | big733 × 1 | 1.58 | 35.3 | 1361 |
  | O2 | big733 × 2 | 3.01 | 65.4 | 1521 |

  O2/M = 2.58 (big733), 1.41 (erwinia) > 1.3; the heap rule held (+160 MB). So **S**.
- **Shape in the working tree** (not final): `searchFiles` options `provideFile(i, path)` (writes file
  *i* before its search) and `releaseFile(i, path)` (removes it after); each file is then searched
  alone inside its own "Searching <name> (i of n)..." step (the nested "(1 of 1)" step is hidden), its
  spectra read right away (`collectSpectraOfFile`), and the files pooled as `mergeFileResults` does
  (open search: the pooled modification analysis). JS exceptions from the callbacks are caught and
  rethrown as OpenMS exceptions. New module functions `writeFileChunk(path, data: Uint8Array, offset)`,
  `readFileChunk(path, offset, length): Uint8Array`, `allocateFile(path, size)` (one allocation up
  front; `OutOfMemory` if the heap cannot hold it); new `src/openms_wasm/wasmfs_fs.js` overriding
  `FS.writeFile`/`FS.write`/`FS.read` to throw ENOMEM (errno 48) when `_malloc` fails, and `FS.write`
  with one typed-array `set` (Ruling 30: target ≥ 200 MB/s).
- Remaining B9 acceptance: two big733 copies within the heap rule; 4 × big733 (2.9 GB) completes in
  Chromium; both Node suites; a browser test; the malloc guard test; README (storage modes, quota,
  cleanup, locking); per-file heap growth measured in 4 × big733 and, if it limits, `-sMALLOC=dlmalloc`
  or emmalloc evaluated (B-R31).

### 4.12 Planned: B final fix wave and final re-review

After B9 (sequential: shared build dirs): Important 3 (`collisionEnergy` from the precursor meta value
"collision energy", MS:1000045), Important 4 (document protein-less peptides, B-R28), the B-R29 minors
(annotate PSM q-values when `FDR:PSM` is 0 and decoys exist, no filtering; predictMS2 charge/NCE range
checks; `search()` passes `percolator.warning`; `ProSEMultiSummary` gains index size, seconds, decoy
mode, recommended tolerances; document the annotatePeaks `maxCharge` default vs predictMS2's 2+), the
B8 deferred minor (shared constant `ML::PEPTDEEP_DEFAULT_BATCH_SIZE`, 128 wasm / 500 native, used by
ProSEAlgorithm, PeptDeepRescoring and the inference constructors), then one final re-review; #10604
stays draft until then.

### 4.13 Test suites of part B

`src/openms_wasm/tests/*.test.mjs` (`node --test`). At B8 (006a261fb3): mt-onnx 81 tests, 76 pass,
5 skipped (4 package-layout tests without `OPENMS_WASM_PACKAGE`, "throws without ONNX Runtime");
single-threaded release 81 tests, 66 pass, 15 skipped (package, ONNX-only, threads-only). Notable
tests: pooling vs `ProSE_13_merged_info.tsv`; per-file progress; same-name files; open search of two
files; empty results; mixed rescoring; progress after a throwing search; tables consistency (row by
row against the stored idXML); terminal modifications (synthetic spectra: `[Acetyl]-…`,
`…-[Amidated]`, `M[Oxidation]` Unimod 35); unspecific-search decoys; five spectra tests; four
annotatePeaks tests plus ppm/Da/equal-m/z pins; six predictMS2 tests plus the proline test; WasmFS
deleted-file and close tests (`io.test.mjs`); "repeated PeptDeep searches do not grow the heap per
file (ONNX Runtime)" (2 searches, bound 400 MiB) and "peptdeep:batch_size is 128 by default".

---

## 5. App (part C)

`/scratch/sachsenb/prose-pages/app`, branch `prose-app`. Stack (C plan, installed versions from
`npm ls`): Svelte 5.57.2 (runes), Vite 8.3.4, @sveltejs/vite-plugin-svelte 7.3.1, TypeScript 6.0.3,
Tailwind CSS 4.3.3 (`@tailwindcss/vite`), shadcn-svelte 1.7.0 (bits-ui 2.19.5, style "vega", base
colour zinc, Inter via `@fontsource-variable/inter`, lucide icons), vitest 5.0.5, svelte-check 4.7.7,
@playwright/test 1.56.1 (exact pin, the SIF's browsers); since C11 fflate 0.8.3 and idb-keyval 6.3.0
(runtime dependencies). The plan's TanStack table/virtual are **not** dependencies: the table
virtualization is hand-written (`virtual.ts`).

### 5.1 Structure

| Area | Files |
|---|---|
| Shell | `src/main.ts`, `src/App.svelte`, `src/app.css` (body 13px/1.45, `--text-sm` 0.8125rem), `lib/route.ts` + `lib/route.svelte.ts` (`navigate()`, hash `#/search`, `#/results/<id>`, `#/history`; unknown hashes rewritten with `replaceState`), `lib/components/TopBar.svelte`, `lib/debug.ts` (the one `?debug=` parser: `engine`, `wasm64`, `large`, `large1`, `dense`, `small`) |
| Design | `lib/design/model.ts`, `design-tsv.ts`, `sdrf.ts`, `paste.ts`, `tsv.ts` |
| Formats | `lib/format/peptide.ts`, `fdr.ts`, `bytes.ts`, `settings.svelte.ts`; `components/PeptideSequence.svelte`, `FdrInput.svelte` |
| Engine | `lib/engine/openms-types.ts` (the only file that names the package; re-exports the d.ts types), `protocol.ts`, `core.ts`, `worker.ts`, `client.ts`, `app-engine.svelte.ts`, `variant.ts` (the two module builds: the Memory64 test, the choice, §5.9) |
| Settings | `lib/settings/presets.ts`, `memory.ts`, `parameters.ts`, `modifications.ts`, `labels.ts` |
| New search | `views/NewSearch.svelte`; `components/search/*` (DesignTable, DesignCell, DatabaseCard, SettingsCard, AllParametersDialog, RescoringCard, SearchFooter, PlanLine, SearchProgress, SearchError, SavePresetDialog, PasteDialog, EmptyState, Notice, NoticeList, ModificationsField, NumberField, RangeField, ToleranceField, ParameterField, ChoiceSelect); `lib/search/form.svelte.ts`, `session.svelte.ts`, `plan.svelte.ts`, `failure.ts`, `files.ts` |
| Results | `views/Results.svelte`; `components/results/*` (DataTable, ProteinsTable, PeptidesTable, PsmsTable, FilterBar, ColumnsMenu, KeyFigures, ExportMenu, ProteinRefs, Marker, `cells.ts`); `lib/results/model.ts`, `filters.ts`, `columns.ts`, `csv.ts`, `view.svelte.ts`, `table-columns.ts`, `display.ts`, `figures.ts`, `virtual.ts`, `exports.ts`, `synthetic.ts`, `debug-result.ts`; `lib/download.ts` |
| Service worker (C12) | `public/sw.js`, `lib/sw-client.ts` (+ test), `sw-stamp.ts` (build: ids, shell and data lists, the page's build meta), `e2e/deploy.spec.ts` + `e2e/pages-server.ts`, `src/globals.d.ts` (`__OPENMS_ID__`); site: `.github/workflows/pages.yml`, `.github/assemble-site.sh` |
| Static | `public/openms/` (the module package, wasm32, with the PeptDeep models), `public/openms64/` (the 64-bit module package, §5.9), `public/example/DatabaseSuitability_in_spec.mzML` + `DatabaseSuitability_database.fasta`, `public/fasta/crap.fasta` (OpenMS's cRAP copy, 116 entries, md5 77d6226971ab42fa7d3727668bebc707, C-R3) |

Config: `vite.config.ts` (`base: process.env.VITE_BASE ?? '/prose-web/'`, `$lib` alias, COOP/COEP on
`server` and `preview` (`PROSE_PREVIEW_ISOLATION=off` drops them for `preview`), `define`
`__OPENMS_ID__`, the service-worker stamping plugin), `vitest.config.ts` (node environment, `src/**/*.test.ts`; Svelte resolves to
its server build there, so runes/effect-root behaviour is covered only by e2e), `playwright.config.ts`
(chromium only, `vite preview` on 127.0.0.1:4173 with the isolation headers and on 4174 without
them (`deploy.spec.ts`), baseURL `/prose-web/`, `serviceWorkers: 'block'` except in `deploy.spec.ts`,
`reuseExistingServer` unless CI). Scripts: `dev`, `build`, `preview`, `test` (vitest run), `e2e` (playwright test, does not
build first), `check` (svelte-check + `tsc -p tsconfig.node.json`).

Look: shadcn zinc theme, light first; no images or decoration. Colours: b ions `#2a78d6`, y ions
`#eb6834`, unmatched `#a1a1aa`, modified residue `#1baf7a` (background `#d7f5ea`, text `#065f46`).
Units: binary throughout (1 GB = 2³⁰ B, matching the 4 GB limit; the example mzML reads 6.2 MB).

Mockups (static HTML with invented data, `superpowers/specs/2026-10-16-prose-app-mockups/`, each with a
PNG; layout and behaviour count, numbers do not; `style.css` holds their look):

| Mockup | Screen | Built by |
|---|---|---|
| `1-new-search` (+ `1b-fdr-fields`) | New search; FDR fields | C6 (done) |
| `2-results-proteins` | Results, Proteins tab | C7 (in review) |
| `3-psm-spectrum` | PSM view | C9 (planned) |
| `4-protein-drilldown` | Protein panel | C8 (planned) |
| `5-modification-encoding` | Option A marked residues (chosen default), option B ProForma (the switch) | C3 (done) |

### 5.2 Engine client and worker (C4, C4b)

- **One `EngineClient` per app** (`app-engine.svelte.ts`), `startTimeoutMs` 180 000 until a module of
  that build has loaded once (first download of the 45 MB module; the 64-bit module's first load
  likewise), `restartTimeoutMs` 30 000 for every worker of that build after that; `?debug=engine` exposes it as `window.__engine` (no second client). OpenMS loads at app start
  (the status chip, parameter list and dialog need it). Workers are named `openms-search` and
  `openms-viewer`. Search threads: all cores (≤ 16) when cross-origin isolated, else 1.
- **Threads per search** (`threadsForSearch`, C4b): at most 4 (`MULTI_FILE_THREADS`) for more than 4
  files and for more than 2 files with PeptDeep; else all, in either module. (The cap for chunked
  semi-/non-specific searches is gone: decisions "W64 thread cap".) A search with other threads or
  another module than the current worker's gets a new worker. The progress shows the threads ("16
  threads", "4 threads (memory)" with a tooltip, `data-testid="search-threads"`) and, for a search in
  wasm64, "· 64-bit" (`data-testid="search-engine"`, with a title).
- **Module per search** (W64, §5.9): `SearchRequest.engine` (`'wasm32' | 'wasm64'`, from the plan's
  `chooseEngine`); the search worker's `init` gets `variant`, and the worker loads `openms/` or
  `openms64/` with that package's `?v=`. `EngineInfo` gains `variant` and `maxFileBytes`,
  `SearchOutcome` gains `variant`. Failures name the module: "The 64-bit engine could not be loaded
  (…)", "… did not start within … s"; out-of-memory advice "a search can use at most the 16 GB of the
  64-bit engine". Until the 64-bit engine has loaded once, its search's step reads "Loading the 64-bit
  engine…" (`EngineClient.hasLoaded`).
- **Fresh worker per search** (C-R13): `search()` starts a new worker unless the current one has run
  only init (and has the search's threads and module). The worker keeps the `ProSEResultSet` until replaced (idXML is stored lazily; `delete()` is
  pointless, memory never shrinks and the worker is discarded). `EngineClient.hasSearchResult` is false
  before a search, from the start of a new search, and after a trap.
- **Viewer worker** (C-R14): created lazily on the first `annotate()`/`predict()`, `VIEWER_THREADS` 2,
  always wasm32, needs no init, fetches the MS2 model lazily; restarts independently of the search worker. `idXML()`
  stays with the search worker.
- **Paths**: inputs `/input/<i>/<name>`, database `/input/db/<name>`; `/input` is removed after the
  search (the result set already holds the peaks) and cleaned before writing. After a fatal error
  (`isFatal`: a trap, an abort, a `WebAssembly.Exception`, anything not an `Error`) the module is not
  called again, not even to clean up (no `remove`, `releaseFile` cleanup or `delete()`; the worker is
  replaced); otherwise every cleanup is wrapped (`tryRemove`, `tryDelete`) so it cannot replace the
  error being handled.
- **Contaminants**: `withContaminants()` appends `public/fasta/crap.fasta` as a Blob, prefixing `CON__`
  to each accession unless present (`>CON__sp|ALBU_BOVIN|`), adding a newline if needed, no dedup.
- **Request mapping** (`searchSettings`): `rescore` → `searchFiles` option `{ rescore, keepSpectra:
  true }` (`removeDecoys` stays false); `peptdeep` → `peptdeep:enable` plus `peptdeep:ms2_model`/
  `rt_model` = `/models/<file>`. PeptDeep without ONNX Runtime or without models is refused.
- **Staging, file by file** (C4b, B9's per-file streaming): the database (with cRAP) and the PeptDeep
  models are written before the search with `allocateFile(path, size, size)` + `writeFileChunk` of
  16 MB `blob.slice().arrayBuffer()` pieces. The mzML files go through `searchFiles(…, { provideFile,
  releaseFile })`: `provideFile(i)` writes file *i* when its turn comes, synchronously (the worker reads
  the user's `File` with `FileReaderSync` in 16 MB pieces), with `allocateFile(path, size, capacity)`
  where `capacity` = the largest file's size (one block reused by every file); `releaseFile(i)`
  removes it (also after a failed write or search). Only the largest file must fit in the heap, next
  to the search. A file (or the database) larger than the module holds (`getMemoryInfo().maxFileSize`:
  `MAX_FILE_BYTES` = 2 GiB − 64 MiB in wasm32, `MAX_FILE_BYTES_64` = 16 GiB − 64 MiB in wasm64) is
  refused before anything is written: "x.mzML is too large (2.5 GiB); a file can be at most 1.93 GiB."
  (a file of exactly that size is accepted). While a file is written the stage is `reading` (an OOM or
  trap then advises fewer or smaller files), then `searching` again. Results are identical to all files
  written first (core test; in Chromium 3 × 733 MB gave the same 30,342 PSMs, 998 peptides, 451
  proteins as the all-at-once Node reference). idXML is read back with `readFileChunk` in 16 MB pieces.
- **Progress mapping** (`progressMapper`): file *i*'s steps take `[i, i+1]/n` of `[0, 0.95]`; only the
  file's depth-0 step and nested `progress` events move it (nested start/end change only the label;
  "Reading the spectra of the PSMs..." is nested in each file's step); a database chunk's step ("file 1
  chunk 3") is shown as "Searching database chunk 3..."; monotone. When the last file's own step ends
  (several files) the label becomes "Pooling the files..." (file −1): the pooling reports nothing and the
  bar **ends at 95 %** until the result arrives (there is no [0.95, 1] spectra step any more). Worker-
  made steps before the search: "Loading the PeptDeep models..." and "Reading the files..." (file −1,
  fraction 0).
- **Transfer**: `transferList()` lists each buffer once; a view of a `SharedArrayBuffer` throws in dev
  (`strict`) and is copied otherwise. `annotate()` copies the peaks (`slice()`) before transferring
  (subarrays of the stored spectra would detach the page's arrays).
- **Traps and stages**: the worker reports its stage (`loading | reading | searching | idXML | annotate
  | predict`), also by `{type: 'stage'}` messages during a search. `isTrapMessage`:
  `/RuntimeError|unreachable|out of memory|Aborted\(|WebAssembly\.Exception/i` (OpenMS `OutOfMemory:`
  and other exceptions are not traps); `isFatal(e)`: not an `Error`, a `WebAssembly.RuntimeError`, or a
  trap message. `trapMessage(stage, detail, restarted)`: "OpenMS stopped <while …> (<detail>)<advice>
  OpenMS was restarted." | "Reload the page to start OpenMS again." — `database:chunk_size (e.g. 2000)`
  advice only for `searching`; "search fewer or smaller files" for `reading`; "the idXML of this search
  is no longer available" for `idXML`. OpenMS' own `OutOfMemory`/`bad_alloc` errors (the module lives
  on, no restart) get `outOfMemoryMessage(stage, detail, variant)`: "OpenMS ran out of memory <while
  …> (<detail>). <advice by stage and module>" (the advice names the engine's limit; a search in chunks
  is told to use smaller chunks, not to set database:chunk_size; the 32-bit engine without the 64-bit
  one in this browser adds "Chrome, Edge or Firefox run larger searches in the 64-bit engine.", W64 r2).
  The restart (same role, threads and module) is
  verified within `restartTimeoutMs`.
- **Watchdog** (C4b): armed by the search's `searching` stage, only when its module runs more than one
  thread (`info.threaded` and `info.threads > 1`); every progress or stage message re-arms it (also the
  `reading` stage of writing a file). Silence for 120 s, or 60 s once the reported heap is fully grown
  (`heapSize ≥ heapMax − 64 MiB`; the heap never shrinks, so "near 95 %" would hold for the rest of the
  search), ends the worker like a trap: "OpenMS stopped responding (likely out of memory); search fewer
  files at a time. OpenMS was restarted." A search with `slowSteps` (every semi- or non-specific search,
  chunked or not; was `uncertainMemory`, chunked only, W64) gets 300 s and 120 s: its index build is
  silent (human semi-tryptic unchunked in wasm64, 16 threads: 48.7 s without a report), a non-specific
  one about 5 × that, Percolator on a large pool unmeasured, and a false kill of a valid search is
  worse than a late hang report. Only the
  search's own thread reports; chunk index builds, Percolator, PeptDeep, mzML parsing, writing a file
  and the final tables are silent: measured at most 5.8 s (3 × 733 MB TMT, 3 × 78 MB human
  semi-tryptic in chunks, 4 threads, Chromium).
- **Cancel** (C4b): a no-op unless a search is in flight; terminates the search worker at once and
  starts a new one with the threads and module of the cancelled search (not for a 64-bit search: its
  module may still be downloading, the next search that needs it starts one, W64 r1) (no cooperative stop: the worker is never
  reused after a search and holds nothing that outlives it); pending calls reject "The search was
  cancelled." / "The request was cancelled." (`EngineError.kind` `cancelled`), also those of a search
  whose worker trapped and is being restarted. Late answers of replaced workers are ignored. Load
  failures: kind `failed`, "OpenMS could not be loaded (…). Reload the page…", no restart loop.
- **Partial rescoring**: `searchError()` rewrites ProSE's message to "Percolator could rescore only
  some of the files, and their scores cannot be pooled with the others (not rescored: x.mzML (…)).
  Switch Percolator off, or leave out the files it could not rescore."

### 5.3 New search (C6, done)

One page, in mockup 1's order: Spectra with the design table, Protein database, Search settings,
Rescoring, and a sticky footer.

#### 5.3.1 Experimental design (decided with the user)

Four user-facing columns **File · Condition · Replicate · Fraction**, on top of the OpenMS one-table
`design.tsv`. **No guessing from file names.**

- **Sample = Condition + Replicate.** Fractions of a sample are combined into one sample column.
- **Every field is optional**; assumed values show greyed and italic (`muted-foreground`, ≈ 4.8:1) in
  cells that look editable (input border, hover, focus ring):
  - no Fraction: unfractionated (shown "–");
  - no Replicate: the *n*-th occurrence of a fraction number within its condition is replicate *n*
    (C-R5: so F1 F2 F1 F2 → 1 1 2 2 and fraction-major order F1 F1 F2 F2 → 1 2 1 2; unfractionated
    files → 1 2 3);
  - no Condition but fractions (or a replicate): one implicit condition-less group with the same rule,
    labels "Replicate n" (C-R5);
  - nothing at all: each file is its own sample, labelled with the file stem; no condition summary;
  - a single file needs no table: the design section appears from two files on.
- **Technical replicates**: two files with the same Condition + Replicate + Fraction. A
  `techReplicate` notice with "Change" (switches to Advanced and focuses the Replicate cell), not an
  error; numbers 1, 2, … (explicit values kept). In results they merge into their sample unless "Show
  technical replicates separately" (then columns "EGF 1 · TR1", "EGF 1 · TR2").
- **Notices, never blockers**: `fractionGap` (used fractions not 1..max), `unevenFractions` (per
  condition, fraction groups with different file counts), `duplicateFile` (same file name twice:
  "rename or remove", listed first; rows stay apart, C-R6), `multiplexed` (several labels per file),
  `unknownColumn`. One polite live region announces the notice summary.
- **Summary line** (C-R1): "6 files → 3 samples · 2 conditions · fractions 1–2"; singular "1 sample",
  "1 condition"; "· fractions …" omitted when no file has a fraction; "fraction n" when all equal.
- **Advanced** switch: shows the derived `Fraction_Group` (1-based) and the Sample label (never the
  0-based `Sample.index`), plus an editable "Tech. replicate" column. The table sits in a bounded scroll
  box (`max-h-[70vh]`) with a sticky header and fixed column widths; File truncates with a title.
- Invalid cell entries ("0", "1.5", "abc") stay visible, red-bordered with `aria-invalid`, until
  corrected; the model holds "not entered" meanwhile.
- **I/O**:
  - "Paste from spreadsheet": tab-separated clipboard text; MaxQuant's template is read (`Name` = file
    by stem, `Experiment` = condition, `Fraction`; PTM ignored).
  - "Load design (SDRF, design.tsv)":
    - `design.tsv`: one-table and the two-table format of sdrf-pipelines; BOM/CRLF/`#` lines handled;
      condition = `MSstats_Condition`; the biological unit is the first present of
      `MSstats_BioReplicate`, `Sample`, `Fraction_Group` (C-R4), ranked per condition (reload
      renumbers 4, 5, 6 → 1, 2, 3, C-R7).
    - SDRF: `comment[data file]`, all `factor value[...]` joined with `/` as condition,
      `characteristics[biological replicate]`, `comment[fraction identifier]`,
      `comment[technical replicate]`; "not available"/"not applicable" are empty; case-insensitive
      headers; several `comment[label]` per file → one row + `multiplexed` notice.
  - "Save design.tsv": header
    `Fraction_Group\tFraction\tSpectra_Filepath\tLabel\tSample\tMSstats_Condition\tMSstats_BioReplicate`,
    sorted by (Fraction_Group, Fraction), Label 1, Sample and BioReplicate = 1-based sample number;
    empty condition as empty cell. `writeDesignTsv` throws on duplicate file names; the button is then
    `aria-disabled` with a tooltip naming the notice.
- "Try the example": fetches `example/DatabaseSuitability_in_spec.mzML` and the FASTA and adds the mzML
  twice as `DatabaseSuitability_1.mzML`/`_2.mzML`, condition "example", replicates blank (shown 1, 2):
  "2 files → 2 samples · 1 condition".
- Empty state: the Spectra card is a dashed drop zone with "Add files" and "Try the example", plus the
  desktop downloads (`releases/latest/download/prose-desktop-<platform>.zip`: win_x64, mac_universal,
  linux_x64, linux_arm64); the privacy note ("Spectra and database stay on this computer") is the
  page's lead line. Drag and drop or "Add files" for mzML.

#### 5.3.2 Parameters and presets

- Ten common parameters in mockup order: enzyme, missed cleavages, precursor tolerance, fragment
  tolerance (ppm/Da toggle button inside the field), fixed, variable modifications, PSM FDR, protein
  FDR, charges, peptide length. "All N parameters" opens a dialog generated from
  `getDefaults().getEntries()`, by section, with a filter, "Show the 25 advanced parameters", per
  parameter "default: …" reset, clamped descriptions, "Back to the preset"; edits apply to the same
  state. The module has 77 parameters; the dialog shows 72: it leaves out the switch-owned `rescore`,
  `peptdeep:enable`, `peptdeep:ms2_model`, `peptdeep:rt_model` and the card-owned
  `peptdeep:instrument`.
- Modifications: multi-residue sites ("Phospho (STY)", "Deamidated (NQ)") are grouped for display
  and expanded into ProSE's single-residue names (its `validStrings`), which are what is sent. Before
  OpenMS loads, typed names are "unverified" (dashed) and checked at start; afterwards only known names.
- Built-in presets (`BUILTIN_PRESETS`), all setting the same core keys on top of ProSE's defaults:
  `orbitrap-hcd-tryptic` "Orbitrap HCD · tryptic" (default; Trypsin/P, full, 2 missed cleavages,
  CAM fixed, Oxidation (M) + Acetyl (Protein N-term) variable, FDR 1 %/1 %, charges 2–5, length 7–40,
  10/10 ppm precursor, 20 ppm fragment, QE), `timstof-tryptic` (20/20 ppm, 40 ppm, charges 2–4,
  timsTOF), `open-search` "Open search · ±500 Da" (no variable mods, ±500 Da, isotope error 0..0,
  20 ppm, QE). User presets in `localStorage["prose.presets"]` ("Save as preset" stores values that
  differ from the defaults, never the switch parameters); a "modified" hint shows when settings differ.
- The request sends only parameters that differ from the defaults (`requestParameters`, from a
  `$state.snapshot`).

#### 5.3.3 FDR display (decided with the user: never ambiguous)

`FdrInput` everywhere an FDR is entered: the number with a "%" suffix and "q ≤ 0.01" right-aligned in
the field, quick chips 0.1 / 1 / 5 %. `parsePercent`: "1", "1 %", "1%" → 0.01; "0.01" → 0.0001 (it is
read as a percent); > 100, junk, zero or negative → null; decimal comma accepted. `formatPercent(0.01)`
= "1 %", `formatQ(4e-6)` = "q ≤ 4.0e-6" (≥ 1e-4: 3 significant digits). Hint "> 0 – 100 %"; a `max`
prop disables chips above it ("at most 0.5 %"). Start is disabled unless both FDRs are > 0 ("Set a PSM
FDR above 0 %."). The search's FDR values are the search's cutoffs; result filters can only tighten
them (§5.5.3).

#### 5.3.4 Rescoring rules

- The Percolator switch sets `SearchRequest.rescore` (ProSE `rescore`); on by default.
- The PeptDeep switch requires Percolator: disabled while Percolator is off ("Needs Percolator: switch
  it on to use PeptDeep.") and without ONNX Runtime. **Off by default** (deviation from the mockup:
  faster first search, 0.35 GB less memory (0.6 GB before openms-mimalloc), the example gains nothing). The instrument select
  (`peptdeep:instrument`) sits in the card.

#### 5.3.5 Memory estimate (`settings/memory.ts`)

Rewritten for the 64-bit engine (W64, decisions "W64 estimate"): the formula and constants of the
calibration of both modules with OpenMS' allocator (`/scratch/sachsenb/wasm-logs/wasm64/packages/calibration.md`:
Chromium 141, a Web Worker on an isolated page, `searchFiles` file by file as the app runs it, rescore
and keepSpectra on, a fresh module per search, the TMT settings of `prose-bench/bench.sh`; 1–12 files
of 75 and 733 MB, Erwinia and human, 4–16 threads, with and without PeptDeep, tryptic, semi-tryptic,
chunked; the chunks of 5000/6000 in Node). The engine searches file by file (§5.2), so the inputs do not
add up.

```
bytes = MODULE
      + INDEX × proteins / 1000 × SPECIFICITY × MOD^max(0, variableMods − 1)      (the fragment index)
        variableMods = indexModifications(…): protein-terminal entries do not count (W64)
      + 2 × largest mzML + FASTA                         (the file being searched + its spectra)
      + growth(files, mean mzML size)
      + THREAD × max(0, threads − 4)                     (once, not per file)
      + (peptdeep ? PEPTDEEP : 0)                        (flat: no file or thread term)
chunked (0 < chunk_size < proteins), tryptic and semi-tryptic:
  index = INDEX / 1000 × MOD^… × min(chunk_size × CHUNKED, proteins × SPECIFICITY)
non-specific: by the residues of the target proteins (cRAP's 38,459 included), not their number (W64 r2):
  index = NONE × residues × MOD^…; chunked: min(NONE_CHUNK × chunk_size × residues / proteins, unchunked)
  (residues not known: 555 per protein)
growth: g = G_SMALL at ≤ 75 MiB … G_LARGE at ≥ 733 MiB (linear between); files 2–5 add g each,
        every further file g / 4
proteins = target proteins incl. contaminants (not counted yet: 0)
level: 'over' if bytes > LIMIT or a file > MAX_FILE; 'warn' if bytes > WARN; else 'ok'
cause = 'inputs' if fileTooLarge or inputs > index, else 'database'
threads = threadsForSearch(engine threads, files, peptdeep)   (§5.2)
```

| Constant (`MODULES`) | wasm32 | wasm64 |
|---|---|---|
| LIMIT / WARN | 4 GB / 3 GB | 16 GB / 14 GB |
| MODULE | 0.20 GB | 0.40 GB |
| INDEX per 1,000 proteins, tryptic | 0.03 GB (fit 28.4 MB) | 0.025 GB (fit 21.9 MB) |
| SPECIFICITY full / semi | 1 / 10 | 1 / 15 |
| CHUNKED full / semi | 2 / 20 | 32⁄15 / 32 |
| NONE / NONE_CHUNK, GB per million residues | 7.5 / 18.5 | 9.6 / 24.5 |
| MOD per further variable modification | 2 | 2 |
| G_SMALL / G_LARGE | 0.05 / 0.15 GB | 0.06 / 0.15 GB |
| THREAD per thread above 4 | 0.025 GB | 0.035 GB |
| PEPTDEEP | 0.35 GB | 0.25 GB |
| MAX_FILE | 2 GiB − 64 MiB | 16 GiB − 64 MiB |

Semi measured (human needs 14.2 in wasm64; Erwinia 8.7/10.7), CHUNKED semi measured (a chunk costs
about twice the unchunked index per protein: every chunk builds its index again, and the memory is
not handed back between chunks; so a chunk size near the protein count gains nothing, which the min()
covers); CHUNKED full in proportion. Non-specific: measured on both databases (Erwinia, fix round 1;
human, fix round 2: per million residues of a chunk 13.6–18.1 GB needed in wasm32, 22.0–23.8 in wasm64,
the same for both databases, while per protein human needed 1.6 times Erwinia's: its proteins are 555
residues long against 324; the threads add little here, so the 4-thread runs set the wasm32 constant),
unchunked in wasm64 on Erwinia (9.4 needed); wasm32 unchunked aborts on both, so NONE (wasm32) is above
both proportions of wasm64's (7.25 and 6.4). MB/GB binary.

**Which module** (`chooseEngine`, `engine/variant.ts`; the user's rule): the estimate with the wasm32
constants (`estimate32`); above 3 GB (`SWITCH_BYTES`), or a file too large for wasm32, the search runs
in wasm64 if the browser has Memory64 (`supportsMemory64`: `WebAssembly.validate` of the smallest
module with a shared 64-bit memory, once per page) and the footer shows the estimate with the wasm64
constants. `?debug=wasm64` forces wasm64 (where supported). What the calibration's searches do:
human semi-tryptic in chunks of 5000, 6000, 7000, 8000 and unchunked switch (3.36, 3.96, 4.56, 5.16 and
6.55 GB in wasm32), and the non-specific ones: Erwinia in chunks of 500 and 1000 and unchunked (3.64,
6.63, 11.6 GB; chunks of 250, 2.14 GB, stay), human in chunks of 250, 400, 500, 1000 (3.22 GB and up);
everything else stays, the largest 12 × 733 MB (2.63 GB) and human with 3 variable modifications (2.84
GB). The estimate is at or above every peak of the calibration table (by 0.03–1.4 GB) and above 4 GB for
every wasm32 search of it that failed. It is a calibration on one spectra file against two databases,
not a bound: fix round 1's non-specific constants, calibrated on Erwinia alone, under-estimated human by
30–40 %.

Gone: `UNCERTAIN_BYTES` (3.8 GB), `isUncertain`, `uncertain`, "`over` from 3 files" and the thread cap
for chunked semi/none (openms-mimalloc removed the scattering they guarded against, decisions "W64
estimate", "W64 thread cap"); `threadFactor`, the growth per file by threads and PeptDeep's file × thread
term (the calibration found neither). No storage mode and no `INPUT_BUDGET` (B9 chose per-file
streaming): only a file above the module's MAX_FILE is refused.

The plan line: wasm32 "… · estimated memory 2.6 GB of 4 GB"; wasm64 "… · estimated memory 8.1 GB ·
64-bit engine (up to 16 GB)", its title adding why: "Estimated 6.40 GB in the standard 32-bit engine,
above 3 GB: the search runs in the 64-bit engine." (two decimals, rounded up), "x.mzML is larger than
the 32-bit engine takes (1.93 GiB): …", or the debug switch. While the proteins are counted the line has
no estimate ("… · counting proteins…"); a search started then waits for that count ("Counting
proteins…" as its step; the count is held at Start, whatever the database is by then) and its engine is
chosen on it (W64 r1, r2). A database that cannot be read: "… · the database cannot be read", the card
says "cannot be read" (the reason in its title), and Start is disabled: "<name> cannot be read (…).
Choose it again, or another FASTA file." (W64 r2; it counted as 0 proteins before). Advice (amber `warn`, red `over`), by module and cause:

- wasm32 (only without Memory64 above 3 GB): "Close to the 4 GB limit: consider database:chunk_size
  (e.g. 2000) under All parameters." / "…, mostly for the files: search fewer files at once.";
  above 4 GB: "This browser cannot run the 64-bit engine, which a search above 4 GB needs: use a
  Chromium-based browser (Chrome, Edge) or Firefox, smaller chunks (database:chunk_size under All
  parameters) or fewer files at once." (a file too large: the too-large message, then that).
- wasm64: "Close to the 16 GB limit of the 64-bit engine: set database:chunk_size (e.g. 2000) under All
  parameters." (> 14 GB); "More than the 16 GB the 64-bit engine can use: set database:chunk_size (e.g.
  2000) under All parameters, or use fewer variable modifications or a narrower specificity." (> 16
  GB); "…, mostly for the files: search fewer files at once."; a file above 15.93 GiB: the too-large
  message.

Start stays enabled over budget (C-R15 accepted).

Tests (`memory.test.ts`): the calibration table (31 searches, 71 measured peaks in both modules at
4–16 threads, the non-specific ones of fix rounds 1 and 2 included: estimate ≥ peak and within 1.5 GB;
the 6 failed wasm32 searches above 4 GB; exactly the twelve named searches cross 3 GB, human
non-specific in chunks of 250 at 16 threads only (3.22 GB; 2.92 at 4), `chooseEngine` agrees), the constants, each term, chunking, the growth
schedule, the levels of both modules, a file too large in each. `plan.test.ts`: the module, the line and
the advice with and without Memory64, the forced switch, `slowSteps`. Real large case (on demand,
§5.9): human semi-tryptic unchunked in Chromium, 16 threads: estimate 8.8 GB, 8.66 GiB measured.

#### 5.3.6 Footer, progress, errors, TopBar

- `PlanLine`: one-line plan ("… 49 proteins + 116 cRAP + decoys …"), the problem that disables Start
  or the memory advice (amber/red), how the last run ended. Start has
  `aria-keyshortcuts="Control+Enter"` (Meta on Mac) and `aria-describedby="start-problem"` only when
  that element is shown.
- `SearchProgress`: the step label (with "File n of N" when `file ≥ 0`), a bar that is
  **indeterminate** while the fraction is 0 or has not moved for 2 s (staging, Percolator, chunked
  searches, engine start; static under reduced motion) and determinate otherwise ("48 % · 0:03"),
  then the threads of the search ("· 16 threads", "· 4 threads (memory)", C4b) and, in wasm64,
  "· 64-bit" (title: "The 64-bit engine (Memory64): this search needs more memory than the 4 GB of the
  standard engine; it can use up to 16 GB.").
  Cancel is available throughout, also while OpenMS is still loading (the run ends at once; the load
  continues in the background).
- `SearchError`: a shadcn Alert above the footer, scrolled into view: "<context>: <summary>", with the
  raw OpenMS text in a collapsed `<details>` "OpenMS message". `describeFailure()` derives the context
  from the last progress report and the file names ("While searching file 2 of 2 (broken.mzML)",
  "While reading the files", "While starting OpenMS", "During “Building fragment index”"); message
  stages it recognizes itself ("Percolator could rescore only some…" → "While rescoring with
  Percolator", no file); after > 2 s without progress it drops the stale label: "…, in a step without
  progress reports (e.g. Percolator)". Exceptions are shortened ("Parse Error." + "The file may be
  incomplete or not valid mzML." for mzML parse errors); "in: <location>" tails are cleaned. "Reload
  the page" button when the message holds `RELOAD`; Dismiss. Cancellation is a quiet footer line.
- A search keeps running when the user leaves New search; the app navigates to Results when it ends.
- **TopBar indicator**: on any view but New search, a compact link (small bar + "Searching 48 %" or
  "Searching…", with an aria-label) returns to New search. Status chip: "Loading OpenMS…", then
  "OpenMS 3.7 · 16 threads", plus "· works offline" once the service worker reports this build's shell
  and module stored and verified (C12; its title lists the PeptDeep models and the example), or
  "· not cross-origin isolated" (amber dot, explanatory title; New search adds a dismissible notice).
  The bar stays one row above 900 px, the result chip shrinking and truncating first (at ≤ 1100 px the
  subtitle hides and the gaps narrow); at ≤ 900 px (C12) the result chip with its save state takes a
  second row; should the fixed items not fit, the right-hand group wraps whole, never overflowing. The
  Results tab list scrolls sideways where it does not fit. "Update ready · Reload" appears when an
  update waits, or in a page of the previous build after another tab took it (C12 fix rounds 1–2).

### 5.4 Display formats (C3, done)

- **Modifications (decided with the user)**: by default a marked residue (one aqua colour means
  "modified", a short superscript label says which, hover shows "Oxidation (Unimod:35) +15.9949").
  Labels: Oxidation→ox, Phospho→ph, Acetyl→ac, Deamidated→de, Methyl→me, Dimethyl→dm, GlyGly→gg,
  Carbamyl→cm, Gln->pyro-Glu→pg, Glu->pyro-Glu→pe, TMT6plex→tmt, otherwise the first three letters
  lower-cased. N-terminal label before, C-terminal after the sequence. Fixed modifications are not
  marked (the legend says so). A user switch (`displaySettings.modMode`, `localStorage["prose.modMode"]`,
  in the Columns menu: "Marked residues / ProForma") shows ProForma (`AVM[Oxidation]DDFAAFVEK`), which
  includes fixed modifications ("ProForma: fixed modifications included (…)"). **Exports and copy
  always write ProForma.** Labels are `user-select: none`, so a copied selection is the plain sequence.
- Open-search PSMs: `[+Δ]?` (signed, `toFixed(4)`, muted) before the sequence when |Δ| > 0.05 Da;
  ProForma `[+15.9949]?PEPTIDE` (`massShift`, `psmProforma`).

### 5.5 Results (C5 model done; C7 view in review)

C7 (`43aa0f3..e26e083`) is implemented; its fix round 1 (C-R16) is **in progress**. Facts below are
the committed state; C-R16's changes are listed at the end.

#### 5.5.1 Model (`lib/results/model.ts`)

`buildModel(tables, design, { showTechReplicates, psmFdr, proteinFdr })` (both FDRs required, `0 <
q ≤ 1`; design rows must equal the searched files in count and base name, else a clear error). Typed
arrays only (index permutations; no per-row objects). Columns in use: one per biological sample
(fractions and technical replicates summed), or per technical replicate when shown separately.
`protein.members` (CSR protein → peptides) for coverage. `peptideCounts(m, maxQ)` recounts peptide
PSMs/per-sample/found-in at a tighter cutoff (cached, last 8 cutoffs).

#### 5.5.2 Tables and filters

- Tabs **Overview · Proteins n · Peptides n · PSMs n · Samples · QC**; Overview/Samples/QC are disabled
  until C10; Proteins is the default. Five key figures: target protein groups at the protein FDR
  ("· no protein FDR" when not applied), target peptides (best PSM within the PSM FDR), target PSMs
  within the PSM FDR (`data-testid="psm-count"`), PSMs/MS2 spectra, median absolute precursor error;
  plus "n samples · m conditions" in place of the mockup's "PSMs from rescoring".
- `DataTable.svelte`: `rows: Uint32Array`, `columns: Column[]` (`{ id; header; group?; width; align;
  cell: (row) => string | Snippet<[number]>; sortKey?; title?; cellTitle?; muted?; class? }`), `sort`,
  `onSort`, `onRowClick`, `selected?`, `label`, `empty?`; renders the visible rows ± 3 with spacer rows;
  `table-fixed` with `<colgroup>`; sticky two-row header with per-sample columns grouped under their
  condition; `role="grid"`, `aria-rowcount`, `aria-rowindex`, `aria-selected`, roving tabindex,
  Arrow/Page/Home/End/Enter/Space; sort headers are buttons with `aria-sort`.
- `FilterBar`: text search (150 ms debounce, Escape clears; words all must match, case-insensitive);
  the q-value filter as a popover with `FdrInput` (`max` = the search's cutoff), labelled "Protein FDR
  ≤ 1 % (q ≤ 0.01)", "Best PSM q-value ≤ …" (Peptides: no peptide-level FDR), "PSM FDR ≤ …"; on
  Proteins "≥ n peptides" and "Found in ≥ n replicates of a condition"; chips "Contaminants hidden ✕",
  "Decoys shown ✕"; "+ Filter" with both toggles; "n of total" in a polite live region.
- Per level: Proteins (text on accession/description; maxQ protein q; minPeptides;
  minReplicatesInCondition; contaminants; decoys), Peptides (text on sequence, ProForma, protein
  accessions; best PSM q; contaminants = peptides mapping only to `CON__`; decoys; protein filter),
  PSMs (text and contaminants via the peptide; maxQ; decoys; protein and peptide filters). Every level
  starts at its search cutoff with contaminants and decoys hidden.
- Columns: Accession (UniProt identifier shown, full accession in title, CSV and search), Gene (from
  `GN=`, only if some description has one), Description (name without `OS=`/`GN=`…), counts, coverage,
  "Found in", per-sample counts; hidden by default: protein q-value, "Best Percolator score"/"Best
  ln(hyperscore)", Length, Group; the Δ mass column hidden for closed searches. PSM score header
  "Percolator score" when any file was rescored, else "ln(hyperscore)"; −100 with q = 1 shows "–".
  RT in minutes in the UI ("RT (min)"), seconds in the CSV. `CON__` accessions get a "contaminant"
  marker, decoys a "decoy" marker. Protein-less peptides/PSMs show a muted italic "below protein FDR".
- `ColumnsMenu`: optional columns, "Counts per sample", "Show technical replicates separately" (only
  with technical replicates), Modifications: Marked residues / ProForma. Legend under Peptides/PSMs.
- View state per open result (`resultsViewFor`) lives in its own `$effect.root`, so filters survive a
  visit to New search.

#### 5.5.3 Cutoff rules

- The search's FDRs are the cutoffs: PSMs above `psmFdr` are not evidence (not counted anywhere);
  filters start there and can only tighten (`maxQ` above the cutoff or NaN acts as the cutoff; FdrInput
  chips above it disabled). Loosening needs a new search. Decoys are kept so q-values and score
  distributions stay visible ("show decoys").
- One `FilterState` per level; `sortRows(m, level, rows, key, dir, filters)` and `toCsv(m, level, rows,
  columns, filters)` take it, so cells, sort and CSV read one cutoff.
- Protein-level PSM and peptide counts stay at the search PSM FDR (header tooltip "At the search PSM FDR
  (1 %, q ≤ 0.01)"); peptide-level counts follow the peptide maxQ, counted at `min(maxQ, psmFdr)`
  (C-R9).
- "Found in" always counts biological samples (Condition + Replicate), however technical replicates are
  shown (C-R10); `minReplicatesInCondition` keeps a protein if in some condition at least that many
  samples found it.
- Protein "Peptides" and `minPeptides` count distinct plain sequences (MaxQuant convention); the
  Peptides table rows stay peptidoforms (C-R11).
- When `proteinFdrApplied` is false the protein FDR filter is an `aria-disabled` button "Protein FDR:
  not available" with the tooltip "This search applied no protein FDR (the proteins have no q-values), so
  proteins cannot be filtered by it."
- Protein-less peptides count for no protein; the text filter still finds them; hiding contaminants
  keeps them.

#### 5.5.4 CSV format

UTF-8 with BOM (`'﻿'`), every line ends with `\n` (n rows → n + 1 lines), RFC 4180 quoting
(comma, quote, CR/LF), NaN → empty field, text cells and headers starting with `= + - @ \t \r`
prefixed with `'` (numeric columns never), coverage as percent with one decimal. ProForma always; PSM
peptide with the `[+Δ]?` prefix; File = base name; `samples` expands to one column per sample (header =
sample label). Headers: Accession, Description, Score (named after the score used), q-value, Length,
Coverage (%), Peptides, PSMs, Found in, Group, Contaminant, Decoy; Peptide, Sequence, Proteins
(`;`-joined), Best PSM q-value; File, Sample, Spectrum, RT (s), m/z, Charge, PEP, Precursor error (ppm),
Isotope error, Delta mass (Da). The CSV holds the visible columns of the current, filtered, sorted view.
"Export CSV · n rows" downloads it as a Blob (no second BOM; nothing copies it to the clipboard).

#### 5.5.5 Export menu (in the TopBar on Results)

With a chip "name · n files · finished HH:MM · duration":
- "CSV (current view)";
- "Design (design.tsv)" (`<name>_design.tsv`; a write error shows in the header);
- "Project (.prose)": downloads `<name>.prose` (C11; disabled while a CSV export runs);
- "idXML (merged)": enabled only while `result.engineResult && engineClient().hasSearchResult`, else
  title "Run the search again to export idXML"; downloads `<name>.idXML`, read in 16 MB chunks.
  (The design spec's reason: it needs the OpenMS objects, which History does not keep.)
- The spectrum as SVG joins with C9.

#### 5.5.6 Performance (C5/C7)

150k PSMs / 20k peptides / 4k proteins (`makeLargeTables`): filter + sort ≈ 100 ms (limit 300 ms);
`buildModel` 35 ms; CSV of 150k PSMs 355 ms (22 MB); peptide recount 5 ms. Scroll test (e2e
`?debug=large`, 90 rAF steps of ~1,700 rows): median and max frame 16.7 ms (< 50 ms asserted); at 4×
CPU throttling max 50 ms (< 100 ms).

#### 5.5.7 In progress: C7 fix round 1 (C-R16)

Grid as a single tab stop with `aria-activedescendant` and keyed rows (focus after mouse scroll); Gene
column in the CSV; the example search with protein FDR 5 % (marked in the plan line) and an
explanatory empty state "Search again with protein FDR 5 %" when PSMs exist but no protein passes; data
contrast of `.muted`; sample header aria-labels; proteins text filter also matching peptide sequences;
native ID parsing (`scan=`/`spectrum=`/`index=`); negative RT → "–"; `levelRows` computed once;
"Exporting…" state; sort follows the column id across the tech-replicate toggle; release the module
cache when results close; a 1 % debug variant. A read-only investigation compares with native ProSE
`-out_merged` why a decoy protein ranks first on the example (all 47 targets then have q ≥ 1/49 =
0.0204, so 0 proteins pass at 1 %). Deferred: group key-figure semantics (→ C8/C10), TopBar wrap ≤ 900 px
(→ C12, done there), runes test conditions.

### 5.6 Planned: C4b, C8–C12

| Task | Content (plan + rulings) |
|---|---|
| **C4b** (after B9; built, see §5.2 and §5.3.5) | Staging through B9's per-file streaming (`provideFile`/`releaseFile`, `allocateFile` with the largest file's size as capacity, `writeFileChunk`), so only the largest file must fit; files above `MAX_FILE_BYTES` refused; idXML read with `readFileChunk`; the memory estimate without storage mode (file by file, growth per file by threads and size; chunked semi/none shown as the measured 3.8 GB, `over` from 3 files); threads capped at 4 for many files, PeptDeep with > 2 files and chunked semi/none, shown in the progress; a watchdog for a hung module of more than one thread (120 s, 60 s with a fully grown heap; 300/120 s for chunked semi/none); Cancel terminates at once and restarts with the search's threads, also during a restart; no module call after a fatal error; stage advice for `OutOfMemory`/`bad_alloc`; 180 s start timeout for the first load, 30 s for restarts; progress ends at 95 % with "Pooling the files..."; e2e of many files, cancel, the threads in the UI, and an on-demand large-file check (`PROSE_BIG_MZML`) |
| **C8** protein panel | `ProteinPanel`, `CoverageStrip`, `CoverageMap`, `ProteinPeptides` (mockup 4): selecting a protein opens its page on the right; coverage strip with modified sites (dots `#1baf7a`); coverage map in blocks of 10 residues, 40 per row; tabs Coverage · Peptides · PSMs; peptides with per-sample counts, expanding in place to their PSMs; a PSM opens the PSM view; "Open in PSM table" → chip "Protein: <accession> ✕"; Description hidden while the panel is open. e2e `a protein opens its coverage, peptides and PSMs`, `open in PSM table carries the filter` |
| **C9** PSM view | `PsmView`, `FragmentLadder`, `SpectrumMirror`, `IonTable`, `MassErrorPlot`, `PsmFeatures`, `psm/svg-export.ts` (mockup 3): breadcrumb Proteins › protein › Peptides › peptide › PSM; sequence with fragment ladder and modified-residue labels; mirror spectrum with ion/charge/loss toggles, observed (top) against the **PeptDeep prediction** when `info.onnx` (NCE = `peptdeepNce` of the PSM's file, else the spectrum's `collisionEnergy`, else 30; instrument from the search) or the **theoretical** spectrum (`annotate(...).theoretical`, uniform height); annotation with `maxCharge` 2 for the mirror (B-R29), labels grouped per peak ("y1-NH3++ / z1++", B-R20); b/y ion table with matched cells highlighted; **fragment mass error plot**: m/z against ppm, tolerance band, dot size = intensity, one dot per match; cosine and spectral angle from the `ms2_cosine`/`ms2_spectral_angle` features when present; all PSM features; Prev/Next in the current sort; "Export spectrum (SVG)" (`exportSpectrumSvg`: standalone, inline styles, no external references). Peaks come from the stored spectra, so the view works for History and project files without the mzML. Ion colours b `#2a78d6`, y `#eb6834`, unmatched grey; direct labels, so colour is never the only cue |
| **C10** Overview, Samples, QC, open search | `OverviewTab`, `SamplesTab`, `QcTab`, `DeltaMassPanel`: Overview = key figures, the search's facts (since W64 also "Engine": "OpenMS 3.7 · 32-bit" / "· 64-bit") and a per-file table (spectra, PSMs, Percolator applied/skipped, seconds); with `summary.openSearch` a delta-mass histogram and the mapped-PTM table; Samples = samples × (PSMs, peptides, proteins) grouped by condition; QC = target vs decoy score distribution, precursor-error histogram, PSMs per file. Hand-written SVG charts with direct labels or legends |
| **C11** History and `.prose` | `persist/record.ts` (the record, pack/unpack, checks), `history.ts` (storage), `history.svelte.ts` (page state and actions), `backend.ts` (idb-keyval + OPFS; `memory-backend.ts` for tests), `project.ts` + `crc32.ts` (the `.prose` zip), `views/History.svelte`, `components/history/SaveNotice.svelte`. `SCHEMA_VERSION = 1`; `SearchRecord = { schema: 1; id; name; createdAt; appVersion; moduleVersion; moduleVariant? (W64: 'wasm32' | 'wasm64'; absent = wasm32); design: DesignResolution; settings: { parameters; rescore; peptdeep; contaminants; presetId?; fixedMods; database }; psmFdr; proteinFdr; seconds; summary; tables; spectra }` (beyond the plan: `settings.fixedMods`, `settings.database`, `psmFdr`, `proteinFdr`, `seconds`, which a reopened result needs). Metadata (the manifest = the record without its arrays, the byte layout, the list fields) in IndexedDB via idb-keyval, the arrays as one OPFS file per search (`prose-history/<key>.bin`, written through `createWritable` in 8 MB pieces); a save over an existing id writes a new file and removes the old one after, so a failed save keeps the old entry. Saved automatically after each completed search only (a failed or cancelled search leaves History unchanged); `navigator.storage.estimate()` is checked first and a search that does not fit is not written ("Not saved to History: needs …, … free", amber notice on Results and History, "Not saved to History" in the top bar; the results stay usable); after the first save the browser is asked once to persist storage. Saves, deletes, renames and the cleanup of orphan files and `.crswap` leftovers (only files older than 5 min) take turns under the Web Lock `prose-history` (fallback: a queue in the tab); other tabs hear of changes over `BroadcastChannel("prose-history")` and History reads the list again when shown. History view: name, finished, files, PSMs (targets within the search PSM FDR), size; open, rename (inline; the open result takes the new name for Export › Project), delete (with confirmation); "Open project…" with its progress; storage use and the persistence answer. A reload of `#/results/<id>` reopens the search from History. Opening from History reuses `openStoredResult()` (keeping id and createdAt); a stored search has no engine result (no idXML). `.prose` = zip of `manifest.json` (marker `format: "prose-project"`, `byteOrder: "little"`, non-finite numbers as `{"$num": …}`) + one `.bin` per typed array or text column (UTF-8 with u32 lengths), written by ProSE's own zip writer (decisions "C11 zip container"); an array that deflate shrinks to no more than 85 % is deflated, else stored (decisions "C11 stored entries"); written and read in slices with pauses and progress ("Saving project n %", "Opening project… n %"). `readProject` of an unknown schema throws `ProjectVersionError("This project was saved by a newer version of ProSE (schema 2) …")` ("This search …" for a History entry); anything else wrong (not a zip, no manifest, missing/mis-sized/damaged entry by CRC, columns of the wrong length, offsets or references out of range, settings or design the views cannot read, summary of other files) is a `ProjectError` that says what, never a crash. Spectra are stored with the results (decided by the user; float32 is 0.06 ppm at m/z 2,000; spectra of PSMs outside the FDR are not kept, which the engine's `spectra()` already does); raw mzML is not. The Export menu's Project item is active (disabled during a CSV export). |
| **C12** SW, Pages, desktop (deployed 2026-10-20 from ce51dae; §2.4, §8.8) | `app/public/sw.js` (from `examples/sw.js` with the `no-cache` fix; module files under `openms/`, cache-first, `openms.wasm` unwrapped; app files network-first, the shell stored on installation, the example and cRAP on request; COOP/COEP on navigations and worker scripts), `app/src/lib/sw-client.ts` (reload once when not isolated, 30 s cap, decision on `crossOriginIsolated`), `app/sw-stamp.ts` (stores `openms-module-<MODULE_ID>` and `prose-app-<BUILD_ID>` instead of both after `__BUILD_ID__`; `openms.mjs?v=<MODULE_ID>`; decisions "C12 store ids", "C12 `?v=`", "C12 precache"); `.github/workflows/pages.yml` running `.github/assemble-site.sh` → `_site/`: the app at `/prose-web/`, `/prose-web/examples/prose/` → redirect page to `../../` (also `examples/browser/` → `../../openms-demo/`; both unregister the old `examples/` worker), `/prose-web/openms-demo/` = the old `examples/browser/` with the root's module, `sw.js` and `sw-client.mjs` in one directory (paths and two races patched, "C12 site"), `data/`, `prose-single-file.html` and `README.md` unchanged. Pages source switches to "GitHub Actions" (`gh api -X PUT repos/timosachsenberg/prose-web/pages -f build_type=workflow`). Root `index.html`: a pointer page without automatic redirect ("C12 root index"). Desktop: `desktop/build.sh` builds the app with `VITE_BASE=./` into the package's resources (not into `app/dist`), `neutralino.config.json` `url` `/`, version 0.3.0, README.txt for the app. The C7-deferred TopBar wrap at ≤ 900 px. Chip "· works offline"; without isolation the chip plus a notice on New search. e2e `deploy.spec.ts`: the SW isolates and caches (one reload, `crossOriginIsolated`, `openms-module-<MODULE_ID>` holds `openms.wasm`, the shell and the example stored), works offline after the first visit (its own `vite preview`, closed; reload, "Try the example" and a search), runs single-threaded without isolation ("1 thread" + "not cross-origin isolated", the notice, a search finishes). Fix round 1 (review of 0fbde6b): C1 module/wasm pairing across an update (`?v=` on wasm and models via `locateFile`, the worker stores only its own version), I1 blocked session storage, I2 shell-only installation + DATA on request + "Loading ProSE…", I3 deploy order, M1 waiting update with a Reload notice, M2 old stores and registrations, M3 all-or-nothing shell with a build check, M4 top bar (one row above 900 px, no overflow at 560 px or 900×540), M5 workflow (Node 24.19.0/npm 11.17.0, check + vitest before the build, deploy only from `main`), M6 e2e (refused/unsupported registration, PeptDeep under the worker, env restored). Fix round 3 (re-review of 78d4743: I-1 the update notice missed an installation already under way, I-2 a full storage stopped OpenMS from loading and blocked updates; minors: the PeptDeep 409 surfaced late, generic 409 messages, non-app windows kept the previous generation, fakeUpdate left openms.mjs unchanged): `watchUpdate` follows a running installation, `store()` never fails a response, room checked before the module, shell-only updates without room, one "A newer version of ProSE was deployed: reload the page." message (worker and a PeptDeep pre-check), app windows only; e2e for each (they fail on 78d4743). Fix round 2 (re-review of f576241: C-1 an unapplied update left offline broken, I-1 network-first stored another build's files, I-2 a lazily fetched model stored under the old version with new bytes, I-3 old tabs could not start workers after a deployment; TopBar overflow with the notice; unrealistic `fakeUpdate`; weak storage test): a build manifest (size + SHA-256) and "only verified bytes are stored", 409 for another version's bytes under this version's URL, complete updates (module stored before waiting, DATA and models carried over), generations with markers (one previous kept while its pages are open), not-OK falls back to the store, "works offline" from the worker's STATUS, the bar wraps instead of overflowing; e2e for C-1, I-1, I-2 and I-3 (they fail on f576241). Deploy (live e2e, desktop `0.3.0` with `gh release create`) **only after the re-review**; order: first switch Pages to GitHub Actions (`gh api -X PUT repos/timosachsenberg/prose-web/pages -f build_type=workflow`), then push `main`. The switch keeps the site deployed before live until the workflow deploys; the push runs the workflow, which deploys the app. In the other order, Pages in branch mode would publish `main`'s root (the pointer `index.html` and the repository's files, no app) until the switch |

### 5.9 The 64-bit engine (W64, wasm64; 2026-10-20)

OpenMS PR #10659 (draft, stacked on #10575) builds the module also for wasm64 (Memory64, at most 16 GB,
files up to 16 GiB − 64 MiB) with one JavaScript API for both builds, and makes OpenMS' own build of
mimalloc (`openms-mimalloc`) the allocator of every WebAssembly build. The app ships both packages of
fd807dc89a (since fix round 1 76607e6451) and uses wasm64 only where a search needs it. Rulings:
decisions §4.9.

| Part | What |
|---|---|
| Packages | `public/openms/` `@openms/openms-wasm-mt@3.7.0-pre.76607e6451` (first fd807dc89a, replacing 7abcb280e2), `public/openms64/` `@openms/openms-wasm64-mt@3.7.0-pre.76607e6451` (no models: both use `openms/models/`). Ids `__OPENMS_ID__`/`__OPENMS64_ID__` = `MODULE_ID`/`MODULE64_ID` (SHA-256 of each directory). |
| Choice | `engine/variant.ts`: `supportsMemory64()` (`WebAssembly.validate(MEMORY64_PROBE)`, a shared 64-bit memory), `chooseEngine({ estimate32, fileTooLarge32, memory64, force })`: wasm64 above 3 GB (wasm32 constants) where supported; `?debug=wasm64` forces it. `search/plan.svelte.ts`: `memory64`, `forceWasm64`, `estimate32`, `engine`, `estimate` (in the chosen module), the line and the advice (§5.3.5); `startSearch` sends `engine` and `slowSteps`. |
| Engine | §5.2: the search worker of the search's module, restarts keep it, the viewer stays wasm32, per-build start timeout, messages that name the module, the module's own file limit. |
| Shown | Footer ("· 64-bit engine (up to 16 GB)", or why this browser cannot), progress ("· 64-bit"), Overview ("Engine"), History (a "64-bit" tag), the record and project file (`moduleVariant`), the chip's title (whether the 64-bit engine is stored). The status chip itself is unchanged. |
| Service worker | §2.4: `openms64/` in the manifest, not in the shell nor an update's installation, stored on first use in `openms64-module-<MODULE64_ID>`, `?v=` pairing, generations and cleanup for both module stores, `module64Stored`/`module64Full` in STATUS, a room check before storing it. |
| Desktop | Both modules in the package (`desktop/build.sh` checks them); version 0.4.0 (not released). Neutralino opens Chrome/Chromium/Edge, which have Memory64 from 133. |

**Measured in the app (Chromium 141 of the Playwright SIF, 16 threads, from New search with a user
preset of the calibration's TMT settings, semi-tryptic, not chunked; `e2e/engine.spec.ts` "a search above
3 GB…", on demand with `PROSE_LARGE_MZML`/`PROSE_LARGE_FASTA`/`PROSE_LARGE_PARAMETERS`):**

| Search | Footer (estimate) | Engine | Peak heap | Time | PSMs | Longest silent step |
|---|---|---|---|---|---|---|
| erwinia_tmt.mzML vs human_ref.fasta (20,652 + 116 cRAP) | 8.8 GB · 64-bit | wasm64 | 8.66 GiB | 54 s | 0 (none expected) | 48.7 s |
| the same vs Erwinia + human (25,151 + 116) | 10.5 GB · 64-bit | wasm64 | 9.66 GiB | 66 s | 1,346 | 59.0 s |
| as the first, with Acetyl (Protein N-term) as well (the default preset's modifications) | 16.6 GB (×2 rule) → 8.8 GB (not counted) | wasm64 | 8.56 GiB | 54 s | 0 | 49.0 s |

The forced example (`?debug=wasm64`) gives the same 1,790 PSMs and 47 protein groups as wasm32
(e2e `engine64.spec.ts`); in Node the same search gives identical PSM scores, q-values, peptides,
spectra and predicted spectra in both modules (proteins and some lists of allowed values in another
order: hashed containers, `core64.test.ts`).

Costs: wasm64 is 8–22 % slower without PeptDeep at 4 threads (4–8 % with), 8–19 % at 16; its
`openms.wasm` is 46.2 MB (7.72 MB brotli, 11.1 MB gzip), downloaded only when a search first needs it.

### 5.7 UX decisions the user made (brainstorming)

| Decision | Where it lives |
|---|---|
| Stack Svelte + Vite + shadcn-svelte; a separate project (prose-web) | §5 |
| Design table **File · Condition · Replicate · Fraction** on top of the OpenMS `design.tsv` | §5.3.1 |
| **No guessing** of the design from file names | §1.3, §5.3.1 |
| **FDR unambiguous**: always a percentage with the q-value beside it ("1 %" · "q ≤ 0.01"), quick choices 0.1/1/5 % | §5.3.3 |
| Modified residues **encoded as a marked residue** by default, with a **switch to ProForma**; exports always ProForma | §5.4 |
| **Spectra peaks stored with the results** (History and project files show spectra without the mzML) | §4.6, C11 |
| **No intensities** / no quantification: samples compared by identification counts | §1.3 |
| Numbers "similar, not identical" to native ProSE | §1.4 |
| Multiplexed designs out of scope | §1.3 |

### 5.8 App tests

At W64 fix round 2: vitest 47 files, 562 tests (the residues in `files.test.ts`, the human
non-specific rows in `memory.test.ts`, an unreadable database and a count held at Start in
`plan.test.ts`, the chunked advice in `client.test.ts`); `npm run check` 1052 files, 0 errors; e2e 101
tests (99 pass, 2 on demand), `deploy.spec.ts` ×23 (+ an update keeps the 64-bit engine an open tab of
the previous version uses).

At W64 fix round 1 (packages 76607e6451): vitest 47 files, 556 tests (new since W64: `session.test.ts`;
the counted proteins in `plan.test.ts`, the non-specific measurements in `memory.test.ts`, the lazy
64-bit restart in `client.test.ts`); `npm run check` 1052 files, 0 errors, 0 warnings; e2e 100 tests (98
pass, 2 on demand: `PROSE_BIG_MZML`, `PROSE_LARGE_MZML`), with `engine64.spec.ts` ×4 (+ a search started
while the proteins are counted) and `deploy.spec.ts` ×22 (+ an update over a stored 64-bit engine; the
room note survives a stopped worker). The formerly flaky `an engine error names the stage and the file…`
passes 20 of 20 on 76607e6451 (decisions "W64 r1 packages").

At W64 (the 64-bit engine, 2026-10-20): vitest 46 files, 549 tests (new: `variant.test.ts`,
`core64.test.ts` with the real 64-bit module in Node 24, `sw-stamp.test.ts`; the calibration table in
`memory.test.ts`; the module in `client.test.ts`, `plan.test.ts`, `record.test.ts`, `history.test.ts`);
`npm run check` 1051 files, 0 errors, 0 warnings; e2e 98 tests (96 run, 2 on demand). Each commit of the
series passes check and vitest on its own.

At C12 fix round 3: vitest 43 files, 516 tests; `npm run check` 1046 files, 0 errors, 0 warnings; e2e
92 tests (91 pass, 1 on-demand skipped: `PROSE_BIG_MZML`), with `deploy.spec.ts` ×19: round 3 added
the notice during a running installation, a 30 MB and an 80 MB quota, other pages of the site, and the
newer-version message for the module (they fail on 78d4743); before that ×14 (isolation and
stores; a server-isolated first start ends up working offline; the A→B module update; an update never
applied, then offline; an aborted update, then offline; a model fetched after a deployment; old tabs
starting workers before and after another tab's Reload; offline; offline before the example was
stored; PeptDeep under the worker; the earlier demos' worker unregistered; blocked session storage;
refused and missing registration). The four update tests fail on f576241. Outside the suites: the
local `_site` check (plain static server under `/prose-web/`) and the Linux desktop check (§8.8).

At C7 (e26e083): vitest 28 files, 252 tests (incl. `core.test.ts` against the real threaded module at
8 threads, ≈ 40 s); `npm run check` 874 files, 0 errors, 0 warnings; e2e 21 tests: smoke ×3 (`the app
shell renders`, `the URL hash mirrors the view`, `the page is cross-origin isolated`), engine ×1, search
×1 (`example search end to end`: 1,790 PSMs in Results, idXML export), new-search ×10, results ×6
(`scrolls a 150k-row PSM table`, `sorts and filters proteins`, `exports the filtered view as CSV`,
`switches modifications to ProForma`, `tables are keyboard-navigable and filters are labelled`, `an
open search without protein FDR: the shifts, the score, the unavailable filter`).

---

## 6. Decision log

Every ruling of the three ledgers, grouped by area, with what was decided, why, the cost if wrong, and
supersessions: **[`prose-app-spec/decisions.md`](prose-app-spec/decisions.md)**.

Supersessions in brief: B-R7 supersedes B-R4 (no golden idXML; the FileInfo summary is the reference);
C-R13 supersedes the earlier note "the worker calls `set.delete()`" (B-R18 note); B-R8 removes
`percolator.seconds` from the plan's contract; C-R14's "OPFS storage waits for B9" is overtaken by B9's
choice of per-file streaming (§4.11).

---

## 7. Known limitations and follow-ups

| # | Item | State / owner |
|---|---|---|
| 1 | **OpenMS library bug, MzMLHandler skipChromatograms**: `MzMLHandler.cpp:160` takes `skip_chromatogram_` from `PeakFileOptions::getSkipChromatograms()` in `setOptions`, and `startElement()`/`onCharacters()` return early on `skip_spectrum_ \|\| skip_chromatogram_`, so `setSkipChromatograms(true)` returns every spectrum empty (default spectra: no native ID, MS level 1, no peaks). Since d49ba5f392a (2025-05-06). Class tests miss it (`MzMLFile_test.cpp:1910` checks only that chromatograms are gone; `FileHandler_test.cpp:930`). `SwathFile.cpp:266` sets it, via FileHandler for Thermo RAW (presumably unaffected; worth checking). The binding avoids the option | follow-up for the user, separate [FIX] with a test that spectra are intact |
| 2 | **mimalloc upstream issue** (Emscripten 6.0.12, mimalloc 3.5.1): allocations above a 4 MiB chunk need fully free chunks, arenas are never released and grow exponentially, the OS fallback over-aligns to 16 MiB; any workload with large short-lived blocks grows the wasm heap. Also ORT: no CPU arena on 32-bit, memory pattern on by default | follow-up: issue at emscripten-core/emscripten; **worked around** by OpenMS' own build of mimalloc (`openms-mimalloc`, PR #10659, in the app since 3.7.0-pre.fd807dc89a: 20–47 % less heap in wasm32, no scattering; emmalloc's wasm64 limits reported as emscripten#28028) |
| 3 | **Heap growth per search** (+116…212 MB per search at 8 threads), never released; within one search file by file, each further file grows the heap too: about 0.2 GB per further small file at 4 threads (12 × 75 MB measured 2.9 GB), 0.07–0.12 GB per 733 MB file, more with more threads and PeptDeep (C4b model, §5.3.5) | mitigated by a fresh worker per search and the 4-thread cap for many files (§5.2); with openms-mimalloc the growth levels off (12 × 75 MB 0.66 GB at 4 threads, 0.80 at 16), modelled by the new growth schedule (§5.3.5) |
| 4 | **#10602's CI matrix has not run** (only cppcheck); the `TOPP_ProSE_13` tolerances (±1 protein, ±6 PSMs, from Test 6 without Percolator) are unverified on macOS/Windows; if CI differs, investigate before widening | keep watching; retarget after #10578 |
| 5 | Inputs inside the 4 GB heap; staging ≈ 25 MB/s | resolved by B9 + C4b: file by file, only the largest file (≤ 2 GiB − 64 MiB) in the heap; 3 × 733 MB in 2377 MiB (one: 2153 MiB) in Chromium at 4 threads; `writeFileChunk` staging (1.2 s per 733 MB) |
| 6 | `collisionEnergy` NaN for typical mzML (MS:1000045 is a precursor meta value) | B final fix wave |
| 7 | The example finds 0 proteins at 1 % protein FDR (a decoy ranks first among 49) | C-R16 in progress + engine investigation |
| 8 | Percolator has no progress step (≈ 10 s per file silent) | library change, not planned; the UI shows an indeterminate bar |
| 9 | `mergeFileResults()` "Graph empty" with no PSM in any file | follow-up for #10602 (return an empty MergedResult); the binding works around it |
| 10 | Mixed rescoring (one file with < 100 PSMs) fails the whole rescored search | library rule; the app maps the message |
| 11 | Chunked semi- and non-specific searches are not bounded by the chunk or by the inputs. Human semi-tryptic in chunks of 2000, 78 MB erwinia_tmt, 4 threads, file by file, Chromium: 2.3, 2.4 and 3.7 GB for 1 file (three runs), 3.8 GB (3913 MiB of 4096) for 3 files (three runs); the formula gives 1.4/1.8 GB. Set by the chunk index rebuilt for every file (~11 builds per file) and how little of it the allocator reuses, not by the inputs; growth per file 0.05–0.75 GB, not repeatable. Node, 4 threads, 3 files: file by file 2243/3783 MiB in 102 s; all files at once (chunk-major, inputs host-mounted) 2695/2711 MiB in 49 s, one of three runs aborted | **resolved** by openms-mimalloc (W64): chunks of 2000 take 1.48–1.65 GB in wasm32 at 4–16 threads, 3 files no more than 1; the formula estimates chunked searches (§5.3.5); the floor, the file rule and the thread cap are gone |
| 12 | `PeptDeepRescoring`'s own `batch_size` default stays 500 in wasm (only ProSEAlgorithm's changed); large unique 500-peptide batches untested | final fix wave shared constant |
| 13 | predictMS2's first call ≈ 0.5 s; sessions never evicted | app should warm up early (C9) |
| 14 | Node: 8 MB stacks × all cores for OpenMP and ORT | pre-existing, tight but passing |
| 15 | `wasmfs_node.js` override must be dropped once emscripten#27825 is fixed (the `#warning` fires on other Emscripten versions) | follow-up |
| 16 | `package.json` of the copied package lists `openms.data` and `README.md`, which the app copy does not ship (inherited) | deferred minor |
| 17 | 63 MB per package update lands in git history of prose-web (with wasm64 about 110 MB per update of both) | accepted (C4 review minor) |
| 18 | **Memory estimate calibrated on one spectra file and two databases** (W64): the index depends on the precursor masses of the spectra; non-specific searches measured on both, scaled by residues (W64 r2; wasm32 unchunked unmeasurable: it aborts), modifications other than Oxidation/Deamidated unmeasured; of the terminal ones only Acetyl (Protein N-term) measured (adds nothing: protein-terminal entries are not counted, decisions "W64 terminal modifications") | follow-up: calibrate with more varied spectra and other modifications |
| 19 | **wasm64 is slower** (8–22 %) and a 46 MB download on first use; offline only after a first use; Safari has no Memory64 (above 4 GB the footer says so) | accepted (the user's rule: wasm32 by default) |
| 20 | The thread cap for many files (> 4, or > 2 with PeptDeep) was justified by Emscripten's allocator (12 × 75 MB: 2.9 GB at 4 threads, 4.0 GB at 16); with openms-mimalloc 0.66 vs 0.80 GB | kept as it was (W64 changed only the chunked cap); a decision for the user |

Deferred minors that matter (from the ledgers; full list in the decision log):

- A: no file when all failed (Minor 8) and DRY with `applyCompleteSetProteinFDR` (Minor 9), post-merge;
  the "runs disagree → omit" NCE fallback untested; an exception inside a nested step leaves the outer
  step open (pre-existing in `search()`); `id_merge_index` is shared by the same path given twice in
  `-in`.
- B: TS status literal union/options alias incl. null|undefined (recorded for C4); the "rescored only
  some" inference on `InvalidValue`; weak heap test; isotope sign flip and >4096-PSM stamping untested;
  `pin_not_features` copies Percolator.cpp's 6-name list; non-MS2 model cached; HO3P→HPO3 untested;
  precursor peak only at `maxCharge`; predictMS2 accepts any NCE ≤ 0 (until B-R29); the close test is
  Linux-only and relies on the descriptor number staying free.
- C: File-column end truncation at 1024–1280 px with Advanced; the ">2 s silent step" suffix may attach
  to other errors; PSM text filter does not search nativeId/file; +Infinity ties with NaN in sort;
  `$lib` alias written 4×; `npm run e2e` does not build first and may reuse a stale preview; the
  `storage` event (other tab) is not observed for modMode; the design table is not virtualized (fine
  for 6–12 files); condition-less implicit groups get no `unevenFractions` notice.

---

## 8. Recreate it, step by step

Commands are those used for this work on ibminode06. Where a repository's own docs hold the details,
they are referenced: **OpenMS `src/openms_wasm/README.md`** (sections "Building", "Machine learning:
ONNX Runtime and PeptDeep", "Several files and the ProSE app", "Serving the module") and the copy in
prose-web `README-openms-wasm.md` (of #10575, older).

### 8.1 Toolchain

| Tool | Version / location |
|---|---|
| Emscripten SDK | **6.0.12**, `/scratch/sachsenb/emsdk` (`./emsdk install 6.0.12 && ./emsdk activate 6.0.12`; `source emsdk_env.sh` sets `EMSDK`) |
| Node.js | 24.19.0 from emsdk: `/scratch/sachsenb/emsdk/node/24.19.0_64bit/bin` (no system node on the host) |
| TypeScript for Embind's d.ts generation | `tsc` 7.0.2 on PATH: `/scratch/sachsenb/tools/node_modules/.bin` (linking fails without it) |
| CMake + Ninja | CMake ≥ 3.24; Ninja (`/home/sachsenb/bin/ninja` for native) |
| vcpkg | OpenMS submodule `vcpkg` at f9ffbaa46a (2026.05.25-91); binary cache `/scratch/sachsenb/vcpkg-bincache`; `flex` and `bison` on the machine (Apache Thrift) |
| vcpkg overlays (wasm) | `vcpkg-overlays/emscripten/ports/onnxruntime` (**ORT 1.23.2**, port-version 1: static, `onnxruntime_ENABLE_WEBASSEMBLY_SIMD=ON`, threads ON for the `-pthread` triplet, no LTO, no onnxruntime-web module, no cpuinfo) and `…/onnx` (1.19.0, static, `ONNX_DISABLE_STATIC_REGISTRATION=ON`; ORT registers the schemas); also `arrow`, `highs`, `thrift` |
| Container | singularity/apptainer only (no docker, no conda). Playwright SIF `/scratch/sachsenb/pr10564_review/playwright.sif`: Node 22.20.0, `/ms-playwright` with chromium-1194 (Chromium 141), firefox-1495, webkit-2215 |
| Neutralino | 6.10.0 (binaries and client), CLI `@neutralinojs/neu@11.8.0` via npx |
| App deps | `app/package-lock.json` (§5) |

### 8.2 Clone and branches

```bash
# OpenMS (parts A and B)
git clone https://github.com/OpenMS/OpenMS.git /scratch/sachsenb/openms-pr10564
cd /scratch/sachsenb/openms-pr10564
git switch claude/wasm-prose-app-bindings        # part B (contains part A, merged at 31d9598ee8)
git submodule update --init vcpkg
# part A on its own, as a worktree (A-R1)
git worktree add /scratch/sachsenb/openms-merged claude/prose-merged-in-library

# prose-web (part C, the site, these docs)
git clone https://github.com/timosachsenberg/prose-web.git /scratch/sachsenb/prose-pages
git -C /scratch/sachsenb/prose-pages switch prose-app
```

At this snapshot GitHub's `claude/wasm-prose-app-bindings` is be22770d6a (B7); B8 (`..006a261fb3`)
exists only in the local repository until it is pushed, and B9 is uncommitted. GitHub's `prose-app`
is 639779d; the local branch is at e26e083 or later.

### 8.3 Native build (part A, class and TOPP tests)

`/scratch/sachsenb/wasm-logs/native-merged.sh` configures; it reuses the vcpkg checkout and
`vcpkg_installed` of `/scratch/sachsenb/openms-develop-prose` (incl. onnxruntime). **Use a clean
PATH**: Linuxbrew's binutils (`as` 2.36) cannot assemble ONNX Runtime's AVX-NE-CONVERT kernels.

```bash
# native-merged.sh, verbatim:
export VCPKG_MAX_CONCURRENCY=64
export VCPKG_BINARY_SOURCES="clear;files,/scratch/sachsenb/vcpkg-bincache,readwrite"
export PATH="/home/sachsenb/bin:/usr/local/bin:/usr/bin:/bin"
cd /scratch/sachsenb/openms-merged
cmake --preset linux-x64-release -B OpenMS-build -DCMAKE_MAKE_PROGRAM=/home/sachsenb/bin/ninja \
  -DCMAKE_TOOLCHAIN_FILE=/scratch/sachsenb/openms-develop-prose/vcpkg/scripts/buildsystems/vcpkg.cmake \
  -DVCPKG_INSTALLED_DIR=/scratch/sachsenb/openms-develop-prose/OpenMS-build/vcpkg_installed \
  -DVCPKG_TARGET_TRIPLET=x64-linux-dynamic \
  -DWITH_ONNX=ON -DVCPKG_MANIFEST_FEATURES=onnxruntime -DENABLE_CLASS_TESTING=ON -DBUILD_TOPP_TOOLS=ON \
  -DWITH_GUI=OFF -DWITH_THERMO_RAW=OFF -DWITH_OPENTIMS=OFF

# then, with the same clean PATH:
cmake --build /scratch/sachsenb/openms-merged/OpenMS-build -j 64
ctest --test-dir /scratch/sachsenb/openms-merged/OpenMS-build -R "ProSE|PeptDeep" -j 8 --output-on-failure   # 80/80
```

On a fresh machine without that sibling checkout, drop the three vcpkg overrides and let the preset
build the dependencies (OpenMS's usual vcpkg flow).

### 8.4 WebAssembly builds (part B)

```bash
source /scratch/sachsenb/emsdk/emsdk_env.sh
export VCPKG_MAX_CONCURRENCY=64
export VCPKG_BINARY_SOURCES="clear;files,/scratch/sachsenb/vcpkg-bincache,readwrite"
export PATH="/scratch/sachsenb/tools/node_modules/.bin:$PATH"     # tsc for the d.ts
cd /scratch/sachsenb/openms-pr10564

# single-threaded, no ONNX (must still compile; ONNX entry points throw there)
cmake --preset wasm32-emscripten-release                          # → build/wasm32-emscripten-release
cmake --build build/wasm32-emscripten-release --target openms_wasm -j 100

# threaded (plain), if wanted: preset wasm32-emscripten-mt-release → build/wasm32-emscripten-mt-release

# threaded with ONNX Runtime: what /scratch/sachsenb/wasm-logs/configure-onnx.sh does
# (the mt preset plus the ONNX variables = the preset wasm32-emscripten-mt-onnx-release,
#  but into build/wasm32-emscripten-mt-onnx; class tests on)
cmake --preset wasm32-emscripten-mt-release -B build/wasm32-emscripten-mt-onnx \
      -DWITH_ONNX=ON -DVCPKG_MANIFEST_FEATURES=onnxruntime -DENABLE_CLASS_TESTING=ON
cmake --build build/wasm32-emscripten-mt-onnx --target openms_wasm -j 100
# (cmake --preset wasm32-emscripten-mt-onnx-release is equivalent, with build dir
#  build/wasm32-emscripten-mt-onnx-release)
```

`/scratch/sachsenb/wasm-logs/configure.sh <preset>` wraps the first form. vcpkg builds ORT for the
`wasm32-emscripten-mt` triplet in about two minutes; the build downloads the PeptDeep models into
`<build>/openms-wasm/models/`. The module's settings are in `cmake/emscripten.cmake` (§4.10) and
`src/openms_wasm/CMakeLists.txt` (`--js-library wasmfs_node.js`, from B9 also `wasmfs_fs.js`). The
package assembly of both builds (`assemble_package.cmake`) is in the README; the app does not use it.

### 8.5 Node and browser tests of the module

```bash
cd /scratch/sachsenb/openms-pr10564
for B in build/wasm32-emscripten-mt-onnx build/wasm32-emscripten-release; do
  OPENMS_WASM_MODULE=$PWD/$B/openms-wasm/openms.mjs \
    node --test --test-reporter=spec src/openms_wasm/tests/*.test.mjs
done
# class tests on the wasm library (README "Building"): build the targets, run with ctest
cmake --build build/wasm32-emscripten-mt-onnx --target ProSEAlgorithm_test PeptDeepRescoring_test -j 100
ctest --test-dir build/wasm32-emscripten-mt-onnx -R "ProSEAlgorithm_test|PeptDeepRescoring_test" --output-on-failure

# Chromium tests of the package (tests/browser/run.mjs), in the SIF with the app's playwright-core:
singularity exec --bind /scratch/sachsenb,/tmp /scratch/sachsenb/pr10564_review/playwright.sif \
  env PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
      PLAYWRIGHT_MODULE=/scratch/sachsenb/prose-pages/app/node_modules/playwright-core \
  node src/openms_wasm/tests/browser/run.mjs build/wasm32-emscripten-mt-onnx/openms-wasm
```

(The README's variant installs `playwright-core` into `/tmp/pw`.) The OpenMP team in Node defaults to
all logical cores; `OMP_NUM_THREADS=4` mimics the 4-vCPU CI runner.

### 8.6 Package the module into the app

Both packages, as `/scratch/sachsenb/wasm-logs/wasm64/packages/make-packages.sh` makes them from
OpenMS PR #10659 (the presets `wasm32-emscripten-mt-onnx-release` and `wasm64-emscripten-mt-onnx-release`;
version 3.7.0-pre.<10-character hash of the commit the modules were built from>, B-R26, in the copies only):

```bash
P=/scratch/sachsenb/wasm-logs/wasm64/packages        # wasm32/, wasm64/ (make-packages.sh)
A=/scratch/sachsenb/prose-pages/app/public
cp $P/wasm32/{openms.mjs,openms.wasm,openms.d.ts,package.json,LICENSE} $A/openms/
cp $P/wasm32/models/peptdeep_ms2_dynamic.onnx $P/wasm32/models/peptdeep_rt_dynamic.onnx $A/openms/models/
mkdir -p $A/openms64
cp $P/wasm64/{openms.mjs,openms.wasm,openms.d.ts,package.json,LICENSE} $A/openms64/
# the 64-bit package has no models/: it uses openms/models/ (the files are identical, check with cmp)
cmp $P/wasm64/models/peptdeep_ms2_dynamic.onnx $A/openms/models/peptdeep_ms2_dynamic.onnx
```

Not copied: `README.md`, `serve.py`, `examples/`, the CCS model. Commit the copies in prose-web on
their own ("app: OpenMS module packages <version>", as 6acff06; B-R3). `openms-types.ts` re-exports
the types from `public/openms/openms.d.ts`, so `npm run check` catches contract changes; the two
`openms.d.ts` differ only in the raw export interface (OpenMS CI compares them). `core64.test.ts` runs
the 64-bit module in Node 24 against the 32-bit one.

### 8.7 Build and test the app

```bash
export PATH=/scratch/sachsenb/emsdk/node/24.19.0_64bit/bin:$PATH
cd /scratch/sachsenb/prose-pages/app
npm ci
npm test              # vitest (core.test.ts loads public/openms/openms.mjs, ~40 s)
npm run check         # svelte-check + tsc -p tsconfig.node.json
npm run build         # → app/dist, base /prose-web/  (desktop: VITE_BASE=./ npm run build)
npm run dev           # local development with COOP/COEP (vite)

# e2e: build first (npm run e2e does not), then in the SIF
singularity exec --bind /scratch/sachsenb,/tmp /scratch/sachsenb/pr10564_review/playwright.sif \
  env PLAYWRIGHT_BROWSERS_PATH=/ms-playwright env -C /scratch/sachsenb/prose-pages/app npm run e2e
# one spec: ... npm run e2e -- results
# the config starts vite preview on 4173 (isolation headers) and 4174 (none, deploy.spec.ts) unless
# servers already listen there: make sure nothing else holds those ports
```

Debug hooks: `?debug=large` (150k PSMs / 20k peptides / 4k proteins, PSM FDR 100 %), `?debug=small`
(open search, no protein FDR, no Percolator), `?debug=engine` (`window.__engine`).

### 8.8 Deploy

Today (`main`): GitHub Pages serves the repository root of `main` (start page `index.html`, the demo
`examples/prose/`, `examples/sw.js`, the module files and `models/` in the root, `data/`,
`prose-single-file.html`); `serve.py` serves it locally with the isolation headers
(`python3 serve.py`, http://localhost:8000/examples/prose/). The desktop app is built with
`desktop/build.sh` (needs node/npx, curl, unzip, zip; Neutralino 6.10.0, `chrome` mode, fixed port
47815, `serverHeaders` with COOP/COEP, `url` `/examples/prose/`, version 0.2.0 in
`desktop/neutralino.config.json`; one zip per platform in `desktop/dist/`: linux_x64, linux_arm64,
win_x64, mac_universal) and published with `gh release create`.

For the app (C12, built; §2.4, §5.6). Pushing `main`, switching Pages and the release wait for the
user's approval of screenshots. Since W64 the site is about 179 MB (both modules; 133 MB before) and a
desktop zip about 41.7 MB (30.6 MB with one module); a first visit still downloads only the shell
(1.1 MB) and the wasm32 module (44.5 MB, about 10.8 MB gzip), then the example and cRAP (6.6 MB); the
64-bit module (46.4 MB, about 11.1 MB gzip) only with the first search that needs it.

```bash
# the site, as .github/workflows/pages.yml builds it
cd /scratch/sachsenb/prose-pages/app && npm ci && npm run build && cd .. && .github/assemble-site.sh _site
# served as GitHub Pages serves it (no COOP/COEP), at /prose-web/
mkdir -p /tmp/pages-root && ln -sfn $PWD/_site /tmp/pages-root/prose-web
(cd /tmp/pages-root && python3 -m http.server 8765 --bind 127.0.0.1)
# first switch Pages to the workflow (once): the site deployed before stays live until the workflow
# deploys; then push main, which runs the workflow. (Pushing first would let branch-mode Pages publish
# main's root, the pointer index.html without the app, until the switch.)
gh api -X PUT repos/timosachsenberg/prose-web/pages -f build_type=workflow
git push origin main

# desktop 0.4.0 since W64, both modules (the app built with VITE_BASE=./ into the package)
NEU_CLI=/scratch/sachsenb/tools/node_modules/.bin/neu desktop/build.sh
# Linux check: xvfb + Playwright's Chromium as the program's browser, remote debugging
# (prose-bench/browser/desktop-check3.mjs <port> <prime|search>, run inside the Playwright SIF)
xvfb-run -a sh -c './prose-linux_x64 --chrome-browser-binary=/ms-playwright/chromium-1194/chrome-linux/chrome \
  --chrome-args="--remote-debugging-port=9333 --no-sandbox --no-first-run" & node desktop-check3.mjs 9333 search'
```

Checked on 2026-10-20 after W64 fix round 1 (packages 76607e6451), not deployed: the same `_site`
checks (26 manifest files over HTTP, ids `e95c352237b7`/`38f10ad8bd3b`, the shell without either
module; in Chromium the first visit stores only wasm32, the forced 64-bit example 1,790 PSMs and its two
`?v=` files in `openms64-module-38f10ad8bd3b`); desktop linux_x64 0.4.0: works offline at the first
start, the example with PeptDeep in wasm64 1,790 PSMs in 25.7 s; the large case again 8.66 GiB, 53 s.

Checked on 2026-10-20 after W64 (6b099e7), not deployed: the local `_site` (`assemble-site.sh`, plain
static server under `/prose-web/`) serves all 26 files of `sw.js`'s manifest with their size and SHA-256,
both module ids are the hashes of their directories, the shell (11 files) holds neither module, both
`openms.wasm` come as `application/wasm`; in Chromium the first visit stores only the shell and the
wasm32 module (chip title: "The 64-bit engine for large searches not stored yet"), the example forced
into wasm64 finds 1,790 PSMs and `openms64-module-<id>` then holds exactly its two files with their
`?v=`. Desktop linux_x64 0.4.0 (fresh profile, xvfb, Playwright's Chromium 141): works offline at the
first start; the example with PeptDeep in wasm64 1,790 PSMs in 24.8 s, the models stored once (wasm32
package's id), the 64-bit module in its own store.

Checked on 2026-10-20 after fix round 3, from the commit itself: the Pages check 20/20; the
review's probes (`/tmp/c12rr2/probe`, B made by the review's own `mkb.mjs`, which also changes
`openms.mjs`): `notice-race` 10 of 10 runs with the notice (also after a plain reload); `quota` 30 MB
(OpenMS loads online, the chip's title says the storage is full) and 80 MB (B arrives, waiting, on
every load); offline-after-update, aborted, tabs, pthreads, partial, bookkeeping (a non-app window no
longer keeps A), frozen (a frozen A tab does), conflict (the module message), desktop (first start
works offline), hash (174 ms for the wasm) as intended; models: the search fails 0.45 s after Start
(the probe's 33 s was its own 30 s wait for the progress element, gone once the search failed).
Desktop linux_x64 with the upgrade from 0.2.0 as below.

Checked on 2026-10-19 after fix round 2, from the commit itself (`git archive`, `npm ci`, build,
`assemble-site.sh`). Pages check (`_site` A, and B = `fakeUpdate()` of the app build copied over the
site, under a Pages-like server: max-age=600, no COOP/COEP): 20/20 ("Loading ProSE…"; one reload;
16 threads; works offline; A paired; example and cRAP stored; the example search 1,790 PSMs; the demo
isolated by its own worker, the app's stores survive it; B's first load B/B, nothing of B in A's
stores; "Update ready"; after Reload B paired, B's wasm stored, A's stores gone, the demo's kept;
both redirects; an `examples/prose/` worker unregistered; `data/`, `prose-single-file.html`,
`README.md` byte-identical). The review's probes (`/tmp/c12rr/probe`, test builds made with
`fakeUpdate()`): offline-after-update (B starts offline, the example too), aborted (A's store keeps
A's page, offline OK), models (the search fails cleanly, nothing stored), tabs with renamed and with
unrenamed chunks (the old tab starts engine workers with A's module before and after the takeover; its
model request fails cleanly with 409), pthreads (no network requests), storage (one document
request, 1 thread), notice layout (one row 1100–901 px, no overflow down to 480 px), code cache
(1.34 MB beside the wasm, ≈ 1 s start, also for a wasm stored by an update's installation). Desktop
linux_x64: 0.2.0 (released zip) then 0.3.0 on the same profile: 0.2.0's worker and stores gone, the
worker active, isolated, 16 threads, works offline; the example with PeptDeep in 20.8 s (1,790 PSMs),
a PSM's spectrum; a fresh profile likewise, "works offline" already on the first start (20.7 s); the
program ends about 11 s after the window closes.

---

## 9. Status

Commit ranges are `base..head` on the task's branch (OpenMS: `claude/prose-merged-in-library` for A,
`claude/wasm-prose-app-bindings` for B; prose-web: `prose-app` for C).

| Task | Content | Status | Commits |
|---|---|---|---|
| A1 | Characterization test of `-out_merged` (TOPP_ProSE_13) | done | 8bd10f7c62..9761d51160 |
| A2 | `mergeFileResults()`, used by the tool; `id_merge_index` = input position | done | 9761d51160..582e07de2c |
| A3 | Per-file progress step | done | 582e07de2c..dca3780684 |
| A4 | `peptdeep_nce` run meta value | done | dca3780684..e8029a3f05 |
| A5 | CHANGELOG, PR #10602; final fix wave (`remove_decoys`, input check, `NCE_META_VALUE`) | done (PR open, CI matrix not run) | e8029a3f05..7f1af02738; final wave 7f1af02738..8c2347422b |
| B1 | Branch with part A merged; rescoring by the search | done | 80a3b501c4..7acde3924f (merge 31d9598ee8) |
| B2 | `searchFiles()`, `ProSEResultSet`, progress stack | done | 7acde3924f..3aede0fb14 |
| B3 | `tables()`; public `pinEnzymeName()` | done | 3aede0fb14..f1bce22762 |
| B4 | `spectra()` | done | f1bce22762..2fbba39394 |
| B5 | `annotatePeaks()` | done | 2fbba39394..15758ba58c |
| B6 | `predictMS2()` | done | 15758ba58c..f696a5ec87 |
| (B-inv) | Node exit abort: WasmFS fix for emscripten#27825 | done | f696a5ec87..a078f43fde |
| B7 | Docs, carried fixes, package 3.7.0-pre.d2a798a00d, PR #10604 (draft) | done | a078f43fde..be22770d6a (pushed) |
| B8 | PeptDeep heap retention; batch size 128 on wasm | done (not pushed) | be22770d6a..006a261fb3 |
| B9 | Inputs outside the heap: spike done (S chosen), implementation | in progress (B9) | base 006a261fb3, uncommitted |
| (B-final) | Final fix wave (B-R28/R29, collisionEnergy, batch-size constant) and final re-review | planned (B-final) | — |
| C1 | Scaffold; cRAP FASTA | done | ac67a75..61d3164 |
| C2 | Experimental design model, design.tsv, SDRF | done | 61d3164..d2ad679 |
| C3 | Peptide/modification and FDR display | done | d2ad679..000f850 |
| C4 | Engine worker and client; module package | done | 639779d..92a7b68 (6acff06, b4e8ce7, 92a7b68) |
| C4b | Staging through B9's mechanism; thread cap, watchdog, cancel; deferred C4 minors | done (review approved after fix round 2) | 67d35c0..efddf22 |
| C5 | Results model, filters, sorting, CSV | done | 000f850..639779d |
| C6 | New search page | done | 92a7b68..5cc4082 |
| C7 | Results view, virtualized tables, filters, CSV export | in review (fix round 1, C-R16, in progress) | 5cc4082..e26e083 |
| C8 | Protein panel | planned (C8) | — |
| C9 | PSM view | planned (C9) | — |
| C10 | Overview, Samples, QC, open search | planned (C10) | — |
| C11 | History and project files | done (review approved after fix round 1) | 67d35c0..0048e06 |
| C12 | Service worker, Pages deployment, desktop | deployed 2026-10-20: Pages switched to the workflow, `main` = ce51dae (build 4d0e6fd34b7e), desktop 0.3.0 released; live checks passed (first visit isolated, 16 threads, works offline; example 1,790 PSMs; offline search; upgrade from 0.2.0) | 3b943ec..0fbde6b; fix round 1 0fbde6b..f576241; round 2 ..78d4743; round 3 (commit "app: service worker fix round 3") |
| W64 | The 64-bit engine: packages 3.7.0-pre.fd807dc89a, then 76607e6451 (wasm32 + wasm64), the choice above 3 GB with Memory64, the estimate of both modules recalibrated (no `uncertain`), the engine shown and recorded, the service worker storing wasm64 on first use, desktop 0.4.0 (§5.9, decisions §4.9) | done locally, fix rounds 1 and 2 done (not pushed, not deployed; screenshots for the user) | da0c786..6b099e7 and 5746fe6 (docs); fix round 1 5746fe6..74ebe8b; fix round 2 the commits after 74ebe8b, `prose-app` |
| — | This as-built specification | snapshot; to be updated at the end (user request 2026-10-17) | this commit |

Execution order (C-R2): A1–A5, C1, C2, C3, C5, B1–B7, C4, C6–C12; one implementer at a time per
repository; B8 → B9 → B final wave sequential (shared build dirs); C work runs in parallel with B.
