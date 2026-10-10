import json
import struct
import sys
sys.path.insert(0, 'tools/server')
from vfs import VFS
from convert.terrain import terrain_to_glb

v = VFS()
glb, rep = terrain_to_glb(v, 'map/single/01_usa-skirmish/01_usa-overlord')
jlen, = struct.unpack_from('<I', glb, 12)
js = json.loads(glb[20:20+jlen])

print("gltf keys:", list(js.keys()))
print("scenes:", js.get('scenes'))
print("nodes:", js.get('nodes'))
print("meshes count:", len(js.get('meshes', [])))
if js.get('meshes'):
    m0 = js['meshes'][0]
    print("mesh 0 name:", m0['name'], "primitives count:", len(m0['primitives']))
    p0 = m0['primitives'][0]
    print("primitive 0:", p0)
    print("attributes:", p0['attributes'])
    pos_acc = js['accessors'][p0['attributes']['POSITION']]
    print("POSITION accessor:", pos_acc)
    idx_acc = js['accessors'][p0['indices']]
    print("indices accessor:", idx_acc)
