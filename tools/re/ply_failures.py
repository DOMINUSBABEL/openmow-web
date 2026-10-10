import sys, os, zipfile, struct
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from formats import ply as P
R = r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2\resource\entity'
P.validate = lambda p: None  # inspect raw
for pak, n in [('c1.pak', 'construction/bridge/x/pile_x/piece4.ply'), ('c1.pak', 'construction/entourage/trafficator1/trafficator1.ply'),
               ('c2.pak', 'construction/town_e/house_euro_117c/117_roof2/117_roof2.ply')]:
    d = zipfile.ZipFile(R + '\\' + pak).read(n)
    p = P.parse_ply(d)
    idx = struct.unpack(f'<{len(p.indices)//2}H', p.indices)
    used = sum(s.tri_count for s in p.submeshes) * 3
    bad = [i for i, v in enumerate(idx) if v >= p.vertex_count]
    print(n, 'verts', p.vertex_count, 'idx', len(idx), 'used by submeshes', used, 'bad positions', bad[:10], len(bad))
    print('   submeshes', [(s.first_tri, s.tri_count, s.material) for s in p.submeshes])
    print('   tail after INDX? file len', len(d))
d = zipfile.ZipFile(R + r'\c1.pak').read('construction/fence/x/fence_wire1_x/fence_wire09.ply')
i = d.find(b'ADJA'); print('ADJA ctx', d[i-8:i+40].hex(' '), 'len', len(d), 'pos', i)
