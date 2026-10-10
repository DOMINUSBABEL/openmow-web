"""Census of tag paths used in .mdl and .mtl files (drives the model exporter spec)."""
import sys, os, zipfile, collections
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from formats.sdl import parse_sdl, decode, Node, Atom  # noqa: E402
GAME = r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2'

paths = {'.mdl': collections.Counter(), '.mtl': collections.Counter()}
ex = {}


def walk(items, prefix, ext, fname):
    for it in items:
        if isinstance(it, Node):
            t = it.tag if it.kind == '{' else '(' + str(it.tag)
            if t and t.startswith('"'):
                t = 'STR'
            p = prefix + '/' + str(t)
            # collapse recursive bone nesting
            p = p.replace('/bone/bone', '/bone')
            while '/bone/bone' in p:
                p = p.replace('/bone/bone', '/bone')
            paths[ext][p] += 1
            ex.setdefault((ext, p), fname)
            walk(it.items, p, ext, fname)


for dp, _, fn in os.walk(os.path.join(GAME, 'resource')):
    for f in fn:
        if not f.endswith('.pak'):
            continue
        z = zipfile.ZipFile(os.path.join(dp, f))
        for n in z.namelist():
            e = os.path.splitext(n)[1].lower()
            if e in paths:
                try:
                    walk(parse_sdl(decode(z.read(n), n)), '', e, n)
                except Exception:
                    pass
for e, c in paths.items():
    print('\n=====', e, len(c), 'distinct paths')
    for p, v in c.most_common(90):
        print(f'  {v:7d}  {p}')
