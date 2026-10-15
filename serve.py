#!/usr/bin/env python3
"""Serves this directory for the OpenMS WebAssembly demos: python3 serve.py [port], then open
http://localhost:8000/examples/prose/ (the ProSE search) or http://localhost:8000/examples/browser/.

It sets the MIME types modules need (older Pythons do not know .mjs) and the cross-origin
isolation headers that threads need. (The demos' service worker adds those headers too, so any
static server works; this one also makes threads work on the very first load.)"""
import functools
import http.server
import os
import sys

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm",
                      ".mzML": "application/xml", ".fasta": "text/plain"}

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-cache")  # revalidate, but keep: Chrome caches the compiled module
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
server = http.server.ThreadingHTTPServer(("localhost", port), functools.partial(Handler, directory=os.path.dirname(os.path.abspath(__file__))))
print(f"OpenMS demos: http://localhost:{port}/examples/prose/  and  http://localhost:{port}/examples/browser/  (Ctrl+C stops)")
server.serve_forever()
