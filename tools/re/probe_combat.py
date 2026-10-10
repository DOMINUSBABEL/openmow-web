import sys, os
sys.path.insert(0, 'tools/server')
from vfs import VFS, DEFAULT_GAME
from formats.sdl import decode, parse_sdl, Node, Atom

vfs = VFS(DEFAULT_GAME)

# 1. Search for ballistics file
print("--- 1. Searching for ballistics definitions ---")
ballistics_candidates = [p for p in vfs.files.keys() if 'ballistic' in p or 'penetration' in p or 'damage' in p]
print(f"Candidates ({len(ballistics_candidates)}):")
for b in sorted(ballistics_candidates)[:15]:
    print("  ", b)

# 2. Check set/stuff structure
print("\n--- 2. Checking set/stuff categories ---")
subdirs = [p for p in vfs.dirs.keys() if p.startswith('/set/stuff')]
print("Stuff dirs:", sorted(subdirs)[:15])

# 3. Check some ammo files (rifle, 75mm, 88mm)
print("\n--- 3. Inspecting sample ammo files ---")
sample_ammos = [p for p in vfs.files.keys() if p.endswith('.ammo')]
print(f"Total .ammo files: {len(sample_ammos)}")
for target in ['rifle', 'bullet75', 'bullet88']:
    matches = [p for p in sample_ammos if target in p]
    print(f"Matches for {target}:", matches[:3])
    if matches:
        content = decode(vfs.read(matches[0]))
        print(f"--- Content of {matches[0]} ---")
        print(content[:500])
        print("...")

# 4. Check sample weapons
print("\n--- 4. Inspecting sample weapon files ---")
sample_weapons = [
    '/set/stuff/rifle/garand',
    '/set/stuff/rifle/m9130',
    '/set/stuff/rifle/k98',
    '/set/stuff/gun/88mm_kwk36',
    '/set/stuff/gun/75mm_m3',
]
for w in sample_weapons:
    if vfs.exists(w):
        print(f"--- Content of {w} ---")
        print(decode(vfs.read(w))[:500])
    else:
        # Search by basename
        name = os.path.basename(w)
        matches = [p for p in vfs.files.keys() if f'/{name}' in p and '/set/stuff/' in p]
        print(f"{w} not found. Alternative matches:", matches[:3])
        if matches:
            print(decode(vfs.read(matches[0]))[:500])
