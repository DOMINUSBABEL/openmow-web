"""OpenMoW-Web asset server (localhost).

Endpoints (contract: docs/CONTRACTS.md §server-api):
  GET /vfs/<vpath>                      raw bytes from the original .pak files
  GET /vfs-list/<vdir>                  JSON list of entries ('name/' = directory)
  GET /conv/tex/<vpath>.png             DDS/TGA -> PNG
  GET /conv/model/<vpath .def|.mdl>.glb entity model -> GLB   (?lod=N)
  GET /conv/model-report/<vpath>.json   converter report (missing files, bones...)
  GET /conv/sdl/<vpath>.json            SDL text -> JSON AST
  GET /api/health                       {"ok": true, "files": N}
  everything else: static files from web/dist (production build) or web/public
Conversions are cached in .cache/ keyed by (converter version, vpath, query).
"""
from __future__ import annotations
import argparse
import hashlib
import json
import mimetypes
import os
import sys
import threading
import traceback
import urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)

from vfs import VFS, DEFAULT_GAME  # noqa: E402
from formats.sdl import parse_sdl, decode, to_json  # noqa: E402
from convert.model import def_to_mdl, mdl_to_glb  # noqa: E402
from convert.texture import to_png  # noqa: E402
from convert.proto import resolve_proto  # noqa: E402
from convert.terrain import terrain_to_glb  # noqa: E402
from convert.anim import anm_to_clip  # noqa: E402
from convert.nav import mission_nav_grid  # noqa: E402

CONVERTER_VERSION = {'tex': 1, 'model': 6, 'sdl': 1, 'terrain': 3, 'proto': 3, 'anim': 1, 'nav': 1}
MIME = {'.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json', '.js': 'text/javascript',
        '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.dds': 'application/octet-stream', '.svg': 'image/svg+xml'}


class Cache:
    def __init__(self, root: str):
        self.root = root
        os.makedirs(root, exist_ok=True)
        self._locks: dict[str, threading.Lock] = {}
        self._g = threading.Lock()

    def path(self, kind: str, key: str, ext: str) -> str:
        h = hashlib.sha1(f'{kind}:{CONVERTER_VERSION[kind]}:{key}'.encode()).hexdigest()
        return os.path.join(self.root, kind, h[:2], h + ext)

    def get_or_make(self, kind: str, key: str, ext: str, make) -> bytes:
        p = self.path(kind, key, ext)
        if os.path.exists(p):
            with open(p, 'rb') as f:
                return f.read()
        with self._g:
            lock = self._locks.setdefault(p, threading.Lock())
        with lock:
            if os.path.exists(p):
                with open(p, 'rb') as f:
                    return f.read()
            data = make()
            os.makedirs(os.path.dirname(p), exist_ok=True)
            tmp = p + f'.{threading.get_ident()}.tmp'
            with open(tmp, 'wb') as f:
                f.write(data)
            os.replace(tmp, p)
            return data


class App:
    def __init__(self, game_dir: str, cache_dir: str, static_dirs: list[str]):
        self.vfs = VFS(game_dir)
        self.cache = Cache(cache_dir)
        self.static_dirs = static_dirs

    def model(self, vpath: str, lod: int) -> tuple[bytes, dict]:
        mdl = def_to_mdl(self.vfs, vpath) if vpath.endswith('.def') else vpath
        return mdl_to_glb(self.vfs, mdl, lod=lod)

    def terrain(self, mission_vpath: str) -> tuple[bytes, dict]:
        return terrain_to_glb(self.vfs, mission_vpath)


class Handler(BaseHTTPRequestHandler):
    app: App = None  # type: ignore
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):  # quieter console
        if os.environ.get('OPENMOW_VERBOSE'):
            super().log_message(fmt, *args)

    def send(self, code: int, body: bytes, ctype: str, cache: bool = True):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'public, max-age=3600' if cache else 'no-cache')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def fail(self, code: int, msg: str):
        self.send(code, json.dumps({'error': msg}).encode(), 'application/json', cache=False)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(url.path)
        q = urllib.parse.parse_qs(url.query)
        app = self.app
        try:
            if path == '/api/health':
                return self.send(200, json.dumps({'ok': True, 'files': len(app.vfs.files)}).encode(),
                                 'application/json', cache=False)
            if path.startswith('/vfs/'):
                vp = path[4:]
                data = app.vfs.read(vp)
                return self.send(200, data, MIME.get(os.path.splitext(vp)[1].lower(), 'application/octet-stream'))
            if path.startswith('/vfs-list/'):
                return self.send(200, json.dumps(app.vfs.listdir(path[9:])).encode(), 'application/json')
            if path.startswith('/conv/tex/') and path.endswith('.png'):
                vp = path[len('/conv/tex'):-4]
                data = app.cache.get_or_make('tex', vp, '.png', lambda: to_png(app.vfs.read(vp)))
                return self.send(200, data, 'image/png')
            if path.startswith('/conv/model/') and path.endswith('.glb'):
                vp = path[len('/conv/model'):-4]
                lod = int(q.get('lod', ['0'])[0])
                data = app.cache.get_or_make('model', f'{vp}?lod={lod}', '.glb', lambda: app.model(vp, lod)[0])
                return self.send(200, data, 'model/gltf-binary')
            if path.startswith('/conv/model-report/') and path.endswith('.json'):
                vp = path[len('/conv/model-report'):-5]
                _, rep = app.model(vp, 0)
                return self.send(200, json.dumps(rep).encode(), 'application/json', cache=False)
            if path.startswith('/conv/sdl/') and path.endswith('.json'):
                vp = path[len('/conv/sdl'):-5]
                def make():
                    w = []
                    items = parse_sdl(decode(app.vfs.read(vp), vp), warnings=w)
                    return json.dumps({'items': [to_json(i) for i in items], 'warnings': w},
                                      separators=(',', ':'), ensure_ascii=False).encode()
                return self.send(200, app.cache.get_or_make('sdl', vp, '.json', make), 'application/json')
            if path.startswith('/conv/proto/') and path.endswith('.json'):
                sub = path[len('/conv/proto/'):-5]
                parts = sub.split('/', 1)
                if len(parts) == 2:
                    kind, name = parts[0], parts[1]
                    def make_proto():
                        res = resolve_proto(app.vfs, kind, name)
                        return json.dumps(res, separators=(',', ':'), ensure_ascii=False).encode()
                    return self.send(200, app.cache.get_or_make('proto', f'{kind}:{name}', '.json', make_proto), 'application/json')
            if path.startswith('/conv/terrain/') and path.endswith('.glb'):
                vp = path[len('/conv/terrain'):-4]
                data = app.cache.get_or_make('terrain', vp, '.glb', lambda: app.terrain(vp)[0])
                return self.send(200, data, 'model/gltf-binary')
            if path.startswith('/conv/anim/') and path.endswith('.json'):
                vp = path[len('/conv/anim'):-5]
                if not vp.endswith('.anm'):
                    vp += '.anm'
                fps = float(q.get('fps', ['25.0'])[0])
                def make_anim():
                    clip = anm_to_clip(app.vfs, vp, fps)
                    return json.dumps(clip, separators=(',', ':'), ensure_ascii=False).encode()
                data = app.cache.get_or_make('anim', f'{vp}?fps={fps}', '.json', make_anim)
                return self.send(200, data, 'application/json')
            if path.startswith('/conv/nav/') and path.endswith('.json'):
                vp = path[len('/conv/nav'):-5]
                def make_nav():
                    grid_data = mission_nav_grid(app.vfs, vp)
                    return json.dumps(grid_data, separators=(',', ':')).encode()
                data = app.cache.get_or_make('nav', vp, '.json', make_nav)
                return self.send(200, data, 'application/json')
            return self.static(path)
        except FileNotFoundError as e:
            return self.fail(404, f'not found: {e}')
        except BrokenPipeError:
            return
        except ConnectionResetError:
            return
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self.fail(500, f'{type(e).__name__}: {e}')

    def static(self, path: str):
        rel = path.lstrip('/') or 'index.html'
        for d in self.app.static_dirs:
            p = os.path.abspath(os.path.join(d, rel))
            if not p.startswith(os.path.abspath(d)):
                continue
            if os.path.isdir(p):
                p = os.path.join(p, 'index.html')
            if os.path.isfile(p):
                with open(p, 'rb') as f:
                    data = f.read()
                ext = os.path.splitext(p)[1].lower()
                return self.send(200, data, MIME.get(ext) or mimetypes.guess_type(p)[0] or 'application/octet-stream',
                                 cache=False)
        return self.fail(404, f'no route {path}')


def make_server(port: int = 8080, game_dir: str = DEFAULT_GAME, host: str = '127.0.0.1') -> ThreadingHTTPServer:
    static = [os.path.join(ROOT, 'web', 'dist'), os.path.join(ROOT, 'web', 'public')]
    Handler.app = App(game_dir, os.path.join(ROOT, '.cache'), static)
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    return srv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--game', default=os.environ.get('MOWAS2_DIR', DEFAULT_GAME))
    ap.add_argument('--host', default='127.0.0.1')
    a = ap.parse_args()
    srv = make_server(a.port, a.game, a.host)
    print(f'OpenMoW-Web server on http://{a.host}:{a.port}  ({len(Handler.app.vfs.files)} files indexed)', flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
