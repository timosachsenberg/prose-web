ProSE desktop: the OpenMS search engine ProSE as a desktop application
=====================================================================

The web application of https://timosachsenberg.github.io/prose-web/ packaged with Neutralinojs:
a 3 MB program serves the application (resources.neu) on http://127.0.0.1:47815 with the headers
that threads need and opens it in a window of your Chrome, Chromium or Edge. Everything stays on
your machine and works offline. Closing the window ends the program (after about 10 s).

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

The browser profile and its caches are in the user's application data directory
(org.openms.prose in ~/.local/share, ~/Library/Application Support or %APPDATA%).

Built from OpenMS pull request #10575 (commit 4f4d152a6f), a preview, not an OpenMS release.
OpenMS: BSD 3-Clause license. Neutralinojs: MIT license.
