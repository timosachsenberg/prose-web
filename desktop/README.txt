ProSE desktop: the OpenMS search engine ProSE as a desktop application
=====================================================================

The ProSE app of https://timosachsenberg.github.io/prose-web/ packaged with Neutralinojs: a 3 MB
program serves the app (resources.neu) on http://127.0.0.1:47815 with the headers that threads need
and opens it in a window of your Chrome, Chromium or Edge. Everything stays on your machine and works
offline. Closing the window ends the program (after about 10 s).

Searches of one or many mzML files with an experimental design (conditions, replicates, fractions),
results at protein, peptide and PSM level with CSV export, the spectrum of every PSM, History (kept in
the browser profile, see below) and project files (.prose) that open in the web app as well.

With "PeptDeep predictions" switched on (under Rescoring, next to Percolator), PeptDeep predicts the
fragment intensities and retention time of every PSM, and their agreement with the spectrum becomes
more Percolator features. The models are included (resources.neu); a search with them needs about
0.35 GB more memory.

A search that needs more than 3 GB of memory (e.g. a large database searched semi-tryptically) runs
in the 64-bit engine, which can use up to 16 GB; New search says so. It needs Chrome, Chromium or Edge
133 or newer.

Requirements: Google Chrome, Chromium or Microsoft Edge (Edge is part of Windows).

Start
-----
Keep the program and resources.neu in the same folder.

Windows  Double-click prose-win_x64.exe. Windows SmartScreen may warn about an unknown publisher
         (the program is not code-signed): "More info", then "Run anyway".

macOS    The program is not signed by an Apple developer, so macOS blocks it at first. In Terminal:
           cd <this folder>
           xattr -d com.apple.quarantine prose-mac_universal resources.neu
           ./prose-mac_universal
         (or: double-click it, then System Settings > Privacy & Security > "Open Anyway").

Linux    ./prose-linux_x64 (or prose-linux_arm64). Chrome or Chromium is looked for in /usr/bin and
         /snap/bin; another location: ./prose-linux_x64 --chrome-browser-binary=/path/to/chrome

Options
-------
--port=<n>        another port, if 47815 is taken (the browser's caches are per port: the first start
                  on a new port is slower)
--mode=window     the operating system's web view instead of Chrome (Windows: WebView2, i.e.
                  Chromium; macOS and Linux: WebKit, untested with this application)
--mode=browser    the default browser

The browser profile, its caches and the History of searches are in the user's application data
directory (org.openms.prose in ~/.local/share, ~/Library/Application Support or %APPDATA%). History
belongs to the port: on another --port the app starts with an empty History.

Version 0.4.0: the ProSE app with the OpenMS modules 3.7.0-pre.76607e6451 of OpenMS pull request
#10659 (the threaded modules with ONNX Runtime, 32-bit and 64-bit), a preview, not an OpenMS release.
OpenMS: BSD 3-Clause license. Neutralinojs: MIT license.
