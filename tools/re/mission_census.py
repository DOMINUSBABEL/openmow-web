"""Structural census of the 15 in-scope skirmish missions (SDL AST based).

Outputs tools/re/mission_census.txt: tag-path histogram, placed object kinds/prototypes,
trigger node types with argument shapes (condition/action), per-mission summary.
"""
import collections
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))
from vfs import VFS  # noqa: E402
from formats.sdl import parse_sdl, decode, Node, Atom  # noqa: E402

SCOPE = [
    'map/single/01_usa-skirmish/01_usa-overlord', 'map/single/01_usa-skirmish/02_usa-carentan',
    'map/single/01_usa-skirmish/03_usa-ardennes',
    'map/single/02_ger-skirmish/01_ger-caen', 'map/single/02_ger-skirmish/02_ger-sthilaire',
    'map/single/02_ger-skirmish/03_ger-marketgarden',
    'map/single/03_eng-skirmish/01_eng-battleaxe', 'map/single/03_eng-skirmish/02_eng-torch',
    'map/single/03_eng-skirmish/03_eng-arnhem',
    'map/single/04_rus-skirmish/01_rus-smolensk', 'map/single/04_rus-skirmish/02_rus-koenigsberg',
    'map/single/04_rus-skirmish/03_rus-manchuria',
    'map/single/05_jap-skirmish/01_jap-khalkhingol', 'map/single/05_jap-skirmish/02_jap-singapore',
    'map/single/05_jap-skirmish/03_jap-iwojima',
]


def shape(a):
    if isinstance(a, Atom):
        if a.quoted:
            return 's'
        return 'n' if a.num() is not None else 'w:' + a.value
    return '{' + (a.tag or '?') + '}' if a.kind == '{' else '(' + (a.tag or '?') + ')'


def main():
    vfs = VFS()
    paths = collections.Counter()
    kinds = collections.Counter()
    protos = collections.Counter()
    nodes = {'condition': collections.Counter(), 'action': collections.Counter()}
    examples = {}
    per = {}

    def walk(n, path, depth):
        if not isinstance(n, Node):
            return
        p = path + '/' + (n.tag or n.kind)
        if depth <= 5:
            paths[p] += 1
        for c in n.items:
            walk(c, p, depth + 1)

    for m in SCOPE:
        mi = m + '/0.mi'
        items = parse_sdl(decode(vfs.read(mi), mi))
        for it in items:
            walk(it, '', 0)
        mission = next(i for i in items if isinstance(i, Node) and i.tag == 'mission')
        cnt = collections.Counter()
        for c in mission.children:
            cnt[c.tag] += 1
            if c.tag in ('Entity', 'Human', 'Vehicle', 'Item', 'Squad', 'Cannon', 'Inventory'):
                kinds[c.tag] += 1
                if c.args:
                    protos[(c.tag, c.args[0].value)] += 1
        per[m] = dict(cnt)
        # triggers: find {triggers {trigger "name" {condition ...} {actions ...}}}
        for trg in mission.find_all('triggers') if hasattr(mission, 'find_all') else []:
            pass

    # generic trigger scan: any node whose tag is a quoted string inside condition/actions
    def scan(n, ctx):
        if not isinstance(n, Node):
            return
        t = n.tag
        if t in ('condition', 'actions', 'action'):
            ctx = 'condition' if t == 'condition' else 'action'
        first = n.items[0] if n.items else None
        if ctx and isinstance(first, Atom) and first.quoted:
            key = first.value
            nodes[ctx][key] += 1
            sh = ' '.join(shape(a) for a in n.items[1:])
            examples.setdefault((ctx, key), collections.Counter())[sh] += 1
        for c in n.items:
            scan(c, ctx)

    for m in SCOPE:
        mi = m + '/0.mi'
        for it in parse_sdl(decode(vfs.read(mi), mi)):
            scan(it, None)

    out = []
    out.append('## tag paths (depth<=5)')
    for p, c in sorted(paths.items()):
        out.append(f'{c:7d} {p}')
    out.append('\n## placed kinds')
    out.append(json.dumps(kinds))
    out.append(f'\n## distinct prototypes: {len(protos)}')
    for (k, p), c in protos.most_common():
        out.append(f'{c:5d} {k} {p}')
    for ctx in ('condition', 'action'):
        out.append(f'\n## {ctx} types: {len(nodes[ctx])}')
        for k, c in nodes[ctx].most_common():
            shapes = examples[(ctx, k)].most_common(4)
            out.append(f'{c:6d} {k}')
            for s, sc in shapes:
                out.append(f'          {sc:5d}x  {s[:220]}')
    out.append('\n## per mission top-level children')
    for m, d in per.items():
        out.append(m + ' ' + json.dumps(d))
    with open(os.path.join(HERE, 'mission_census.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))
    print('ok', len(protos), {k: len(v) for k, v in nodes.items()})


if __name__ == '__main__':
    main()
