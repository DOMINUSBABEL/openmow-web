import sys
sys.path.insert(0, 'tools/server')
from vfs import VFS
from formats.sdl import parse_sdl, decode, Node
from convert.proto import resolve_proto

vfs = VFS()
mi_path = 'map/single/03_eng-skirmish/01_eng-battleaxe/0.mi'
items = parse_sdl(decode(vfs.read(mi_path), mi_path))
mission = next(i for i in items if isinstance(i, Node) and i.tag == 'mission')

protos = set()
for c in mission.children:
    if (c.tag == 'Entity' or c.tag == 'Human') and c.args:
        kind = 'human' if c.tag == 'Human' else 'entity'
        protos.add((kind, c.args[0].value))

print(f"Testing {len(protos)} prototypes of 01_eng-battleaxe:")
failed = []
for kind, name in sorted(protos):
    try:
        p = resolve_proto(vfs, kind, name)
    except Exception as e:
        failed.append((kind, name, e))

print(f"Failed prototypes: {len(failed)} {failed}")
