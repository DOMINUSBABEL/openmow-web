"""Model converter test: tank + soldier + random sample of entity .def files."""
import sys, os, json, struct, random, collections, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from vfs import VFS  # noqa: E402
from convert.model import def_to_mdl, mdl_to_glb  # noqa: E402

v = VFS()


def check_glb(b: bytes):
    magic, ver, total = struct.unpack_from('<III', b, 0)
    assert magic == 0x46546C67 and ver == 2 and total == len(b)
    jlen, = struct.unpack_from('<I', b, 12)
    return json.loads(b[20:20 + jlen])


def convert(defp):
    mdl = def_to_mdl(v, defp)
    glb, rep = mdl_to_glb(v, mdl)
    js = check_glb(glb)
    return glb, rep, js


def test_known_models():
    out = os.path.join(os.path.dirname(__file__), '..', '..', '.cache', 'g0')
    os.makedirs(out, exist_ok=True)
    for defp in ('/entity/-vehicle/tank_heavy/jagdtiger/jagdtiger.def', '/entity/humanskin/eng_com/eng_com.def'):
        glb, rep, js = convert(defp)
        print(defp, 'bones', rep['bones'], 'meshes', rep['meshes'], 'missing', rep['missing'][:5], 'bytes', len(glb))
        assert rep['meshes'] > 0 and not rep['missing']
        with open(os.path.join(out, os.path.basename(defp) + '.glb'), 'wb') as f:
            f.write(glb)


def test_sample_defs(n=400):
    defs = [p for p in v.files if p.startswith('/entity/') and p.endswith('.def')]
    random.seed(5)
    ok = 0; fail = collections.Counter(); ex = {}; missing = 0; nomodel = 0
    t = time.time()
    for d in random.sample(defs, n):
        try:
            _, rep, _ = convert(d)
            ok += 1
            missing += bool(rep['missing'])
        except Exception as e:  # noqa: BLE001
            k = type(e).__name__ + ': ' + str(e)[:50]
            if 'no Extension' in k:
                nomodel += 1; continue
            fail[k] += 1; ex.setdefault(k, d)
    print(f'sample: ok {ok}, no-model defs {nomodel}, with missing refs {missing}, failures {sum(fail.values())} '
          f'in {time.time() - t:.1f}s')
    for k, c in fail.most_common(10):
        print('  FAIL', c, k, ex[k])
    assert not fail


if __name__ == '__main__':
    test_known_models()
    test_sample_defs()
