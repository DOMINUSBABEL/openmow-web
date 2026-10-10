import sys
sys.path.insert(0, 'tools/server')
from vfs import VFS
from formats.sdl import parse_sdl, decode, Node
from convert.proto import resolve_proto
from convert.model import def_to_mdl, mdl_to_glb

vfs = VFS()
mi_path = 'map/single/03_eng-skirmish/01_eng-battleaxe/0.mi'
items = parse_sdl(decode(vfs.read(mi_path), mi_path))
mission = next(i for i in items if isinstance(i, Node) and i.tag == 'mission')

protos = set()
for c in mission.children:
    if (c.tag == 'Entity' or c.tag == 'Human') and c.args:
        kind = 'human' if c.tag == 'Human' else 'entity'
        protos.add((kind, c.args[0].value))

print(f"Testing {len(protos)} models of 01_eng-battleaxe:")
failed_models = []
models = set()
for kind, name in sorted(protos):
    p = resolve_proto(vfs, kind, name)
    if p.get('model'):
        models.add(p['model'])

print(f"Unique models to convert: {len(models)}")
for m in sorted(models):
    try:
        mdl = def_to_mdl(vfs, m) if m.endswith('.def') else m
        glb, rep = mdl_to_glb(vfs, mdl)
    except Exception as e:
        failed_models.append((m, e))

print(f"Failed models: {len(failed_models)} {failed_models}")
