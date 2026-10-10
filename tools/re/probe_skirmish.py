import os
import glob
import json

def probe_skirmish():
    files = sorted(glob.glob('web/test/fixtures/*.json'))
    print(f"Total mission fixtures: {len(files)}")
    
    sample_file = 'web/test/fixtures/01_usa-overlord.json'
    with open(sample_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    m = data['items'][0]
    h = [x for x in m['i'] if isinstance(x, dict) and x.get('i') and (x['i'][0] == {'w': 'Helpers'} or x['i'][0] == 'Helpers')][0]
    
    # 1. Zones related to flags
    zones = [x for x in h['i'] if isinstance(x, dict) and x.get('i') and (x['i'][0] == {'w': 'zone'} or x['i'][0] == 'zone')]
    flag_zones = []
    for z in zones:
        zname = [zp['i'][1] for zp in z['i'][2:] if isinstance(zp, dict) and zp.get('i') and (zp['i'][0] == {'w': 'Name'} or zp['i'][0] == 'Name')]
        if zname:
            zn = zname[0].get('w', str(zname[0])) if isinstance(zname[0], dict) else str(zname[0])
            if 'flag' in zn.lower():
                flag_zones.append(zn)
    print(f"\n[Overlord Flag Zones] ({len(flag_zones)}):", flag_zones[:15])
    
    # 2. Reinforcements block
    reinf = [x for x in h['i'] if isinstance(x, dict) and x.get('i') and (x['i'][0] == {'w': 'reinforcements'} or x['i'][0] == 'reinforcements')]
    if reinf:
        print("\n[Overlord Reinforcements Block structure]:")
        for item in reinf[0]['i'][1:10]:
            if isinstance(item, dict) and item.get('i'):
                tag = item['i'][0].get('w', str(item['i'][0])) if isinstance(item['i'][0], dict) else str(item['i'][0])
                val = item['i'][1] if len(item['i']) > 1 else None
                print(f"  - {tag}: {val}")
    
    # 3. Triggers related to victory, gameover, defeat, flags
    trs = [x for x in h['i'] if isinstance(x, dict) and x.get('i') and (x['i'][0] == {'w': 'triggers'} or x['i'][0] == 'triggers')][0]
    flag_trs = []
    victory_trs = []
    defeat_trs = []
    
    for tr in trs['i'][1:]:
        trname = tr['i'][0] if isinstance(tr['i'][0], str) else tr['i'][0].get('w', '')
        if 'flag' in trname:
            flag_trs.append(trname)
        if 'win' in trname or 'vic' in trname:
            victory_trs.append(trname)
        if 'lose' in trname or 'defeat' in trname or 'fail' in trname or 'gameover' in trname:
            defeat_trs.append(trname)
            
    print(f"\n[Flag Triggers Sample] ({len(flag_trs)}):", flag_trs[:10])
    print(f"\n[Victory Triggers] ({len(victory_trs)}):", victory_trs)
    print(f"\n[Defeat Triggers] ({len(defeat_trs)}):", defeat_trs)

    # Let's inspect victory trigger details
    print("\n[Victory Triggers Details]:")
    for tr in trs['i'][1:]:
        trname = tr['i'][0] if isinstance(tr['i'][0], str) else tr['i'][0].get('w', '')
        if trname in victory_trs or trname in defeat_trs:
            print(f"--- Trigger: {trname} ---")
            cond = [x for x in tr['i'] if isinstance(x, dict) and x.get('i') and (x['i'][0] == {'w': 'condition'} or x['i'][0] == 'condition')]
            acts = [x for x in tr['i'] if isinstance(x, dict) and x.get('i') and (x['i'][0] == {'w': 'actions'} or x['i'][0] == 'actions')]
            if cond:
                terms = [x for x in cond[0]['i'] if isinstance(x, dict) and x.get('i') and (x['i'][0] == {'w': 'terms'} or x['i'][0] == 'terms')]
                if terms:
                    for t in terms[0]['i'][1:]:
                        ttag = t['i'][0] if isinstance(t['i'][0], str) else t['i'][0].get('w', '')
                        print(f"  cond term: {ttag} -> {t['i'][1:]}")
            if acts:
                for a in acts[0]['i'][1:]:
                    atag = a['i'][0] if isinstance(a['i'][0], str) else a['i'][0].get('w', '')
                    print(f"  action: {atag}")

if __name__ == '__main__':
    probe_skirmish()
