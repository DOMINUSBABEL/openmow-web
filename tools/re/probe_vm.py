import sys, os, json
sys.path.insert(0, 'tools/server')
from vfs import VFS, DEFAULT_GAME
from formats.sdl import decode, parse_sdl, Node, Atom

vfs = VFS(DEFAULT_GAME)

skirmishes = [
    '01_usa-skirmish/01_usa-overlord',
    '01_usa-skirmish/02_usa-carentan',
    '01_usa-skirmish/03_usa-bastogne',
    '02_ger-skirmish/01_ger-smolensk',
    '02_ger-skirmish/02_ger-leningrad',
    '02_ger-skirmish/03_ger-caen',
    '03_eng-skirmish/01_eng-battleaxe',
    '03_eng-skirmish/02_eng-tobruk',
    '03_eng-skirmish/03_eng-alam_halfa',
    '04_rus-skirmish/01_rus-kharkov',
    '04_rus-skirmish/02_rus-moscow',
    '04_rus-skirmish/03_rus-kursk',
    '05_jap-skirmish/01_jap-singapore',
    '05_jap-skirmish/02_jap-peleliu',
    '05_jap-skirmish/03_jap-okinawa',
]

all_terms = collections = {}
all_actions = {}
trigger_count = 0

for sk in skirmishes:
    p = f'/map/single/{sk}/0.mi'
    if not vfs.exists(p):
        continue
    text = decode(vfs.read(p))
    ast = parse_sdl(text)
    m_node = next((b for b in ast if isinstance(b, Node) and b.tag == 'mission'), None)
    if not m_node: continue
    helpers = m_node.find('Helpers')
    if not helpers: continue
    triggers_node = helpers.find('triggers')
    if not triggers_node: continue

    for tr in triggers_node.children:
        trigger_count += 1
        cond = tr.find('condition')
        if cond:
            terms = cond.find('terms')
            if terms:
                for t in terms.children:
                    ttype = t.tag or ''
                    # strip leading N.
                    clean_type = ttype.split('.', 1)[-1] if '.' in ttype else ttype
                    all_terms[clean_type] = all_terms.get(clean_type, 0) + 1
        actions = tr.find('actions')
        if actions:
            for a in actions.children:
                atype = a.tag or ''
                all_actions[atype] = all_actions.get(atype, 0) + 1

print(f"Total triggers scanned across 15 missions: {trigger_count}")
print(f"Condition term types ({len(all_terms)}):")
for k, v in sorted(all_terms.items(), key=lambda x: -x[1]):
    print(f"  {k:20s}: {v}")

print(f"\nAction types ({len(all_actions)}):")
for k, v in sorted(all_actions.items(), key=lambda x: -x[1]):
    print(f"  {k:20s}: {v}")
