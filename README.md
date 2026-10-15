# ProSE in the browser

**https://timosachsenberg.github.io/prose-web/**

The OpenMS search engine ProSE compiled to WebAssembly, with its web application and in-process
Percolator rescoring. The search runs entirely in the browser; spectra and database stay on the
user's machine.

This is a preview built from [OpenMS pull request #10575](https://github.com/OpenMS/OpenMS/pull/10575)
(commit 4f4d152a6f, threaded build), not an OpenMS release. The files are the assembled npm package
(`openms.mjs`, `openms.wasm`, `openms.d.ts`, `package.json`) and its demo applications (`examples/`).

## Threads on GitHub Pages

The threaded module needs a cross-origin isolated page (the headers
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`), which
GitHub Pages does not send. The application's service worker (`examples/sw.js`) adds them, so the page
reloads once on its first visit. It also caches the module, so that the browser keeps the compiled
code and later visits start and search faster.

## Contents

- `index.html`: the start page; `examples/prose/`: the ProSE application; `examples/browser/`: the
  general demo (peptide masses, digestion, mzML viewer).
- `data/`: example data (OpenMS test data): `DatabaseSuitability_*` (the data of the TOPP test
  ProSE_11_rescore; set the fragment mass tolerance to 10) and `SimpleSearchEngine_1.*`.
- `prose-single-file.html`: the application as one file that opens from disk (single-threaded).
- `serve.py`: a local server with the isolation headers (`python3 serve.py`, then
  http://localhost:8000/examples/prose/).
- `README-openms-wasm.md`: the JavaScript API of the module.

OpenMS is licensed under the BSD 3-Clause license (`LICENSE`).
