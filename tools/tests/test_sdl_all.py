"""Golden test: every SDL text file in the game parses with balanced structure.

Run: python tools/tests/test_sdl_all.py
"""
import sys, os, zipfile, collections, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from formats.sdl import parse_sdl, decode, SdlError  # noqa: E402

GAME = os.environ.get('MOWAS2_DIR', r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2')
TEXT_EXT = {'.def', '.mdl', '.mtl', '.set', '.mi', '.lng', '.info', '.inc', '.ext', '.ammo', '.weapon',
            '.pattern', '.grenade', '.reg', '.dl', '.fsm', '.mine', '.template', '.accuracy', '.hand',
            '.presets', '.fx', '.tpl', '.font', '.water', '.tex', '.mod', '.def1'}
BINARY_MAGIC = (b'EPLY', b'BPLY', b'EANM', b'EVLM', b'DDS ', b'RIFF', b'GRAS')


def iter_text_files():
    paks = [os.path.join(GAME, 'localization.pak')]
    for dp, _, fn in os.walk(os.path.join(GAME, 'resource')):
        paks += [os.path.join(dp, f) for f in fn if f.endswith('.pak')]
    for p in paks:
        z = zipfile.ZipFile(p)
        for info in z.infolist():
            n = info.filename
            if info.is_dir():
                continue
            base = n.rsplit('/', 1)[-1]
            ext = os.path.splitext(base)[1].lower()
            if ext in TEXT_EXT or (ext == '' and (n.startswith('set/') or base in ('map',))):
                if n.startswith('shader/'):
                    continue  # HLSL includes, not SDL
                d = z.read(n)
                if d[:4] in BINARY_MAGIC:
                    continue
                yield os.path.basename(p), n, d


def run():
    ok = 0; fail = collections.Counter(); ex = {}; per_ext = collections.Counter(); recovered = []
    t = time.time()
    for pak, n, d in iter_text_files():
        try:
            w = []
            parse_sdl(decode(d, n), warnings=w)
            if w:
                recovered.append((pak, n, w[0]))
            ok += 1
            per_ext[os.path.splitext(n)[1].lower() or '<none>'] += 1
        except SdlError as e:
            k = str(e)[:70]
            fail[(os.path.splitext(n)[1], k)] += 1
            ex.setdefault((os.path.splitext(n)[1], k), (pak, n))
    print(f'parsed {ok} files in {time.time() - t:.1f}s; failures {sum(fail.values())}; lenient recoveries {len(recovered)}')
    print('by ext:', dict(per_ext.most_common()))
    for r in recovered:
        print('  recovered:', r)
    for k, v in fail.most_common(25):
        print(f'  FAIL x{v}: {k} e.g. {ex[k]}')
    return ok, fail, recovered


def test_all_sdl_parse():
    ok, fail, recovered = run()
    assert ok > 48000
    assert not fail, fail.most_common(5)
    assert len(recovered) <= 4, recovered  # known vanilla defects (blitz3_6*, vehicles_ger.set)


if __name__ == '__main__':
    ok, fail, recovered = run()
    sys.exit(1 if fail or len(recovered) > 4 else 0)
