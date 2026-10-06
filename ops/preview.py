"""Local visual preview only: rewrite the production origin in served text, not files."""
import argparse, functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class Preview(SimpleHTTPRequestHandler):
    def do_GET(self):
        filepath=Path(self.translate_path(self.path))
        if filepath.is_dir(): filepath=filepath/'index.html'
        if filepath.suffix in ['.html','.js','.json','.yml','.css'] and filepath.is_file():
            try: data=filepath.read_bytes().replace(self.server.production.encode(),self.server.local.encode())
            except OSError: return self.send_error(404)
            self.send_response(200); self.send_header('Content-Type',self.guess_type(str(filepath)))
            self.send_header('Content-Length',str(len(data))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(data)
        else: super().do_GET()

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('--root',required=True); p.add_argument('--port',type=int,default=8781); p.add_argument('--production',default='https://portal.creangel.com'); args=p.parse_args()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),functools.partial(Preview,directory=args.root))
    server.production=args.production; server.local=f'http://127.0.0.1:{args.port}'
    print(f'Local preview at {server.local}; OAuth and publication require production services.',flush=True)
    server.serve_forever()
