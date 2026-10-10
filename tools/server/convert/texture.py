"""Texture conversion: DDS/TGA -> PNG (browser-native), via Pillow.

Later optimisation (task card T1.6): pass DXT through untouched as KTX2/DDS for
WEBGL_compressed_texture_s3tc and keep PNG only as fallback.
"""
from __future__ import annotations
import io
from PIL import Image


def to_png(data: bytes, max_size: int = 0) -> bytes:
    im = Image.open(io.BytesIO(data))
    im.load()
    if im.mode not in ('RGB', 'RGBA'):
        im = im.convert('RGBA')
    if max_size and max(im.size) > max_size:
        im.thumbnail((max_size, max_size))
    out = io.BytesIO()
    im.save(out, 'PNG', compress_level=1)
    return out.getvalue()
