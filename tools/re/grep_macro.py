import re, sys
sys.path.insert(0, 'tools/server')
from vfs import VFS
vfs = VFS()

targets = [b'FXtraceL1', b'tracks_mid', b'wlf']
for f in vfs.files:
    if f.endswith(('.dds', '.ply', '.anm', '.vol', '.tga', '.wav', '.ogg', '.png', '.mi')):
        continue
    try:
        data = vfs.read(f)
    except Exception:
        continue
    for t in targets:
        if t in data:
            # find all lines matching
            lines = [l.strip() for l in data.split(b'\n') if t in l]
            print(f, t.decode(), lines[:3])
