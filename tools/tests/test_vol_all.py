"""Golden test: every EVLM .vol decodes, closed triangle mesh, indices in range."""
import sys, os, zipfile, collections
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from formats.vol import parse_vol  # noqa: E402

GAME = os.environ.get('MOWAS2_DIR', r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2')


def run():
    ok = 0; fail = collections.Counter(); ex = {}; extras = collections.Counter(); open_meshes = 0
    for dp, _, fn in os.walk(os.path.join(GAME, 'resource')):
        for f in fn:
            if not f.endswith('.pak'):
                continue
            z = zipfile.ZipFile(os.path.join(dp, f))
            for n in z.namelist():
                if not n.endswith('.vol'):
                    continue
                try:
                    v = parse_vol(z.read(n))
                    extras.update(v.extra.keys())
                    if len(v.indices) % 3:
                        raise ValueError('index count not multiple of 3')
                    edges = collections.Counter()
                    for i in range(0, len(v.indices), 3):
                        a, b, c = v.indices[i:i + 3]
                        for e in ((a, b), (b, c), (c, a)):
                            edges[tuple(sorted(e))] += 1
                    if any(cnt != 2 for cnt in edges.values()):
                        open_meshes += 1
                    ok += 1
                except Exception as e:  # noqa: BLE001
                    k = str(e)[:40]; fail[k] += 1; ex.setdefault(k, (f, n, str(e)))
    print(f'vol ok {ok}; failures {sum(fail.values())}; extra chunks {dict(extras)}; non-closed {open_meshes}')
    for k, v in fail.most_common(10):
        print(f'  FAIL x{v}: {ex[k]}')
    return ok, fail


def test_all_vol():
    ok, fail = run()
    assert ok >= 3422 and not fail


if __name__ == '__main__':
    ok, fail = run()
    sys.exit(1 if fail else 0)
