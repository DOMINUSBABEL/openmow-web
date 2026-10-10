"""Virtual file system over the original GEM2 .pak archives (read-only, zero-copy).

- Every .pak is a ZIP with STORED entries, so a file is a contiguous byte range:
  we index (pak, data_offset, size) once and serve reads with plain seek/read
  (thread-safe: one short-lived handle per read, OS cache does the rest).
- Mount point of a pak = its directory relative to resource/ (entity/c1.pak -> /entity/).
  localization.pak (game root) -> /localization/.  mods/<name>/resource/... same rule.
- Precedence when two paks provide the same path: mods > map_origins2 > map_dlc_2 > map_dlc_1 > base,
  then alphabetical. Virtual paths are lowercase, '/'-separated, absolute.
"""
from __future__ import annotations
import os
import struct
import threading
import zipfile
from dataclasses import dataclass

DEFAULT_GAME = r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2'
PRIORITY = {'map_origins2.pak': 30, 'map_dlc_2.pak': 20, 'map_dlc_1.pak': 10}


@dataclass(frozen=True, slots=True)
class Entry:
    pak: str
    offset: int    # absolute offset of the stored data, resolved lazily (-1 = unknown)
    size: int
    header: int    # local header offset
    compressed: bool


def norm(path: str) -> str:
    p = path.replace('\\', '/').lower()
    while '//' in p:
        p = p.replace('//', '/')
    if not p.startswith('/'):
        p = '/' + p
    return p


class VFS:
    def __init__(self, game_dir: str = DEFAULT_GAME, mods: list[str] | None = None):
        self.game_dir = game_dir
        self.files: dict[str, Entry] = {}
        self.dirs: dict[str, set[str]] = {}
        self._offsets: dict[str, int] = {}
        self._lock = threading.Lock()
        sources = []
        res = os.path.join(game_dir, 'resource')
        for dp, _, fn in os.walk(res):
            for f in fn:
                if f.lower().endswith('.pak'):
                    rel = os.path.relpath(dp, res).replace('\\', '/')
                    mount = '/' if rel == '.' else '/' + rel.lower() + '/'
                    sources.append((PRIORITY.get(f.lower(), 0), f.lower(), os.path.join(dp, f), mount))
        loc = os.path.join(game_dir, 'localization.pak')
        if os.path.exists(loc):
            sources.append((0, 'localization.pak', loc, '/localization/'))
        for i, m in enumerate(mods or []):
            mres = os.path.join(game_dir, 'mods', m, 'resource')
            for dp, _, fn in os.walk(mres):
                for f in fn:
                    if f.lower().endswith('.pak'):
                        rel = os.path.relpath(dp, mres).replace('\\', '/')
                        mount = '/' if rel == '.' else '/' + rel.lower() + '/'
                        sources.append((100 + i, f.lower(), os.path.join(dp, f), mount))
        # low priority first so higher priority overwrites
        for prio, _, path, mount in sorted(sources):
            self._index(path, mount)

    def _index(self, pak: str, mount: str) -> None:
        with zipfile.ZipFile(pak) as z:
            for info in z.infolist():
                if info.is_dir():
                    continue
                vp = norm(mount + info.filename)
                self.files[vp] = Entry(pak, -1, info.file_size, info.header_offset,
                                       info.compress_type != zipfile.ZIP_STORED)
                parent, _, name = vp.rpartition('/')
                while True:
                    self.dirs.setdefault(parent or '/', set()).add(name)
                    if not parent:
                        break
                    parent, _, name = parent.rpartition('/')
                    name = name + '/'

    # ---------------- public API ----------------
    def exists(self, path: str) -> bool:
        return norm(path) in self.files

    def size(self, path: str) -> int:
        return self.files[norm(path)].size

    def listdir(self, path: str) -> list[str]:
        p = norm(path).rstrip('/') or '/'
        return sorted(self.dirs.get(p, ()))

    def read(self, path: str) -> bytes:
        vp = norm(path)
        e = self.files.get(vp)
        if e is None:
            raise FileNotFoundError(path)
        if e.compressed:  # not present in vanilla data, kept for mods
            with zipfile.ZipFile(e.pak) as z:
                for info in z.infolist():
                    if info.header_offset == e.header:
                        return z.read(info)
        key = f'{e.pak}|{e.header}'
        off = self._offsets.get(key)
        with open(e.pak, 'rb') as f:
            if off is None:
                f.seek(e.header)
                h = f.read(30)
                if h[:4] != b'PK\x03\x04':
                    raise IOError(f'bad local header in {e.pak} @ {e.header}')
                nlen, xlen = struct.unpack_from('<HH', h, 26)
                off = e.header + 30 + nlen + xlen
                with self._lock:
                    self._offsets[key] = off
            f.seek(off)
            return f.read(e.size)

    def glob_ext(self, prefix: str, ext: str) -> list[str]:
        prefix = norm(prefix)
        ext = ext.lower()
        return [p for p in self.files if p.startswith(prefix) and p.endswith(ext)]

    def resolve(self, ref: str, base_dir: str, exts: tuple[str, ...] = ('',)) -> str | None:
        """Resolve a resource reference the way GEM2 data uses them.

        '$/x'  -> /texture/common/x      (texture alias)
        '/x'   -> absolute virtual path
        'x'    -> relative to base_dir
        Each candidate is tried with every extension in `exts`.
        """
        r = ref.replace('\\', '/')
        if r.startswith('$/'):
            cands = ['/texture/common/' + r[2:]]
        elif r.startswith('/'):
            cands = [r]
        else:
            cands = [base_dir.rstrip('/') + '/' + r]
        for c in cands:
            for e in exts:
                p = norm(c + e)
                if p in self.files:
                    return p
        return None
