import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.abspath(os.path.join(HERE, '..', 'server'))
sys.path.insert(0, SERVER_DIR)

from vfs import VFS
from formats.sdl import parse_sdl, decode, Node

vfs = VFS()

# 1. Search for .anm files in VFS
all_anms = [p for p in vfs.files.keys() if p.endswith('.anm')]
print(f"Total .anm files in VFS: {len(all_anms)}")
human_anms = [p for p in all_anms if 'human' in p or 'anim' in p]
print(f"Human/anim related .anm files: {len(human_anms)}")
for p in sorted(human_anms)[:20]:
    print("  ", p)

# 2. Check human.mdl or humanskin mdl
human_mdls = [p for p in vfs.files.keys() if 'human' in p and p.endswith('.mdl')]
print(f"\nHuman .mdl files: {len(human_mdls)}")
for p in sorted(human_mdls)[:10]:
    print("  ", p)

# 3. Check /set/ for animation definitions or fsm
anim_sets = [p for p in vfs.files.keys() if ('anim' in p or 'fsm' in p or 'human' in p) and p.startswith('/set/')]
print(f"\nSet files matching anim/fsm/human: {len(anim_sets)}")
for p in sorted(anim_sets)[:20]:
    print("  ", p)
