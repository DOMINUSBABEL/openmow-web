import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))
from vfs import VFS  # noqa
from formats.sdl import decode  # noqa
vfs = VFS()
paths = sys.argv[1:]
for p in paths:
    print('=' * 20, p)
    try:
        t = decode(vfs.read(p), p)
        print(t[:3500])
    except Exception as e:
        print('ERR', e)
