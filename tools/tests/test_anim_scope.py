"""Test animation conversion and core action coverage for human skins in scope (T06)."""
import os
import sys
import unittest
import urllib.request
import json

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.abspath(os.path.join(HERE, '..', 'server'))
sys.path.insert(0, SERVER_DIR)

from vfs import VFS
from convert.anim import anm_to_clip

CORE_ANIMATIONS = [
    # Idle
    '/properties/animation/human/idle_stand_1.anm',
    '/properties/animation/human/idle_stand_2.anm',
    '/properties/animation/human/idle_stand_3.anm',
    # Walk
    '/properties/animation/human/walk_gun_up.anm',
    '/properties/animation/human/walk_normal_gun_up.anm',
    '/properties/animation/human/walk_down.anm',
    # Run
    '/properties/animation/human/run_gun_up.anm',
    '/properties/animation/human/run_fast_gun_up.anm',
    '/properties/animation/human/run_down.anm',
    # Crouch (squat)
    '/properties/animation/human/squat_fire_gun.anm',
    '/properties/animation/human/squat_assault-fire_gun.anm',
    '/properties/animation/human/idle/idle_passive_squat_ground_gun_strap_simple1.anm',
    # Prone (lie / crawl)
    '/properties/animation/human/crawl_gun.anm',
    '/properties/animation/human/crawl.anm',
    '/properties/animation/human/lie_fire_gun.anm',
    # Shoot (fire)
    '/properties/animation/human/stand_fire_gun_up.anm',
    '/properties/animation/human/stand_fire_gun_down.anm',
    '/properties/animation/human/stand_fire_rifle_up.anm',
    # Die
    '/properties/animation/human/stand_die_front_1.anm',
    '/properties/animation/human/stand_die_back_1.anm',
    '/properties/animation/human/squat_die.anm',
    '/properties/animation/human/lie_die.anm',
]


class TestAnimScope(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vfs = VFS()

    def test_core_animations_convert_100_percent(self):
        print(f"\nConverting {len(CORE_ANIMATIONS)} core human animations (idle, walk, run, crouch, prone, shoot, die)...")
        print(f"{'Animation':<55} | {'Frames':>6} | {'Duration':>8} | {'Tracks':>6}")
        print("-" * 84)

        for path in CORE_ANIMATIONS:
            self.assertIn(path, self.vfs.files, f"Animation file missing from VFS: {path}")
            clip = anm_to_clip(self.vfs, path, fps=25.0)

            self.assertIsNotNone(clip)
            self.assertGreater(clip['frameCount'], 0)
            self.assertGreater(clip['duration'], 0.0)
            self.assertGreater(len(clip['tracks']), 0)
            self.assertEqual(clip['fps'], 25.0)

            # Check that every track has times and values matching component counts
            for t in clip['tracks']:
                if t['type'] == 'quaternion':
                    self.assertEqual(len(t['times']) * 4, len(t['values']))
                elif t['type'] == 'vector':
                    self.assertEqual(len(t['times']) * 3, len(t['values']))

            print(f"{path:<55} | {clip['frameCount']:>6} | {clip['duration']:>7.2f}s | {len(clip['tracks']):>6}")

        print(f"\n[T06] ANIMATION ACCEPTANCE: 100% of core animations converted successfully.")

    def test_http_endpoint_live(self):
        sample = '/properties/animation/human/idle_stand_1'
        url = f"http://127.0.0.1:8080/conv/anim{sample}.json"
        with urllib.request.urlopen(url) as r:
            self.assertEqual(r.status, 200)
            data = json.loads(r.read())
            self.assertEqual(data['name'], 'idle_stand_1')
            self.assertGreater(len(data['tracks']), 0)


if __name__ == '__main__':
    unittest.main()
