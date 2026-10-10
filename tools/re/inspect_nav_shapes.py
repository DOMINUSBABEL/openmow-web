"""Check Obb2, Polygon2, Circle2 details and verify whether Extent is half-size or full-size."""
import os
import sys
import posixpath

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

    poly_example = None
    circle_example = None
    obb_and_vol = []

    for p in mdl_files:
        try:
            items = parse_sdl(decode(vfs.read(p), p))
            for it in items:
                obs_list = find_nodes(it, 'Obstacle')
                vol_list = find_nodes(it, 'Volume')
                for obs in obs_list:
                    p2 = find_nodes(obs, 'Polygon2')
                    if p2 and not poly_example:
                        poly_example = (p, obs)
                    c2 = find_nodes(obs, 'Circle2')
                    if c2 and not circle_example:
                        circle_example = (p, obs)
                    obb2 = find_nodes(obs, 'Obb2')
                    if obb2 and vol_list and len(obb_and_vol) < 5:
                        obb_and_vol.append((p, obb2[0], vol_list[0]))
        except Exception:
            pass

    if poly_example:
        print("=== Polygon2 Example ===")
        print(f"File: {poly_example[0]}")
        print(dump_node(poly_example[1]))

    if circle_example:
        print("=== Circle2 Example ===")
        print(f"File: {circle_example[0]}")
        print(dump_node(circle_example[1]))

    print("=== Obb2 vs Volume comparison (to check half vs full extent) ===")
    for p, obb, vol in obb_and_vol:
        print(f"\nFile: {p}")
        print("Obstacle Obb2:")
        print(dump_node(obb, 1))
        print("Volume:")
        print(dump_node(vol, 1))

if __name__ == '__main__':
    main()
