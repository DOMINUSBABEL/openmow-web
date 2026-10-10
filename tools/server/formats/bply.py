"""GEM2 BPLYBNDS terrain mesh decoder.

Layout (docs/formats/bply.md):
  'BPLY' 'BNDS' bbox[6]f
  'SUBM'*  : decl[14]  first_tri u32  tri_count u32  unk0 u32  unk1 u32  flags u32  pstr material
  'BAS2'   : 12 x f32 (texture projection basis; kept raw)
  'VERT'   : count u32, stride u16, flags u16, count*stride bytes
  'IND4'   : count u32, count * u32 indices
Vertex (stride 44): pos3 f32 (z up), normal3 f32, color u32 (BGRA), uv0 2f (tiling), uv1 2f
"""
from __future__ import annotations
import struct
from dataclasses import dataclass, field


class BplyError(ValueError):
    pass


@dataclass
class TerrainSubmesh:
    first_tri: int
    tri_count: int
    unk0: int
    unk1: int
    flags: int
    material: str


@dataclass
class Terrain:
    bbox: tuple
    submeshes: list[TerrainSubmesh] = field(default_factory=list)
    basis: tuple | None = None
    vertex_count: int = 0
    stride: int = 0
    vflags: int = 0
    vertices: bytes = b''
    indices: bytes = b''   # u32 little endian
    pad: int = 0


def parse_bply(d: bytes) -> Terrain:
    if d[:8] != b'BPLYBNDS':
        raise BplyError(f'bad magic {d[:8]!r}')
    t = Terrain(bbox=struct.unpack_from('<6f', d, 8))
    o, n = 32, len(d)
    while o < n:
        tag = d[o:o + 4]; o += 4
        if tag == b'SUBM':
            o += 14
            first, cnt, u0, u1, fl = struct.unpack_from('<5I', d, o); o += 20
            k = d[o]; mat = d[o + 1:o + 1 + k].decode('latin1'); o += 1 + k
            t.submeshes.append(TerrainSubmesh(first, cnt, u0, u1, fl, mat))
        elif tag == b'BAS2':
            t.basis = struct.unpack_from('<12f', d, o); o += 48
        elif tag == b'VERT':
            cnt, stride, fl = struct.unpack_from('<IHH', d, o); o += 8
            end = o + cnt * stride
            if end > n:
                raise BplyError('VERT overruns file')
            t.vertex_count, t.stride, t.vflags = cnt, stride, fl
            t.vertices = d[o:end]
            o = end
        elif tag == b'IND4':
            cnt, = struct.unpack_from('<I', d, o); o += 4
            end = o + cnt * 4
            if end > n:
                raise BplyError('IND4 overruns file')
            t.indices = d[o:end]; o = end
        else:
            raise BplyError(f'unknown chunk {tag!r} at {o - 4}')
    tris = len(t.indices) // 12
    for s in t.submeshes:
        if s.first_tri + s.tri_count > tris:
            raise BplyError(f'submesh {s.material} out of range')
    return t
