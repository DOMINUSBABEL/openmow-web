"""Brute-force per-flag-bit payload sizes for EANM records."""
import sys, os, zipfile, struct, collections, itertools
sys.stdout.reconfigure(encoding='utf-8')
GAME = r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2'

files = []
for dp, _, fn in os.walk(os.path.join(GAME, 'resource')):
    for f in fn:
        if f.endswith('.pak'):
            z = zipfile.ZipFile(os.path.join(dp, f))
            files += [z.read(n) for n in z.namelist() if n.endswith('.anm')]
print('anm files', len(files))


def parse(d, bitsz, hdr):
    frames, = struct.unpack_from('<I', d, 12)
    nb, = struct.unpack_from('<I', d, 20)
    o = 24
    for _ in range(nb):
        k, = struct.unpack_from('<I', d, o); o += 4 + k
    last = -1
    while o < len(d):
        if d[o:o+4] != b'FRM2':
            return False
        o += 4
        if hdr == 'H B':
            fno, nrec = struct.unpack_from('<HB', d, o); o += 3
        else:
            fno, nrec = struct.unpack_from('<HH', d, o); o += 4
        if fno <= last or fno >= max(frames, 1) + 1:
            return False
        last = fno
        for _ in range(nrec):
            if o + 3 > len(d):
                return False
            b, fl = struct.unpack_from('<BH', d, o); o += 3
            if b >= nb:
                return False
            for bit, sz in bitsz.items():
                if fl & bit:
                    o += sz
            if fl & ~sum(bitsz):
                return False
    return o == len(d)


best = []
for hdr in ('H B', 'H H'):
    for s4, s8, s10 in itertools.product((0, 4, 8, 12, 16), (0, 4, 8, 12, 16), (0, 4, 12, 16)):
        bitsz = {1: 12, 2: 12, 4: s4, 8: s8, 0x10: s10}
        ok = sum(parse(d, bitsz, hdr) for d in files)
        best.append((ok, hdr, s4, s8, s10))
best.sort(reverse=True)
for b in best[:8]:
    print(b)
