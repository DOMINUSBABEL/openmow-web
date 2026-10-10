"""Infer vertex layout per (mesh fmt, stride, vflags) by statistics over 4-byte slots."""
import sys, zipfile, struct, collections, random, math
sys.stdout.reconfigure(encoding='utf-8')
R = r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2\resource'

def parse(d):
    o = 32; meshes = []; vert = None; mror = []
    while o < len(d):
        tag = d[o:o+4]; o += 4
        if tag == b'SKIN':
            n, = struct.unpack_from('<I', d, o); o += 4
            for _ in range(n): o += 1 + d[o]
        elif tag == b'MESH':
            fmt, first, cnt, flags = struct.unpack_from('<IIII', d, o); o += 16
            if flags & 0x200: o += 4
            o += 1 + d[o]
            if fmt & 0x1000:
                o += 1 + d[o]
            meshes.append(fmt)
        elif tag == b'VERT':
            cnt, stride, fl = struct.unpack_from('<IHH', d, o); o += 8
            vert = (cnt, stride, fl, o); o += cnt * stride
        elif tag == b'INDX':
            cnt, = struct.unpack_from('<I', d, o); o += 4 + cnt * 2
        elif tag == b'MROR':
            mror.append(d[o:o+32]); return meshes, vert, ('MROR', d[o-4:o+40].hex(' '))
        else:
            return meshes, vert, ('UNK', tag)
    return meshes, vert, None

groups = collections.defaultdict(list); mrors = []
for pak in ('c1.pak', 'c2.pak', 'e1.pak', 'e2.pak'):
    z = zipfile.ZipFile(R + r'\entity\\' + pak)
    plys = [n for n in z.namelist() if n.endswith('.ply')]
    random.seed(3)
    for name in random.sample(plys, min(800, len(plys))):
        d = z.read(name)
        if d[:8] != b'EPLYBNDS': continue
        meshes, vert, extra = parse(d)
        if extra and extra[0] == 'MROR' and len(mrors) < 4: mrors.append((name, extra[1]))
        if not vert or not meshes: continue
        key = (hex(meshes[0]), vert[1], hex(vert[2]))
        if len(groups[key]) < 12: groups[key].append((name, d, vert))

for key in sorted(groups):
    items = groups[key]
    stride = key[1]; nslot = stride // 4
    fin = [0]*nslot; rng = [[1e9, -1e9] for _ in range(nslot)]; tot = 0
    unit = collections.Counter()
    for name, d, (cnt, st, fl, off) in items:
        for v in range(min(cnt, 300)):
            base = off + v * st
            fs = struct.unpack_from('<%df' % nslot, d, base)
            tot += 1
            for i, f in enumerate(fs):
                if math.isfinite(f) and abs(f) < 1e5:
                    fin[i] += 1; rng[i][0] = min(rng[i][0], f); rng[i][1] = max(rng[i][1], f)
            for i in range(nslot - 2):
                a, b, c = fs[i:i+3]
                if all(math.isfinite(x) for x in (a, b, c)) and abs(a*a + b*b + c*c - 1) < 0.02:
                    unit[i] += 1
    print('\n=== fmt=%s stride=%d vflags=%s  files=%d e.g. %s' % (key[0], key[1], key[2], len(items), items[0][0]))
    print('  slot: finite%  [min,max]')
    for i in range(nslot):
        print('   %2d  %5.1f%%  [%9.3f, %9.3f]%s' % (i, 100*fin[i]/tot, rng[i][0], rng[i][1], '  <-unit3 %.0f%%' % (100*unit[i]/tot) if unit[i] > tot*0.5 else ''))
    n, d, (cnt, st, fl, off) = items[0]
    print('  v0 hex:', d[off:off+st].hex(' '))
print('\nMROR samples:'); [print(' ', m) for m in mrors]
