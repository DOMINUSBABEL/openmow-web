import json
import glob
import os

def probe_ai():
    sample_file = 'web/test/fixtures/01_usa-overlord.json'
    with open(sample_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    m = data['items'][0]
    
    # 1. Inspect Brains
    brains = [x for x in m['i'] if isinstance(x, dict) and x.get('i') and len(x['i']) > 0 and (x['i'][0] == {'w': 'Brain'} or x['i'][0] == 'Brain')]
    print(f"Total Brain blocks in Overlord: {len(brains)}")
    
    brain_props = {}
    for b in brains[:30]:
        for prop in b['i'][2:]:
            if isinstance(prop, dict) and prop.get('i'):
                ptag = prop['i'][0].get('w', str(prop['i'][0])) if isinstance(prop['i'][0], dict) else str(prop['i'][0])
                pval = prop['i'][1].get('w', str(prop['i'][1])) if isinstance(prop['i'][1], dict) else str(prop['i'][1])
                brain_props.setdefault(ptag, set()).add(pval)
                
    print("Brain properties sample values:")
    for k, v in brain_props.items():
        print(f"  {k}: {sorted(list(v))}")
        
    # 2. Inspect Covers
    covers = [x for x in m['i'] if isinstance(x, dict) and x.get('i') and len(x['i']) > 0 and (x['i'][0] == {'w': 'Covers'} or x['i'][0] == 'Covers')]
    print(f"\nTotal Covers blocks: {len(covers)}")
    if covers:
        print("Covers structure sample:")
        for c in covers[0]['i'][1:5]:
            if isinstance(c, dict) and c.get('i'):
                ctag = c['i'][0].get('w', str(c['i'][0])) if isinstance(c['i'][0], dict) else str(c['i'][0])
                print(f"  - {ctag}: {c['i'][1:3]}")
                
    # 3. AI triggers in Helpers/triggers
    h = [x for x in m['i'] if isinstance(x, dict) and x.get('i') and (x['i'][0] == {'w': 'Helpers'} or x['i'][0] == 'Helpers')][0]
    trs = [x for x in h['i'] if isinstance(x, dict) and x.get('i') and (x['i'][0] == {'w': 'triggers'} or x['i'][0] == 'triggers')][0]
    
    ai_triggers = []
    wave_triggers = []
    for tr in trs['i'][1:]:
        trname = tr['i'][0] if isinstance(tr['i'][0], str) else tr['i'][0].get('w', '')
        if 'ai' in trname.lower():
            ai_triggers.append(trname)
        if 'enemy' in trname.lower() or 'wave' in trname.lower():
            wave_triggers.append(trname)
            
    print(f"\nTotal AI triggers: {len(ai_triggers)}, Sample: {ai_triggers[:10]}")
    print(f"Total Enemy/Wave triggers: {len(wave_triggers)}, Sample: {wave_triggers[:10]}")

    # Inspect one enemy wave trigger
    if wave_triggers:
        w_tr = [x for x in trs['i'][1:] if (x['i'][0] if isinstance(x['i'][0], str) else x['i'][0].get('w', '')) == wave_triggers[0]][0]
        print(f"\nDetails of wave trigger: {wave_triggers[0]}")
        acts = [x for x in w_tr['i'] if isinstance(x, dict) and x.get('i') and (x['i'][0] == {'w': 'actions'} or x['i'][0] == 'actions')][0]
        for a in acts['i'][1:]:
            atag = a['i'][0] if isinstance(a['i'][0], str) else a['i'][0].get('w', '')
            print(f"  act: {atag}")

if __name__ == '__main__':
    probe_ai()
