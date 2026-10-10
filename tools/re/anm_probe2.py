import sys, zipfile, struct
sys.stdout.reconfigure(encoding='utf-8')
R = r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2\resource'
g = zipfile.ZipFile(R + r'\gamelogic.pak')
for n in ('properties/animation/human/board_ba-20m.anm',):
    d = g.read(n)
    frames, = struct.unpack_from('<I', d, 12)
    nb, = struct.unpack_from('<I', d, 20)
    o = 24; names = []
    for _ in range(nb):
        k, = struct.unpack_from('<I', d, o); names.append(d[o+4:o+4+k].decode()); o += 4 + k
    print('frames', frames, 'bones', nb, names)
    print('data starts', o, 'remaining', len(d) - o, 'per bone per frame', (len(d) - o) / nb / frames)
    print(d[o:o+256].hex(' '))
    print([round(x, 4) for x in struct.unpack_from('<40f', d, o)])
