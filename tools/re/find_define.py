import os, sys, re
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))
from vfs import VFS  # noqa
vfs = VFS()
want = sys.argv[1:]
for f in vfs.files:
    if f.endswith(('.dds', '.ply', '.anm', '.vol', '.tga', '.wav', '.ogg', '.png', '.mi', '.lng')):
        continue
    if not (f.startswith('/set/') or f.startswith('/properties/')):
        continue
    d = vfs.read(f).decode('latin1')
    for w in want:
        for m in re.finditer(r'\(define\s+"' + re.escape(w) + r'"', d):
            # print balanced block
            i = m.start(); depth = 0; j = i
            while j < len(d):
                if d[j] == '(':
                    depth += 1
                elif d[j] == ')':
                    depth -= 1
                    if depth == 0:
                        break
                elif d[j] == ';':
                    j = d.find('\n', j)
                    if j < 0: break
                j += 1
            print('=====', w, f)
            print(re.sub(r'\n\s*\n', '\n', d[i:j + 1])[:1800])
