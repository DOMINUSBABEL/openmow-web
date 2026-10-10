"""Test prototype extraction & merge_blocks on sample items, entities, and breeds."""
import os
import posixpath
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))
from vfs import VFS
from formats.gem_pre import Pre
from formats.sdl import Node, Atom, to_json

vfs = VFS()
pre = Pre(vfs)

def get_node_key(n: Node) -> str | None:
    if not n.items:
        return None
    first = n.items[0]
    return first.value if isinstance(first, Atom) else None

def extract_stuff_blocks(nodes: list) -> tuple[str | None, list[Node]]:
    """Return (parent_from_ref, blocks) for a loaded stuff file."""
    for n in nodes:
        if isinstance(n, Node) and n.items:
            k = get_node_key(n)
            if k == 'from' and len(n.items) > 1:
                from_ref = getattr(n.items[1], 'value', str(n.items[1]))
                return from_ref, n.children
            if k in ('weapon_bullet', 'weapon_throwable', 'item', 'tag'):
                # Wrapper container
                return None, n.children
    # Otherwise top-level nodes
    return None, [n for n in nodes if isinstance(n, Node)]

def merge_blocks(parent_blocks: list[Node], child_blocks: list[Node]) -> list[Node]:
    merged_map = {}
    order = []
    for n in parent_blocks:
        k = get_node_key(n)
        if k:
            merged_map[k] = n
            if k not in order:
                order.append(k)
        else:
            order.append(id(n))
            merged_map[id(n)] = n
    for n in child_blocks:
        k = get_node_key(n)
        if k:
            merged_map[k] = n
            if k not in order:
                order.append(k)
        else:
            order.append(id(n))
            merged_map[id(n)] = n
    return [merged_map[k] for k in order]

valter_nodes = pre.load('/set/stuff/pistol/valter')
pistol_pat = pre.load('/set/stuff/pistol/pistol.pattern')
bullet_pat = pre.load('/set/stuff/bullet.pattern')

valter_ref, valter_blocks = extract_stuff_blocks(valter_nodes)
print(f"Valter from: {valter_ref}, blocks: {[get_node_key(n) for n in valter_blocks]}")

pistol_ref, pistol_blocks = extract_stuff_blocks(pistol_pat)
print(f"Pistol from: {pistol_ref}, blocks: {[get_node_key(n) for n in pistol_blocks]}")

bullet_ref, bullet_blocks = extract_stuff_blocks(bullet_pat)
print(f"Bullet from: {bullet_ref}, blocks: {[get_node_key(n) for n in bullet_blocks]}")

merged_pistol = merge_blocks(bullet_blocks, pistol_blocks)
merged_valter = merge_blocks(merged_pistol, valter_blocks)
print(f"\nMerged valter blocks count: {len(merged_valter)}")
print("Merged valter block keys:", [get_node_key(n) for n in merged_valter])

entity_node = next(n for n in merged_valter if get_node_key(n) == 'entity')
print("Merged valter entity tag:", [a.value for a in entity_node.args])
range_node = next(n for n in merged_valter if get_node_key(n) == 'range')
print("Merged valter range tag:", [a.value for a in range_node.args])
damage_node = next(n for n in merged_valter if get_node_key(n) == 'healthDamage')
print("Merged valter healthDamage:", [a.value for a in damage_node.args])
recharge_node = next(n for n in merged_valter if get_node_key(n) == 'rechargeTime')
print("Merged valter rechargeTime:", [a.value for a in recharge_node.args])
filling_node = next(n for n in merged_valter if get_node_key(n) == 'filling')
print("Merged valter filling:", [a.value for a in filling_node.args])

# Test on 88mm_kwk36
kwk_nodes = pre.load('/set/stuff/gun/88mm_kwk36')
kwk_ref, kwk_blocks = extract_stuff_blocks(kwk_nodes)
print(f"\n88mm_kwk36 from: {kwk_ref}, blocks: {[get_node_key(n) for n in kwk_blocks]}")
gun_pat = pre.load('/set/stuff/gun/gun.pattern')
gun_ref, gun_blocks = extract_stuff_blocks(gun_pat)
print(f"gun.pattern from: {gun_ref}, blocks: {[get_node_key(n) for n in gun_blocks]}")
merged_88 = merge_blocks(gun_blocks, kwk_blocks)
print(f"Merged 88mm keys: {[get_node_key(n) for n in merged_88]}")
range_88 = next(n for n in merged_88 if get_node_key(n) == 'range')
print("88mm range:", [a.value for a in range_88.args])
recharge_88 = next(n for n in merged_88 if get_node_key(n) == 'rechargeTime')
print("88mm rechargeTime:", [a.value for a in recharge_88.args])
filling_88 = next(n for n in merged_88 if get_node_key(n) == 'filling')
print("88mm filling:", [a.value for a in filling_88.args])


