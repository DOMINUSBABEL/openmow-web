"""GEM2 EANM animation decoder.

Layout (docs/formats/eanm.md):
  'EANM' u32 version (0x00060000)
  'FRMS' u32 frame_count
  'BMAP' u32 bone_count, bone_count x (u32 len, name)
  'FRM2'* : u16 frame_index (strictly increasing, sparse keyframes), u8 record_count,
            record_count x ( u8 bone, u16 flags, payload )
  flags: 0x01 position (3 f32)
         0x02 rotation (3 f32: quaternion x,y,z; w = +sqrt(1 - x^2 - y^2 - z^2))
         0x04, 0x08, 0x10 : no payload (state bits; semantics TBD - see spec)
         0x20 vertex animation block: u32 size, size bytes (morph data, tracks)
Order of payloads: position, rotation, vertex block.
"""
from __future__ import annotations
import struct
from dataclasses import dataclass, field

ANM_POS = 0x01
ANM_ROT = 0x02
ANM_VTX = 0x20
KNOWN = 0x3F


class AnmError(ValueError):
    pass


@dataclass
class Key:
    frame: int
    flags: int
    pos: tuple | None = None
    rot: tuple | None = None      # quaternion (x, y, z, w)
    vtx: bytes | None = None


@dataclass
class Anm:
    version: int
    frame_count: int
    bones: list[str]
    tracks: dict[str, list[Key]] = field(default_factory=dict)


def _quat(x, y, z):
    w2 = 1.0 - (x * x + y * y + z * z)
    return (x, y, z, w2 ** 0.5 if w2 > 0 else 0.0)


def parse_anm(d: bytes, keep_vertex_blocks: bool = False) -> Anm:
    if d[:4] != b'EANM' or d[8:12] != b'FRMS':
        raise AnmError(f'bad header {d[:12]!r}')
    ver, = struct.unpack_from('<I', d, 4)
    frames, = struct.unpack_from('<I', d, 12)
    if d[16:20] != b'BMAP':
        raise AnmError('missing BMAP')
    nb, = struct.unpack_from('<I', d, 20)
    o = 24
    bones = []
    for _ in range(nb):
        k, = struct.unpack_from('<I', d, o)
        bones.append(d[o + 4:o + 4 + k].decode('latin1')); o += 4 + k
    anm = Anm(ver, frames, bones, {b: [] for b in bones})
    last = -1
    n = len(d)
    if d[o:o + 4] == b'FRMN':
        return _parse_v5(d, o, anm, keep_vertex_blocks)
    while o < n:
        if d[o:o + 4] != b'FRM2':
            raise AnmError(f'expected FRM2 at {o}, got {d[o:o + 4]!r}')
        fno, nrec = struct.unpack_from('<HB', d, o + 4); o += 7
        if fno <= last:
            raise AnmError(f'frame index {fno} not increasing')
        last = fno
        for _ in range(nrec):
            b, fl = struct.unpack_from('<BH', d, o); o += 3
            if b >= nb:
                raise AnmError(f'bone {b} >= {nb}')
            if fl & ~KNOWN:
                raise AnmError(f'unknown flags {fl:#x}')
            key = Key(fno, fl)
            if fl & ANM_POS:
                key.pos = struct.unpack_from('<3f', d, o); o += 12
            if fl & ANM_ROT:
                key.rot = _quat(*struct.unpack_from('<3f', d, o)); o += 12
            if fl & ANM_VTX:
                sz, = struct.unpack_from('<I', d, o); o += 4
                if keep_vertex_blocks:
                    key.vtx = d[o:o + sz]
                o += sz
            if o > n:
                raise AnmError('record overruns file')
            anm.tracks[bones[b]].append(key)
    if last >= max(frames, 1) + 1:
        raise AnmError(f'frame index {last} beyond frame_count {frames}')
    return anm


def _parse_v5(d: bytes, o: int, anm: Anm, keep: bool) -> Anm:
    """Legacy v5 layout: per frame 'FRMN' u32, then per bone 'BONE' u32 index followed
    by optional 'MATR' (12 f32, 3x4 row-major: 3x3 rotation + translation),
    'VISI' u32 visibility, 'MESH' u32 size + vertex-animation payload."""
    n = len(d)
    frame = -1
    key = None
    while o < n:
        tag = d[o:o + 4]; o += 4
        if tag == b'FRMN':
            frame, = struct.unpack_from('<I', d, o); o += 4
        elif tag == b'BONE':
            b, = struct.unpack_from('<I', d, o); o += 4
            if b >= len(anm.bones):
                raise AnmError(f'v5 bone {b} out of range')
            key = Key(frame, 0)
            anm.tracks[anm.bones[b]].append(key)
        elif tag == b'MATR':
            m = struct.unpack_from('<12f', d, o); o += 48
            if key is None:
                raise AnmError('MATR before BONE')
            key.flags |= ANM_POS | ANM_ROT
            key.pos = m[9:12]
            key.rot = _mat3_to_quat(m[0:9])
        elif tag == b'VISI':
            o += 4
        elif tag == b'MESH':
            sz, = struct.unpack_from('<I', d, o); o += 4
            if key is not None:
                key.flags |= ANM_VTX
                if keep:
                    key.vtx = d[o:o + sz]
            o += sz
        else:
            raise AnmError(f'v5 unknown chunk {tag!r} at {o - 4}')
        if o > n:
            raise AnmError('v5 chunk overruns file')
    return anm


def _mat3_to_quat(m):
    """Row-major 3x3 rotation -> quaternion (x, y, z, w)."""
    m00, m01, m02, m10, m11, m12, m20, m21, m22 = m
    tr = m00 + m11 + m22
    if tr > 0:
        s = (tr + 1.0) ** 0.5 * 2
        return ((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s)
    if m00 > m11 and m00 > m22:
        s = max(1e-12, 1.0 + m00 - m11 - m22) ** 0.5 * 2
        return (0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s)
    if m11 > m22:
        s = max(1e-12, 1.0 + m11 - m00 - m22) ** 0.5 * 2
        return ((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s)
    s = max(1e-12, 1.0 + m22 - m00 - m11) ** 0.5 * 2
    return ((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s)
