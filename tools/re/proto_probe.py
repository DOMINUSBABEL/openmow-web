"""Probe: how do mission prototype names resolve to files? (in-scope 15 skirmishes)."""
import collections
import os
import posixpath
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))
from vfs import VFS  # noqa: E402
from formats.sdl import parse_sdl, decode, Node, Atom  # noqa: E402
from mission_census import SCOPE  # noqa: E402

vfs = VFS()
files = list(vfs.files)
by_base = collections.defaultdict(list)
for f in files:
    if f.startswith('/entity/') and f.endswith('.def'):
        by_base[posixpath.splitext(posixpath.basename(f))[0]].append(f)
breeds = {f for f in files if f.startswith('/set/breed/')}
print('defs', sum(len(v) for v in by_base.values()), 'distinct basenames', len(by_base), 'breed files', len(breeds))
dups = {k: v for k, v in by_base.items() if len(v) > 1}
print('basename collisions', len(dups), list(dups.items())[:5])
print('sample breed files', sorted(breeds)[:15])

ent = collections.Counter(); hum = collections.Counter(); itm = collections.Counter()
for m in SCOPE:
    mi = m + '/0.mi'
    items = parse_sdl(decode(vfs.read(mi), mi))
    mission = next(i for i in items if isinstance(i, Node) and i.tag == 'mission')
    for c in mission.children:
        if c.tag == 'Entity' and c.args:
            ent[c.args[0].value] += 1
        elif c.tag == 'Human' and c.args:
            hum[c.args[0].value] += 1
        elif c.tag == 'Inventory':
            box = c.find('box')
            if box:
                for it in box.children:
                    if it.tag == 'item' and it.args:
                        itm[it.args[0].value] += 1


def res_entity(n):
    n2 = n.lower()
    if n2 in by_base:
        return by_base[n2][0]
    return None


miss_e = [n for n in ent if not res_entity(n)]
miss_i = [n for n in itm if not res_entity(n)]
print('\nENTITY protos', len(ent), 'unresolved', len(miss_e), miss_e[:40])
print('ITEM protos', len(itm), 'unresolved', len(miss_i), miss_i[:40])
print('HUMAN protos', len(hum), list(hum.most_common(30)))
miss_h = []
for h in hum:
    cands = [f'/set/breed/{h}.set', f'/set/breed/{h}']
    if not any(vfs.exists(c) for c in cands):
        miss_h.append(h)
print('HUMAN unresolved', len(miss_h), miss_h[:30])
