"""Empirical chunk explorer for GEM2 EPLYBNDS meshes."""
import sys, zipfile, struct, collections, random
sys.stdout.reconfigure(encoding='utf-8')
R = r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2\resource'

def chunks(d):
    """Print raw chunk structure, guessing sizes by scanning for known tags."""
    out = []
    i = 8
    tags = (b'BNDS', b'MESH', b'VERT', b'INDX', b'SKIN', b'BONE', b'SKN2', b'MTRL')
    while i < len(d):
        t = d[i:i+4]
        out.append((i, t))
        # find next known tag
        j = len(d)
        for tg in tags:
            k = d.find(tg, i + 4)
            if k != -1 and k < j: j = k
        i = j
    return out

def dump(name, d, n=1):
    print('\n###', name, len(d))
    for off, t in chunks(d):
        print('  @%d %s %s' % (off, t, d[off+4:off+40].hex(' ')))

samples = [
    ('c1.pak', 'construction/africa/decor/afric_bench/afr_bench.ply'),
    ('e1.pak', 'humanskin/eng_com/skin.ply'),
    ('e2.pak', '-vehicle/tank_heavy/jagdtiger/body.ply'),
]
for pak, n in samples:
    z = zipfile.ZipFile(R + r'\entity\\' + pak)
    dump(n, z.read(n))

# statistics over many files: tag set & MESH header variants & VERT stride/flags
stats = collections.Counter(); vf = collections.Counter(); mh = collections.Counter()
for pak in ('c1.pak', 'e1.pak', 'e2.pak'):
    z = zipfile.ZipFile(R + r'\entity\\' + pak)
    plys = [n for n in z.namelist() if n.endswith('.ply')]
    random.seed(1)
    for n in random.sample(plys, min(400, len(plys))):
        d = z.read(n)
        if d[:8] != b'EPLYBNDS':
            stats['magic:' + d[:8].decode('latin1')] += 1; continue
        cs = chunks(d)
        stats[' '.join(sorted({c[1].decode() for c in cs}))] += 1
        for off, t in cs:
            if t == b'VERT':
                cnt, stride, flags = struct.unpack_from('<IHH', d, off + 4)
                vf[(stride, flags)] += 1
            if t == b'MESH':
                mh[d[off+4:off+8].hex() + '|' + d[off+16:off+20].hex()] += 1
print('\nchunk sets', stats.most_common())
print('VERT (stride, flags)', vf.most_common())
print('MESH flags|word4', mh.most_common(30))
