import urllib.request
import json

m = 'map/single/03_eng-skirmish/01_eng-battleaxe'
url = f'http://127.0.0.1:8080/conv/sdl/{m}/0.mi.json'
with urllib.request.urlopen(url) as r:
    data = json.loads(r.read())
items = data.get('items', [])

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

find_protos(items)
models = []
for kind, name in sorted(protos):
    purl = f'http://127.0.0.1:8080/conv/proto/{kind}/{name}.json'
    with urllib.request.urlopen(purl) as pr:
        pdoc = json.loads(pr.read())
        mdl = pdoc.get('model')
        models.append((kind, name, mdl))

with_mdl = [m for m in models if m[2]]
print(f'Total protos: {len(protos)}, with models: {len(with_mdl)}')
for k, n, m in models:
    if not m:
        print(f'  No model: {k}/{n}')
