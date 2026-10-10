import sys
sys.path.insert(0, 'tools/server')
from vfs import VFS
vfs = VFS()

for f in vfs.files:
    if f.endswith('.ext') or f.endswith('.inc') or f.endswith('.def'):
        try:
            d = vfs.read(f)
        except Exception:
            continue
        if b'(define "crew_human"' in d or b'(define "crew_human" ' in d:
            print("Define crew_human in:", f)
            lines = [l.strip().decode('latin1', 'replace') for l in d.split(b'\n') if b'crew_human' in l]
            print("  lines:", lines[:5])
