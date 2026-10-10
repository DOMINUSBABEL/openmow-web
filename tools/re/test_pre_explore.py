"""Explore preprocessor execution on entities, breeds, and stuff in scope."""
import collections
import os
import posixpath
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))
from vfs import VFS  # noqa: E402
from formats.sdl import parse_sdl, decode, Node, Atom  # noqa: E402
from formats.gem_pre import Pre  # noqa: E402
from mission_census import SCOPE  # noqa: E402

vfs = VFS()

# 1. Map entity basenames to defs
defs_by_base = collections.defaultdict(list)
for f in vfs.files:
    if f.startswith('/entity/') and f.endswith('.def'):
        base = posixpath.splitext(posixpath.basename(f))[0].lower()
        defs_by_base[base].append(f)

# Priority resolution for collisions
def resolve_entity_def(name: str) -> str | None:
    n = name.lower()
    cands = defs_by_base.get(n)
    if not cands:
        return None
    if len(cands) == 1:
        return cands[0]
    # For collisions (e.g. shellhole_big, shellhole_medium, radio_station):
    # filter out /entity/fx/ for static constructions, or prefer non-fx
    non_fx = [c for c in cands if '/fx/' not in c]
    if non_fx:
        return non_fx[0]
    return cands[0]

# 2. Map stuff files
# Stuff files can be in /set/stuff/<category>/<name> or /set/stuff/<name> or with extensions .ammo, .grenade
stuff_by_name = collections.defaultdict(list)
for f in vfs.files:
    if f.startswith('/set/stuff/'):
        base = posixpath.basename(f).lower()
        stuff_by_name[base].append(f)
        # without extension if any
        raw_base = posixpath.splitext(base)[0]
        if raw_base != base:
            stuff_by_name[raw_base].append(f)

print(f"Total entity defs: {len(defs_by_base)}, stuff entries: {len(stuff_by_name)}")

# Collect all referenced entities, breeds, and items
entities_in_scope = set()
breeds_in_scope = set()
items_in_scope = set()

for m in SCOPE:
    mi = m + '/0.mi'
    items = parse_sdl(decode(vfs.read(mi), mi))
    mission = next(i for i in items if isinstance(i, Node) and i.tag == 'mission')
    for c in mission.children:
        if c.tag == 'Entity' and c.args:
            entities_in_scope.add(c.args[0].value)
        elif c.tag == 'Human' and c.args:
            breeds_in_scope.add(c.args[0].value)
        elif c.tag == 'Inventory':
            box = c.find('box')
            if box:
                for it in box.children:
                    if it.tag == 'item' and it.args:
                        items_in_scope.add(it.args[0].value)

print(f"Entities in scope: {len(entities_in_scope)}")
print(f"Breeds in scope: {len(breeds_in_scope)}")
print(f"Items in scope: {len(items_in_scope)}")

# Let's test Pre on each entity .def
pre_ent = Pre(vfs)
ent_files = []
for e in sorted(entities_in_scope):
    p = resolve_entity_def(e)
    if p:
        ent_files.append(p)
    else:
        print(f"Missing entity def for: {e}")

print(f"Resolved entity def files: {len(ent_files)}")

# Run pre on entities
macro_calls = collections.Counter()
for ef in ent_files:
    try:
        nodes = pre_ent.load(ef)
    except Exception as exc:
        print(f"ERR loading entity {ef}: {exc}")

print(f"Entity preprocessing done. Warnings: {len(pre_ent.warnings)}")
if pre_ent.warnings:
    warn_counts = collections.Counter(pre_ent.warnings)
    print("Top entity warnings:", warn_counts.most_common(15))
