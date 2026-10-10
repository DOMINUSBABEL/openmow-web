"""Test resolution of all {from ...} references in /set/stuff/."""
import os
import posixpath
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))
from vfs import VFS
from formats.gem_pre import Pre
from formats.sdl import Node

vfs = VFS()
pre = Pre(vfs)
stuff_files = [f for f in vfs.files if f.startswith('/set/stuff/')]

# Index stuff by basename and without ext
by_base = {}
by_noext = {}
for f in stuff_files:
    base = posixpath.basename(f).lower()
    noext = posixpath.splitext(base)[0]
    by_base[base] = f
    by_noext[noext] = f

def resolve_from(ref_str: str) -> str | None:
    s = ref_str.strip('"').lower()
    parts = s.split()
    if 'pattern' in parts:
        other = [p for p in parts if p != 'pattern']
        if other:
            cand = other[0]
            # Try cand.pattern
            if f"{cand}.pattern" in by_base:
                return by_base[f"{cand}.pattern"]
            # Try partial matches in patterns
            for f in stuff_files:
                if f.endswith('.pattern'):
                    pbase = posixpath.splitext(posixpath.basename(f))[0]
                    if cand in pbase or pbase in cand:
                        return f
    # Try exact basename
    if s in by_base:
        return by_base[s]
    if s in by_noext:
        return by_noext[s]
    # Try last token
    if parts:
        last = parts[-1]
        if last in by_base:
            return by_base[last]
        if last in by_noext:
            return by_noext[last]
        # try first token
        first = parts[0]
        if first in by_base:
            return by_base[first]
        if first in by_noext:
            return by_noext[first]
        if len(parts) >= 2:
            cand = f"{parts[0]}.{parts[1]}.ammo"
            if cand in by_base:
                return by_base[cand]
            cand = f"{parts[1]}.{parts[0]}"
            if cand in by_base:
                return by_base[cand]
    return None

all_froms = set()
for f in stuff_files:
    nodes = pre.load(f)
    for n in nodes:
        if isinstance(n, Node) and n.items:
            # {from "..." ...}
            first_val = getattr(n.items[0], 'value', str(n.items[0]))
            if first_val == 'from' and len(n.items) > 1:
                ref = getattr(n.items[1], 'value', str(n.items[1]))
                all_froms.add(ref)

print(f"Total distinct {{from}} refs in all /set/stuff/: {len(all_froms)}")
unresolved = []
for fr in sorted(all_froms):
    res = resolve_from(fr)
    if not res:
        unresolved.append(fr)
    else:
        print(f"  {fr:<25} -> {res}")

print(f"\nUnresolved from refs: {len(unresolved)} {unresolved}")
