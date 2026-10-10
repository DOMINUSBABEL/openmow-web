import json

with open('web/test/fixtures/01_usa-overlord.json', 'r', encoding='utf-8') as fp:
    doc = json.load(fp)

mission = next(it for it in doc['items'] if isinstance(it, dict) and it.get('k') == '{' and (it['i'][0] == 'mission' or it['i'][0].get('w') == 'mission'))
helpers = next(c for c in mission['i'] if isinstance(c, dict) and c.get('k') == '{' and (c['i'][0] == 'Helpers' or c['i'][0].get('w') == 'Helpers'))

for h in helpers['i'][1:]:
    if isinstance(h, dict) and h.get('k') == '{':
        tag = h['i'][0].get('w') if isinstance(h['i'][0], dict) else h['i'][0]
        if tag in ('zone', 'tasks', 'reinforcements', 'vars', 'triggers'):
            print(f'=== {tag} ===')
            print(json.dumps(h, indent=2)[:500])
