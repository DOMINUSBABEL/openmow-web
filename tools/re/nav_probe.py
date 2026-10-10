"""Probe navigation data across the 15 skirmish missions.

Investigates:
1. Terrain bounding boxes and dimensions in GEM2 units and meters.
2. Obstacle / Area / Volume definitions in MDL and DEF for entities placed in the 15 missions.
3. Slope statistics on map.ply.
"""
import os
import sys
import posixpath
import numpy as np
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from vfs import VFS
from formats.bply import parse_bply
from formats.sdl import parse_sdl, decode, Node

MISSIONS = [
    'map/single/01_usa-skirmish/01_usa-overlord',
    'map/single/01_usa-skirmish/02_usa-carentan',
    'map/single/01_usa-skirmish/03_usa-ardennes',
    'map/single/02_ger-skirmish/01_ger-caen',
    'map/single/02_ger-skirmish/02_ger-sthilaire',
    'map/single/02_ger-skirmish/03_ger-marketgarden',
    'map/single/03_eng-skirmish/01_eng-battleaxe',
    'map/single/03_eng-skirmish/02_eng-torch',
    'map/single/03_eng-skirmish/03_eng-arnhem',
    'map/single/04_rus-skirmish/01_rus-smolensk',
    'map/single/04_rus-skirmish/02_rus-koenigsberg',
    'map/single/04_rus-skirmish/03_rus-manchuria',
    'map/single/05_jap-skirmish/01_jap-khalkhingol',
    'map/single/05_jap-skirmish/02_jap-singapore',
    'map/single/05_jap-skirmish/03_jap-iwojima',
]

def find_nodes(node, tag):
    out = []
    if isinstance(node, Node):
        if node.tag == tag:
            out.append(node)
        for c in node.children:
            out.extend(find_nodes(c, tag))
    return out

def run():
    game_dir = r"C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2"
    vfs = VFS(game_dir)

    print("=== 1. TERRAIN BOUNDS ACROSS 15 MISSIONS ===")
    for m in MISSIONS:
        ply_path = m + '/map.ply'
        if not vfs.exists(ply_path):
            print(f"MISSING: {ply_path}")
            continue
        b = parse_bply(vfs.read(ply_path))
        raw = np.frombuffer(b.vertices, np.uint8).reshape(b.vertex_count, b.stride)
        pos = np.ascontiguousarray(raw[:, :12]).view('<f4').reshape(-1, 3)
        min_p = pos.min(axis=0)
        max_p = pos.max(axis=0)
        size_gem = max_p - min_p
        size_m = size_gem / 20.0
        print(f"{posixpath.basename(m):<20} Verts:{b.vertex_count:<6} "
              f"X:[{min_p[0]:.0f}..{max_p[0]:.0f}] Y:[{min_p[1]:.0f}..{max_p[1]:.0f}] Z:[{min_p[2]:.0f}..{max_p[2]:.0f}] "
              f"Size_m:({size_m[0]:.0f}m x {size_m[1]:.0f}m, dZ={size_m[2]:.1f}m)")

    print("\n=== 2. SCAN ENTITIES IN 0.mi AND DEF/MDL FOR OBSTACLES ===")
    proto_set = set()
    for m in MISSIONS:
        mi_path = m + '/0.mi'
        if not vfs.exists(mi_path):
            continue
        items = parse_sdl(decode(vfs.read(mi_path), mi_path))
        for it in items:
            if isinstance(it, Node) and it.tag in ('Entity', 'Human'):
                if it.args:
                    proto_set.add(str(it.args[0].value))

    print(f"Total unique entity prototypes across 15 missions: {len(proto_set)}")

    # Sample check of .def and .mdl
    obstacle_tags = Counter()
    mdl_obstacle_nodes = Counter()
    def_props = Counter()

    # Search for defs
    for proto in list(proto_set)[:100]: # Sample 100 first
        # Find def
        def_candidates = [
            f"/entity/{proto}.def",
            f"/entity/-vehicle/{proto}.def",
            f"/entity/construction/{proto}.def",
            f"/entity/fauna/{proto}.def",
            f"/entity/flora/{proto}.def",
            f"/entity/human/{proto}.def",
            f"/entity/inventory/{proto}.def",
            f"/entity/landscape/{proto}.def",
            f"/entity/service/{proto}.def",
        ]
        def_path = None
        for cand in def_candidates:
            if vfs.exists(cand):
                def_path = cand
                break
        if not def_path:
            # Let's search by basename
            base = posixpath.basename(proto)
            for cand in [f"/entity/{base}/{base}.def", f"/entity/construction/{base}/{base}.def", f"/entity/landscape/{base}/{base}.def"]:
                if vfs.exists(cand):
                    def_path = cand
                    break

        if not def_path:
            continue

        try:
            def_nodes = parse_sdl(decode(vfs.read(def_path), def_path))
        except Exception:
            continue

        # Look for props
        for p_node in find_nodes(def_nodes, 'props'):
            for a in p_node.args:
                def_props[str(a.value)] += 1

        # Look for Volume
        for v_node in find_nodes(def_nodes, 'Volume'):
            for tag_node in find_nodes(v_node, 'tags'):
                for a in tag_node.args:
                    obstacle_tags[str(a.value)] += 1

        # Look for Extension (MDL)
        for ext_node in find_nodes(def_nodes, 'Extension'):
            if ext_node.args:
                mdl_name = str(ext_node.args[0].value)
                mdl_dir = posixpath.dirname(def_path)
                mdl_path = posixpath.normpath(posixpath.join(mdl_dir, mdl_name))
                if not vfs.exists(mdl_path):
                    # Try .mdl in entity
                    mdl_path = posixpath.splitext(def_path)[0] + '.mdl'
                if vfs.exists(mdl_path):
                    try:
                        mdl_items = parse_sdl(decode(vfs.read(mdl_path), mdl_path))
                        for n in find_nodes(mdl_items, 'Obstacle'):
                            mdl_obstacle_nodes['Obstacle'] += 1
                            for c in n.children:
                                mdl_obstacle_nodes[f"Obstacle.{c.tag}"] += 1
                        for n in find_nodes(mdl_items, 'Area'):
                            mdl_obstacle_nodes['Area'] += 1
                        for n in find_nodes(mdl_items, 'Volume'):
                            mdl_obstacle_nodes['Volume'] += 1
                    except Exception:
                        pass

    print("\nDef props sample:")
    for k, v in def_props.most_common(15):
        print(f"  {k}: {v}")

    print("\nVolume tags sample:")
    for k, v in obstacle_tags.most_common(15):
        print(f"  {k}: {v}")

    print("\nMDL obstacle nodes sample:")
    for k, v in mdl_obstacle_nodes.most_common(15):
        print(f"  {k}: {v}")

if __name__ == '__main__':
    run()
