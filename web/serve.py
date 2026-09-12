"""
Local dev server for the web generators.

Plain `python -m http.server` sends Last-Modified but no Cache-Control, so
Chrome heuristically caches the scripts. Editing one file then reloading can
therefore leave you running a NEW index.html against an OLD cached script -
which fails in confusing, tab-specific ways (a tab whose controls quietly
stop responding, NaN geometry) rather than failing loudly. This serves
everything with no-store so a reload always gets the current files.

    python serve.py [port]
"""
import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter console
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(NoCacheHandler, directory=".")
    print("서빙: http://localhost:%d/  (Ctrl+C 종료, 캐시 비활성)" % port)
    try:
        HTTPServer(("", port), handler).serve_forever()
    except KeyboardInterrupt:
        print("\n종료")
