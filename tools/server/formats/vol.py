"""GEM2 EVLM collision/armour polyhedron decoder (.vol).

Layout (docs/formats/evlm.md):
  'EVLM'
  'VERT' u32 n, n x 3 f32
  'INDX' u32 n, n x u16 (triangle list)
  further chunks: recorded raw in `extra` until specified
"""
from __future__ import annotations
import struct
from dataclasses import dataclass, field


class VolError(ValueError):
    pass


@dataclass
class Vol:
    vertices: list = field(default_factory=list)
    indices: list = field(default_factory=list)
    extra: dict = field(default_factory=dict)


def parse_vol(d: bytes) -> Vol:
    if d[:4] != b'EVLM':
        raise VolError(f'bad magic {d[:4]!r}')
    v = Vol()
    o, n = 4, len(d)
    while o < n:
        tag = d[o:o + 4]; o += 4
        if tag == b'VERT':
            c, = struct.unpack_from('<I', d, o); o += 4
            f = struct.unpack_from(f'<{c * 3}f', d, o); o += c * 12
            v.vertices = [f[i:i + 3] for i in range(0, len(f), 3)]
        elif tag == b'INDX':
            c, = struct.unpack_from('<I', d, o); o += 4
            v.indices = list(struct.unpack_from(f'<{c}H', d, o)); o += c * 2
        elif tag == b'SIDE':
            c, = struct.unpack_from('<I', d, o); o += 4
            v.extra['SIDE'] = d[o:o + c]; o += c
        else:
            raise VolError(f'unknown chunk {tag!r} at {o - 4}: {d[o - 4:o + 16].hex(" ")}')
        if o > n:
            raise VolError('overrun')
    if v.indices and max(v.indices) >= len(v.vertices):
        raise VolError('index out of range')
    return v
