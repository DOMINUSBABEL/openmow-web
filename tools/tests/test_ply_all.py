"""Golden test: decode EVERY EPLYBNDS .ply in the installed game.

Run:  python tools/tests/test_ply_all.py   (or pytest)
"""
import sys, os, zipfile, collections, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from formats.ply import parse_ply, PlyError  # noqa: E402

GAME = os.environ.get('MOWAS2_DIR', r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2')


def iter_paks():
    for dp, _, fn in os.walk(os.path.join(GAME, 'resource')):
        for f in fn:
            if f.endswith('.pak'):
                yield os.path.join(dp, f)


def run():
    ok = 0; fail = collections.Counter(); examples = {}; skipped = collections.Counter()
    unknown_bytes = collections.Counter(); mror = 0
    t = time.time()
    for p in iter_paks():
        z = zipfile.ZipFile(p)
        for n in z.namelist():
            if not n.lower().endswith('.ply'):
                continue
            d = z.read(n)
            if d[:8] != b'EPLYBNDS':
                skipped[d[:8].decode('latin1')] += 1
                continue
            try:
                ply = parse_ply(d)
                ok += 1
                if ply.layout.unknown:
                    unknown_bytes[(hex(ply.submeshes[0].fvf), ply.layout.stride)] += 1
                if ply.mirror is not None:
                    mror += 1
            except (PlyError, Exception) as e:  # noqa: BLE001
                k = type(e).__name__ + ': ' + str(e)[:60]
                fail[k] += 1
                examples.setdefault(k, (os.path.basename(p), n))
    print(f'decoded {ok} files in {time.time() - t:.1f}s; failures {sum(fail.values())}; MROR {mror}')
    print('non-EPLY .ply skipped:', dict(skipped))
    print('layouts with unexplained trailing bytes:', dict(unknown_bytes))
    for k, v in fail.most_common(20):
        print(f'  FAIL x{v}: {k}  e.g. {examples[k]}')
    return ok, fail, unknown_bytes


def test_all_ply_decode():
    ok, fail, unknown = run()
    assert ok > 50000
    assert not fail, fail.most_common(5)
    assert not unknown, unknown


if __name__ == '__main__':
    ok, fail, unknown = run()
    sys.exit(1 if fail or unknown else 0)
