"""Test navigation grid generation across all 15 in-scope skirmish missions."""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.abspath(os.path.join(HERE, '..', 'server'))
sys.path.insert(0, SERVER_DIR)

from vfs import VFS
from convert.nav import mission_nav_grid

MISSIONS = [
    'map/single/01_usa-skirmish/01_usa-overlord',
    'map/single/01_usa-skirmish/02_usa-carentan',
    'map/single/01_usa-skirmish/03_usa-ardennes',
    'map/single/02_ger-skirmish/01_ger-caen',
    'map/single/02_ger-skirmish/02_ger-sthilaire',
    'map/single/02_ger-skirmish/03_ger-marketgarden',
    'map/single/03_eng-skirmish/01_eng-battleaxe',
    'map/single/03_eng-skirmish/02_eng-torch',
    'map/single/03_eng-skirmish/03_eng-arnhem',
    'map/single/04_rus-skirmish/01_rus-smolensk',
    'map/single/04_rus-skirmish/02_rus-koenigsberg',
    'map/single/04_rus-skirmish/03_rus-manchuria',
    'map/single/05_jap-skirmish/01_jap-khalkhingol',
    'map/single/05_jap-skirmish/02_jap-singapore',
    'map/single/05_jap-skirmish/03_jap-iwojima',
]

class TestNavGrid(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vfs = VFS()

    def test_all_15_missions_nav_grid(self):
        for m in MISSIONS:
            with self.subTest(mission=m):
                res = mission_nav_grid(self.vfs, m)
                self.assertIn('width', res)
                self.assertIn('height', res)
                self.assertIn('rle', res)
                self.assertGreater(res['width'], 100)
                self.assertGreater(res['height'], 100)
                self.assertGreater(res['blockedCount'], 0)
                self.assertEqual(res['totalCells'], res['width'] * res['height'])
                
                # Check RLE decoding matches totalCells
                total_from_rle = sum(res['rle'])
                self.assertEqual(total_from_rle, res['totalCells'])
                print(f"  [OK] {os.path.basename(m):<22} Grid: {res['width']}x{res['height']} "
                      f"Blocked: {res['blockedCount']}/{res['totalCells']} ({res['blockedCount']/res['totalCells']*100:.1f}%)")

if __name__ == '__main__':
    unittest.main()
