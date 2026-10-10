import sys
sys.path.insert(0, 'tools/server')
from vfs import VFS
from formats.gem_pre import Pre
from test_pre_explore import ent_files

vfs = VFS()
for ef in ent_files:
    p = Pre(vfs)
    p.load(ef)
    for w in p.warnings:
        if 'door2' in w:
            print("door2 warning in:", ef, w)
            break
