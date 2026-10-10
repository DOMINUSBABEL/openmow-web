import sys, re
sys.path.insert(0, 'tools/server')
from vfs import VFS
vfs = VFS()

for f in vfs.files:
    if f.startswith('/properties/') or f.startswith('/set/'):
        if f.endswith('.ext') or f.endswith('.inc'):
            d = vfs.read(f)
            if b'%0' in d or b'%1' in d:
                print("Positional arg in:", f)
                for l in d.split(b'\n'):
                    if b'%0' in l or b'%1' in l:
                        print("  ", l.strip().decode('latin1', 'replace'))
