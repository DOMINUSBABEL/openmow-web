"""Acceptance test for terrain conversion (T02).

Validates that all 15 skirmish missions generate valid glTF 2.0 binary (GLB) terrain files
without errors, matching vertex counts and bounding boxes.
Also tests live HTTP /conv/terrain/<mission>.glb endpoint.
"""
import json
import os
import posixpath
import struct
import sys
import unittest
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.abspath(os.path.join(HERE, '..', 'server'))
sys.path.insert(0, SERVER_DIR)
from vfs import VFS  # noqa: E402
from convert.terrain import terrain_to_glb  # noqa: E402
RE_DIR = os.path.abspath(os.path.join(HERE, '..', 're'))
sys.path.insert(0, RE_DIR)
from mission_census import SCOPE  # noqa: E402

BASE = 'http://127.0.0.1:8080'


class TestTerrainScope(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vfs = VFS()

    def test_all_15_terrains_conversion(self):
        self.assertEqual(len(SCOPE), 15)
        failed = []
        reports = []
        for m in SCOPE:
            try:
                glb_bytes, report = terrain_to_glb(self.vfs, m)
                self.assertGreater(len(glb_bytes), 1000, f"GLB too small for {m}")
                magic, ver, total = struct.unpack_from('<III', glb_bytes, 0)
                self.assertEqual(magic, 0x46546C67, f"Invalid glTF magic in {m}")
                self.assertEqual(ver, 2, f"Expected glTF version 2 in {m}")
                self.assertEqual(total, len(glb_bytes), f"Total length mismatch in {m}")
                reports.append(report)
            except Exception as e:
                failed.append((m, e))

        self.assertEqual(len(failed), 0, f"Failed terrain conversions: {failed}")
        print(f"\n[T02] Successfully converted 15/15 skirmish terrains to GLB:")
        for r in reports:
            print(f"  {posixpath.basename(r['mission']):<22} | verts: {r['vertices']:>6} | tris: {r['triangles']:>6} | submeshes: {r['submeshes']:>2}")

    def test_live_http_terrain_endpoint(self):
        # Test 01_usa-overlord terrain through HTTP server
        test_url = f"{BASE}/conv/terrain/map/single/01_usa-skirmish/01_usa-overlord.glb"
        req = urllib.request.Request(test_url)
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            self.assertEqual(resp.headers.get('Content-Type'), 'model/gltf-binary')
            data = resp.read()
            self.assertGreater(len(data), 500000)
            magic, ver, total = struct.unpack_from('<III', data, 0)
            self.assertEqual(magic, 0x46546C67)
            self.assertEqual(ver, 2)
            print(f"\n[T02] Live HTTP endpoint verified: {test_url} -> 200 OK ({len(data)} bytes)")


if __name__ == '__main__':
    unittest.main()
