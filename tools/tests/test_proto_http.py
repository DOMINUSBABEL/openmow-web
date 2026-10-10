"""Smoke test for /conv/proto HTTP endpoints on the live server."""
import json
import urllib.request
import unittest

BASE = 'http://127.0.0.1:8080'

class TestProtoHttp(unittest.TestCase):
    def fetch_json(self, path: str):
        url = BASE + path
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = resp.read()
            return json.loads(data.decode('utf-8'))

    def test_pz6e_endpoint(self):
        doc = self.fetch_json('/conv/proto/entity/pz6e.json')
        self.assertEqual(doc['kind'], 'entity')
        self.assertEqual(doc['name'], 'pz6e')
        self.assertIn('tank', doc['props'])
        weapons = [w.get('weapon') for w in doc['weaponry'] if 'weapon' in w]
        self.assertIn('88mm_kwk36', weapons)
        print("HTTP pz6e weapons:", weapons)

    def test_human_endpoint(self):
        doc = self.fetch_json('/conv/proto/human/mp/ger/rifle.json')
        self.assertEqual(doc['kind'], 'human')
        self.assertEqual(doc['breed']['skin'], 'ger_t2')
        self.assertTrue(doc['model'].endswith('.def'))
        print("HTTP human skin & model:", doc['breed']['skin'], doc['model'])

    def test_item_endpoint(self):
        doc = self.fetch_json('/conv/proto/item/88mm_kwk36.json')
        self.assertEqual(doc['kind'], 'item')
        self.assertEqual(doc['stuff']['rechargeTime'], 6)
        print("HTTP 88mm_kwk36 rechargeTime:", doc['stuff']['rechargeTime'])

if __name__ == '__main__':
    unittest.main()
