import sys, re
sys.path.insert(0, 'tools/server')
from vfs import VFS
vfs = VFS()

for f in vfs.files:
    if f.endswith('.def'):
        try:
            d = vfs.read(f)
        except Exception:
            continue
        if b'("shield"' in d:
            for l in d.split(b'\n'):
                if b'("shield"' in l:
                    print(f, l.strip().decode('latin1', 'replace'))
