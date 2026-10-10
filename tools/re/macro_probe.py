import os, sys, re, collections
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))
from vfs import VFS  # noqa
vfs = VFS()
pats = [rb'accuracy_pistol', rb'"recoveryTime"', rb'veterancy_1"', rb'burst_short']
found = collections.defaultdict(list)
defs = collections.Counter()
for f in vfs.files:
    if not (f.startswith('/set/') or f.startswith('/properties/') or f.startswith('/entity/-vehicle/')):
        continue
    if f.endswith(('.dds', '.ply', '.anm', '.vol', '.tga', '.wav', '.ogg', '.png')):
        continue
    try:
        d = vfs.read(f)
    except Exception:
        continue
    for m in re.finditer(rb'\(define\s+"?([\w\- ]+)"?', d):
        defs[m.group(1)] += 1
    for p in pats:
        if re.search(rb'\(define\s+"?' + p.strip(b'"'), d):
            found[p].append(f)
print('define sites:', {k.decode(): v[:5] for k, v in found.items()})
print('distinct defined macro names', len(defs))
print(defs.most_common(30))
# directive census
dirs = collections.Counter()
for f in vfs.files:
    if f.startswith('/set/') or f.startswith('/properties/') or (f.startswith('/entity/') and f.endswith(('.def', '.ext', '.inc'))):
        try:
            d = vfs.read(f)
        except Exception:
            continue
        for m in re.finditer(rb'\((\w+)[\s"]', d):
            dirs[m.group(1)] += 1
print('paren directives', dirs.most_common(25))
