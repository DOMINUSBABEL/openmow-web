"""Census of all obstacles across the 15 skirmish missions (both map and 0.mi)."""
import os
import sys
import posixpath
import time
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from vfs import VFS
from formats.sdl import parse_sdl, decode, Node, Atom
from formats.bply import parse_bply

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

class ObstacleResolver:
    def __init__(self, vfs):
        self.vfs = vfs
        self.def_cache = {}
        self.mdl_cache = {}
        self._def_index = {}
        # Index all .def files by basename
        for p in vfs.files:
            if p.endswith('.def'):
                base = posixpath.basename(p)[:-4]
                if base not in self._def_index:
                    self._def_index[base] = p

    def get_def_path(self, proto: str) -> str | None:
        if not proto:
            return None
        proto = proto.replace('\\', '/').strip('/')
        # 1. Direct path
        cands = [
            f"/entity/{proto}.def",
            f"/entity/-vehicle/{proto}.def",
            f"/entity/construction/{proto}.def",
            f"/entity/landscape/{proto}.def",
            f"/entity/flora/{proto}.def",
            f"/entity/inventory/{proto}.def",
            f"/entity/service/{proto}.def",
        ]
        for c in cands:
            if self.vfs.exists(c):
                return c
        # 2. Basename index
        base = posixpath.basename(proto)
        return self._def_index.get(base)

    def get_proto_obstacles(self, proto: str) -> list[dict]:
        if proto in self.def_cache:
            return self.def_cache[proto]
        
        def_path = self.get_def_path(proto)
        if not def_path:
            self.def_cache[proto] = []
            return []

        # Find extension MDL
        obs_list = []
        try:
            def_nodes = parse_sdl(decode(self.vfs.read(def_path), def_path))
            ext = None
            for e_n in find_nodes(def_nodes[0], 'Extension'):
                if e_n.args:
                    ext = e_n.args[0].value
            mdl_path = None
            if ext:
                mdl_path = posixpath.normpath(posixpath.join(posixpath.dirname(def_path), ext))
            if not mdl_path or not self.vfs.exists(mdl_path):
                mdl_path = posixpath.splitext(def_path)[0] + '.mdl'

            if self.vfs.exists(mdl_path):
                if mdl_path in self.mdl_cache:
                    obs_list = self.mdl_cache[mdl_path]
                else:
                    mdl_nodes = parse_sdl(decode(self.vfs.read(mdl_path), mdl_path))
                    for m_it in mdl_nodes:
                        for obs in find_nodes(m_it, 'Obstacle'):
                            obb2 = obs.find('Obb2')
                            p2 = obs.find('Polygon2')
                            c2 = obs.find('Circle2')
                            rot = obs.find('Rotate') is not None
                            if obb2:
                                c_n = obb2.find('Center')
                                e_n = obb2.find('Extent')
                                a_n = obb2.find('Axis')
                                if c_n and e_n:
                                    obs_list.append({
                                        'type': 'obb2',
                                        'center': [float(a.value) for a in c_n.args],
                                        'extent': [float(a.value) for a in e_n.args],
                                        'axis': [float(a.value) for a in a_n.args] if a_n else [1.0, 0.0],
                                        'rotate': rot,
                                    })
                            elif c2:
                                r_n = c2.find('Radius')
                                c_n = c2.find('Center')
                                if r_n:
                                    obs_list.append({
                                        'type': 'circle2',
                                        'radius': float(r_n.args[0].value),
                                        'center': [float(a.value) for a in c_n.args] if c_n else [0.0, 0.0],
                                        'rotate': rot,
                                    })
                            elif p2:
                                verts = []
                                for v_n in p2.find_all('Vertex'):
                                    verts.append([float(a.value) for a in v_n.args])
                                if len(verts) >= 3:
                                    obs_list.append({
                                        'type': 'polygon2',
                                        'vertices': verts,
                                        'rotate': rot,
                                    })
                    self.mdl_cache[mdl_path] = obs_list
        except Exception:
            pass

        self.def_cache[proto] = obs_list
        return obs_list

def main():
    vfs = VFS()
    resolver = ObstacleResolver(vfs)
    print("Resolver initialized.")

    total_stats = []

    for m in MISSIONS:
        t0 = time.time()
        m_name = posixpath.basename(m)
        
        # 1. Map.ply terrain
        ply_path = m + '/map.ply'
        b = parse_bply(vfs.read(ply_path))
        
        # 2. Placed entities in 0.mi and map
        entities = []
        for f_name in ['0.mi', 'map']:
            f_path = m + '/' + f_name
            if not vfs.exists(f_path):
                continue
            try:
                items = parse_sdl(decode(vfs.read(f_path), f_path))
                root = items[0]
                for it in root.children:
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
                        entities.append((proto, pos, zl, f_name))
            except Exception as e:
                print(f"Error reading {f_path}: {e}")

        # Count obstacles
        total_obstacles = 0
        for proto, pos, zl, src in entities:
            obs = resolver.get_proto_obstacles(proto)
            total_obstacles += len(obs)

        dt = time.time() - t0
        print(f"[{m_name}] Entities: {len(entities):<5} Obstacles: {total_obstacles:<5} ({dt:.2f}s)")
        total_stats.append((m_name, len(entities), total_obstacles))

    print("\n--- Summary ---")
    for name, ents, obs in total_stats:
        print(f"  {name:<25}: {ents:<6} entities, {obs:<6} obstacles")

if __name__ == '__main__':
    main()
