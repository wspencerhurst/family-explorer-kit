"""Serve the built Family Explorer (site/dist) on http://127.0.0.1:8765 with gzip for JSON/JS/CSS,
then open it in the default browser. Usage: python serve.py [--no-open] [--port N]"""
import gzip, http.server, mimetypes, pathlib, socketserver, sys, threading, webbrowser

ROOT = pathlib.Path(__file__).resolve().parent / "dist"
PORT = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8765
COMPRESS = {".json", ".js", ".css", ".html", ".svg", ".txt"}
_cache: dict[pathlib.Path, tuple[float, bytes]] = {}

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()
    def do_GET(self):
        path = pathlib.Path(self.translate_path(self.path.split("?")[0]))
        if path.is_dir(): path = path / "index.html"
        if path.suffix in COMPRESS and path.is_file() and "gzip" in (self.headers.get("Accept-Encoding") or ""):
            mt = path.stat().st_mtime
            hit = _cache.get(path)
            if not hit or hit[0] != mt:
                hit = (mt, gzip.compress(path.read_bytes(), 6)); _cache[path] = hit
            body = hit[1]
            self.send_response(200)
            self.send_header("Content-Type", (mimetypes.guess_type(str(path))[0] or "application/octet-stream") + ("; charset=utf-8" if path.suffix in {".json", ".js", ".css", ".html"} else ""))
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if not (ROOT / "index.html").exists():
    sys.exit("site/dist is missing - build it first (npm run build).")
url = f"http://127.0.0.1:{PORT}/"
try:
    srv = Server(("127.0.0.1", PORT), Handler)
except OSError:
    print("Already running - opening", url)
    if "--no-open" not in sys.argv: webbrowser.open(url)
    sys.exit(0)
print("Family Explorer running at", url, "(close this window to stop)")
if "--no-open" not in sys.argv: threading.Timer(0.6, lambda: webbrowser.open(url)).start()
srv.serve_forever()
