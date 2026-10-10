"""Characterise optional MESH fields vs flags across many EPLYBNDS files."""
import sys, zipfile, struct, collections, random
sys.stdout.reconfigure(encoding='utf-8')
R = r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2\resource'

def is_pstr(d, o):
    if o >= len(d): return False
    n = d[o]
    s = d[o+1:o+1+n]
    return 3 < n < 120 and len(s) == n and all(32 <= c < 127 for c in s) and s.lower().endswith(b'.mtl')

corr = collections.Counter(); tails = collections.Counter(); vstr = collections.Counter(); unk = collections.Counter()
examples = {}
for pak in ('c1.pak', 'c2.pak', 'e1.pak', 'e2.pak'):
    z = zipfile.ZipFile(R + r'\entity\\' + pak)
    plys = [n for n in z.namelist() if n.endswith('.ply')]
    random.seed(7)
    for name in random.sample(plys, min(1500, len(plys))):
        d = z.read(name)
        if d[:8] != b'EPLYBNDS':
            unk['magic ' + repr(d[:8])] += 1; continue
        o = 32
        try:
            while o < len(d):
                tag = d[o:o+4]; o += 4
                if tag == b'SKIN':
                    n, = struct.unpack_from('<I', d, o); o += 4
                    for _ in range(n): o += 1 + d[o]
                elif tag == b'MESH':
                    fmt, first, cnt, flags = struct.unpack_from('<IIII', d, o); o += 16
                    gap = None
                    for g in (0, 4, 8, 12):
                        if is_pstr(d, o + g): gap = g; break
                    if gap is None:
                        unk['nostr fmt=%x flags=%x' % (fmt, flags)] += 1; raise ValueError('nostr')
                    corr[(hex(fmt), hex(flags), gap)] += 1
                    if gap: examples.setdefault((hex(fmt), hex(flags), gap), (name, d[o:o+gap].hex()))
                    o += gap
                    o += 1 + d[o]
                    # tail before next tag
                    nxt = min([k for k in (d.find(t, o) for t in (b'MESH', b'VERT', b'SKIN', b'INDX')) if k != -1] or [len(d)])
                    tl = nxt - o
                    # skinned: u8 count + bytes
                    if tl and d[o] == tl - 1:
                        tails[(hex(fmt), 'u8list')] += 1
                    elif tl:
                        tails[(hex(fmt), 'tail%d' % tl)] += 1
                        examples.setdefault((hex(fmt), 'tail%d' % tl), (name, d[o:o+min(tl, 24)].hex()))
                    o = nxt
                elif tag == b'VERT':
                    cnt, stride, fl = struct.unpack_from('<IHH', d, o); o += 8
                    vstr[(stride, hex(fl))] += 1
                    o += cnt * stride
                elif tag == b'INDX':
                    cnt, = struct.unpack_from('<I', d, o); o += 4 + cnt * 2
                else:
                    unk['tag ' + repr(tag)] += 1; break
        except Exception as e:
            unk['err ' + str(e)[:40]] += 1
print('MESH (fmt, flags, gap):'); [print('  ', k, v) for k, v in corr.most_common()]
print('MESH tails:'); [print('  ', k, v) for k, v in tails.most_common()]
print('VERT (stride, flags):', vstr.most_common())
print('UNKNOWN:', unk.most_common(20))
print('EXAMPLES:'); [print('  ', k, v) for k, v in list(examples.items())[:25]]
