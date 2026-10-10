"""Inspect obstacles for buildings and constructions in Caen and Carentan."""
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
    for p in vfs.files:
        if p.endswith(f"/{base}.def"):
            return p
    return None

def main():
    vfs = VFS()
    for m in ['map/single/02_ger-skirmish/01_ger-caen', 'map/single/01_usa-skirmish/02_usa-carentan']:
        mi_path = m + '/0.mi'
        items = parse_sdl(decode(vfs.read(mi_path), mi_path))
        mission_node = items[0]
        entities = []
        for it in mission_node.children:
            if it.tag == 'Entity':
                proto = it.args[0].value if it.args else None
                entities.append(proto)
        
        print(f"\n=== Mission: {posixpath.basename(m)} (Total Entities: {len(entities)}) ===")
        protos = Counter(entities)
        
        # Check 15 most common entity protos
        for proto, cnt in protos.most_common(20):
            def_path = get_def_path(vfs, proto)
            if not def_path:
                print(f"  {proto} x{cnt}: NO DEF")
                continue
            def_nodes = parse_sdl(decode(vfs.read(def_path), def_path))
            ext = None
            for e_n in find_nodes(def_nodes[0], 'Extension'):
                if e_n.args:
                    ext = e_n.args[0].value
            mdl_path = None
            if ext:
                mdl_path = posixpath.normpath(posixpath.join(posixpath.dirname(def_path), ext))
            if not mdl_path or not vfs.exists(mdl_path):
                mdl_path = posixpath.splitext(def_path)[0] + '.mdl'
            
            obs_cnt = 0
            vol_cnt = 0
            if vfs.exists(mdl_path):
                mdl_nodes = parse_sdl(decode(vfs.read(mdl_path), mdl_path))
                for m_it in mdl_nodes:
                    obs_cnt += len(find_nodes(m_it, 'Obstacle'))
                    vol_cnt += len(find_nodes(m_it, 'Volume'))
            print(f"  {proto:<30} x{cnt:<3} def:{posixpath.basename(def_path)} obs:{obs_cnt} vol:{vol_cnt}")

if __name__ == '__main__':
    main()
