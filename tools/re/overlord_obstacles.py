"""Inspect obstacles for entities in 01_usa-overlord."""
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

def get_def_path(vfs, proto):
    cands = [
        f"/entity/{proto}.def",
        f"/entity/-vehicle/{proto}.def",
        f"/entity/construction/{proto}.def",
        f"/entity/landscape/{proto}.def",
        f"/entity/flora/{proto}.def",
        f"/entity/fauna/{proto}.def",
        f"/entity/inventory/{proto}.def",
        f"/entity/service/{proto}.def",
    ]
    for c in cands:
        if vfs.exists(c):
            return c
    base = posixpath.basename(proto)
    for c in [f"/entity/{base}/{base}.def", f"/entity/construction/{base}/{base}.def", f"/entity/landscape/{base}/{base}.def"]:
        if vfs.exists(c):
            return c
    # Fallback search
    for p in vfs.files:
        if p.endswith(f"/{base}.def"):
            return p
    return None

def main():
    vfs = VFS()
    mi_path = 'map/single/01_usa-skirmish/01_usa-overlord/0.mi'
    items = parse_sdl(decode(vfs.read(mi_path), mi_path))
    
    # In 0.mi, top node is mission
    mission_node = items[0]
    entities = []
    for it in mission_node.children:
        if it.tag in ('Entity', 'Human'):
            proto = it.args[0].value if it.args else None
            pos_node = it.find('Position')
            pos = [float(a.value) for a in pos_node.args] if pos_node else [0, 0, 0]
            xform = it.find('xform')
            zl = 0.0
            if xform:
                for idx, a in enumerate(xform.args):
                    if a.value == 'zl' and idx + 1 < len(xform.args):
                        zl = float(xform.args[idx + 1].value)
            entities.append({
                'kind': it.tag,
                'proto': proto,
                'pos': pos,
                'zl': zl,
                'node': it
            })

    print(f"Total entities in Overlord: {len(entities)}")
    
    # Check prototypes
    protos = Counter(e['proto'] for e in entities)
    print(f"Unique protos: {len(protos)}")
    
    # Analyze obstacles per proto
    proto_obstacles = {}
    for proto in protos:
        def_path = get_def_path(vfs, proto)
        if not def_path:
            continue
        try:
            def_nodes = parse_sdl(decode(vfs.read(def_path), def_path))
            # Find extension MDL
            ext = None
            for e_n in find_nodes(def_nodes[0], 'Extension'):
                if e_n.args:
                    ext = e_n.args[0].value
            mdl_path = None
            if ext:
                mdl_path = posixpath.normpath(posixpath.join(posixpath.dirname(def_path), ext))
            if not mdl_path or not vfs.exists(mdl_path):
                mdl_path = posixpath.splitext(def_path)[0] + '.mdl'
            
            obs_found = []
            if vfs.exists(mdl_path):
                mdl_nodes = parse_sdl(decode(vfs.read(mdl_path), mdl_path))
                for m_it in mdl_nodes:
                    for obs in find_nodes(m_it, 'Obstacle'):
                        name = obs.args[0].value if obs.args else ''
                        obb2 = obs.find('Obb2')
                        c2 = obs.find('Circle2')
                        p2 = obs.find('Polygon2')
                        rotate = obs.find('Rotate') is not None
                        tags = [a.value for a in obs.find('Tags').args] if obs.find('Tags') else []
                        obs_found.append({
                            'name': name,
                            'obb2': obb2 is not None,
                            'circle2': c2 is not None,
                            'polygon2': p2 is not None,
                            'rotate': rotate,
                            'tags': tags,
                            'node': obs
                        })
            proto_obstacles[proto] = obs_found
        except Exception as err:
            pass

    has_obs = sum(1 for p, o in proto_obstacles.items() if len(o) > 0)
    print(f"Prototypes with MDL Obstacle: {has_obs} / {len(proto_obstacles)}")
    
    # Print sample obstacles found
    for proto, obs in list(proto_obstacles.items()):
        if obs:
            print(f"\nProto: {proto} ({len(obs)} obstacles):")
            for o in obs[:3]:
                print(f"  Name: {o['name']}, obb2:{o['obb2']}, circle:{o['circle2']}, poly:{o['polygon2']}, rot:{o['rotate']}, tags:{o['tags']}")
                if o['obb2']:
                    obb_node = o['node'].find('Obb2')
                    c_n = obb_node.find('Center')
                    e_n = obb_node.find('Extent')
                    a_n = obb_node.find('Axis')
                    c_val = [float(a.value) for a in c_n.args] if c_n else []
                    e_val = [float(a.value) for a in e_n.args] if e_n else []
                    a_val = [float(a.value) for a in a_n.args] if a_n else []
                    print(f"    Center: {c_val}, Extent: {e_val}, Axis: {a_val}")

if __name__ == '__main__':
    main()
