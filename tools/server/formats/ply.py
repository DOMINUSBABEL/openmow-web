"""GEM2 EPLYBNDS mesh decoder (Men of War: Assault Squad 2).

Spec: docs/formats/eplybnds.md. Reverse engineered from game data; validated by
tools/tests/test_ply_all.py against every .ply in the installed game.
"""
from __future__ import annotations
import struct
from dataclasses import dataclass, field

# Direct3D FVF bits used by GEM2
FVF_XYZ = 0x002
FVF_XYZB2 = 0x008          # position + 1 float weight (+ UBYTE4 indices if LASTBETA_UBYTE4)
FVF_NORMAL = 0x010
FVF_DIFFUSE = 0x040
FVF_TEX1 = 0x100
FVF_TEX2 = 0x200
FVF_LASTBETA_UBYTE4 = 0x1000

MESH_FLAG_SPECULAR = 0x200  # MESH.flags bit: 4-byte RGBA specular colour follows


class PlyError(ValueError):
    pass


@dataclass
class Submesh:
    fvf: int
    first_tri: int
    tri_count: int
    flags: int
    material: str
    specular: int | None = None          # packed 0xAARRGGBB as stored (little endian u32)
    bone_remap: list[int] | None = None  # local palette -> SKIN bone index


@dataclass
class VertexLayout:
    stride: int
    pos: int = 0
    weight: int | None = None
    bones: int | None = None   # 4 x u8
    normal: int | None = None
    color: int | None = None   # u32 BGRA (D3DCOLOR)
    uv0: int | None = None
    uv1: int | None = None
    uv2: int | None = None
    tangent: int | None = None  # 4 floats (xyz + handedness)
    unknown: int = 0           # trailing bytes not understood (should be 0)


@dataclass
class Ply:
    bbox: tuple[float, float, float, float, float, float]
    submeshes: list[Submesh] = field(default_factory=list)
    skin: list[str] | None = None
    vertex_count: int = 0
    vflags: int = 0
    layout: VertexLayout | None = None
    vertices: bytes = b''      # raw interleaved buffer, little endian
    indices: bytes = b''       # raw u16 buffer
    mirror: bytes | None = None  # MROR chunk payload (semantics: docs/formats/eplybnds.md)


def fvf_layout(fvf: int, stride: int) -> VertexLayout:
    lay = VertexLayout(stride=stride)
    o = 0
    if fvf & FVF_XYZB2:
        lay.pos = o; o += 12
        lay.weight = o; o += 4
        if fvf & FVF_LASTBETA_UBYTE4:
            lay.bones = o; o += 4
    elif fvf & FVF_XYZ:
        lay.pos = o; o += 12
    else:
        raise PlyError(f'unsupported FVF position type 0x{fvf:x}')
    if fvf & FVF_NORMAL:
        lay.normal = o; o += 12
    if fvf & FVF_DIFFUSE:
        lay.color = o; o += 4
    ntex = (fvf >> 8) & 0xF
    if ntex >= 1:
        lay.uv0 = o; o += 8
    if ntex >= 2:
        lay.uv1 = o; o += 8
    if ntex > 2:
        raise PlyError(f'unsupported texcoord count {ntex}')
    extra = stride - o
    if extra < 0:
        raise PlyError(f'stride {stride} smaller than FVF 0x{fvf:x} size {o}')
    if extra >= 16:
        lay.tangent = o; o += 16; extra -= 16
    if extra >= 8 and lay.uv1 is None:
        lay.uv1 = o; o += 8; extra -= 8
    if extra >= 8:
        lay.uv2 = o; o += 8; extra -= 8
    lay.unknown = extra
    return lay


def _pstr(d: bytes, o: int) -> tuple[str, int]:
    n = d[o]
    return d[o + 1:o + 1 + n].decode('latin1'), o + 1 + n


def parse_ply(d: bytes) -> Ply:
    if d[:8] != b'EPLYBNDS':
        raise PlyError(f'bad magic {d[:8]!r}')
    ply = Ply(bbox=struct.unpack_from('<6f', d, 8))
    o = 32
    n = len(d)
    while o < n:
        tag = d[o:o + 4]
        o += 4
        if tag == b'SKIN':
            cnt, = struct.unpack_from('<I', d, o); o += 4
            names = []
            for _ in range(cnt):
                s, o = _pstr(d, o)
                names.append(s)
            ply.skin = names
        elif tag == b'MESH':
            fvf, first, cnt, flags = struct.unpack_from('<IIII', d, o); o += 16
            spec = None
            if flags & MESH_FLAG_SPECULAR:
                spec, = struct.unpack_from('<I', d, o); o += 4
            mat, o = _pstr(d, o)
            remap = None
            if fvf & FVF_LASTBETA_UBYTE4:
                k = d[o]; remap = list(d[o + 1:o + 1 + k]); o += 1 + k
            ply.submeshes.append(Submesh(fvf, first, cnt, flags, mat, spec, remap))
        elif tag == b'VERT':
            cnt, stride, vfl = struct.unpack_from('<IHH', d, o); o += 8
            ply.vertex_count, ply.vflags = cnt, vfl
            if not ply.submeshes:
                raise PlyError('VERT before MESH')
            ply.layout = fvf_layout(ply.submeshes[0].fvf, stride)
            end = o + cnt * stride
            if end > n:
                raise PlyError('VERT overruns file')
            ply.vertices = d[o:end]; o = end
        elif tag == b'INDX':
            cnt, = struct.unpack_from('<I', d, o); o += 4
            end = o + cnt * 2
            if end > n:
                raise PlyError('INDX overruns file')
            ply.indices = d[o:end]; o = end
        elif tag == b'ADJA':
            # Triangle adjacency (3 x u16 per triangle) used for shadow volumes; not needed.
            cnt, = struct.unpack_from('<I', d, o); o += 4 + cnt * 6
        elif tag == b'MROR':
            # Trailing mirror block; payload kept raw until fully specified.
            ply.mirror = d[o:]; o = n
        elif tag == b'SHDW':
            # Shadow-volume geometry (only fence_wire09.ply); not rendered by the web client.
            o = n
        else:
            raise PlyError(f'unknown chunk {tag!r} at {o - 4}')
    validate(ply)
    return ply


def used_index_ranges(ply: Ply) -> list[tuple[int, int]]:
    """(start, end) in index units actually referenced by submeshes.

    Some vanilla files carry garbage indices after the last submesh range; the
    engine never draws them, so consumers must only read these ranges.
    """
    return [(s.first_tri * 3, (s.first_tri + s.tri_count) * 3) for s in ply.submeshes]


def validate(ply: Ply) -> None:
    if ply.layout is None:
        raise PlyError('no VERT chunk')
    tri_total = len(ply.indices) // 6
    for s in ply.submeshes:
        if s.first_tri + s.tri_count > tri_total:
            raise PlyError(f'submesh {s.material} tris {s.first_tri}+{s.tri_count} > {tri_total}')
    if ply.indices:
        idx = struct.unpack(f'<{len(ply.indices) // 2}H', ply.indices)
        for a, b in used_index_ranges(ply):
            if b > a and max(idx[a:b]) >= ply.vertex_count:
                raise PlyError(f'index {max(idx[a:b])} >= vertex_count {ply.vertex_count}')
