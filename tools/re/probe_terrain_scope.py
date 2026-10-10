"""Probe terrain data for the 15 skirmishes in scope."""
import os
import posixpath
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))
from vfs import VFS
from formats.bply import parse_bply
from formats.sdl import parse_sdl, decode, Node
from mission_census import SCOPE

vfs = VFS()

print(f"Inspecting 15 terrain maps in scope:")
for m in SCOPE:
    ply_path = m + '/map.ply'
    map_path = m + '/map'
    has_ply = vfs.exists(ply_path)
    has_map = vfs.exists(map_path)
    
    # List all mtl files
    mtl_files = [f for f in vfs.files if f.startswith(m + '/') and f.endswith('.mtl')]
    
    t = parse_bply(vfs.read(ply_path))
    
    # Read Land from map if present
    land_info = {}
    if has_map:
        nodes = parse_sdl(decode(vfs.read(map_path), map_path))
        land_node = next((n for n in nodes if isinstance(n, Node) and n.tag == 'Land'), None)
        if land_node:
            for c in land_node.children:
                if c.tag and c.args:
                    land_info[c.tag] = [a.value for a in c.args]

    subm_mats = [s.material for s in t.submeshes]
    print(f"\n[{posixpath.basename(m)}]")
    print(f"  verts: {t.vertex_count}, stride: {t.stride}, indices: {len(t.indices)//4} (tris: {len(t.indices)//12})")
    print(f"  bbox: {[round(x, 1) for x in t.bbox]}")
    print(f"  submeshes: {len(t.submeshes)}, materials: {subm_mats}")
    print(f"  mtl files found on disk: {len(mtl_files)}")
    print(f"  Land info: {land_info}")
