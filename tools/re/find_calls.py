import os, sys, re
sys.path.insert(0, 'tools/server')
from vfs import VFS
vfs = VFS()

# Find which def file triggered 'unknown macro FXtraceL1'
for f in vfs.files:
    if f.endswith('.def') or f.endswith('.inc') or f.endswith('.ext'):
        try:
            d = vfs.read(f)
        except Exception:
            continue
        if b'FXtraceL1' in d:
            print("Found FXtraceL1 in:", f)
            lines = [l.strip().decode('latin1', 'replace') for l in d.split(b'\n') if b'FXtraceL1' in l]
            print("  lines:", lines[:5])
        if b'tracks_mid' in d:
            print("Found tracks_mid in:", f)
            lines = [l.strip().decode('latin1', 'replace') for l in d.split(b'\n') if b'tracks_mid' in l]
            print("  lines:", lines[:5])
