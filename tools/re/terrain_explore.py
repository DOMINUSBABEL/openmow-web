"""Explore BPLYBNDS terrain mesh and the 'map' land descriptor."""
import sys, zipfile, struct, re
sys.stdout.reconfigure(encoding='utf-8')
R = r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2\resource'
z = zipfile.ZipFile(R + r'\map.pak')
base = 'map/single/01_usa-skirmish/00b_usa-hurtgen/'
d = z.read(base + 'map.ply')
print('len', len(d), 'bbox', struct.unpack_from('<6f', d, 8))
o = 32
seen = 0
while o < len(d) and seen < 40:
    tag = d[o:o+4]
    print('@%d %r %s' % (o, tag, d[o+4:o+52].hex(' ')))
    seen += 1
    # heuristic jump: next uppercase 4-letter tag
    m = re.compile(rb'(CSUB|SUBM|VERT|INDX|MESH|LMAP|NORM|HGHT|BNDS|[A-Z]{4})').search(d, o + 4)
    if not m: break
    o = m.start()
print()
m = z.read(base + 'map').decode('latin1')
print(m[:3000])
