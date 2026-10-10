"""Inspect skeleton hierarchy and revolute bones in tank MDL."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))
from vfs import VFS
from formats.sdl import parse_sdl, decode, Node

def walk_bones(node, depth=0):
    if not isinstance(node, Node):
        return
    indent = "  " * depth
    if node.tag == 'bone':
        name = node.args[0].value if node.args else '?'
        kinds = [a.value for a in node.args[1:]]
        limits = node.find('limits')
        speed = node.find('speed')
        lim_s = [a.value for a in limits.args] if limits else ''
        spd_s = speed.args[0].value if speed and speed.args else ''
        extra = f" kinds={kinds}" if kinds else ""
        if lim_s: extra += f" limits={lim_s}"
        if spd_s: extra += f" speed={spd_s}"
        print(f"{indent}- {name}{extra}")
    for c in node.children:
        walk_bones(c, depth + 1 if node.tag == 'bone' else depth)

def main():
    vfs = VFS()
    mdl_path = '/entity/-vehicle/tank_medium/m4a3_75/m4a3_75.mdl'
    items = parse_sdl(decode(vfs.read(mdl_path), mdl_path))
    walk_bones(items[0])

if __name__ == '__main__':
    main()
