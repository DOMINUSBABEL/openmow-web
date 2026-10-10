import sys, zipfile, struct
sys.stdout.reconfigure(encoding='utf-8')
R = r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2\resource'
z = zipfile.ZipFile(R + r'\map.pak')
for n in ('map/multi/1v1_road/map.ply', 'map/multi/1v1_argentan/map.ply', 'map/single/01_usa-skirmish/00b_usa-hurtgen/map.ply'):
    d = z.read(n)
    v = d.find(b'VERT')
    cnt, stride, fl = struct.unpack_from('<IHH', d, v + 4)
    end = v + 12 + cnt * stride
    extra, = struct.unpack_from('<I', d, end)
    i4 = d.find(b'IND4', end)
    icnt, = struct.unpack_from('<I', d, i4 + 4)
    tail = len(d) - (i4 + 8 + icnt * 4)
    blk = i4 - (end + 4)
    print(n, 'verts', cnt, 'extra', extra, 'block bytes', blk, 'per item', blk / extra if extra else '-', 'IND4', icnt, 'tail', tail)
    if extra:
        print('   first bytes', d[end + 4:end + 52].hex(' '))
        print('   as f32', struct.unpack_from('<12f', d, end + 4))
    print('   last 32 before IND4', d[i4 - 32:i4].hex(' '))

e = zipfile.ZipFile(R + r'\entity\e2.pak').read('-vehicle/car/blitz3_6eng/blitz3_6eng.def').decode('latin1').splitlines()
print('\n'.join(f'{i+1}: {l}' for i, l in enumerate(e[24:36], 24)))
g = zipfile.ZipFile(R + r'\gamelogic.pak').read('set/multiplayer/units/vehicles_ger.set').decode('latin1').splitlines()
print('\n'.join(f'{i+1}: {l}' for i, l in enumerate(g[88:94], 88)))
