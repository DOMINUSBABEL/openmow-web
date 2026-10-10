"""Golden test: every BPLYBNDS terrain decodes; indices in range; vertices inside bbox."""
import sys, os, zipfile, collections, struct
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from formats.bply import parse_bply, BplyError  # noqa: E402
import numpy as np  # noqa: E402

GAME = os.environ.get('MOWAS2_DIR', r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2')


def run():
    ok = 0; fail = collections.Counter(); ex = {}; strides = collections.Counter(); pads = collections.Counter()
    for dp, _, fn in os.walk(os.path.join(GAME, 'resource')):
        for f in fn:
            if not f.endswith('.pak'):
                continue
            z = zipfile.ZipFile(os.path.join(dp, f))
            for n in z.namelist():
                if not n.endswith('.ply'):
                    continue
                d = z.read(n)
                if d[:8] != b'BPLYBNDS':
                    continue
                try:
                    t = parse_bply(d)
                    if t.vertex_count == 0:
                        strides['empty'] += 1; ok += 1
                        continue
                    idx = np.frombuffer(t.indices, '<u4')
                    if idx.size and idx.max() >= t.vertex_count:
                        raise BplyError(f'index {idx.max()} >= {t.vertex_count}')
                    v = np.frombuffer(t.vertices, np.uint8).reshape(t.vertex_count, t.stride)
                    pos = v[:, :12].copy().view('<f4').reshape(-1, 3)
                    lo, hi = np.array(t.bbox[:3]), np.array(t.bbox[3:])
                    if (pos < lo - 1).any() or (pos > hi + 1).any():
                        raise BplyError('vertex outside bbox')
                    nrm = v[:, 12:24].copy().view('<f4').reshape(-1, 3)
                    if np.abs(np.linalg.norm(nrm, axis=1) - 1).max() > 0.05:
                        raise BplyError('normals not unit')
                    strides[t.stride] += 1; pads[t.pad] += 1; ok += 1
                except Exception as e:  # noqa: BLE001
                    k = str(e)[:60]; fail[k] += 1; ex.setdefault(k, (f, n))
    print(f'terrains ok {ok}; failures {sum(fail.values())}; strides {dict(strides)}; pads {dict(pads)}')
    for k, v in fail.most_common(10):
        print(f'  FAIL x{v}: {k} e.g. {ex[k]}')
    return ok, fail


def test_all_terrain():
    ok, fail = run()
    assert ok >= 140 and not fail


if __name__ == '__main__':
    ok, fail = run()
    sys.exit(1 if fail else 0)
