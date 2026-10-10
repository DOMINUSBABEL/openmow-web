"""Verify terrain materials and diffuse textures resolution across 15 missions."""
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

def parse_terrain_mtl(vfs, path: str):
    data = {'layers': [], 'diffuse': None, 'bump': None}
    if not vfs.exists(path):
        return data
    base = posixpath.dirname(path)
    items = parse_sdl(decode(vfs.read(path), path))
    for it in items:
        if isinstance(it, Node) and it.tag == 'material':
            for c in it.children:
                if c.tag == 'layer':
                    lay = {}
                    for prop in c.children:
                        tag = prop.tag
                        if tag and prop.args:
                            val = prop.args[0].value
                            if tag in ('diffuse', 'bump'):
                                resolved = vfs.resolve(val, base, ('.dds', '.tga', ''))
                                lay[tag] = resolved
                                lay[tag + '_raw'] = val
                            else:
                                lay[tag] = val
                    data['layers'].append(lay)
    if data['layers']:
        data['diffuse'] = data['layers'][0].get('diffuse')
        data['bump'] = data['layers'][0].get('bump')
    return data

total_subm = 0
missing_mtls = []
missing_diffuses = []

for m in SCOPE:
    m_dir = '/' + m.lstrip('/')
    ply_path = m_dir + '/map.ply'
    t = parse_bply(vfs.read(ply_path))
    for s in t.submeshes:
        total_subm += 1
        mtl_path = m_dir + '/' + s.material
        if not vfs.exists(mtl_path):
            missing_mtls.append(mtl_path)
            continue
        info = parse_terrain_mtl(vfs, mtl_path)
        if not info['diffuse']:
            missing_diffuses.append((mtl_path, info))

print(f"Total terrain submeshes across 15 missions: {total_subm}")
print(f"Missing MTL files: {len(missing_mtls)}")
print(f"Missing diffuse textures: {len(missing_diffuses)}")
if missing_diffuses:
    print("Samples of missing diffuse:", missing_diffuses[:5])
