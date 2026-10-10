"""GEM2 SDL preprocessor: include / define / macro call / mod / prefix arithmetic.

Empirical semantics (docs/formats/sdl.md §preprocessor):
  (include "path" [name(v..)]*)  splice the parsed file; path absolute ('/x', '\\x') or relative to the
                                 including file; named args become %params inside the included text.
  (define "name" body...)        register macro; later definitions override (lexical, per resolution).
  ("name" [name(v..)|v]*)        expand macro body with %name / %0.. substitution.
  (mod "mp" body...)             splice body only when mod is active (single player: none active).
  (+ a b) (- a b) (* a b) (/ a b) numeric folding after substitution.
  '##' disabled nodes are dropped.
  Directory '.presets' files are implicitly included (root-most first) before a /set/ file.
Unknown macros / params are reported in `self.warnings` and left in place (never silently dropped).
"""
from __future__ import annotations
import posixpath
import re
from dataclasses import dataclass, field

from formats.sdl import parse_sdl, decode, Node, Atom

_PCT = re.compile(r'%(\w+)')
_ARITH = {'+', '-', '*', '/'}
MAX_DEPTH = 64


def norm_path(ref: str, base_dir: str) -> str:
    r = ref.replace('\\', '/').strip()
    if r.startswith('/'):
        p = r
    else:
        p = posixpath.join(base_dir or '/', r)
    return posixpath.normpath(p).lower()


def _fmt_num(v: float) -> str:
    if abs(v - round(v)) < 1e-9:
        return str(int(round(v)))
    return repr(float(v))


@dataclass
class Pre:
    vfs: object
    mods: tuple[str, ...] = ()
    macros: dict = field(default_factory=dict)
    warnings: list = field(default_factory=list)
    files: list = field(default_factory=list)       # every file read (provenance)
    macro_uses: dict[str, int] = field(default_factory=dict)
    _presets_done: set = field(default_factory=set)

    # ---------------- public ----------------
    def load(self, path: str, params: dict | None = None) -> list:
        path = path.lower()
        out: list = []
        for pre in self._presets_for(path):
            out += self._file(pre, {}, 0)
        out += self._file(path, params or {}, 0)
        return out

    # ---------------- internals ----------------
    def _presets_for(self, path: str) -> list[str]:
        if not path.startswith('/set/'):
            return []
        res = []
        d = posixpath.dirname(path)
        chain = []
        while d and d != '/':
            chain.append(d)
            d = posixpath.dirname(d)
        for d in reversed(chain):
            p = d + '/.presets'
            if p not in self._presets_done and self.vfs.exists(p):
                self._presets_done.add(p)
                res.append(p)
        return res

    def _file(self, path: str, params: dict, depth: int) -> list:
        if depth > MAX_DEPTH:
            self.warnings.append(f'include depth exceeded at {path}')
            return []
        try:
            text = decode(self.vfs.read(path), path)
        except FileNotFoundError:
            self.warnings.append(f'missing include {path}')
            return []
        self.files.append(path)
        items = parse_sdl(text)
        return self._expand(items, params, posixpath.dirname(path), depth + 1)

    def _subst_atom(self, a: Atom, params: dict) -> list:
        v = a.value
        if '%' not in v:
            return [a]
        m = _PCT.fullmatch(v)
        if m and not a.quoted:
            val = params.get(m.group(1))
            if val is None:
                self.warnings.append(f'unbound %{m.group(1)}')
                return [a]
            return [x for x in val]  # splice (may be several atoms / nodes)

        def rep(mm):
            val = params.get(mm.group(1))
            if val is None:
                self.warnings.append(f'unbound %{mm.group(1)}')
                return mm.group(0)
            return ' '.join(x.value if isinstance(x, Atom) else '' for x in val)
        return [Atom(_PCT.sub(rep, v), a.quoted)]

    def _subst(self, items: list, params: dict) -> list:
        out = []
        for it in items:
            if isinstance(it, Atom):
                out += self._subst_atom(it, params)
            else:
                out.append(Node(it.kind, self._subst(it.items, params), it.line))
        return out

    def _call_args(self, items: list) -> dict:
        """[word, (..), word, (..), atom ...] -> {'word': [...], '0': [atom], ...}"""
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

    def _arith(self, node: Node):
        op = node.items[0].value
        vals = []
        for x in node.items[1:]:
            if not isinstance(x, Atom):
                return None
            n = x.num()
            if n is None:
                return None
            vals.append(float(n))
        if not vals:
            return None
        r = vals[0]
        if op == '-' and len(vals) == 1:
            return Atom(_fmt_num(-r))
        for v in vals[1:]:
            if op == '+': r += v
            elif op == '-': r -= v
            elif op == '*': r *= v
            elif op == '/': r = r / v if v else 0.0
        return Atom(_fmt_num(r))

    def _expand(self, items: list, params: dict, base: str, depth: int) -> list:
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
                    out += self._file(norm_path(ref, base), inc_params, depth + 1)
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
                if not head.quoted and h in _ARITH:
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
                    if depth > MAX_DEPTH:
                        self.warnings.append(f'macro depth exceeded {h!r}')
                        continue
                    body, mbase = mac
                    self.macro_uses[h] = self.macro_uses.get(h, 0) + 1
                    raw_args = self._call_args(it.items[1:])
                    # expand each argument's values using caller's params and base
                    margs = {k: self._expand(v, params, base, depth + 1) for k, v in raw_args.items()}
                    out += self._expand(body, margs, mbase, depth + 1)
                    continue
            # data block (or unknown call): recurse into children
            out.append(Node(it.kind, self._expand(it.items, {}, base, depth + 1), it.line))
        return out


# ---------------- inheritance ({from "..."}) ----------------
def block_key(n: Node):
    """Override identity for merge: (tag, first-arg) for keyed blocks, tag otherwise."""
    if n.kind != '{' or not n.tag:
        return None
    t = n.tag.lower()
    a = n.items[1] if len(n.items) > 1 else None
    if isinstance(a, Atom) and a.quoted:
        return (t, a.value.lower())
    return (t,)


def merge_blocks(base: list, over: list) -> list:
    """Child items override base items with the same block_key; new ones are appended."""
    out = list(base)
    idx = {}
    for i, it in enumerate(out):
        if isinstance(it, Node):
            k = block_key(it)
            if k is not None:
                idx[k] = i
    for it in over:
        k = block_key(it) if isinstance(it, Node) else None
        if k is not None and k in idx:
            out[idx[k]] = it
        else:
            if k is not None:
                idx[k] = len(out)
            out.append(it)
    return out
