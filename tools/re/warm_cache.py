import urllib.request
import json
import sys

def warm(m):
    url = f'http://127.0.0.1:8080/conv/sdl/{m}/0.mi.json'
    print(f'Fetching 0.mi for {m}...')
    with urllib.request.urlopen(url) as r:
        data = json.loads(r.read())
    
    protos = set()
    def find_protos(items):
        for it in items:
            if isinstance(it, dict) and it.get('k') == '{':
                i = it.get('i', [])
                if i and len(i) >= 2:
                    tag = i[0].get('w') if isinstance(i[0], dict) else i[0]
                    if tag in ('Entity', 'Human'):
                        kind = 'human' if tag == 'Human' else 'entity'
                        name = str(i[1]).replace('"', '')
                        protos.add((kind, name))
                find_protos(it.get('i', []))
    find_protos(data.get('items', []))
    print(f'Found {len(protos)} unique protos. Warming...')
    for kind, name in protos:
        try:
            purl = f'http://127.0.0.1:8080/conv/proto/{kind}/{name}.json'
            with urllib.request.urlopen(purl) as pr:
                pdoc = json.loads(pr.read())
                mdl = pdoc.get('model')
                if mdl:
                    murl = f'http://127.0.0.1:8080/conv/model{mdl}.glb'
                    with urllib.request.urlopen(murl) as mr:
                        _ = mr.read()
        except Exception as e:
            print(f'  [err] {kind}/{name}: {e}')
    print(f'Done warming {m}')

if __name__ == '__main__':
    m = sys.argv[1] if len(sys.argv) > 1 else 'map/single/03_eng-skirmish/01_eng-battleaxe'
    warm(m)
