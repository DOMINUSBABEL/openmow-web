"""Test fix for gem_pre.py."""
import sys
sys.path.insert(0, 'tools/server')
from vfs import VFS
from formats.gem_pre import Pre
from test_pre_explore import ent_files
import collections

vfs = VFS()

# Test modified Pre
from formats.sdl import parse_sdl, decode, Node, Atom
import formats.gem_pre as gp

def fixed_call_args(self, items: list) -> dict:
    args: dict = {}
    pos = 0
    i = 0
    while i < len(items):
        it = items[i]
        # Skip literal 'args' keyword (which introduces positional arguments %0, %1, etc.)
        if isinstance(it, Atom) and not it.quoted and it.value == 'args':
            i += 1
            continue
        nxt = items[i + 1] if i + 1 < len(items) else None
        if isinstance(it, Atom) and not it.quoted and isinstance(nxt, Node) and nxt.kind == '(':
            args[it.value] = nxt.items
            i += 2
            continue
        args[str(pos)] = [it]
        pos += 1
        i += 1
    return args

gp.Pre._call_args = fixed_call_args

# Now test the macro call expansion fix
orig_expand = gp.Pre._expand
def fixed_expand(self, items: list, params: dict, base: str, depth: int) -> list:
    out: list = []
    for it in self._subst(items, params) if params else items:
        if isinstance(it, Atom):
            out.append(it)
            continue
        if it.disabled:
            continue
        head = it.items[0] if it.items else None
        if it.kind == '(' and isinstance(head, Atom):
            h = head.value
            if not head.quoted and h == 'include':
                ref = it.items[1].value if len(it.items) > 1 and isinstance(it.items[1], Atom) else ''
                inc_params = dict(params)
                inc_params.update(self._call_args(it.items[2:]))
                out += self._file(gp.norm_path(ref, base), inc_params, depth + 1)
                continue
            if not head.quoted and h == 'define':
                if len(it.items) > 1 and isinstance(it.items[1], Atom):
                    self.macros[it.items[1].value] = (it.items[2:], base)
                continue
            if not head.quoted and h == 'mod':
                name = it.items[1].value if len(it.items) > 1 and isinstance(it.items[1], Atom) else ''
                if name in self.mods:
                    out += self._expand(it.items[2:], {}, base, depth + 1)
                continue
            if not head.quoted and h in gp._ARITH:
                inner = Node('(', [head] + self._expand(it.items[1:], {}, base, depth + 1), it.line)
                r = self._arith(inner)
                out.append(r if r is not None else inner)
                continue
            if head.quoted:
                mac = self.macros.get(h)
                if mac is None:
                    self.warnings.append(f'unknown macro {h!r}')
                    out.append(it)
                    continue
                if depth > gp.MAX_DEPTH:
                    self.warnings.append(f'macro depth exceeded {h!r}')
                    continue
                body, mbase = mac
                raw_args = self._call_args(it.items[1:])
                # expand each argument's values using caller's params and base
                margs = {k: self._expand(v, params, base, depth + 1) for k, v in raw_args.items()}
                out += self._expand(body, margs, mbase, depth + 1)
                continue
        # data block (or unknown call): recurse into children
        out.append(Node(it.kind, self._expand(it.items, {}, base, depth + 1), it.line))
    return out

gp.Pre._expand = fixed_expand

p = gp.Pre(vfs)
for ef in ent_files:
    p.load(ef)

print("Warnings count with fix:", len(p.warnings))
warn_counts = collections.Counter(p.warnings)
print("Top warnings:", warn_counts.most_common(20))
