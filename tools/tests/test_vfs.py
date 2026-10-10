"""VFS smoke test: indexing, precedence, reads match zipfile, resolution rules."""
import sys, os, time, zipfile, random
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from vfs import VFS, norm  # noqa: E402


def test_vfs():
    t = time.time()
    v = VFS()
    dt = time.time() - t
    print(f'indexed {len(v.files)} files in {dt:.1f}s')
    assert len(v.files) > 130000
    assert dt < 20
    # reads equal zipfile reads (random sample)
    random.seed(0)
    sample = random.sample(sorted(v.files), 300)
    for p in sample:
        e = v.files[p]
        with zipfile.ZipFile(e.pak) as z:
            info = next(i for i in z.infolist() if i.header_offset == e.header)
            assert z.read(info) == v.read(p), p
    # mounts
    assert v.exists('/set/ballistics.set')
    assert v.exists('/entity/humanskin/eng_com/eng_com.def')
    assert v.exists('/localization/mission.lng')
    assert v.exists('/map/single/00_mow_allied/01-torch_uprising/0.mi')
    # resolution
    assert v.resolve('$/model/jagdtiger_bp', '/entity/-vehicle/tank_heavy/jagdtiger', ('.dds',)) == \
        '/texture/common/model/jagdtiger_bp.dds'
    assert v.resolve('jgdtiger', '/entity/-vehicle/tank_heavy/jagdtiger', ('.dds', '.tga')) == \
        '/entity/-vehicle/tank_heavy/jagdtiger/jgdtiger.dds'
    assert 'humanskin/' in v.listdir('/entity')
    print('vfs ok')


if __name__ == '__main__':
    test_vfs()
