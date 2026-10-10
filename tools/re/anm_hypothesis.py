"""Test EANM hypotheses against every .anm in the game."""
import sys, os, zipfile, struct, collections
sys.stdout.reconfigure(encoding='utf-8')
GAME = r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2'


def try_parse(d, sizes):
    if d[:4] != b'EANM':
        return 'magic'
    frames, = struct.unpack_from('<I', d, 12)
    nb, = struct.unpack_from('<I', d, 20)
    o = 24
    for _ in range(nb):
        k, = struct.unpack_from('<I', d, o); o += 4 + k
    fcount = 0; flagset = collections.Counter(); tags = collections.Counter()
    while o < len(d):
        tag = d[o:o+4]
        tags[tag] += 1
        if tag != b'FRM2':
            return f'tag {tag!r} at {o} after {fcount} frames'
        o += 4
        fno, nrec = struct.unpack_from('<HB', d, o); o += 3
        for _ in range(nrec):
            b, fl = struct.unpack_from('<BH', d, o); o += 3
            if b >= nb:
                return f'bone {b} >= {nb}'
            flagset[fl] += 1
            sz = sizes(fl)
            if sz is None:
                return f'flags {fl:#x}'
            o += sz
        fcount += 1
    if o != len(d):
        return f'overrun {o - len(d)}'
    if fcount != frames:
        return f'frames {fcount} != {frames}'
    return flagset


def sizes(fl):
    s = 0
    if fl & 1: s += 12
    if fl & 2: s += 12
    return s


res = collections.Counter(); flags = collections.Counter(); ex = {}; total = 0
for dp, _, fn in os.walk(os.path.join(GAME, 'resource')):
    for f in fn:
        if not f.endswith('.pak'):
            continue
        z = zipfile.ZipFile(os.path.join(dp, f))
        for n in z.namelist():
            if n.endswith('.anm'):
                total += 1
                r = try_parse(z.read(n), sizes)
                if isinstance(r, collections.Counter):
                    res['ok'] += 1; flags.update(r)
                else:
                    k = r.split(' at ')[0][:30]; res[k] += 1; ex.setdefault(k, (f, n, r))
print('total', total, res.most_common(12))
print('flags seen', {hex(k): v for k, v in flags.most_common()})
for k, v in ex.items():
    print(' ', k, v)
