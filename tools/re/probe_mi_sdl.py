import json
import urllib.request

url = 'http://127.0.0.1:8080/conv/sdl/map/single/01_usa-skirmish/01_usa-overlord/0.mi.json'
with urllib.request.urlopen(url) as r:
    data = json.loads(r.read())

items = data.get('items', [])
def find_mission(items):
    for it in items:
        if isinstance(it, dict) and it.get('k') == '{':
            i = it.get('i', [])
            if i:
                tag = i[0].get('w') if isinstance(i[0], dict) else i[0]
                if tag == 'mission':
                    return it
    return None

mission = find_mission(items)
children = mission.get('i', [])
print(f'Total mission children: {len(children)}')

by_tag = {}
for c in children:
    if isinstance(c, dict) and c.get('k') == '{':
        i = c.get('i', [])
        if i:
            tag = i[0].get('w') if isinstance(i[0], dict) else i[0]
            by_tag.setdefault(tag, []).append(c)

print('Mission child tag counts:', {k: len(v) for k, v in by_tag.items()})

# Look at 1 sample of each
for tag in ['Link', 'Tags', 'Inventory', 'Brain', 'Players', 'Helpers', 'Covers']:
    samples = by_tag.get(tag, [])
    if samples:
        print(f'\n--- Sample {tag} ---')
        print(json.dumps(samples[0], indent=2)[:500])
