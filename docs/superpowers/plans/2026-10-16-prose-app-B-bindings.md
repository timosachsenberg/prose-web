# ProSE app, part B: WebAssembly bindings for the app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the OpenMS WebAssembly module what the ProSE app needs:
- a multi-file search with pooled FDR and protein inference;
- the results as compact typed columns;
- the stored peaks of identified spectra;
- peak annotation from stored arrays;
- PeptDeep MS2 prediction on demand.

**Architecture:**
- New Embind entry points in `src/openms_wasm/bindings/bind_prose.cpp`, plus a new
  `bind_prose_tables.cpp` for the column export. They call part A's `mergeFileResults()`, so the pooling
  is native ProSE's.
- Results stay in a C++ `ProSEResultSet` object, held by JavaScript until `delete()`. JavaScript pulls
  tables, spectra or idXML from it.

**Tech Stack:** C++20 + Embind (Emscripten 6.0.12), Node.js 24 `node --test`, the threaded ONNX build.

**Spec:** `docs/superpowers/specs/2026-10-16-prose-app-design.md` ("Engine work", "Persistence", "Settled while reviewing").

## Global Constraints

- **Repository and branch:**
  - Repository `/scratch/sachsenb/openms-pr10564`.
  - New branch `claude/wasm-prose-app-bindings`, from `claude/wasm-prose-webapp` (PR #10575, head
    80a3b501c4), with part A's branch `claude/prose-merged-in-library` merged in.
  - PR base: `claude/wasm-prose-webapp`.
- **Builds and tests:**
  - Main build: `cmake --preset wasm32-emscripten-mt-onnx-release` into `build/wasm32-emscripten-mt-onnx`,
    with `ENABLE_CLASS_TESTING=ON` (configure script `/scratch/sachsenb/wasm-logs/configure-onnx.sh`).
  - Source `/scratch/sachsenb/emsdk/emsdk_env.sh`, and put `/scratch/sachsenb/tools/node_modules/.bin`
    on PATH (tsc).
  - The single-threaded build without ONNX (`wasm32-emscripten-release`) must still compile. The new ONNX
    entry points throw there with "built without ONNX Runtime".
  - JS tests: `OPENMS_WASM_MODULE=<build>/openms-wasm/openms.mjs node --test --test-reporter=spec src/openms_wasm/tests/*.test.mjs`.
- **Every new JS-facing type** is registered in `js_types.h/.cpp` and appears in `openms.d.ts`. The TS
  shapes below are the contract part C codes against; names and types are exact.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; CHANGELOG entries go
  under the existing WebAssembly entries.

## Review Focus

- **Two input files with the same basename.**
  - Expect: the binding writes them under distinct paths; `files` keeps the caller's order;
    `psms.file` indexes that order.
  - Test: Task 2 `searchFiles keeps files with the same name apart`.
- **A PSM whose spectrum is missing from the re-read file** (native ID mismatch).
  - Expect: `psmSpectrum[row] = -1`, never a throw.
  - Test: Task 4 `spectra() marks PSMs without a readable spectrum with -1`.
- **Peptides with N-/C-terminal and unlocalized modifications** in ProForma and the mod arrays.
  - Expect: N-term position −1, C-term = length, and ProForma `[Acetyl]-PEPTIDE`.
  - Test: Task 3 `tables() encodes terminal modifications`.
- **ONNX entry points on a module without ONNX Runtime.**
  - Expect: a clear JS Error, no abort.
  - Test: Task 6 `predictMS2 throws without ONNX Runtime` (skipped when `hasONNXRuntime()`).
- **Memory of the result set.**
  - Expect: `delete()` frees it; a second search after `delete()` does not grow the heap by the size of
    the first result set.
  - Test: Task 2 `ProSEResultSet.delete() releases the results`.

---

### Task 1: Branch with part A merged; the build stays green

**Files:** none new.

- [ ] **Step 1: Create the branch and merge part A.**
  `git switch -c claude/wasm-prose-app-bindings claude/wasm-prose-webapp && git merge --no-ff origin/claude/prose-merged-in-library`.
  Resolve conflicts in favour of part A in the files it touches: `ProSE.cpp`, `ProSEAlgorithm.*`,
  `PeptDeepRescoring.*`, tests.
- [ ] **Step 2: Build** `openms_wasm`, `ProSEAlgorithm_test` and `PeptDeepRescoring_test` in
  `build/wasm32-emscripten-mt-onnx`. Run the class tests with node from `src/tests/class_tests/openms`,
  and the JS tests. Expected: all pass (40 JS tests, PeptDeep class tests PASSED).
- [ ] **Step 3: Commit** the merge as is (`Merge … into claude/wasm-prose-app-bindings`).

### Task 2: `ProSEAlgorithm.searchFiles()` and `ProSEResultSet`

**Files:**
- Modify: `src/openms_wasm/bindings/bind_prose.cpp`
- Modify: `src/openms_wasm/bindings/js_types.h`, `js_types.cpp`
- Test: `src/openms_wasm/tests/prose.test.mjs`

**Interfaces:**
- Consumes: `ProSEAlgorithm::searchWithModificationAnalysis(files, fasta_entries, {}, "", true)`, and
  from part A `mergeFileResults()` and the per-file depth-0 progress.
- Produces:
  ```ts
  interface ProSEFilesOptions { rescore?: boolean /* default true */; keepSpectra?: boolean /* default true */ }
  interface ProSEFileSummary { path: string; status: string; ms2Spectra: number; targetPSMs: number; decoyPSMs: number;
    percolator: { applied: boolean; skipped: string | null; seconds: number } | null; peptdeepNce: number | null; secondsSearch: number }
  interface ProSEMultiSummary { files: ProSEFileSummary[]; proteinFdrApplied: boolean; psmFdr: number; proteinFdr: number;
    decoyString: string; openSearch: boolean; modificationAnalysis: ProSESummary["modificationAnalysis"] /* the aggregate, same shape as today */ }
  class ProSEResultSet { summary(): ProSEMultiSummary; tables(): ResultTables; spectra(): StoredSpectra;
    storeIdXML(path: string): void; delete(): void }
  // on ProSEAlgorithm:
  searchFiles(files: string[], database: string, options?: ProSEFilesOptions): ProSEResultSet
  ```
  - Progress events gain `file: number` (input index, −1 outside a file), set from the depth-0
    "Searching …" steps.
  - `peptdeepNce` is read from the run meta value `peptdeep_nce`.

- [ ] **Step 1: Write the failing tests** in `prose.test.mjs`. All copy
  `THIRDPARTY/DatabaseSuitability_in_spec.mzML` into a temp directory (`fs.mkdtempSync`) and mount it.
  Settings: those of ProSE_6_fdr.ini, `FDR:protein` 0.05.
  - `searchFiles pools two files like ProSE -out_merged`:
    - `summary().files.length === 2`; `proteinFdrApplied === true`.
    - After `storeIdXML("/tmp/m.idXML")`, loading it with `IdXMLFile` gives the same numbers of
      PeptideIdentifications with hits and ProteinHits as `src/tests/topp/ProSE_12_merged_out.idXML`
      (part A's reference, loaded through `/topp`).
  - `searchFiles reports one progress step per file`: the depth-0 start events carry `file` 0 and 1 and
    labels `Searching a.mzML (1 of 2)...` and `Searching b.mzML (2 of 2)...`.
  - `searchFiles keeps files with the same name apart`: two directories, both `run.mzML`. Expect
    `summary().files[0].path !== summary().files[1].path`, and PSMs with file index 0 and with 1.
  - `ProSEResultSet.delete() releases the results`:
    - heap after search 1 + `delete()` = `h1`;
    - after search 2 + `delete()` = `h2`;
    - expect `h2 - h1 < 0.2 * h1`.
- [ ] **Step 2: Run them.** Expected: FAIL ("searchFiles is not a function").
- [ ] **Step 3: Implement it.**
  - `ProSEResultSet` owns the `MultiFileSearchResult` per-file summaries and part A's `MergedResult`.
  - `searchFiles` loads the FASTA once (`FASTAFile`), runs the multi-file search with `rescore` mapped to
    the `rescore` parameter, then calls `mergeFileResults`.
  - It forwards progress through the existing `JSProgressLogger`, extended with `file`.
- [ ] **Step 4: Run the JS tests.** Expected: all pass.
- [ ] **Step 5: Commit** `[WASM] ProSEAlgorithm.searchFiles(): multi-file search pooled as ProSE -out_merged`.

### Task 3: `ProSEResultSet.tables()`: typed columns

**Files:**
- Create: `src/openms_wasm/bindings/bind_prose_tables.cpp` (the column builder; registered from `bind_prose.cpp`)
- Modify: `src/openms_wasm/CMakeLists.txt` (source list), `js_types.*`
- Test: `prose.test.mjs`

**Interfaces:**
- Produces, consumed by part C:
  ```ts
  interface ResultTables {
    files: string[];
    psms: { count: number; file: Uint16Array; nativeId: string[]; rt: Float64Array; mz: Float64Array; charge: Int8Array;
            peptide: Uint32Array; score: Float64Array; qValue: Float64Array; pep: Float64Array; precursorErrorPpm: Float64Array;
            isotopeError: Int8Array; deltaMass: Float64Array; decoy: Uint8Array; featureNames: string[]; features: Float64Array };
    peptides: { count: number; openms: string[]; proforma: string[]; sequence: string[]; decoy: Uint8Array;
                modOffsets: Uint32Array; modPosition: Int16Array; modName: string[]; modUnimod: Int32Array; modMass: Float64Array;
                proteinOffsets: Uint32Array; protein: Uint32Array; start: Uint32Array; end: Uint32Array };
    proteins: { count: number; accession: string[]; description: string[]; sequence: string[]; score: Float64Array;
                qValue: Float64Array; decoy: Uint8Array; group: Int32Array };
  }
  ```
  - **PSM rows:**
    - One row per PeptideIdentification with a hit; best hit only.
    - `features`: row-major `count × featureNames.length`, NaN where absent. They include every
      Percolator input feature and the PeptDeep features.
    - `qValue`, `pep`, `deltaMass`: NaN when absent.
  - **Peptides:** unique by `openms` (the `AASequence::toString()` with modifications).
    - `modPosition`: −1 = N-terminus, `sequence.length` = C-terminus.
    - `start` is 0-based and `end` exclusive into `proteins.sequence`.
    - `proteinOffsets` and `modOffsets` have `count + 1` entries.
  - **Proteins:**
    - Every protein hit of the merged run; `sequence` comes from the FASTA.
    - `qValue` is NaN when protein FDR was not applied.
    - `group`: index of the indistinguishable-protein group, or −1.

- [ ] **Step 1: Write the failing tests.**
  - `tables() is consistent with the result set`:
    - `psms.count` = the number of PeptideIdentifications with hits in the stored idXML.
    - Every `psms.peptide[i] < peptides.count`.
    - For every peptide reference, `proteins.sequence[p].slice(start, end) === peptides.sequence[k]`.
    - `featureNames` includes `"ln(hyperscore)"`.
    - All columns have length `count` (`features` has `count * featureNames.length`).
  - `tables() encodes terminal modifications`: one search of the TOPP_ProSE_1 data with variable
    `Acetyl (N-term)` and `Oxidation (M)`.
    - Expect a peptide with `modPosition` −1 and ProForma starting `"[Acetyl]-"`.
    - Expect an oxidized M with ProForma `"M[Oxidation]"` and `modUnimod` 35.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement the builder.**
  - Copy into `std::vector`s, then hand them out as JS typed arrays
    (`val::global("Float64Array").new_(typed_memory_view(...))`), so JS owns the copies.
  - ProForma via `AASequence::toBracketString(false, true)` if it yields ProForma names. Otherwise build
    it from the residue/terminal modification names; Unimod ids come from `ResidueModification::getUniModRecordId()`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `[WASM] ProSEResultSet.tables(): the results as typed columns`.

### Task 4: `ProSEResultSet.spectra()`: stored peaks of identified spectra

**Files:**
- Modify: `bind_prose_tables.cpp` (spectrum extraction), `js_types.*`
- Test: `prose.test.mjs`

**Interfaces:**
- Produces, consumed by part C:
  ```ts
  interface StoredSpectra { psmSpectrum: Int32Array /* per PSM row: spectrum index or -1 */; offsets: Uint32Array /* n+1 */;
    mz: Float32Array; intensity: Float32Array; precursorMz: Float64Array; collisionEnergy: Float32Array /* NaN unknown */ }
  ```
  - Peaks are stored for every PSM row with `qValue <= psmFdr`, or for all rows when q-values are absent.
  - The spectra are the raw MS2 spectra as measured: centroided, not preprocessed.

- [ ] **Step 1: Write the failing tests.**
  - `spectra() holds the peaks of the identified spectra`:
    - Every target row with `qValue <= 0.01` has `psmSpectrum >= 0`, and its peak range is non-empty.
    - `precursorMz[s]` is within 1e-4 of `psms.mz[row]`.
    - The arrays are Float32Array.
  - `spectra() marks PSMs without a readable spectrum with -1`: give a PSM a fake native ID through the
    test hook `ProSEResultSet.debugSetNativeId(row, "scan=99999999")`, compiled only with `OPENMS_WASM_TEST_HOOKS`.
    Expect −1 for that row.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - Per input file, stream it with `MzMLFile::transform` and a consumer that keeps the spectra whose
    native ID is in that file's set; MS level 2 only.
  - Pack them into the arrays, and collect them during `searchFiles` when `keepSpectra`.
  - The collision energy comes from the precursor's activation energy.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `[WASM] ProSEResultSet.spectra(): the peaks of identified spectra`.

### Task 5: `annotatePeaks()`: annotation from stored arrays

**Files:**
- Modify: `bind_prose.cpp` (next to `annotateSpectrum`), `js_types.*`
- Test: `prose.test.mjs`

**Interfaces:**
- Produces:
  ```ts
  interface PeakMatch { peak: number; ion: string /* "b3", "y5++", "y7-H2O" */; type: string; ordinal: number; charge: number;
    loss: string; theoreticalMz: number; errorPpm: number }
  interface PeakAnnotationResult { matches: PeakMatch[]; theoretical: { ion: string; type: string; ordinal: number; charge: number; mz: number }[] }
  annotatePeaks(mz: Float32Array, intensity: Float32Array, peptide: string /* peptides.openms */, charge: number,
                options: AnnotationOptions /* existing: tolerance, unit, ions, losses */): PeakAnnotationResult
  ```
  It uses the same matching as `annotateSpectrum`; `errorPpm = (observed - theoretical) / theoretical * 1e6`.

- [ ] **Step 1: Write the failing test** `annotatePeaks matches b and y ions of a stored spectrum`.
  - Take a PSM of the Task 4 result set, its peaks and `peptides.openms`, at a tolerance of 10 ppm.
  - Expect matches of type `b` and `y`, every `|errorPpm| <= 10`, and `theoretical` holding b1..b(n−1)
    and y1..y(n−1) at charge 1.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement it.** Build an `MSSpectrum` from the arrays and share the internals of `annotateSpectrum`.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `[WASM] annotatePeaks(): spectrum annotation from stored peak arrays`.

### Task 6: `predictMS2()`: PeptDeep prediction on demand

**Files:**
- Modify: `bind_prose.cpp` (`#ifdef WITH_ONNX`), `js_types.*`
- Test: `prose.test.mjs`

**Interfaces:**
- Consumes: `PeptDeepMS2Inference(model_path)`; `predictMS2(peptides, charges, nces, instrument_indices)`
  returns 8 channels per cleavage: `[b_z1, b_z2, y_z1, y_z2, b_modloss_z1, b_modloss_z2, y_modloss_z1, y_modloss_z2]`;
  `ML::instrumentIndex()`.
- Produces:
  ```ts
  interface PredictedIon { ion: string; type: "b" | "y"; ordinal: number; charge: 1 | 2; mz: number; intensity: number }
  predictMS2(peptide: string, charge: number, nce: number, instrument: string, modelPath?: string /* default "/models/peptdeep_ms2_dynamic.onnx" */): PredictedIon[]
  ```
  - Only `b`/`y` without modloss.
  - Intensities are as the model returns them (0–1, max 1); ions with intensity ≤ 0.01 are dropped.
  - `mz` comes from `TheoreticalSpectrumGenerator`.
  - The model session is created once per model path and reused.

- [ ] **Step 1: Write the failing tests.**
  - `predictMS2 predicts b and y intensities` (skip unless `hasONNXRuntime()`; mount the models like the
    PeptDeep test):
    - For `AVM(Oxidation)DDFAAFVEK`, charge 2, NCE 30, `"QE"`: non-empty.
    - Every `0 < intensity <= 1`, and max = 1.
    - Ordinals within 1..11; mz of y1 is 147.1128 ± 1e-3.
  - `predictMS2 throws without ONNX Runtime` (skip when `hasONNXRuntime()`): expect it to throw `/without ONNX Runtime/`.
  - `searchFiles reports the PeptDeep NCE`: with `peptdeep:enable`, every
    `summary().files[i].peptdeepNce` is a number in [20, 40].
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run them in the ONNX build and the single-threaded build.** Expected: PASS, and SKIP where noted.
- [ ] **Step 5: Commit** `[WASM] predictMS2(): PeptDeep fragment intensities on demand`.

### Task 7: Documentation, package, pull request

- [ ] **Step 1: Document it.**
  - In `src/openms_wasm/README.md`, under "Database search with ProSE", add a subsection "Several files
    and the ProSE app": `searchFiles`, `ProSEResultSet`, `tables`/`spectra`, `annotatePeaks`,
    `predictMS2`, with the TS shapes above.
  - Add a CHANGELOG entry.
- [ ] **Step 2: Assemble the package for part C.**
  - Copy `build/wasm32-emscripten-mt-onnx/openms-wasm/{openms.mjs,openms.wasm,openms.d.ts,package.json}`
    and `models/peptdeep_{ms2,rt}_dynamic.onnx` to `/scratch/sachsenb/prose-pages/app/public/openms/`
    (models into `models/`).
  - Set `package.json` `version` to `3.7.0-pre.<short commit>`.
- [ ] **Step 3: Run the full JS tests** on both the ONNX build and `wasm32-emscripten-release`. Expected:
  all pass or skip as designed.
- [ ] **Step 4: Push and open the PR.**
  - Push `claude/wasm-prose-app-bindings`; open a draft PR with base `claude/wasm-prose-webapp`, titled
    "[EXPERIMENT] WebAssembly: ProSE bindings for the ProSE app".
  - The body links part A's PR and the spec.
  - Register it with `mcp__t3-code__link_pull_request`.
