"""Probe: Which entities in the 15 skirmishes have models vs no models?"""
import os
import posixpath
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))
from vfs import VFS
from formats.sdl import parse_sdl, decode, Node
from convert.proto import ProtoResolver, build_entity_proto, build_human_proto
from mission_census import SCOPE

vfs = VFS()
resolver = ProtoResolver(vfs)

all_entities = set()
all_humans = set()

for m in SCOPE:
    mi = m + '/0.mi'
    items = parse_sdl(decode(vfs.read(mi), mi))
    mission = next(i for i in items if isinstance(i, Node) and i.tag == 'mission')
    for c in mission.children:
        if c.tag == 'Entity' and c.args:
            all_entities.add(c.args[0].value)
        elif c.tag == 'Human' and c.args:
            all_humans.add(c.args[0].value)

no_model_entities = []
has_model_entities = []

for e in sorted(all_entities):
    p = build_entity_proto(resolver, e)
    if p['model'] is None:
        no_model_entities.append((e, p['source']))
    else:
        has_model_entities.append(e)

no_model_humans = []
for h in sorted(all_humans):
    p = build_human_proto(resolver, h)
    if p['model'] is None:
        no_model_humans.append((h, p['source']))

print(f"Entities in scope: {len(all_entities)}")
print(f"  With model: {len(has_model_entities)}")
print(f"  Without model: {len(no_model_entities)}")
for e, src in no_model_entities:
    print(f"    - {e} ({src})")

print(f"\nHumans in scope: {len(all_humans)}")
print(f"  Without model: {len(no_model_humans)}")
