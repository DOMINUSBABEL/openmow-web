import json
import glob
import os

files = glob.glob('web/test/fixtures/*.json')
print(f'Checking helpers in {len(files)} files...')

for f in sorted(files)[:3]:
    name = os.path.basename(f)
    with open(f, 'r', encoding='utf-8') as fp:
        doc = json.load(fp)
    
    items = doc.get('items', [])
    mission = None
    for it in items:
        if isinstance(it, dict) and it.get('k') == '{':
            i = it.get('i', [])
            if i and (i[0] == 'mission' or (isinstance(i[0], dict) and i[0].get('w') == 'mission')):
                mission = it
                break
    if not mission:
        continue
    
    helpers = None
    for c in mission.get('i', []):
        if isinstance(c, dict) and c.get('k') == '{':
            tag = c['i'][0].get('w') if isinstance(c['i'][0], dict) else c['i'][0]
            if tag == 'Helpers':
                helpers = c
                break
    
    if not helpers:
        print(f'{name}: No Helpers node')
        continue
    
    counts = {}
    for h in helpers.get('i', [])[1:]:
        if isinstance(h, dict) and h.get('k') == '{':
            htag = h['i'][0].get('w') if isinstance(h['i'][0], dict) else h['i'][0]
            counts[htag] = counts.get(htag, 0) + 1
    print(f'{name}: {counts}')
