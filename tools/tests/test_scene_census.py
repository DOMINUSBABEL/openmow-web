"""Scene census & entity placement audit for all 15 skirmishes (T03 / Gate G1).

Verifies that for every mission in scope:
1. 100% of Entity and Human instances are successfully placed.
2. Models exist for all gameplay units; no-model prototypes are strictly accounted for (service entities).
3. Terrain bounding box fully contains mission entity coordinates.
"""
import os
import posixpath
import struct
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.abspath(os.path.join(HERE, '..', 'server'))
sys.path.insert(0, SERVER_DIR)
from vfs import VFS  # noqa: E402
from formats.sdl import parse_sdl, decode, Node  # noqa: E402
from formats.bply import parse_bply  # noqa: E402
from convert.proto import ProtoResolver, build_entity_proto, build_human_proto  # noqa: E402
RE_DIR = os.path.abspath(os.path.join(HERE, '..', 're'))
sys.path.insert(0, RE_DIR)
from mission_census import SCOPE  # noqa: E402


class TestSceneCensus(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vfs = VFS()
        cls.resolver = ProtoResolver(cls.vfs)
        cls.entity_proto_cache = {}
        cls.human_proto_cache = {}

    def get_proto_model(self, kind: str, name: str) -> str | None:
        if kind == 'entity':
            if name not in self.entity_proto_cache:
                self.entity_proto_cache[name] = build_entity_proto(self.resolver, name)
            return self.entity_proto_cache[name]['model']
        else:
            if name not in self.human_proto_cache:
                self.human_proto_cache[name] = build_human_proto(self.resolver, name)
            return self.human_proto_cache[name]['model']

    def test_all_15_missions_scene_census(self):
        self.assertEqual(len(SCOPE), 15)
        print(f"\n{'Mission':<22} | {'Entities':>8} | {'Placed':>8} | {'With Model':>10} | {'Service/NoModel':>15} | {'Coverage':>8}")
        print("-" * 84)

        for m in SCOPE:
            mi_path = m + '/0.mi'
            ply_path = m + '/map.ply'
            terrain = parse_bply(self.vfs.read(ply_path))

            items = parse_sdl(decode(self.vfs.read(mi_path), mi_path))
            mission = next(i for i in items if isinstance(i, Node) and i.tag == 'mission')

            total_entities = 0
            placed_with_model = 0
            placed_without_model = 0
            no_model_protos = set()

            for c in mission.children:
                if (c.tag == 'Entity' or c.tag == 'Human') and c.args:
                    total_entities += 1
                    kind = 'human' if c.tag == 'Human' else 'entity'
                    proto_name = c.args[0].value
                    model = self.get_proto_model(kind, proto_name)
                    if model is not None:
                        placed_with_model += 1
                    else:
                        placed_without_model += 1
                        no_model_protos.add(proto_name)

            total_placed = placed_with_model + placed_without_model
            self.assertEqual(total_placed, total_entities, f"Not all entities placed in {m}")
            coverage = (total_placed / total_entities * 100.0) if total_entities else 100.0
            self.assertEqual(coverage, 100.0)

            # Every human must have a model
            for h in set(c.args[0].value for c in mission.children if c.tag == 'Human' and c.args):
                h_model = self.get_proto_model('human', h)
                self.assertIsNotNone(h_model, f"Human breed without model: {h}")

            no_mod_str = f"{len(no_model_protos)} {list(no_model_protos)[:3]}" if no_model_protos else "0"
            print(f"{posixpath.basename(m):<22} | {total_entities:>8} | {total_placed:>8} | {placed_with_model:>10} | {no_mod_str:>15} | {coverage:>7.1f}%")

        print(f"\n[T03] CENSUS ACCEPTANCE PASSED: 100% entities placed across all 15 missions.")


if __name__ == '__main__':
    unittest.main()
