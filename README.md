# ProSE in the browser

**https://timosachsenberg.github.io/prose-web/**

The OpenMS search engine ProSE compiled to WebAssembly, with its web application, in-process
Percolator rescoring and optional PeptDeep rescoring features (ONNX Runtime in the module). The
search runs entirely in the browser; spectra and database stay on the user's machine.

This is a preview built from [OpenMS pull request #10575](https://github.com/OpenMS/OpenMS/pull/10575)
(commit e296af856f, the threaded build with ONNX Runtime, CMake preset
`wasm32-emscripten-mt-onnx-release`), not an OpenMS release. The files are the npm package of that build
(`openms.mjs`, `openms.wasm`, `openms.d.ts`, `package.json`; its version carries the commit, as the
service worker names its caches after it), the PeptDeep models (`models/`, loaded when the PeptDeep
option is first used) and the demo applications (`examples/`).

## Threads on GitHub Pages

The threaded module needs a cross-origin isolated page (the headers
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`), which
GitHub Pages does not send. The application's service worker (`examples/sw.js`) adds them, so the page
reloads once on its first visit. It also caches the module, so that the browser keeps the compiled
code and later visits start and search faster.

## Contents

- `index.html`: the start page; `examples/prose/`: the ProSE application; `examples/browser/`: the
  general demo (peptide masses, digestion, mzML viewer).
- `models/`: the PeptDeep models of the PeptDeep option (MS2 intensities 15.5 MB, retention time
  2.7 MB; from https://archive.openms.de/openms/models).
- `data/`: example data (OpenMS test data): `DatabaseSuitability_*` (the data of the TOPP test
  ProSE_11_rescore; set the fragment mass tolerance to 10) and `SimpleSearchEngine_1.*`.
- `prose-single-file.html`: the application as one file that opens from disk (single-threaded).
- `serve.py`: a local server with the isolation headers (`python3 serve.py`, then
  http://localhost:8000/examples/prose/).
- `README-openms-wasm.md`: the JavaScript API of the module.
- `desktop/`: the desktop application, packaged with [Neutralinojs](https://neutralino.js.org)
  (`desktop/build.sh`; the zips are on the [releases page](https://github.com/timosachsenberg/prose-web/releases)).
  A 3 MB program serves the application on `127.0.0.1:47815` with the isolation headers
  (`serverHeaders`) and opens it in Chrome, Chromium or Edge; it ends when the window is closed.

OpenMS is licensed under the BSD 3-Clause license (`LICENSE`).
