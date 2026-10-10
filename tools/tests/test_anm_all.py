"""Golden test: every EANM decodes; rotation quaternions are unit length."""
import sys, os, zipfile, collections
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from formats.anm import parse_anm, AnmError  # noqa: E402

GAME = os.environ.get('MOWAS2_DIR', r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2')


def run():
    ok = 0; fail = collections.Counter(); ex = {}; flags = collections.Counter(); badq = 0
    for dp, _, fn in os.walk(os.path.join(GAME, 'resource')):
        for f in fn:
            if not f.endswith('.pak'):
                continue
            z = zipfile.ZipFile(os.path.join(dp, f))
            for n in z.namelist():
                if not n.endswith('.anm'):
                    continue
                try:
                    a = parse_anm(z.read(n))
                    for keys in a.tracks.values():
                        for k in keys:
                            flags[k.flags] += 1
                            if k.rot and sum(c * c for c in k.rot[:3]) > 1.001:
                                badq += 1
                    ok += 1
                except (AnmError, Exception) as e:  # noqa: BLE001
                    k = str(e)[:50]; fail[k] += 1; ex.setdefault(k, (f, n))
    print(f'anm ok {ok}; failures {sum(fail.values())}; non-unit quats {badq}')
    print('flags', {hex(k): v for k, v in flags.most_common()})
    for k, v in fail.most_common(15):
        print(f'  FAIL x{v}: {k} e.g. {ex[k]}')
    return ok, fail, badq


def test_all_anm():
    ok, fail, badq = run()
    assert ok > 3900 and not fail and badq == 0


if __name__ == '__main__':
    ok, fail, badq = run()
    sys.exit(1 if fail or badq else 0)
