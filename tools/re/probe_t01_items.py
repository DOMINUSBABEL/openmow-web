"""Comprehensive probe for T01: Entities, Humans, Breeds, Weapons, Items and Stuff."""
import collections
import os
import posixpath
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))
from vfs import VFS
from formats.sdl import parse_sdl, decode, Node, Atom
from formats.gem_pre import Pre
from mission_census import SCOPE

vfs = VFS()

# 1. Index entities
defs_by_base = collections.defaultdict(list)
for f in vfs.files:
    if f.startswith('/entity/') and f.endswith('.def'):
        base = posixpath.splitext(posixpath.basename(f))[0].lower()
        defs_by_base[base].append(f)

# 2. Index stuff
stuff_by_name = collections.defaultdict(list)
for f in vfs.files:
    if f.startswith('/set/stuff/'):
        base = posixpath.basename(f).lower()
        stuff_by_name[base].append(f)
        raw_base = posixpath.splitext(base)[0]
        if raw_base != base:
            stuff_by_name[raw_base].append(f)

print(f"Total entity defs: {sum(len(v) for v in defs_by_base.values())}, unique basenames: {len(defs_by_base)}")
print(f"Total stuff files: {len(set(f for sublist in stuff_by_name.values() for f in sublist))}")

# 3. Collect from missions
ent_names = set()
human_names = set()
mission_items = set()

for m in SCOPE:
    mi = m + '/0.mi'
    items = parse_sdl(decode(vfs.read(mi), mi))
    mission = next(i for i in items if isinstance(i, Node) and i.tag == 'mission')
    for c in mission.children:
        if c.tag == 'Entity' and c.args:
            ent_names.add(c.args[0].value)
        elif c.tag == 'Human' and c.args:
            human_names.add(c.args[0].value)
        elif c.tag == 'Inventory':
            box = c.find('box')
            if box:
                for it in box.children:
                    if it.tag == 'item' and it.args:
                        mission_items.add(tuple(a.value for a in it.args))

print(f"Missions: {len(ent_names)} unique entities, {len(human_names)} unique humans, {len(mission_items)} item tuples")

# Check item resolution
hex_items = []
resolved_items = {}
unresolved_items = []

def resolve_item(parts):
    # parts is tuple of atom values e.g. ('valter',), ('0x8000',), ('pistol', 'ammo', 100), ('bullet88', 'ap'), ('ammo bazooka', 3)
    first = str(parts[0]).lower().strip('"')
    if first.startswith('0x'):
        return 'HEX_ENTITY_REF', first
    
    # If first contains space, e.g. "ammo bazooka", "grenade m24", "panzerfaust weapon", "rifle ammo", "weapon weapon type_4at"
    tokens = first.split()
    if len(tokens) >= 2:
        # Try any combination of tokens
        w0, w1 = tokens[0], tokens[1]
        cands = [
            f"{w1}.{w0}",
            f"{w0}.{w1}",
            f"{w0}.{w1}.ammo",
            f"{w1}.{w0}.ammo",
            f"{w0}",
            f"{w1}",
            f"{tokens[-1]}",
            f"{tokens[-1]}.weapon",
            f"{tokens[-1]}.ammo",
            f"{tokens[-1]}.grenade",
            f"{w0}_{w1}",
            f"{w1}_{w0}",
        ]
        if len(tokens) >= 3:
            wlast = tokens[-1]
            cands.extend([
                f"{wlast}",
                f"{wlast}.weapon",
                f"{wlast}.ammo",
                f"{wlast}.grenade",
            ])
        for c in cands:
            if c in stuff_by_name:
                return 'STUFF', stuff_by_name[c][0]
            if c in defs_by_base:
                return 'ENTITY', defs_by_base[c][0]

    # Check exact stuff
    if first in stuff_by_name:
        return 'STUFF', stuff_by_name[first][0]
    
    # Try extensions
    for ext in ('.ammo', '.grenade', '.pattern', '.weapon'):
        if first + ext in stuff_by_name:
            return 'STUFF', stuff_by_name[first + ext][0]
            
    # If 2 parts, e.g. ("bullet88", "ap") or ("ammo", "pistol") or ("pistol", "ammo")
    if len(parts) >= 2:
        second = str(parts[1]).lower().strip('"')
        cand1 = f"{first}.{second}.ammo"
        if cand1 in stuff_by_name:
            return 'STUFF', stuff_by_name[cand1][0]
        cand2 = f"{second}.{first}.ammo"
        if cand2 in stuff_by_name:
            return 'STUFF', stuff_by_name[cand2][0]
        cand3 = f"{second}.ammo"
        if cand3 in stuff_by_name:
            return 'STUFF', stuff_by_name[cand3][0]
        cand4 = f"{first}.ammo"
        if cand4 in stuff_by_name:
            return 'STUFF', stuff_by_name[cand4][0]
        cand5 = f"{second}.grenade"
        if cand5 in stuff_by_name:
            return 'STUFF', stuff_by_name[cand5][0]
        cand6 = f"{first}.grenade"
        if cand6 in stuff_by_name:
            return 'STUFF', stuff_by_name[cand6][0]

    # Check if it's an entity basename
    if first in defs_by_base:
        return 'ENTITY', defs_by_base[first][0]

    return 'UNRESOLVED', None

for it in sorted(mission_items, key=lambda x: str(x)):
    kind, res = resolve_item(it)
    if kind == 'HEX_ENTITY_REF':
        hex_items.append(it)
    elif kind == 'UNRESOLVED':
        unresolved_items.append(it)
    else:
        resolved_items[it] = (kind, res)

print(f"Item resolution results:")
print(f"  HEX_ENTITY_REF: {len(hex_items)}")
print(f"  Resolved to STUFF or ENTITY: {len(resolved_items)}")
print(f"  Unresolved items: {len(unresolved_items)}")
if unresolved_items:
    print("  Samples of unresolved items:")
    for u in unresolved_items[:30]:
        print("   ", u)

# Check breed skins and inventories
print("\nChecking Human Breeds and their components:")
breed_skins = set()
breed_items = set()
pre = Pre(vfs)

for h in sorted(human_names):
    bpath = f'/set/breed/{h}.set'
    if not vfs.exists(bpath):
        bpath = f'/set/breed/{h}'
    nodes = pre.load(bpath)
    bnode = next((n for n in nodes if isinstance(n, Node) and n.tag == 'breed'), None)
    if bnode:
        skin = bnode.find('skin')
        if skin and skin.args:
            skin_name = skin.args[0].value.strip('"')
            breed_skins.add(skin_name)
        inv = bnode.find('inventory')
        if inv:
            for it in inv.children:
                if it.tag == 'item' and it.args:
                    breed_items.add(tuple(a.value for a in it.args))

print(f"Human Breeds: {len(human_names)}, unique skins referenced: {len(breed_skins)}, unique breed items: {len(breed_items)}")

# Verify all skins resolve to .def
missing_skins = []
for s in breed_skins:
    cands = [f'/entity/humanskin/{s}/{s}.def', f'/entity/humanskin/{s}.def']
    if not any(vfs.exists(c) for c in cands):
        # check defs_by_base
        if s.lower() not in defs_by_base:
            missing_skins.append(s)

print(f"Missing human skins: {len(missing_skins)} {missing_skins}")

# Verify breed items resolution
unres_breed_items = []
for it in sorted(breed_items, key=lambda x: str(x)):
    kind, res = resolve_item(it)
    if kind == 'UNRESOLVED':
        unres_breed_items.append(it)

print(f"Unresolved breed items: {len(unres_breed_items)}")
if unres_breed_items:
    for u in unres_breed_items[:30]:
        print("   ", u)
