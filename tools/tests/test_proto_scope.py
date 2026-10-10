"""Acceptance test for prototype resolver (T01).

Validates all 225 entities, 115 humans, and referenced items across the 15 skirmishes.
Checks that /conv/proto/entity/pz6e.json produces weaponry with 88mm_kwk36.
"""
import collections
import os
import posixpath
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.abspath(os.path.join(HERE, '..', 'server'))
sys.path.insert(0, SERVER_DIR)
from vfs import VFS  # noqa: E402
from formats.sdl import parse_sdl, decode, Node  # noqa: E402
from convert.proto import ProtoResolver, build_entity_proto, build_human_proto, build_item_proto, resolve_proto  # noqa: E402
RE_DIR = os.path.abspath(os.path.join(HERE, '..', 're'))
sys.path.insert(0, RE_DIR)
from mission_census import SCOPE  # noqa: E402


class TestProtoScope(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vfs = VFS()
        cls.resolver = ProtoResolver(cls.vfs)

        cls.entities = set()
        cls.humans = set()
        cls.items = set()

        for m in SCOPE:
            mi = m + '/0.mi'
            items = parse_sdl(decode(cls.vfs.read(mi), mi))
            mission = next(i for i in items if isinstance(i, Node) and i.tag == 'mission')
            for c in mission.children:
                if c.tag == 'Entity' and c.args:
                    cls.entities.add(c.args[0].value)
                elif c.tag == 'Human' and c.args:
                    cls.humans.add(c.args[0].value)
                elif c.tag == 'Inventory':
                    box = c.find('box')
                    if box:
                        for it in box.children:
                            if it.tag == 'item' and it.args:
                                val = it.args[0].value
                                if not str(val).startswith('0x'):
                                    cls.items.add(val)

        # Also harvest items from human breeds
        for h in sorted(cls.humans):
            bpath = cls.resolver.resolve_human_path(h)
            hproto = build_human_proto(cls.resolver, h)
            for it in hproto['inventory']:
                name = it['name']
                if not name.startswith('0x'):
                    cls.items.add(name)

    def test_pz6e_weaponry(self):
        proto = resolve_proto(self.vfs, 'entity', 'pz6e')
        self.assertEqual(proto['kind'], 'entity')
        self.assertEqual(proto['name'], 'pz6e')
        self.assertIsNotNone(proto['model'])
        self.assertIn('tank', proto['props'])
        weapon_names = [w.get('weapon') for w in proto['weaponry'] if 'weapon' in w]
        self.assertIn('88mm_kwk36', weapon_names, f"Expected 88mm_kwk36 in weaponry, got: {weapon_names}")
        print(f"\n[T01] pz6e weaponry verified: {proto['weaponry']}")

    def test_all_entities_in_scope(self):
        self.assertEqual(len(self.entities), 225, f"Expected 225 entities, got {len(self.entities)}")
        failed = []
        for e in sorted(self.entities):
            try:
                p = resolve_proto(self.vfs, 'entity', e)
                self.assertEqual(p['kind'], 'entity')
                self.assertIsInstance(p['props'], list)
                self.assertIsInstance(p['volumes'], list)
                self.assertIsInstance(p['raw'], list)
            except Exception as ex:
                failed.append((e, ex))
        self.assertEqual(len(failed), 0, f"Failed entities: {failed}")
        print(f"[T01] Successfully converted 225/225 entity prototypes.")

    def test_all_humans_in_scope(self):
        self.assertEqual(len(self.humans), 115, f"Expected 115 humans, got {len(self.humans)}")
        failed = []
        for h in sorted(self.humans):
            try:
                p = resolve_proto(self.vfs, 'human', h)
                self.assertEqual(p['kind'], 'human')
                self.assertIsNotNone(p['breed'])
                self.assertTrue(bool(p['breed']['skin']))
                self.assertIsNotNone(p['model'])
            except Exception as ex:
                failed.append((h, ex))
        self.assertEqual(len(failed), 0, f"Failed humans: {failed}")
        print(f"[T01] Successfully converted 115/115 human breed prototypes.")

    def test_all_items_in_scope(self):
        failed = []
        converted = 0
        for it in sorted(self.items):
            try:
                p = resolve_proto(self.vfs, 'item', it)
                self.assertEqual(p['kind'], 'item')
                self.assertIsNotNone(p['stuff'])
                converted += 1
            except Exception as ex:
                failed.append((it, ex))
        self.assertEqual(len(failed), 0, f"Failed items: {failed}")
        print(f"[T01] Successfully converted {converted}/{len(self.items)} items in scope (100%).")


if __name__ == '__main__':
    unittest.main()
