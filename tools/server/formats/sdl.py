"""GEM2 SDL text format parser (lossless AST).

Grammar (see docs/formats/sdl.md):
    file    := item*
    item    := block | call | atom
    block   := '{' item* '}'          # data node: first atom is usually the tag
    call    := '(' item* ')'          # directive: include / define / mod / macro call
    atom    := STRING | NUMBER | WORD
    comment := ';' .* EOL             # stripped
A '##' word inside a block marks it disabled in the editor; kept as an atom.
Text encoding: UTF-8 for .lng; other files are ASCII/cp1251-ish -> decoded latin1
losslessly (re-encode with latin1 to recover bytes).
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field


class SdlError(ValueError):
    pass


@dataclass(slots=True)
class Atom:
    value: str
    quoted: bool = False

    def num(self) -> float | int | None:
        if self.quoted:
            return None
        v = self.value
        try:
            if v.lower().startswith(('0x', '-0x')):
                return int(v, 16)
            if re.fullmatch(r'[-+]?\d+', v):
                return int(v)
            return float(v)
        except ValueError:
            return None

    def __repr__(self) -> str:
        return f'"{self.value}"' if self.quoted else self.value


@dataclass(slots=True)
class Node:
    kind: str                     # '{' block or '(' call
    items: list = field(default_factory=list)
    line: int = 0

    # --- convenience accessors (do not assume semantics beyond syntax) ---
    @property
    def tag(self) -> str | None:
        return self.items[0].value if self.items and isinstance(self.items[0], Atom) else None

    @property
    def args(self) -> list[Atom]:
        return [i for i in self.items[1:] if isinstance(i, Atom)]

    @property
    def children(self) -> list['Node']:
        return [i for i in self.items if isinstance(i, Node)]

    @property
    def disabled(self) -> bool:
        return any(isinstance(i, Atom) and not i.quoted and i.value == '##' for i in self.items[:2])

    def find(self, tag: str) -> 'Node | None':
        for c in self.children:
            if c.kind == '{' and c.tag == tag:
                return c
        return None

    def find_all(self, tag: str) -> list['Node']:
        return [c for c in self.children if c.kind == '{' and c.tag == tag]


_TOKEN = re.compile(r'''
    (?P<ws>[ \t\r\n\f\v\x00\x1a]+)
  | (?P<comment>;[^\n]*)
  | (?P<str>"(?:[^"\\]|\\.)*"?)
  | (?P<open>[{(])
  | (?P<close>[})])
  | (?P<word>[^\s{}()";]+)
''', re.X)


def parse_sdl(text: str, strict: bool = False, warnings: list | None = None) -> list:
    """Parse SDL text into a list of top-level items (Atom | Node).

    Vanilla data contains a handful of files with mismatched closers (e.g.
    `{Locomotion ... )`). The engine accepts them, so by default a closer of
    the wrong type simply closes the innermost open node, a stray closer at top
    level is ignored and unclosed nodes are closed at EOF. Each recovery is
    appended to `warnings`. strict=True raises instead.
    """
    root: list = []
    stack: list[Node] = []
    cur = root
    line = 1
    pos = 0
    n = len(text)
    m_ = _TOKEN.match

    def warn(msg: str) -> None:
        if strict:
            raise SdlError(msg)
        if warnings is not None:
            warnings.append(msg)

    while pos < n:
        m = m_(text, pos)
        if m is None:
            raise SdlError(f'line {line}: unexpected {text[pos:pos + 20]!r}')
        kind = m.lastgroup
        tok = m.group()
        pos = m.end()
        if kind == 'ws' or kind == 'comment':
            line += tok.count('\n')
            continue
        if kind == 'str':
            line += tok.count('\n')
            body = tok[1:-1] if len(tok) > 1 and tok.endswith('"') else tok[1:]
            cur.append(Atom(body, True))
        elif kind == 'word':
            cur.append(Atom(tok))
        elif kind == 'open':
            node = Node(tok, [], line)
            cur.append(node)
            stack.append(node)
            cur = node.items
        else:  # close
            if not stack:
                warn(f'line {line}: stray {tok!r} ignored')
                continue
            node = stack.pop()
            if (node.kind == '{') != (tok == '}'):
                warn(f'line {line}: {node.kind!r} (line {node.line}) closed by {tok!r}')
            cur = stack[-1].items if stack else root
    if stack:
        warn(f'unclosed {stack[-1].kind!r} opened at line {stack[-1].line}')
    return root


def decode(data: bytes, path: str = '') -> str:
    if path.lower().endswith('.lng'):
        try:
            return data.decode('utf-8-sig')
        except UnicodeDecodeError:
            pass
    return data.decode('latin1')


def to_json(item):
    """Plain JSON form consumed by the web client (contract: web/src/contracts/sdl.ts).

    Atom   -> string (quoted) | number | {"w": word}   (bare words keep identity)
    Node   -> {"k": "{" | "(", "i": [...]}
    """
    if isinstance(item, Atom):
        if item.quoted:
            return item.value
        v = item.num()
        return v if v is not None else {'w': item.value}
    return {'k': item.kind, 'i': [to_json(x) for x in item.items]}
