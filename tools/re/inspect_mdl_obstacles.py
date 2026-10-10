"""Inspect Obstacle and Area structures in MDL files across GEM2 assets."""
import os
import sys
import posixpath
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from vfs import VFS
from formats.sdl import parse_sdl, decode, Node, Atom

def find_nodes(node, tag):
    out = []
    if isinstance(node, Node):
        if node.tag == tag:
            out.append(node)
        for c in node.children:
            out.extend(find_nodes(c, tag))
    return out

def dump_node(n, indent=0):
    pref = "  " * indent
    tag_str = n.tag or n.kind
    args_str = " ".join(repr(a.value) if a.quoted else a.value for a in n.args)
    res = f"{pref}{{{tag_str} {args_str}\n"
    for c in n.children:
        res += dump_node(c, indent + 1)
    res += f"{pref}}}\n"
    return res

def main():
    vfs = VFS()
    mdl_files = [p for p in vfs.files if p.endswith('.mdl')]
    print(f"Total MDL files in VFS: {len(mdl_files)}")

    obstacle_mdls = []
    area_mdls = []
    volume_mdls = []

    for p in mdl_files[:500]: # Sample 500
        try:
            items = parse_sdl(decode(vfs.read(p), p))
            for it in items:
                obs = find_nodes(it, 'Obstacle')
                if obs:
                    obstacle_mdls.append((p, obs))
                areas = find_nodes(it, 'Area')
                if areas:
                    area_mdls.append((p, areas))
                vols = find_nodes(it, 'Volume')
                if vols:
                    volume_mdls.append((p, vols))
        except Exception:
            pass

    print(f"Sampled 500 MDLs:")
    print(f"  MDLs with Obstacle: {len(obstacle_mdls)}")
    print(f"  MDLs with Area: {len(area_mdls)}")
    print(f"  MDLs with Volume: {len(volume_mdls)}")

    if obstacle_mdls:
        print("\n--- Example Obstacle structure ---")
        p, obs = obstacle_mdls[0]
        print(f"File: {p}")
        for o in obs[:3]:
            print(dump_node(o, 1))

    if area_mdls:
        print("\n--- Example Area structure ---")
        p, areas = area_mdls[0]
        print(f"File: {p}")
        for a in areas[:3]:
            print(dump_node(a, 1))

    if volume_mdls:
        print("\n--- Example Volume structure in MDL ---")
        p, vols = volume_mdls[0]
        print(f"File: {p}")
        for v in vols[:3]:
            print(dump_node(v, 1))

if __name__ == '__main__':
    main()
