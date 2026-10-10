"""Probe all breeds and stuff files in the 15 skirmishes."""
import sys, os, posixpath, collections
sys.path.insert(0, 'tools/server')
from vfs import VFS
from test_pre_explore import breeds_in_scope, items_in_scope, stuff_by_name
import formats.gem_pre as gp
from test_pre_fix import fixed_call_args, fixed_expand

gp.Pre._call_args = fixed_call_args
gp.Pre._expand = fixed_expand

vfs = VFS()

# 1. Breeds
breed_files = []
for b in sorted(breeds_in_scope):
    candidates = [f'/set/breed/{b}.set', f'/set/breed/{b}']
    hit = next((c for c in candidates if vfs.exists(c)), None)
    if hit:
        breed_files.append(hit)
    else:
        print("Missing breed file for:", b)

print(f"Breeds in scope: {len(breeds_in_scope)}, resolved files: {len(breed_files)}")

pb = gp.Pre(vfs)
for bf in breed_files:
    pb.load(bf)
print(f"Breed loading done. Warnings: {len(pb.warnings)}")
if pb.warnings:
    print("Breed warnings:", collections.Counter(pb.warnings).most_common(10))

# 2. Stuff files for items in scope
print(f"Items in scope: {len(items_in_scope)}")

# Resolve item names to stuff files
# Some items are:
# - plain name: 'valter' -> '/set/stuff/pistol/valter'
# - typed: 'pistol' with category 'ammo' -> '/set/stuff/ammo/pistol.ammo'
# - shell: 'bullet88' 'ap' -> '/set/stuff/shell/bullet88.ap.ammo'
# - grenade: 'm24' -> '/set/stuff/grenade/01 grenade_ap/m24.grenade'
# - entity id hex: '0x8000' (references entity in map)

def resolve_stuff(item_name: str) -> list[str]:
    # Check direct stuff match
    name_clean = item_name.strip('"').lower()
    if name_clean in stuff_by_name:
        return stuff_by_name[name_clean]
    # Check with extensions: .ammo, .grenade, .pattern
    for ext in ('.ammo', '.grenade', '.pattern', '.weapon'):
        if name_clean + ext in stuff_by_name:
            return stuff_by_name[name_clean + ext]
    return []

resolved_stuff = set()
unresolved_items = set()
hex_items = set()

for it in items_in_scope:
    if it.startswith('0x'):
        hex_items.add(it)
        continue
    s = resolve_stuff(it)
    if s:
        for p in s:
            resolved_stuff.add(p)
    else:
        unresolved_items.add(it)

print(f"Hex entity ref items: {len(hex_items)}")
print(f"Resolved stuff files: {len(resolved_stuff)}")
print(f"Unresolved items ({len(unresolved_items)}): {sorted(unresolved_items)[:20]}")

ps = gp.Pre(vfs)
for sf in sorted(resolved_stuff):
    ps.load(sf)
print(f"Stuff loading done. Warnings: {len(ps.warnings)}")
if ps.warnings:
    print("Stuff warnings:", collections.Counter(ps.warnings).most_common(10))
