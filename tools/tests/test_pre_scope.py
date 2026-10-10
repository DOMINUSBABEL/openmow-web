"""Validation test for GEM2 SDL preprocessor (T00).

Covers all 225 entity prototypes, 115 human breeds, and referenced stuff/item files
across the 15 skirmish missions in scope.
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
from formats.gem_pre import Pre  # noqa: E402
RE_DIR = os.path.abspath(os.path.join(HERE, '..', 're'))
sys.path.insert(0, RE_DIR)
from mission_census import SCOPE  # noqa: E402


class TestPreScope(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vfs = VFS()

        # Build index of entity defs by basename
        cls.defs_by_base = collections.defaultdict(list)
        for f in cls.vfs.files:
            if f.startswith('/entity/') and f.endswith('.def'):
                base = posixpath.splitext(posixpath.basename(f))[0].lower()
                cls.defs_by_base[base].append(f)

        # Build index of stuff files
        cls.stuff_by_name = collections.defaultdict(list)
        for f in cls.vfs.files:
            if f.startswith('/set/stuff/'):
                base = posixpath.basename(f).lower()
                cls.stuff_by_name[base].append(f)
                raw_base = posixpath.splitext(base)[0]
                if raw_base != base:
                    cls.stuff_by_name[raw_base].append(f)

        # Harvest prototypes from the 15 missions
        cls.entities_in_scope = set()
        cls.breeds_in_scope = set()
        cls.items_in_scope = set()

        for m in SCOPE:
            mi = m + '/0.mi'
            items = parse_sdl(decode(cls.vfs.read(mi), mi))
            mission = next(i for i in items if isinstance(i, Node) and i.tag == 'mission')
            for c in mission.children:
                if c.tag == 'Entity' and c.args:
                    cls.entities_in_scope.add(c.args[0].value)
                elif c.tag == 'Human' and c.args:
                    cls.breeds_in_scope.add(c.args[0].value)
                elif c.tag == 'Inventory':
                    box = c.find('box')
                    if box:
                        for it in box.children:
                            if it.tag == 'item' and it.args:
                                cls.items_in_scope.add(it.args[0].value)

    def resolve_entity_def(self, name: str) -> str:
        n = name.lower()
        cands = self.defs_by_base.get(n)
        self.assertTrue(bool(cands), f"Missing .def for entity: {name}")
        if len(cands) == 1:
            return cands[0]
        non_fx = [c for c in cands if '/fx/' not in c]
        return non_fx[0] if non_fx else cands[0]

    def resolve_breed(self, name: str) -> str:
        cands = [f'/set/breed/{name}.set', f'/set/breed/{name}']
        hit = next((c for c in cands if self.vfs.exists(c)), None)
        self.assertIsNotNone(hit, f"Missing breed file for: {name}")
        return hit

    def resolve_stuff(self, item_name: str) -> list[str]:
        name_clean = item_name.strip('"').lower()
        if name_clean in self.stuff_by_name:
            return self.stuff_by_name[name_clean]
        for ext in ('.ammo', '.grenade', '.pattern', '.weapon'):
            if name_clean + ext in self.stuff_by_name:
                return self.stuff_by_name[name_clean + ext]
        # shells: bullet88 ap -> bullet88.ap.ammo
        parts = name_clean.split()
        if len(parts) >= 2:
            cand = f"{parts[0]}.{parts[1]}.ammo"
            if cand in self.stuff_by_name:
                return self.stuff_by_name[cand]
        return []

    def test_preprocessor_full_scope(self):
        # 1. Resolve all files
        ent_files = [self.resolve_entity_def(e) for e in sorted(self.entities_in_scope)]
        self.assertEqual(len(ent_files), 225, f"Expected 225 entity files, got {len(ent_files)}")

        breed_files = [self.resolve_breed(b) for b in sorted(self.breeds_in_scope)]
        self.assertEqual(len(breed_files), 115, f"Expected 115 breed files, got {len(breed_files)}")

        stuff_files = set()
        for it in self.items_in_scope:
            if it.startswith('0x'):  # entity reference
                continue
            sf = self.resolve_stuff(it)
            for s in sf:
                stuff_files.add(s)

        print(f"\n[T00] Scope inventory: {len(ent_files)} entity defs, {len(breed_files)} breeds, {len(stuff_files)} stuff files")

        pre = Pre(self.vfs)
        all_files = ent_files + breed_files + sorted(stuff_files)

        # 2. Run Pre.load() on each file
        exceptions = []
        for f in all_files:
            try:
                pre.load(f)
            except Exception as e:
                exceptions.append((f, e))

        self.assertEqual(len(exceptions), 0, f"Encountered exceptions during preprocessing: {exceptions}")

        # 3. Analyze warnings
        unknown_macros = [w for w in pre.warnings if 'unknown macro' in w]
        unbound_pct = [w for w in pre.warnings if 'unbound %' in w]
        other_warnings = [w for w in pre.warnings if 'unknown macro' not in w and 'unbound %' not in w]

        print(f"[T00] Total files preprocessed: {len(all_files)}")
        print(f"[T00] Unknown macro warnings: {len(unknown_macros)}")
        print(f"[T00] Unbound % warnings: {len(unbound_pct)}")
        print(f"[T00] Other warnings: {len(other_warnings)}")

        # Acceptance: unknown macro = 0
        self.assertEqual(len(unknown_macros), 0, f"Expected 0 unknown macros, got: {unknown_macros}")

        # Acceptance: unbound % = 0 or explained in ESCALATIONS (E-001 allows %door1 / %door2)
        unexpected_unbound = [w for w in unbound_pct if '%door1' not in w and '%door2' not in w]
        self.assertEqual(len(unexpected_unbound), 0, f"Unexpected unbound % warnings (not covered by E-001): {unexpected_unbound}")

        # 4. Print top-20 macros used
        print("\n[T00] Top-20 macros used in scope:")
        top_20 = sorted(pre.macro_uses.items(), key=lambda x: x[1], reverse=True)[:20]
        for idx, (mname, count) in enumerate(top_20, 1):
            print(f"  {idx:2d}. {mname:<25} ({count} uses)")

        self.assertGreater(len(top_20), 0, "No macros were expanded!")
        print("\n[T00] ACCEPTANCE CRITERIA PASSED: 0 exceptions, 0 unknown macros, all unbound % documented in E-001.")


if __name__ == '__main__':
    unittest.main()
